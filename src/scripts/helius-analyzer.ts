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
import fs from 'fs';
import { createLogger } from '../core/utils/logger';
import { parseTimeRange } from '../core/utils/cliUtils';
import { displaySummary, displayDetailedResults } from '../core/utils/display-utils'; 

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
import Redis from 'ioredis';

// Initialize environment variables
dotenv.config();

const logger = createLogger('HeliusAnalyzerScript');

type AnalyzerRunOptions = {
  limit: number;
  maxSignatures?: number;
  fetchAll: boolean;
  fetchOlder: boolean;
  smartFetch: boolean;
  skipApi: boolean;
  force: boolean;
  analyzeBehavior: boolean;
  startDate?: string;
  endDate?: string;
  saveAnalysisCsv: boolean;
  saveReportMd: boolean;
  displayLimit: number;
};

type AnalyzerServices = {
  dbService: DatabaseService;
  heliusApiClient: HeliusApiClient;
  syncService: HeliusSyncService | null;
  pnlAnalysisService: PnlAnalysisService;
  reportingService: ReportingService;
  behaviorService: BehaviorService | null;
};

function normalizeWalletList(input: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input) {
    const address = raw.trim();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    result.push(address);
  }
  return result;
}

function parseWalletsFromFile(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];

  const looksJson = content.startsWith('[') || content.startsWith('{');
  if (looksJson) {
    const data = JSON.parse(content);
    const list = Array.isArray(data) ? data : Array.isArray(data?.wallets) ? data.wallets : null;
    if (Array.isArray(list)) {
      const addresses = list.map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.address === 'string') return item.address;
        if (item && typeof item.walletAddress === 'string') return item.walletAddress;
        return '';
      });
      return normalizeWalletList(addresses);
    }
    throw new Error('Wallets file JSON must be an array or contain a wallets array.');
  }

  const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return [];

  const headerCells = lines[0].split(',').map(cell => cell.trim().toLowerCase());
  const addressColumn = headerCells.findIndex(cell => cell.includes('address') || cell.includes('wallet'));
  const hasHeader = addressColumn !== -1;
  const startIndex = hasHeader ? 1 : 0;

  const addresses = lines.slice(startIndex).map(line => {
    const cells = line.split(',').map(cell => cell.trim());
    if (hasHeader) {
      return cells[addressColumn] || '';
    }
    return cells[0] || '';
  });
  return normalizeWalletList(addresses);
}

function parseWalletInputs(argv: any): string[] {
  if (argv.walletAddress) {
    return normalizeWalletList([argv.walletAddress]);
  }
  if (argv.wallets) {
    return normalizeWalletList(argv.wallets.split(','));
  }
  if (argv.walletsFile) {
    return parseWalletsFromFile(argv.walletsFile);
  }
  return [];
}

function createSafeRedisClient(): Redis {
  const client = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
  });

  client.on('error', (error) => {
    logger.warn('Redis error (cache will be skipped)', {
      message: error instanceof Error ? error.message : String(error),
    });
  });

  const rawGet = client.get.bind(client);
  const rawSet = client.set.bind(client);
  const clientAny = client as unknown as {
    get: (...args: any[]) => Promise<any>;
    set: (...args: any[]) => Promise<any>;
  };

  clientAny.get = async (...args: any[]) => {
    try {
      return await rawGet(...args);
    } catch (error) {
      logger.warn('Redis get failed (cache miss)', {
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  clientAny.set = async (...args: any[]) => {
    try {
      return await rawSet(...args);
    } catch (error) {
      logger.warn('Redis set failed (cache disabled)', {
        message: error instanceof Error ? error.message : String(error),
      });
      return 'OK';
    }
  };

  return client;
}

function buildServices(options: AnalyzerRunOptions): AnalyzerServices {
  const heliusApiKey = process.env.HELIUS_API_KEY;
  if (!heliusApiKey && !options.skipApi) {
    throw new Error('HELIUS_API_KEY environment variable is not set. Cannot fetch data from Helius.');
  }

  const dbService = new DatabaseService();

  let heliusApiClient: HeliusApiClient | null = null;
  if (heliusApiKey) {
    heliusApiClient = new HeliusApiClient(
      { apiKey: heliusApiKey, network: 'mainnet' },
      dbService
    );
  }

  if (!heliusApiClient) {
    throw new Error('HeliusApiClient is required for analysis services.');
  }

  let syncService: HeliusSyncService | null = null;
  if (heliusApiClient) {
    syncService = new HeliusSyncService(dbService, heliusApiClient);
  } else if (!options.skipApi) {
    throw new Error('Cannot proceed with sync service without Helius API key/client when skipApi is false.');
  }

  const httpService = new HttpService();
  const redisClient = createSafeRedisClient();

  const dexscreenerService = new DexscreenerService(dbService, httpService, redisClient);
  const dexscreenerProvider = new (require('../api/services/dexscreener-price-provider').DexscreenerPriceProvider)(
    dbService,
    httpService
  );
  const onchainMetadataService = new OnchainMetadataService(heliusApiClient);
  const tokenInfoService = new TokenInfoService(
    dbService,
    dexscreenerService,
    dexscreenerProvider,
    onchainMetadataService,
    heliusApiClient,
    redisClient
  );
  const pnlAnalysisService = new PnlAnalysisService(dbService, heliusApiClient, tokenInfoService);

  const reportingService = new ReportingService(undefined, undefined, undefined, undefined, pnlAnalysisService);

  let behaviorService: BehaviorService | null = null;
  if (options.analyzeBehavior) {
    const defaultBehaviorConfig: BehaviorAnalysisConfig = {
      timeRange: parseTimeRange(options.startDate, options.endDate),
      excludedMints: [],
    };
    behaviorService = new BehaviorService(dbService, defaultBehaviorConfig);
    logger.info('Behavioral analysis will be performed.');
  }

  return {
    dbService,
    heliusApiClient,
    syncService,
    pnlAnalysisService,
    reportingService,
    behaviorService,
  };
}

/**
 * Main analysis function.
 */
async function analyzeWalletWithHelius(
  walletAddress: string,
  options: AnalyzerRunOptions,
  services: AnalyzerServices
) {
  const {
    limit,
    maxSignatures,
    fetchAll,
    fetchOlder,
    smartFetch,
    skipApi,
    force,
    startDate,
    endDate,
    saveAnalysisCsv,
    saveReportMd,
    analyzeBehavior,
  } = options;

  const { dbService, syncService, pnlAnalysisService, reportingService, behaviorService } = services;
  let behavioralMetrics: any = null;

  // Set maxSignatures to a large number when fetchAll is true
  const effectiveMaxSignatures = fetchAll && !maxSignatures ? 100000 : maxSignatures;

  logger.info(`Starting analysis for wallet: ${walletAddress}`);

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
        maxSignatures: effectiveMaxSignatures,
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

        if (noNewOlderData && noNewNewerData && !force) {
          logger.info(`--- Skipping P/L Analysis for ${walletAddress}: No new transactions outside the previously analyzed range (${wallet.analyzedTimestampStart} - ${wallet.analyzedTimestampEnd}). Effective fetched range for check based on wallet state: ${effectiveMinFetchedForPnlCheck} - ${effectiveMaxFetchedForPnlCheck}. (Wallet fields: firstProcessedTimestamp=${globalFirstProcessedTs}, newestProcessedTimestamp=${globalNewestProcessedTs}) ---`);
          pnlAnalysisSkipped = true;
        } else if (noNewOlderData && noNewNewerData && force) {
          logger.info(`--- Performing P/L Analysis for ${walletAddress}: --force flag set, bypassing skip logic. ---`);
          // pnlAnalysisSkipped remains false
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
    throw error;
  }
}

// --- Script Execution ---
if (require.main === module) {
  const argv = yargs(hideBin(process.argv))
    .option('walletAddress', {
      alias: 'w',
      type: 'string',
      description: 'The Solana wallet address to analyze',
    })
    .option('wallets', {
      type: 'string',
      description: 'Comma-separated list of Solana wallet addresses to analyze',
    })
    .option('walletsFile', {
      type: 'string',
      description: 'Path to JSON or CSV file containing wallet addresses',
    })
    .option('concurrency', {
      type: 'number',
      default: 3,
      description: 'Number of wallets to process concurrently',
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
      description: 'Force fetching older transactions, ignoring last processed state in DB.',
    })
    .option('smartFetch', {
      type: 'boolean',
      default: false,
      description: 'Fetch new transactions first, then older up to maxSignatures. Requires --maxSignatures.',
    })
    .option('skipApi', {
      type: 'boolean',
      default: false,
      description: 'Skip Helius API calls and analyze only data already in the database',
    })
    .option('force', {
      type: 'boolean',
      default: false,
      description: 'Force re-analysis even if no new transactions detected',
    })
    .option('analyzeBehavior', {
      type: 'boolean',
      default: false,
      description: 'Perform behavioral analysis in addition to P/L analysis',
    })
    .option('startDate', {
      type: 'string',
      description: 'Start date (YYYY-MM-DD) for analysis period (inclusive)',
    })
    .option('endDate', {
      type: 'string',
      description: 'End date (YYYY-MM-DD) for analysis period (inclusive)',
    })
    .option('saveAnalysisCsv', {
      type: 'boolean',
      default: false,
      description: 'Save the detailed analysis results to a CSV file',
    })
    .option('saveReportMd', {
      type: 'boolean',
      default: true, // Default to saving markdown report
      description: 'Save the summary analysis report to a Markdown file',
    })
    .option('displayLimit', {
      alias: 'd',
      type: 'number',
      default: 20,
      description: 'Number of top/bottom results to display in console summary',
    })
    .check((argv) => {
      const sources = [argv.walletAddress, argv.wallets, argv.walletsFile].filter(Boolean).length;
      if (sources === 0) {
        throw new Error('One of --walletAddress, --wallets, or --walletsFile is required.');
      }
      if (sources > 1) {
        throw new Error('Provide only one of --walletAddress, --wallets, or --walletsFile.');
      }
      if (argv.smartFetch && !argv.maxSignatures) {
        throw new Error('--smartFetch requires --maxSignatures to be set.');
      }
      if (argv.concurrency <= 0) {
        throw new Error('--concurrency must be greater than 0.');
      }
      return true;
    })
    .parseSync();

  const walletAddresses = parseWalletInputs(argv);
  if (walletAddresses.length === 0) {
    logger.error('No valid wallet addresses found.');
    process.exit(1);
  }

  const options: AnalyzerRunOptions = {
    limit: argv.limit,
    maxSignatures: argv.maxSignatures,
    fetchAll: argv.fetchAll,
    fetchOlder: argv.fetchOlder,
    smartFetch: argv.smartFetch,
    skipApi: argv.skipApi,
    force: argv.force,
    analyzeBehavior: argv.analyzeBehavior,
    startDate: argv.startDate,
    endDate: argv.endDate,
    saveAnalysisCsv: argv.saveAnalysisCsv,
    saveReportMd: argv.saveReportMd,
    displayLimit: argv.displayLimit,
  };

  let services: AnalyzerServices;
  try {
    services = buildServices(options);
  } catch (error) {
    logger.error('Failed to initialize services:', {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const concurrency = Math.max(1, Math.floor(argv.concurrency));
  const totalWallets = walletAddresses.length;
  let failures = 0;

  const runBatch = async (batch: string[], offset: number) => {
    const tasks = batch.map(async (walletAddress, index) => {
      const position = offset + index + 1;
      logger.info(`Processing wallet ${position}/${totalWallets}: ${walletAddress}`);
      await analyzeWalletWithHelius(walletAddress, options, services);
    });
    const results = await Promise.allSettled(tasks);
    let batchFailures = 0;
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        batchFailures += 1;
        logger.error(`Wallet failed: ${batch[index]}`, {
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
    return batchFailures;
  };

  (async () => {
    for (let i = 0; i < walletAddresses.length; i += concurrency) {
      const batch = walletAddresses.slice(i, i + concurrency);
      const batchFailures = await runBatch(batch, i);
      failures += batchFailures;
    }

    if (failures > 0) {
      logger.warn(`Completed with ${failures} failed wallet(s).`);
      process.exitCode = 1;
    } else {
      logger.info('All wallet analyses completed successfully.');
    }
  })().catch(error => {
    logger.error('Unhandled error in main execution:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    process.exit(1);
  });
}
