#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import path from 'path'; // Import path for joining paths
import { createLogger } from '../utils/logger';
import { HeliusApiClient } from '../services/helius-api-client';
import {
  mapHeliusTransactionsToIntermediateRecords,
} from '../services/helius-transaction-mapper';
import { 
  analyzeSwapRecords,
  writeAnalysisReportTxt,
  writeAnalysisReportTxt_fromMemory,
  saveAnalysisResultsToCsv
} from '../services/transfer-analyzer-service';
import { IntermediateSwapRecord, HeliusTransaction, OnChainAnalysisResult, AdvancedTradeStats } from '../types/helius-api'; // Correct import location
import { calculateAdvancedStats } from '../services/advanced-stats-service'; // Import the new service
import { displaySummary, displayDetailedResults } from '../cli/display-utils';
// --- Database Service Imports ---
import {
    getWallet, 
    updateWallet, 
    saveSwapAnalysisInputs, // Import DB function for saving intermediate data
    getSwapAnalysisInputs,  // Import DB function for reading intermediate data
    createAnalysisRun,
    saveAnalysisResults,
    saveAdvancedStats,
    // Types needed for saving results (if not already exported/defined elsewhere)
    // These might need to be defined/exported in database-service.ts if not already
    // For now, assuming they are available or handled by Prisma types
    AnalysisResultCreateData, // Type for AnalysisResult creation data
    AdvancedStatsCreateData, // Type for AdvancedStats creation data
    prisma // Import Prisma client instance for direct updates (e.g., updating run status)
} from '../services/database-service'; 
import { Prisma, SwapAnalysisInput } from '@prisma/client'; // Import Prisma types
// --- End Database Service Imports ---

// Initialize environment variables
dotenv.config();

// --- Set Log Level based on --verbose ---
// This needs to be done BEFORE any logger is created.
const verboseLogging = process.argv.includes('-v') || process.argv.includes('--verbose');
process.env.LOG_LEVEL = verboseLogging ? 'debug' : 'info';
// --- End Log Level Setup ---

// Create logger for this module (NOW uses the configured level)
const logger = createLogger('HeliusAnalyzerScript');

/**
 * Performs analysis for a wallet based on data stored in the database
 * Can be used for on-demand analysis of specific time ranges
 */
async function performAnalysisForWallet(
  walletAddress: string, 
  timeRange?: { startTs?: number, endTs?: number }
): Promise<{
  results: any[];
  totalSignaturesProcessed: number;
  overallFirstTimestamp?: number;
  overallLastTimestamp?: number;
  advancedStats?: any;
}> {
  logger.debug(`Performing analysis for wallet ${walletAddress} with time constraints`, { timeRange });
  const isTimeRanged = timeRange && (timeRange.startTs || timeRange.endTs);
  
  // Fetch all records from the database for this wallet (with optional time filtering)
  const dbInputs: SwapAnalysisInput[] = await getSwapAnalysisInputs(
    walletAddress,
    timeRange // Pass the entire timeRange object which matches the SwapInputTimeRange interface
  );
  
  // Map Prisma model type to IntermediateSwapRecord type
  const intermediateRecords: IntermediateSwapRecord[] = dbInputs.map(input => ({
    signature: input.signature,
    timestamp: input.timestamp,
    mint: input.mint,
    amount: input.amount,
    direction: input.direction as "in" | "out" // Type assertion
  }));

  if (intermediateRecords.length === 0) {
    logger.warn(`No intermediate records found in database for wallet ${walletAddress}${timeRange ? ' in the specified time range' : ''}`);
    return {
      results: [],
      totalSignaturesProcessed: 0
    };
  }

  logger.info(`Analyzing ${intermediateRecords.length} intermediate records from database...`);
  
  // Perform the analysis on all fetched records
  const analysisSummary = analyzeSwapRecords(intermediateRecords);
  
  if (analysisSummary.results.length === 0) {
    logger.warn('Analysis did not yield any results (e.g., no paired swaps found).');
    return analysisSummary;
  }

  // --- Calculate Advanced Stats ---
  logger.info('Calculating advanced trading statistics...');
  const advancedStats = calculateAdvancedStats(analysisSummary.results);
  if (advancedStats) {
    analysisSummary.advancedStats = advancedStats;
    logger.info('Successfully calculated advanced stats.');
  } else {
    logger.warn('Could not calculate advanced stats (likely insufficient data).');
  }

  return analysisSummary;
}

/**
 * Main function to orchestrate the Helius API-based swap analysis with SOL P/L.
 */
async function analyzeWalletWithHelius(
  walletAddress: string,
  options: {
    limit: number;
    fetchAll: boolean;
    saveAnalysisCsv: boolean;
    verbose: boolean;
    skipApi: boolean;
    fetchOlder: boolean;
    maxSignatures?: number | null;
    timeRange?: { startTs?: number, endTs?: number };
  }
): Promise<void> {
  try {
    const isHistoricalView = !!options.timeRange;
    const mode = isHistoricalView ? 'Historical View' : 'Incremental Update & Full Analysis';
    logger.info(`Starting Mode: ${mode} for wallet: ${walletAddress}`);
    logger.info(`Options: BatchLimit=${options.limit}, FetchAll=${options.fetchAll}, Verbose=${options.verbose}, SkipApi=${options.skipApi}, MaxSignatures=${options.maxSignatures || 'none'}`);
    if (isHistoricalView) {
        logger.info(`Historical Time Range (Unix Ts): ${options.timeRange?.startTs} to ${options.timeRange?.endTs}`);
    }

    // --- Step 1: Ensure Database is Up-to-Date (Incremental Fetch/Save) ---
    // This runs always, unless --skipApi is true, regardless of historical view
    if (!options.skipApi) {
      logger.info('[Fetch Phase] Ensuring database is up-to-date...');
      const heliusApiKey = process.env.HELIUS_API_KEY;
      if (!heliusApiKey) {
        // Allow skipApi even without key, but error if trying to fetch
        throw new Error('HELIUS_API_KEY environment variable is required for fetching data. Please add it to your .env file or use --skipApi.');
      }
      
      const heliusClient = new HeliusApiClient({
        apiKey: heliusApiKey!,
        network: 'mainnet',
      });

      // --- Get Wallet State for Incremental Fetch ---
      let stopAtSignature: string | undefined = undefined;
      let newestProcessedTimestamp: number | undefined = undefined;
      let initialFetch = false;
      const walletState = await getWallet(walletAddress);
      if (walletState && !options.fetchOlder) {
        stopAtSignature = walletState.newestProcessedSignature ?? undefined;
        newestProcessedTimestamp = walletState.newestProcessedTimestamp ?? undefined;
        logger.debug(`[Fetch Phase] Found existing wallet state. Fetching transactions newer than: ts=${newestProcessedTimestamp}, sig=${stopAtSignature}`);
      } else if (options.fetchOlder) {
        initialFetch = true; // Treat as initial fetch for state update logic later
        logger.info('[Fetch Phase] --fetch-older flag detected. Ignoring saved state to fetch older history.');
      } else {
        initialFetch = true;
        logger.debug('[Fetch Phase] No existing wallet state found. Performing initial fetch.');
      }

      logger.debug(`[Fetch Phase] Fetching relevant transactions from Helius API...`);
      let newTransactions: HeliusTransaction[] = [];
      try {
        newTransactions = await heliusClient.getAllTransactionsForAddress(
          walletAddress, 
          options.limit,
          options.maxSignatures,
          stopAtSignature,       
          newestProcessedTimestamp
        );
        logger.info(`[Fetch Phase] Fetched ${newTransactions.length} new, relevant transactions from Helius.`);
      } catch (error) {
        logger.error(`[Fetch Phase] Failed to fetch transactions from Helius.`, { error: error instanceof Error ? error.message : String(error) });
        logger.warn('[Fetch Phase] Cannot update database or wallet state due to API fetch failure.');
        // Allow proceeding to analysis phase with existing DB data even if fetch fails
      }

      // --- Process & Save New Transactions ---
      if (newTransactions.length > 0) {
        logger.debug('[Fetch Phase] Mapping and saving new transactions...');
        const newIntermediateRecords = mapHeliusTransactionsToIntermediateRecords(walletAddress, newTransactions);
        
        if (newIntermediateRecords.length > 0) {
          logger.debug(`[Fetch Phase] Saving ${newIntermediateRecords.length} newly mapped intermediate records to database...`);
          try {
            const recordsToSave: Prisma.SwapAnalysisInputCreateInput[] = newIntermediateRecords.map(rec => ({
              walletAddress: walletAddress,
              signature: rec.signature,
              timestamp: rec.timestamp,
              mint: rec.mint,
              amount: rec.amount ?? 0,
              direction: rec.direction
            }));
            const saveResult = await saveSwapAnalysisInputs(recordsToSave);
            logger.info(`[Fetch Phase] Successfully saved ${saveResult.count} new records to SwapAnalysisInput table.`);
          } catch (dbError) {
            logger.error('[Fetch Phase] Error saving new intermediate records to database:', dbError);
          }
        } else {
          logger.debug('[Fetch Phase] Mapping resulted in 0 intermediate records to save.');
        }

        // --- Update Wallet State ---
        const latestTx = newTransactions.reduce((latest, current) => {
          return (!latest || current.timestamp > latest.timestamp) ? current : latest;
        }, null as HeliusTransaction | null);

        if (latestTx) {
          logger.debug(`[Fetch Phase] Updating wallet state with newest processed transaction: ts=${latestTx.timestamp}, sig=${latestTx.signature}`);
          const updateData: any = {
            newestProcessedSignature: latestTx.signature,
            newestProcessedTimestamp: latestTx.timestamp,
            lastSuccessfulFetchTimestamp: new Date(),
          };
          if (initialFetch) {
            const oldestTx = newTransactions.reduce((oldest, current) => {
              return (!oldest || current.timestamp < oldest.timestamp) ? current : oldest;
            }, null as HeliusTransaction | null);
            if (oldestTx) {
              updateData.firstProcessedTimestamp = oldestTx.timestamp;
            }
          }
          await updateWallet(walletAddress, updateData);
          logger.info('[Fetch Phase] Wallet state updated successfully.');
        } else {
          logger.warn('[Fetch Phase] Failed to find latest transaction to update wallet state, though new transactions were fetched.');
        }
      } else {
        logger.info('[Fetch Phase] No new transactions fetched from API.');
      }
    } else {
      logger.info('Skipping API fetch (--skipApi). Analysis will use currently stored data.');
    }
    // --- End Step 1: Fetch/Save --- 

    // === Step 2: Perform Analysis (Full or Time-Ranged) ===
    const analysisMode = isHistoricalView ? 'Time-Ranged' : 'Full';
    logger.info(`[Analysis Phase] Performing ${analysisMode} analysis for wallet ${walletAddress}...`);
    // Pass the timeRange to performAnalysisForWallet
    const analysisSummary = await performAnalysisForWallet(walletAddress, options.timeRange);
    
    if (analysisSummary.results.length === 0) {
      logger.warn(`[Analysis Phase] Analysis did not yield any results${isHistoricalView ? ' for the specified time range' : ''}.`);
      return; // Exit if no results
    }
    logger.info(`[Analysis Phase] Analysis complete. Found ${analysisSummary.results.length} tokens with P/L data.`);

    // === Step 3: Display & Save (if applicable) ===
    logger.info('[Reporting Phase] Displaying summary...');
    displaySummary(analysisSummary.results, walletAddress);
    if (options.verbose) {
      logger.debug('[Reporting Phase] Displaying detailed results...');
      displayDetailedResults(analysisSummary.results);
    }

    let analysisRunId: number | undefined = undefined;
    let dbSaveOk = false; // Track if DB save was attempted and successful
    if (!isHistoricalView) {
        // --- Save Full Analysis Results to Database ---
        logger.info('[DB Save Phase] Saving full analysis results to database...');
        try {
            // 1. Create AnalysisRun record
            const runData: Omit<Prisma.AnalysisRunCreateInput, 'id' | 'results' | 'advancedStats'> = {
                walletAddress: walletAddress,
                status: 'in_progress',
                analysisStartTs: analysisSummary.overallFirstTimestamp, 
                analysisEndTs: analysisSummary.overallLastTimestamp,
                signaturesProcessed: analysisSummary.totalSignaturesProcessed,
            };
            const analysisRun = await createAnalysisRun(runData);
            if (!analysisRun) throw new Error('Failed to create AnalysisRun record.');
            analysisRunId = analysisRun.id;

            // 2. Save AnalysisResult records
            if (analysisSummary.results.length > 0) {
                const resultsToSave: AnalysisResultCreateData[] = analysisSummary.results.map(res => ({
                    ...res,
                    runId: analysisRunId!,
                    walletAddress: walletAddress
                }));
                await saveAnalysisResults(resultsToSave);
            }

            // 3. Save AdvancedStatsResult record
            if (analysisSummary.advancedStats) {
                const statsToSave: AdvancedStatsCreateData = {
                     runId: analysisRunId!, 
                     walletAddress: walletAddress,
                     ...analysisSummary.advancedStats 
                };
                await saveAdvancedStats(statsToSave);
            }

            // 4. Update AnalysisRun status to completed
            await prisma.analysisRun.update({ where: { id: analysisRunId }, data: { status: 'completed' } });
            logger.info(`[DB Save Phase] Successfully saved full analysis results for Run ID: ${analysisRunId}`);
            dbSaveOk = true; // Mark DB save as successful

        } catch (dbError) {
            logger.error('[DB Save Phase] Error saving full analysis results to database:', { error: dbError });
            if (analysisRunId) {
                try { await prisma.analysisRun.update({ where: { id: analysisRunId }, data: { status: 'failed', errorMessage: dbError instanceof Error ? dbError.message : String(dbError) }});
                } catch (updateError) { logger.error('Failed to update AnalysisRun status to FAILED', { updateError }); }
            }
        }
        // --- End DB Save Phase ---
    }

    // --- Generate Report File (TXT only) ---
    logger.info('[Reporting Phase] Writing analysis report file...');
    let txtReportPath: string | null = null;

    if (isHistoricalView) {
        // Generate report from memory for historical/time-ranged views
        logger.debug('[Reporting Phase] Generating TXT report from memory (time-ranged analysis)...');
        txtReportPath = writeAnalysisReportTxt_fromMemory(
            analysisSummary.results, walletAddress, analysisSummary.totalSignaturesProcessed,
            analysisSummary.overallFirstTimestamp ?? 0, analysisSummary.overallLastTimestamp ?? 0,
            analysisSummary.advancedStats
        );
    } else if (dbSaveOk && analysisRunId) {
        // Use DB-based reporting for full runs that were successfully saved
        logger.debug(`[Reporting Phase] Generating TXT report from database (Run ID: ${analysisRunId})...`);
        txtReportPath = await writeAnalysisReportTxt(analysisRunId, walletAddress);
    } else {
        // Fallback: Generate report from memory if it was a full run but DB save failed
        logger.warn('[Reporting Phase] Database save failed or skipped for full run. Generating report from memory as fallback.');
        logger.debug('[Reporting Phase] Generating TXT report from memory (fallback)...');
        txtReportPath = writeAnalysisReportTxt_fromMemory(
            analysisSummary.results, walletAddress, analysisSummary.totalSignaturesProcessed,
            analysisSummary.overallFirstTimestamp ?? 0, analysisSummary.overallLastTimestamp ?? 0,
            analysisSummary.advancedStats
        );
    }
    
    // Final console output
    console.log(`\n${mode} complete.`);
    if (!isHistoricalView && analysisRunId) {
        console.log(`Analysis results saved to database with Run ID: ${analysisRunId}`);
    }
    if (txtReportPath) {
        console.log(`Analysis report TXT saved to: ${txtReportPath}`);
    }

    // --- Save Analysis Results CSV (if requested) ---
    if (options.saveAnalysisCsv) {
      logger.info('[Export Phase] --save-analysis-csv flag detected. Exporting aggregated P/L results...');
      const csvPath = saveAnalysisResultsToCsv(
          analysisSummary.results, // Use the results from the analysis summary
          walletAddress, 
          !isHistoricalView ? analysisRunId : undefined // Include runId if it was a full run
      );
      if (csvPath) {
          console.log(`Aggregated analysis results CSV saved to: ${csvPath}`);
      } else {
          logger.warn('[Export Phase] Failed to save analysis results CSV.');
      }
    }

  } catch (error) {
    logger.error('Unhandled error during analysis process', { error });
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// CLI setup with yargs
(async () => {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('helius-analyzer')
    .usage('$0 --address WALLET_ADDRESS [options]')
    .option('address', {
      alias: 'a',
      description: 'Solana wallet address to analyze',
      type: 'string',
      demandOption: true
    })
    .option('limit', {
      alias: 'l',
      description: 'Transaction fetch batch size (default: 100)',
      type: 'number',
      default: 100
    })
    .option('fetchAll', {
      alias: 'fa',
      description: 'Attempt to fetch all available relevant SWAP transactions (respects internal limits)',
      type: 'boolean',
      default: false
    })
    .option('verbose', {
      alias: 'v',
      description: 'Show detailed token swap activity (Top 10 by P/L) in console',
      type: 'boolean',
      default: false
    })
    .option('skipApi', {
        description: 'Skip Helius API calls entirely, rely solely on reading cached intermediate data from database',
        type: 'boolean',
        default: false
    })
    .option('fetchOlder', {
        description: 'Ignore saved state and fetch older transaction history (respects --ms limit)',
        type: 'boolean',
        default: false
    })
    .option('maxSignatures', {
        alias: 'ms',
        description: 'Optional maximum number of signatures to fetch via RPC (fetches all if omitted)',
        type: 'number',
        demandOption: false
    })
    // Prepare for Step 7 - Add time range options for on-demand analysis
    .option('startDate', {
        description: 'Optional start date for analysis (format: YYYY-MM-DD)',
        type: 'string',
        demandOption: false
    })
    .option('endDate', {
        description: 'Optional end date for analysis (format: YYYY-MM-DD)',
        type: 'string',
        demandOption: false
    })
    .option('saveAnalysisCsv', {
        description: 'Save aggregated analysis results (per-token P/L) to CSV',
        type: 'boolean',
        default: false
    })
    .example('npx ts-node analyze-helius -- --address <WALLET_ADDRESS>', 'Analyze a wallet (fetches API data)')
    .example('npx ts-node analyze-helius -- --address <WALLET_ADDRESS> --skipApi', 'Analyze using only cached data from database')
    .example('npx ts-node analyze-helius -- --address <WALLET_ADDRESS> --startDate 2023-06-01 --endDate 2023-12-31', 'Analyze specific date range')
    .wrap(yargs.terminalWidth())
    .help()
    .alias('help', 'h')
    .version()
    .alias('version', 'V')
    .epilogue('Analyzes wallet swaps for SOL Profit/Loss using Helius API.')
    .parse();

  const typedArgv = argv as {
      address: string;
      limit: number;
      fetchAll: boolean;
      saveAnalysisCsv: boolean;
      verbose: boolean;
      skipApi: boolean;
      fetchOlder: boolean;
      maxSignatures?: number | null;
      startDate?: string;
      endDate?: string;
      [key: string]: unknown; 
  };

  // --- Process date range options for on-demand analysis ---
  let timeRange: { startTs?: number, endTs?: number } | undefined = undefined;

  if (typedArgv.startDate || typedArgv.endDate) {
      let startTs: number | undefined = undefined;
      let endTs: number | undefined = undefined;

      try {
          if (typedArgv.startDate) {
              // Parse YYYY-MM-DD. getTime() gives ms, divide by 1000 for seconds.
              startTs = Math.floor(Date.parse(typedArgv.startDate + 'T00:00:00Z') / 1000);
              if (isNaN(startTs)) throw new Error('Invalid startDate format. Use YYYY-MM-DD.');
          }
          if (typedArgv.endDate) {
              // Use end of day for endDate (inclusive)
              endTs = Math.floor(Date.parse(typedArgv.endDate + 'T23:59:59Z') / 1000);
              if (isNaN(endTs)) throw new Error('Invalid endDate format. Use YYYY-MM-DD.');
          }
          
          if (startTs && endTs && startTs > endTs) {
              throw new Error('startDate cannot be after endDate.');
          }
          
          timeRange = { startTs, endTs };
          logger.info(`Historical analysis time range (Unix Ts): ${startTs} to ${endTs}`);

      } catch (dateError) {
          logger.error('Error parsing date arguments:', dateError);
          console.error(`Error: ${dateError instanceof Error ? dateError.message : String(dateError)}`);
          process.exit(1);
      }
  }
  // --- End date range processing ---

  // Decide execution path
  // The logic is now unified within analyzeWalletWithHelius, 
  // which handles DB saving based on whether timeRange is provided.
  
  // Always call the main analysis function
  // The function itself now handles DB saving and reporting based on whether timeRange exists
  await analyzeWalletWithHelius(
    typedArgv.address,
    {
      limit: typedArgv.limit,
      fetchAll: typedArgv.fetchAll,
      saveAnalysisCsv: typedArgv.saveAnalysisCsv,
      verbose: typedArgv.verbose,
      skipApi: typedArgv.skipApi,
      fetchOlder: typedArgv.fetchOlder,
      maxSignatures: typedArgv.maxSignatures || null,
      timeRange: timeRange // Pass the processed timeRange here (will be undefined if no dates provided)
    }
  );
})(); 