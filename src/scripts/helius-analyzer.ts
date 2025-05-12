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
import { createLogger } from '@/utils/logger';
import { parseTimeRange } from '@/utils/cliUtils';
import { displaySummary, displayDetailedResults } from '@/utils/display-utils'; 

// Import Services
import { HeliusSyncService, SyncOptions } from '@/services/helius-sync-service';
import { PnlAnalysisService } from '@/services/pnl-analysis-service';
import { DatabaseService, prisma } from '@/services/database-service'; 
import { ReportingService } from '@/reporting/reportGenerator'; 

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
      displayLimit
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
  let syncService: HeliusSyncService | null = null;
  if (heliusApiKey) { 
      syncService = new HeliusSyncService(dbService, heliusApiKey);
  } else if (!skipApi) {
      logger.error("Cannot proceed without Helius API key when skipApi is false.");
      process.exit(1);
  }
  const pnlAnalysisService = new PnlAnalysisService(dbService);
  // Use undefined instead of null for optional service dependencies
  const reportingService = new ReportingService(undefined, undefined, undefined, undefined, pnlAnalysisService);

  // --- Orchestration Flow ---
  let runId: number | null = null;
  let analysisSummary: any | null = null; 
  // Define isHistoricalView outside the try block
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

    // 2. Perform PNL Analysis
    logger.info('--- Step 2: Performing P/L Analysis ---');
    // Use timeRange defined above
    analysisSummary = await pnlAnalysisService.analyzeWalletPnl(walletAddress, timeRange);
    
    if (!analysisSummary || analysisSummary.results.length === 0) {
      logger.warn('PNL analysis did not produce any results. Exiting.');
      // Maybe still save an empty run record?
      return;
    }
    logger.info('--- P/L Analysis Complete ---');

    // 3. Save Full Run Results to Database (if not historical view)
    if (!isHistoricalView) {
        logger.info('--- Step 3: Saving Full Analysis Run to Database ---');
        try {
            // Create AnalysisRun record
            const runData = { 
                walletAddress: walletAddress,
                timestamp: new Date(),
                status: 'PENDING',
                analysisType: 'SWAP_PNL',
                // Add other relevant metadata? CLI args?
            };
            const run = await dbService.createAnalysisRun(runData);
            if (!run) throw new Error('Failed to create AnalysisRun record.');
            runId = run.id;
            logger.info(`Created AnalysisRun with ID: ${runId}`);

            // Prepare and save AnalysisResult records
            // Need to adapt structure based on SwapAnalysisSummary.results
             const resultsToSave = analysisSummary.results.map((r: any) => ({
                runId: runId!,
                walletAddress: walletAddress,
                tokenAddress: r.tokenAddress,
                totalAmountIn: r.totalAmountIn,
                totalAmountOut: r.totalAmountOut,
                netAmountChange: r.netAmountChange,
                totalSolSpent: r.totalSolSpent,
                totalSolReceived: r.totalSolReceived,
                totalFeesPaidInSol: r.totalFeesPaidInSol,
                netSolProfitLoss: r.netSolProfitLoss,
                firstTransferTimestamp: r.firstTransferTimestamp,
                lastTransferTimestamp: r.lastTransferTimestamp,
                // Add other fields from OnChainAnalysisResult if they map to AnalysisResult schema
                isValuePreservation: r.isValuePreservation,
                estimatedPreservedValue: r.estimatedPreservedValue,
             }));
             logger.debug(`Prepared ${resultsToSave.length} AnalysisResult records for saving.`);
            await dbService.saveAnalysisResults(resultsToSave);
            logger.info(`Saved ${resultsToSave.length} AnalysisResult records.`);

            // Prepare and save AdvancedStatsResult record
            if (analysisSummary.advancedStats) {
                const statsToSave = {
                    runId: runId!,
                    walletAddress: walletAddress,
                    medianPnlPerToken: analysisSummary.advancedStats.medianPnlPerToken,
                    trimmedMeanPnlPerToken: analysisSummary.advancedStats.trimmedMeanPnlPerToken,
                    tokenWinRatePercent: analysisSummary.advancedStats.tokenWinRatePercent,
                    standardDeviationPnl: analysisSummary.advancedStats.standardDeviationPnl,
                    profitConsistencyIndex: analysisSummary.advancedStats.profitConsistencyIndex,
                    weightedEfficiencyScore: analysisSummary.advancedStats.weightedEfficiencyScore,
                    averagePnlPerDayActiveApprox: analysisSummary.advancedStats.averagePnlPerDayActiveApprox,
                };
                await dbService.saveAdvancedStats(statsToSave);
                 logger.info(`Saved AdvancedStatsResult record.`);
            }

            // Update AnalysisRun status to COMPLETED
            // Use prisma directly here as planned, or add a helper to dbService
            await prisma.analysisRun.update({
                where: { id: runId },
                data: { status: 'COMPLETED' }
            });
            logger.info(`Updated AnalysisRun ${runId} status to COMPLETED.`);

        } catch (dbError) {
            logger.error('Error saving full analysis run to database:', dbError);
            // Update run status to FAILED if it was created
            if (runId) {
                 try {
                     await prisma.analysisRun.update({
                        where: { id: runId },
                        data: { status: 'FAILED', errorMessage: String(dbError) }
                    });
                    logger.warn(`Updated AnalysisRun ${runId} status to FAILED.`);
                 } catch (updateError) {
                     logger.error(`Failed to update run status to FAILED for run ${runId}:`, updateError);
                 }
            }
        }
        logger.info('--- Database Save Complete ---');
    } else {
        logger.info('--- Step 3: Skipping Database Save (Historical View) ---');
    }

    // 4. Display Results in Console
    logger.info('--- Step 4: Displaying Results ---');
    if (analysisSummary) {
        displaySummary(analysisSummary, walletAddress);
        displayDetailedResults(analysisSummary.results);
    }
    logger.info('--- Display Complete ---');

    // 5. Generate Reports
    logger.info('--- Step 5: Generating Reports ---');
    if (saveReportMd) {
      await reportingService.generateAndSaveSwapPnlReport(walletAddress, analysisSummary);
    }
    if (saveAnalysisCsv) {
      // Ensure runId passed as undefined if null
      await reportingService.generateAndSaveSwapPnlCsv(walletAddress, analysisSummary, runId ?? undefined);
    }
    logger.info('--- Report Generation Complete ---');

    logger.info(`Analysis finished successfully for wallet: ${walletAddress}`);

  } catch (error) {
    logger.error(`An error occurred during the analysis for wallet ${walletAddress}:`, { error });
    // Update run status to FAILED if applicable (runId and isHistoricalView are now in scope)
    if (runId && !isHistoricalView) {
         try {
             await prisma.analysisRun.update({
                where: { id: runId },
                data: { status: 'FAILED', errorMessage: String(error) }
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
