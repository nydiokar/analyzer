#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
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
import { HeliusTransaction, SwapAnalysisSummary, OnChainAnalysisResult } from '../types/helius-api';
import { calculateAdvancedStats } from '../services/advanced-stats-service';
import { displaySummary, displayDetailedResults } from '../cli/display-utils';
import {
    getWallet, 
    updateWallet, 
    saveSwapAnalysisInputs,
    getSwapAnalysisInputs,
    createAnalysisRun,
    saveAnalysisResults,
    saveAdvancedStats,
    AnalysisResultCreateData,
    AdvancedStatsCreateData,
    prisma
} from '../services/database-service'; 
import { Prisma, SwapAnalysisInput } from '@prisma/client';

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
): Promise<SwapAnalysisSummary> {
  logger.debug(`Performing analysis for wallet ${walletAddress} with time constraints`, { timeRange });
  const isTimeRanged = timeRange && (timeRange.startTs || timeRange.endTs);
  
  // Fetch pre-processed analysis input records from the database
  const swapInputs: SwapAnalysisInput[] = await getSwapAnalysisInputs(
    walletAddress,
    timeRange
  );
  
  if (swapInputs.length === 0) {
    logger.warn(`No swap analysis input records found in database for wallet ${walletAddress}${timeRange ? ' in the specified time range' : ''}`);
    // Return an empty summary structure matching SwapAnalysisSummary
    return {
      results: [],
      totalSignaturesProcessed: 0,
      overallFirstTimestamp: 0,
      overallLastTimestamp: 0,
      advancedStats: undefined // Ensure all fields are present
    };
  }

  logger.info(`Analyzing ${swapInputs.length} pre-processed swap input records from database...`);
  
  // Perform the analysis directly on the SwapAnalysisInput records
  // The analyzer now expects this structure
  const analysisSummary = analyzeSwapRecords(swapInputs, walletAddress);
  
  // analysisSummary already includes results, signature count, timestamps
  // Calculate advanced stats based on the results
  if (analysisSummary.results.length > 0) {
    logger.info('Calculating advanced trading statistics...');
    // Filter out stablecoins before calculating advanced stats, as per tomorrow.md
    const resultsForAdvancedStats = analysisSummary.results.filter(r => !r.isValuePreservation);
    
    if (resultsForAdvancedStats.length > 0) {
      const advancedStats = calculateAdvancedStats(resultsForAdvancedStats);
      if (advancedStats) {
        analysisSummary.advancedStats = advancedStats; // Add advanced stats to the summary
        logger.info('Successfully calculated advanced stats.');
      } else {
        logger.warn('Could not calculate advanced stats (likely insufficient data after filtering stablecoins)._');
      }
    } else {
      logger.warn('No non-stablecoin results available to calculate advanced stats.');
      analysisSummary.advancedStats = undefined;
    }
  } else {
     logger.warn('Analysis did not yield any results (e.g., no paired swaps found).');
     // Ensure advancedStats is undefined if no results
     analysisSummary.advancedStats = undefined; 
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
    smartFetch?: boolean;
    period?: string;
  }
): Promise<void> {
  try {
    const isHistoricalView = !!options.timeRange;
    const mode = isHistoricalView ? 'Historical View' : 'Incremental Update & Full Analysis';
    logger.info(`Starting Mode: ${mode} for wallet: ${walletAddress}`);
    logger.info(`Options: BatchLimit=${options.limit}, SmartFetch=${options.smartFetch || false}, Period=${options.period || 'none'}, FetchAll=${options.fetchAll}, Verbose=${options.verbose}, SkipApi=${options.skipApi}, MaxSignatures=${options.maxSignatures || 'none'}`);
    if (isHistoricalView) {
        logger.info(`Historical Time Range (Unix Ts): ${options.timeRange?.startTs} to ${options.timeRange?.endTs}`);
    }

    // Pre-convert period to timeRange if specified
    if (options.period && !options.timeRange) {
      const endDate = new Date();
      const startDate = new Date();
      
      switch(options.period.toLowerCase()) {
        case 'day':
          startDate.setDate(startDate.getDate() - 1);
          break;
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'quarter':
          startDate.setMonth(startDate.getMonth() - 3);
          break;
        case 'year':
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
        default:
          logger.warn(`Unknown period value: ${options.period}. Using 'month' as default.`);
          startDate.setMonth(startDate.getMonth() - 1);
      }
      
      options.timeRange = {
        startTs: Math.floor(startDate.getTime() / 1000),
        endTs: Math.floor(endDate.getTime() / 1000)
      };
      
      logger.info(`Period '${options.period}' converted to time range: ${new Date(startDate).toISOString().split('T')[0]} to ${new Date(endDate).toISOString().split('T')[0]}`);
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

      // Get total transaction count from DB for this wallet
      let dbTransactionCount = 0;
      try {
        const existingInputs = await prisma.swapAnalysisInput.findMany({
          where: { walletAddress },
          select: { signature: true },
          distinct: ['signature']
        });
        dbTransactionCount = existingInputs.length;
        logger.info(`[Fetch Phase] Found ${dbTransactionCount} unique transactions for ${walletAddress} in database.`);
      } catch (error) {
        logger.error(`[Fetch Phase] Error counting existing transactions`, { error });
      }

      // --- Smart Fetch Logic ---
      if (options.smartFetch && options.maxSignatures) {
        // If smartFetch is enabled with maxSignatures, handle differently
        logger.info(`[Fetch Phase] SmartFetch enabled with target of ${options.maxSignatures} transactions.`);
        
        // Check if we need to fetch more transactions
        if (dbTransactionCount >= options.maxSignatures) {
          logger.info(`[Fetch Phase] Database already has ${dbTransactionCount} transactions, which meets or exceeds target of ${options.maxSignatures}. No need to fetch more.`);
        } else {
          // Calculate how many more transactions we need
          const neededTransactions = options.maxSignatures - dbTransactionCount;
          logger.info(`[Fetch Phase] Need to fetch ${neededTransactions} more transactions to reach target of ${options.maxSignatures}.`);
          
          // First fetch newer transactions (if any)
          const walletState = await getWallet(walletAddress);
          let stopAtSignature: string | undefined = undefined;
          let newestProcessedTimestamp: number | undefined = undefined;
          
          if (walletState) {
            stopAtSignature = walletState.newestProcessedSignature ?? undefined;
            newestProcessedTimestamp = walletState.newestProcessedTimestamp ?? undefined;
            logger.debug(`[Fetch Phase] Fetching newer transactions first (newer than ts=${newestProcessedTimestamp}, sig=${stopAtSignature})`);
          }

          // First pass: Fetch newer transactions
          let newTransactions: HeliusTransaction[] = [];
          try {
            newTransactions = await heliusClient.getAllTransactionsForAddress(
              walletAddress, 
              options.limit,
              null, // No maxSignatures yet - get all newer ones
              stopAtSignature,       
              newestProcessedTimestamp,
              false // Don't include cached yet
            );
            logger.info(`[Fetch Phase] Fetched ${newTransactions.length} new transactions.`);
          } catch (error) {
            logger.error(`[Fetch Phase] Failed to fetch newer transactions`, { error });
          }

          // Process and save newer transactions
          if (newTransactions.length > 0) {
            await processAndSaveTransactions(walletAddress, newTransactions, true);
          }

          // Check if we still need older transactions
          const remainingNeeded = neededTransactions - newTransactions.length;
          if (remainingNeeded > 0 && walletState) {
            logger.info(`[Fetch Phase] Still need ${remainingNeeded} more transactions. Fetching older transactions.`);
            
            // Second pass: Fetch older transactions if needed
            let olderTransactions: HeliusTransaction[] = [];
            try {
              const oldestProcessedTimestamp = walletState?.firstProcessedTimestamp; // Will be undefined if no state

              olderTransactions = await heliusClient.getAllTransactionsForAddress(
                walletAddress, 
                options.limit,
                remainingNeeded, // Limit to what we need
                undefined, // No stop signature for older fetch
                undefined, // No timestamp filter
                true, // Include cached to help identify what's older
                oldestProcessedTimestamp ?? undefined // Convert null to undefined
              );

              // Log based on whether a filter was actually applied by the client
              if (oldestProcessedTimestamp) {
                 logger.info(`[Fetch Phase] SmartFetch: Received ${olderTransactions.length} potentially older transactions (older than ts ${oldestProcessedTimestamp}).`);
              } else {
                 logger.info(`[Fetch Phase] SmartFetch: Received ${olderTransactions.length} potentially older transactions (no 'until' filter applied).`);
              }
            } catch (error) {
              logger.error(`[Fetch Phase] Failed to fetch older transactions`, { error });
            }

            // Process and save older transactions
            if (olderTransactions.length > 0) {
              await processAndSaveTransactions(walletAddress, olderTransactions, false);
            }
          }
        }
      } else {
        // Original fetch logic
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
          // Only include cached transactions if this is an initial fetch or we're fetching older transactions
          // For incremental runs (newer transactions), we don't need cached ones
          const includeCached = initialFetch || options.fetchOlder;
          
          newTransactions = await heliusClient.getAllTransactionsForAddress(
            walletAddress, 
            options.limit,
            options.maxSignatures,
            stopAtSignature,       
            newestProcessedTimestamp,
            includeCached // Add the includeCached parameter
          );
          logger.info(`[Fetch Phase] Fetched ${newTransactions.length} relevant transactions from Helius${includeCached ? ' (including cached)' : ' (new only)'}.`);
        } catch (error) {
          logger.error(`[Fetch Phase] Failed to fetch transactions from Helius.`, { error: error instanceof Error ? error.message : String(error) });
          logger.warn('[Fetch Phase] Cannot update database or wallet state due to API fetch failure.');
          // Allow proceeding to analysis phase with existing DB data even if fetch fails
        }

        // Process and save transactions
        if (newTransactions.length > 0) {
          await processAndSaveTransactions(walletAddress, newTransactions, initialFetch);
        } else {
          logger.info('[Fetch Phase] No new transactions fetched from API.');
        }
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
                const resultsToSave: AnalysisResultCreateData[] = analysisSummary.results.map((res: OnChainAnalysisResult) => ({
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

/**
 * Helper function to process and save transactions and update wallet state
 */
async function processAndSaveTransactions(
  walletAddress: string, 
  transactions: HeliusTransaction[], 
  isNewerFetch: boolean
): Promise<void> {
  logger.debug('[Fetch Phase] Mapping and saving transactions...');
  
  // Map transactions to analysis inputs
  const analysisInputsToSave: Prisma.SwapAnalysisInputCreateInput[] = 
    mapHeliusTransactionsToIntermediateRecords(walletAddress, transactions);
  
  if (analysisInputsToSave.length > 0) {
    logger.debug(`[Fetch Phase] Saving ${analysisInputsToSave.length} analysis input records to database...`);
    try {
      const saveResult = await saveSwapAnalysisInputs(analysisInputsToSave);
      logger.info(`[Fetch Phase] Successfully saved ${saveResult.count} new records to SwapAnalysisInput table.`);
      
      // Skip wallet stats update to avoid dependency issues
      // Wallet stats can be recalculated separately
    } catch (dbError) {
      logger.error('[Fetch Phase] Error saving analysis input records to database:', dbError);
    }
  } else {
    logger.debug('[Fetch Phase] Mapping resulted in 0 analysis input records to save.');
  }

  // --- Update Wallet State ---
  if (transactions.length > 0) {
    // Find latest and oldest transactions
    const latestTx = transactions.reduce((latest, current) => {
      return (!latest || current.timestamp > latest.timestamp) ? current : latest;
    }, null as HeliusTransaction | null);

    const oldestTx = transactions.reduce((oldest, current) => {
      return (!oldest || current.timestamp < oldest.timestamp) ? current : oldest;
    }, null as HeliusTransaction | null);

    if (latestTx && oldestTx) {
      const updateData: any = {
        lastSuccessfulFetchTimestamp: new Date(),
      };

      // Update newest/first processed based on if this was newer or older fetch
      if (isNewerFetch && latestTx) {
        logger.debug(`[Fetch Phase] Updating wallet state with newest transaction: ts=${latestTx.timestamp}, sig=${latestTx.signature}`);
        updateData.newestProcessedSignature = latestTx.signature;
        updateData.newestProcessedTimestamp = latestTx.timestamp;
      }

      // Update oldest timestamp only if this is first fetch or fetching older data
      if (!isNewerFetch && oldestTx) {
        logger.debug(`[Fetch Phase] Updating wallet state with oldest transaction: ts=${oldestTx.timestamp}`);
        updateData.firstProcessedTimestamp = oldestTx.timestamp;
      }

      await updateWallet(walletAddress, updateData);
      logger.info('[Fetch Phase] Wallet state updated successfully.');
    } else {
      logger.warn('[Fetch Phase] Failed to find latest/oldest transaction for wallet state update.');
    }
  }
}

/**
 * Count successful and failed transactions
 */
function getTransactionStats(transactions: HeliusTransaction[]) {
  const successful = transactions.filter(tx => {
    // Handle transactions that might not have a status property
    const txStatus = (tx as any).status;
    return txStatus && txStatus.toLowerCase() === 'success';
  }).length;
  const failed = transactions.length - successful;
  
  return { successful, failed };
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
    .option('smartFetch', {
      alias: 'sf',
      description: 'Smart fetch mode: first fetches new transactions, then fills up to --ms with older ones',
      type: 'boolean',
      default: false
    })
    .option('fetchOlder', {
      description: 'Legacy mode: Ignore saved state and fetch older transaction history (respects --ms limit)',
      type: 'boolean',
      default: false
    })
    .option('maxSignatures', {
      alias: 'ms',
      description: 'Maximum number of transactions to fetch in total. With --smartFetch, ensures DB has at least this many',
      type: 'number',
      demandOption: false
    })
    .option('period', {
      alias: 'p',
      description: 'Time period to analyze (day, week, month, quarter, year)',
      type: 'string',
      choices: ['day', 'week', 'month', 'quarter', 'year']
    })
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
    .example('npx ts-node src/scripts/helius-analyzer.ts --address <WALLET> --smartFetch --ms 3000', 'Fetch newer transactions first, then older ones to reach 3000 total')
    .example('npx ts-node src/scripts/helius-analyzer.ts --address <WALLET> --period month', 'Analyze transactions from the past month')
    .example('npx ts-node src/scripts/helius-analyzer.ts --address <WALLET> --skipApi', 'Analyze using only cached data from database')
    .example('npx ts-node src/scripts/helius-analyzer.ts --address <WALLET> --startDate 2023-06-01 --endDate 2023-12-31', 'Analyze specific date range')
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
      smartFetch: boolean;
      period?: string;
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
      timeRange: timeRange,
      smartFetch: typedArgv.smartFetch,
      period: typedArgv.period
    }
  );
})(); 