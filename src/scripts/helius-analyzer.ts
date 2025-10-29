#!/usr/bin/env node

/**
 * Script to fetch Helius transaction data, analyze swap P/L and stats, 
 * save results to DB, and generate reports.
 * 
 * REFRACTORED to use dedicated services for sync, analysis, and reporting.
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import { createLogger } from 'core/utils/logger';
import { parseTimeRange } from 'core/utils/cliUtils';
import { displaySummary, displayDetailedResults } from 'core/utils/display-utils'; 

// Import Services
import { HeliusSyncService, SyncOptions } from 'core/services/helius-sync-service';
import { PnlAnalysisService } from 'core/services/pnl-analysis-service';
import { DatabaseService, prisma } from 'core/services/database-service'; 
import { ReportingService } from 'core/reporting/reportGenerator'; 
import { BehaviorService } from 'core/analysis/behavior/behavior-service';
import { BehaviorAnalysisConfig } from '@/types/analysis';
import { HeliusApiClient } from 'core/services/helius-api-client';
import { DexscreenerService } from '../api/services/dexscreener.service';
import { TokenInfoService } from '../api/services/token-info.service';
import { OnchainMetadataService } from '../core/services/onchain-metadata.service';
import { HttpService } from '@nestjs/axios';

// Initialize environment variables
dotenv.config();

const logger = createLogger('HeliusAnalyzerScript');

/**
 * Main analysis function.
 */
async function analyzeWalletWithHelius() {
  // --- Argument Parsing ---
  const argv = await yargs(hideBin(process.argv))
    .option('walletAddress', {
      alias: 'w',
      type: 'string',
      description: 'The Solana wallet address to analyze',
      required: true,
    })
    .option('limit', {
      alias: 'l',
      type: 'number',
      default: 100,
      description: 'Batch size for fetching transactions from Helius API',
    })
    .option('maxSignatures', {
        alias: 'm',
        type: 'number',
        description: 'Maximum number of signatures to fetch/process. Overrides fetchAll if set. Useful for initial large fetches or limiting history.',
    })
    .option('fetchAll', {
      type: 'boolean',
      default: false,
      description: 'Attempt to fetch all transaction history (can be very slow, use maxSignatures if possible)',
    })
    .option('fetchOlder', {
        type: 'boolean',
        default: false,
        description: 'Force fetching older transactions, ignoring last processed state in DB.'
    })
    .option('smartFetch', {
        type: 'boolean',
        default: false,
        description: 'Fetch new transactions first, then older up to maxSignatures. Requires --maxSignatures.'
    })
    .option('skipApi', {
      type: 'boolean',
      default: false,
      description: 'Skip Helius API calls and analyze only data already in the database',
    })
    .option('analyzeBehavior', {
        type: 'boolean',
        default: false,
        description: 'Perform behavioral analysis in addition to P/L analysis',
    })
    .option('startDate', { 
        type: 'string', 
        description: 'Start date (YYYY-MM-DD) for analysis period (inclusive)' 
    })
    .option('endDate', { 
        type: 'string', 
        description: 'End date (YYYY-MM-DD) for analysis period (inclusive)' 
    })
    .option('saveAnalysisCsv', {
      type: 'boolean',
      default: false,
      description: 'Save the detailed analysis results to a CSV file',
    })
    .option('saveReportMd', {
        type: 'boolean',
        default: true, // Default to saving markdown report
        description: 'Save the summary analysis report to a Markdown file'
    })
    .option('displayLimit', {
        alias: 'd',
        type: 'number',
        default: 20,
        description: 'Number of top/bottom results to display in console summary'
    })
    .check((argv) => {
        if (!argv.walletAddress) {
            throw new Error('Wallet address is required.');
        }
        if (argv.smartFetch && !argv.maxSignatures) {
            throw new Error('--smartFetch requires --maxSignatures to be set.');
        }
        // Add other validation as needed
        return true;
    })
    .parseAsync();

  const { 
      walletAddress, 
      limit, 
      maxSignatures, 
      fetchAll, 
      fetchOlder, 
      smartFetch,
      skipApi, 
      startDate, 
      endDate, 
      saveAnalysisCsv, 
      saveReportMd,
      displayLimit,
      analyzeBehavior,
    } = argv;

  logger.info(`Starting analysis for wallet: ${walletAddress}`);
  logger.debug('CLI Arguments:', argv);

  const heliusApiKey = process.env.HELIUS_API_KEY;
  if (!heliusApiKey && !skipApi) {
    logger.error('HELIUS_API_KEY environment variable is not set. Cannot fetch data from Helius.');
    process.exit(1);
  }

  // --- Instantiate Services ---
  const dbService = new DatabaseService();

  // Instantiate HeliusApiClient once
  let heliusApiClient: HeliusApiClient | null = null;
  if (heliusApiKey) {
    heliusApiClient = new HeliusApiClient({ 
        apiKey: heliusApiKey, 
        network: 'mainnet' // Or make configurable if needed
    }, dbService); // Pass dbService if HeliusApiClient constructor needs it
  }

  let syncService: HeliusSyncService | null = null;
  if (heliusApiClient) { 
      syncService = new HeliusSyncService(dbService, heliusApiClient); // Pass the client instance
  } else if (!skipApi) {
      logger.error("Cannot proceed with sync service without Helius API key/client when skipApi is false.");
      process.exit(1);
  }
  
  // Pass HeliusApiClient to PnlAnalysisService
  // Ensure PnlAnalysisService also uses dbService as its first argument if needed
  const httpService = new HttpService();
  const dexscreenerService = new DexscreenerService(dbService, httpService);
  const dexscreenerProvider = new (require('../api/services/dexscreener-price-provider').DexscreenerPriceProvider)(
    dbService,
    httpService
  );
  // OnchainMetadataService requires HeliusApiClient
  if (!heliusApiClient) {
    throw new Error('HeliusApiClient is required for TokenInfoService (needed for OnchainMetadataService)');
  }
  const onchainMetadataService = new OnchainMetadataService(heliusApiClient);
  const tokenInfoService = new TokenInfoService(dbService, dexscreenerService, dexscreenerProvider, onchainMetadataService);
  const pnlAnalysisService = new PnlAnalysisService(dbService, heliusApiClient, tokenInfoService);
  
  // Use undefined instead of null for optional service dependencies
  const reportingService = new ReportingService(undefined, undefined, undefined, undefined, pnlAnalysisService);
  let behaviorService: BehaviorService | null = null;
  let behavioralMetrics: any = null;

  // Instantiate BehaviorService if requested
  if (analyzeBehavior) {
    // Define a default behavior config, potentially allowing overrides later via CLI
    const defaultBehaviorConfig: BehaviorAnalysisConfig = {
        // Uses defaults from BehaviorAnalyzer for thresholds if not specified here
        // timeRange can be inherited from the main PNL timeRange if appropriate
        timeRange: parseTimeRange(startDate, endDate),
        excludedMints: [], // Add CLI option for this if needed, or use a shared one
    };
    behaviorService = new BehaviorService(dbService, defaultBehaviorConfig);
    logger.info('Behavioral analysis will be performed.');
  }

  // --- Orchestration Flow ---
  let runId: number | null = null;
  let analysisSummary: any | null = null; 
  const timeRange = parseTimeRange(startDate, endDate);
  const isHistoricalView = !!timeRange;

  try {
    // 1. Synchronize Data (if not skipping API)
    if (!skipApi && syncService) {
      logger.info('--- Step 1: Synchronizing Data with Helius API ---');
      const syncOptions: SyncOptions = {
        limit: limit,
        fetchAll: fetchAll,
        skipApi: skipApi, // Should be false here
        fetchOlder: fetchOlder,
        maxSignatures: maxSignatures,
        smartFetch: smartFetch,
      };
      await syncService.syncWalletData(walletAddress, syncOptions);
      logger.info('--- Data Synchronization Complete ---');
    } else {
      logger.info('--- Step 1: Skipping Data Synchronization (--skipApi) ---');
    }

    // *** NEW: PRE-ANALYSIS CHECK ***
    const wallet = await dbService.getWallet(walletAddress);
    let pnlAnalysisSkipped = false;

    // Determine if P/L analysis should be skipped
    if (!isHistoricalView && wallet) {
      const neverAnalyzed = !wallet.analyzedTimestampStart || !wallet.analyzedTimestampEnd;
      
      // These are the wallet's global processed timestamps
      const globalFirstProcessedTs = wallet.firstProcessedTimestamp;
      const globalNewestProcessedTs = wallet.newestProcessedTimestamp;

      // For the PNL check, we need to consider the effective range these represent
      // if they are skewed or one is null.
      let effectiveMinFetchedForPnlCheck: number | null = null;
      let effectiveMaxFetchedForPnlCheck: number | null = null;

      if (globalFirstProcessedTs !== null && globalNewestProcessedTs !== null) {
        effectiveMinFetchedForPnlCheck = Math.min(globalFirstProcessedTs, globalNewestProcessedTs);
        effectiveMaxFetchedForPnlCheck = Math.max(globalFirstProcessedTs, globalNewestProcessedTs);
      } else if (globalFirstProcessedTs !== null) {
        effectiveMinFetchedForPnlCheck = globalFirstProcessedTs;
        effectiveMaxFetchedForPnlCheck = globalFirstProcessedTs;
      } else if (globalNewestProcessedTs !== null) {
        effectiveMinFetchedForPnlCheck = globalNewestProcessedTs;
        effectiveMaxFetchedForPnlCheck = globalNewestProcessedTs;
      }
      // If both are null, effectiveMin/Max remain null, and it will likely proceed to analyze.

      if (neverAnalyzed) {
        logger.info(`--- Performing P/L Analysis for ${walletAddress}: Wallet has not been fully analyzed before. ---`);
        // pnlAnalysisSkipped remains false
      } else if (effectiveMinFetchedForPnlCheck !== null && effectiveMaxFetchedForPnlCheck !== null && wallet.analyzedTimestampStart !== null && wallet.analyzedTimestampEnd !== null) {
        // Only proceed with this check if all necessary timestamps are available
        const noNewOlderData = effectiveMinFetchedForPnlCheck >= wallet.analyzedTimestampStart;
        const noNewNewerData = effectiveMaxFetchedForPnlCheck <= wallet.analyzedTimestampEnd;

        if (noNewOlderData && noNewNewerData) {
          logger.info(`--- Skipping P/L Analysis for ${walletAddress}: No new transactions outside the previously analyzed range (${wallet.analyzedTimestampStart} - ${wallet.analyzedTimestampEnd}). Effective fetched range for check based on wallet state: ${effectiveMinFetchedForPnlCheck} - ${effectiveMaxFetchedForPnlCheck}. (Wallet fields: firstProcessedTimestamp=${globalFirstProcessedTs}, newestProcessedTimestamp=${globalNewestProcessedTs}) ---`);
          pnlAnalysisSkipped = true;
        } else {
          let reason = [];
          if (!noNewOlderData) reason.push(`older data (batch min ${effectiveMinFetchedForPnlCheck} < analyzed start ${wallet.analyzedTimestampStart})`);
          if (!noNewNewerData) reason.push(`newer data (batch max ${effectiveMaxFetchedForPnlCheck} > analyzed end ${wallet.analyzedTimestampEnd})`);
          logger.info(`--- Performing P/L Analysis for ${walletAddress}: New transactions detected (${reason.join(' and ')}). Analyzed range: ${wallet.analyzedTimestampStart}-${wallet.analyzedTimestampEnd}. Effective fetched range for check: ${effectiveMinFetchedForPnlCheck}-${effectiveMaxFetchedForPnlCheck}. (Wallet fields: firstProcessedTimestamp=${globalFirstProcessedTs}, newestProcessedTimestamp=${globalNewestProcessedTs}) ---`);
          // pnlAnalysisSkipped remains false
        }
      } else {
        // Fallback or if some timestamps are unexpectedly null after sync and it's not the first analysis
        logger.warn(`--- Performing P/L Analysis for ${walletAddress}: Could not definitively determine skip logic due to missing timestamp data (firstProcessed: ${globalFirstProcessedTs}, newestProcessed: ${globalNewestProcessedTs}). Proceeding with analysis. Wallet data: ${JSON.stringify(wallet)} ---`);
        // pnlAnalysisSkipped remains false (safer to analyze)
      }
    } else if (isHistoricalView) {
      logger.info(`--- Performing P/L Analysis for ${walletAddress}: Historical view requested, skipping pre-analysis check. ---`);
      // pnlAnalysisSkipped remains false
    } else if (!wallet) {
      logger.warn(`--- Performing P/L Analysis for ${walletAddress}: Wallet record not found. Proceeding with analysis. ---`);
      // pnlAnalysisSkipped remains false
    }

    if (pnlAnalysisSkipped) {
        logger.info(`--- P/L Analysis for ${walletAddress} was skipped due to pre-analysis check. ---`);
        // Optionally, create a "skipped" AnalysisRun record here
    } else {
        logger.info('--- Step 2: Performing P/L Analysis ---');
        // The call to pnlAnalysisService.analyzeWalletPnl remains largely the same,
        // but we no longer pass newestProcessedSignature for it to update lastSignatureAnalyzed.
        // PnlAnalysisService will now be responsible for determining the analyzed range and
        // the main script (or sync service) for updating wallet's overall fetched range.
        analysisSummary = await pnlAnalysisService.analyzeWalletPnl(
            walletAddress, 
            isHistoricalView ? timeRange : undefined, // Pass timeRange only if it's a historical view
            // We remove the third argument `wallet?.newestProcessedSignature` as PnlAnalysisService
            // will no longer update the wallet's signature fields directly based on this.
            // It will, however, update analyzedTimestampStart and analyzedTimestampEnd.
        );
        
        if (analysisSummary && analysisSummary.runId) {
            runId = analysisSummary.runId; // Capture runId if PnlAnalysisService provides it
            logger.info(`P/L Analysis complete. Associated with AnalysisRun ID: ${runId}`);
        }

        if (!analysisSummary || (analysisSummary.results && analysisSummary.results.length === 0 && !analysisSummary.analysisSkipped)) {
            logger.warn('PNL analysis did not produce any results or failed. Check PnlAnalysisService logs.');
            // The script can decide to exit or skip reporting based on this.
            // No need to proceed with saving if summary is null/empty unless it was a planned skip
        }
    }
    // --- P/L Analysis Potentially Skipped or Complete ---

    // Step 3: Saving Full Analysis Run to Database - This is now largely handled by PnlAnalysisService
    // The main responsibility here is to ensure an AnalysisRun record reflects the outcome if not already fully managed by PnlService.
    // For now, we assume PnlAnalysisService creates and finalizes its own AnalysisRun record.
    // If `runId` was captured from `analysisSummary`, it means PnlAnalysisService handled it.
    if (isHistoricalView && analysisSummary) {
        logger.info(`--- Historical P/L Analysis for ${walletAddress} complete. Results are in analysisSummary. No canonical data updated. ---`);
    } else if (pnlAnalysisSkipped) {
        logger.info(`--- P/L Analysis for ${walletAddress} was skipped. No database updates for PNL results. ---`);
    } else if (analysisSummary && runId) {
        logger.info(`--- P/L Analysis and Data Persistence for ${walletAddress} handled by PnlAnalysisService (Run ID: ${runId}). ---`);
    } else if (!isHistoricalView && !pnlAnalysisSkipped) {
        logger.error(`--- P/L Analysis for ${walletAddress} may have failed or did not complete as expected. Run ID not available. ---`);
        // Potentially create a FAILED AnalysisRun here if one wasn't made by PnlService
    }

    // *** NEW: Perform Behavioral Analysis if requested ***
    if (analyzeBehavior && behaviorService) {
        logger.info('--- Step 3a: Performing Behavioral Analysis ---');
        try {
            behavioralMetrics = await behaviorService.analyzeWalletBehavior(walletAddress, timeRange);
            if (behavioralMetrics) {
                logger.info('Behavioral analysis complete. Metrics generated.');
                // TODO: Integrate behavioralMetrics into console display and reporting
                logger.debug('Behavioral Metrics:', behavioralMetrics);
            } else {
                logger.warn('Behavioral analysis did not produce any metrics.');
            }
        } catch (behaviorError) {
            logger.error('Error during behavioral analysis:', behaviorError);
            // Continue with PNL reporting even if behavioral analysis fails
        }
        logger.info('--- Behavioral Analysis Attempt Complete ---');
    }

    // 4. Display Results in Console
    logger.info('--- Step 4: Displaying Results ---');
    if (analysisSummary && Array.isArray(analysisSummary.results)) {
        displaySummary(analysisSummary.results, walletAddress);
        displayDetailedResults(analysisSummary.results);
    } else {
        logger.warn('Analysis summary or results are missing/not an array, skipping console display.');
        if (analysisSummary) {
            logger.debug('Analysis summary object for display issue:', analysisSummary);
        }
    }
    logger.info('--- Display Complete ---');

    // 5. Generate Reports
    logger.info('--- Step 5: Generating Reports ---');
    if (saveReportMd) {
      await reportingService.generateAndSaveSwapPnlReport(walletAddress, analysisSummary);
      if (analyzeBehavior && behavioralMetrics) {
        await reportingService.generateAndSaveBehaviorReportMD(walletAddress, behavioralMetrics);
        logger.info('Behavioral metrics Markdown report generated.');
      }
    }
    if (saveAnalysisCsv) {
      // Ensure runId passed as undefined if null
      await reportingService.generateAndSaveSwapPnlCsv(walletAddress, analysisSummary, runId ?? undefined);
      if (analyzeBehavior && behavioralMetrics) {
        // TODO: Implement CSV reporting for behavioral metrics if needed
        // Example: await reportingService.generateAndSaveBehaviorReportCSV(walletAddress, behavioralMetrics);
        logger.info('CSV reporting for behavioral metrics is a TODO.');
      }
    }
    logger.info('--- Report Generation Complete ---');

    logger.info(`Analysis finished successfully for wallet: ${walletAddress}`);

  } catch (error) {
    let errMessage = 'Unknown error during analysis';
    let errName = 'UnknownError';
    let errStack;

    if (error instanceof Error) {
      errMessage = error.message;
      errName = error.name;
      errStack = error.stack;
    } else if (typeof error === 'string') {
      errMessage = error;
    } else if (typeof error === 'object' && error !== null) {
      // More robust check for properties on a generic object
      if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
        errMessage = (error as { message: string }).message;
      } else {
        errMessage = JSON.stringify(error);
      }
      if ('name' in error && typeof (error as { name?: unknown }).name === 'string') {
        errName = (error as { name: string }).name;
      } else {
        errName = 'ObjectError';
      }
      if ('stack' in error && typeof (error as { stack?: unknown }).stack === 'string') {
        errStack = (error as { stack: string }).stack;
      }
    }

    logger.error(`An error occurred during the analysis for wallet ${walletAddress}:`,
        {
            message: errMessage,
            name: errName,
            stack: errStack,
            originalError: error // Log the full error object for more details
        });
    // Update run status to FAILED if applicable
    if (runId && !isHistoricalView) {
         try {
             await prisma.analysisRun.update({
                where: { id: runId },
                data: { status: 'FAILED', errorMessage: errMessage }
            });
            logger.warn(`Updated AnalysisRun ${runId} status to FAILED due to script error.`);
         } catch (updateError) {
             logger.error(`Failed to update run status to FAILED for run ${runId}:`, updateError);
         }
    }
    process.exit(1); // Exit with error code
  }
}

// --- Script Execution ---
if (require.main === module) {
  analyzeWalletWithHelius().catch(error => {
    // Catch any unhandled errors from the main function itself
    logger.error('Unhandled error in main execution:', { error });
    process.exit(1);
  });
}
