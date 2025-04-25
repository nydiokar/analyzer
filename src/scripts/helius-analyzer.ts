#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import fs from 'fs'; // Import fs for file checks
import path from 'path'; // Import path for joining paths
import Papa from 'papaparse'; // Import papaparse for reading CSV
import { createLogger } from '../utils/logger';
import { HeliusApiClient } from '../services/helius-api-client';
import {
  mapHeliusTransactionsToIntermediateRecords,
  saveIntermediateRecordsToCsv, // Keep for explicit saving option
  // getIntermediateCsvCachePath // Removed incorrect import placeholder
} from '../services/helius-transaction-mapper';
import { 
  analyzeSwapRecords,
  writeOnChainAnalysisToCsv,
  writeOnChainAnalysisToTxt
} from '../services/transfer-analyzer-service';
import { IntermediateSwapRecord, HeliusTransaction } from '../types/helius-api'; // Correct import location
import { displaySummary, displayDetailedResults } from '../cli/display-utils';

// Initialize environment variables
dotenv.config();

// Create logger for this module
const logger = createLogger('HeliusAnalyzerScript');

// --- Helper Function --- 
// Path logic based on where saveIntermediateRecordsToCsv saves by default.
// Adjust if the actual internal cache location is different.
function getIntermediateCsvCachePath_Local(walletAddress: string): string {
  const dataDir = path.resolve('./data'); // Changed from ./cache to ./data
  // Ensure the filename pattern matches the one used for caching/saving
  return path.join(dataDir, `intermediate_swaps_${walletAddress}.csv`); 
}
// --- End Helper --- 


/**
 * Main function to orchestrate the Helius API-based swap analysis with SOL P/L.
 */
async function analyzeWalletWithHelius(
  walletAddress: string,
  options: {
    limit: number;
    fetchAll: boolean;
    saveIntermediateCsv: boolean;
    verbose: boolean;
    skipApi: boolean;
    maxSignatures?: number | null;
  }
): Promise<void> {
  try {
    logger.info(`Starting On-Chain SWAP & SOL P/L analysis for wallet: ${walletAddress}`);
    logger.info(`Options: BatchLimit=${options.limit}, FetchAll=${options.fetchAll}, SaveIntermediate=${options.saveIntermediateCsv}, Verbose=${options.verbose}, SkipApi=${options.skipApi}, MaxSignatures=${options.maxSignatures || 'none'}`);

    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
      throw new Error('HELIUS_API_KEY environment variable is required. Please add it to your .env file.');
    }

    const heliusClient = new HeliusApiClient({
      apiKey: heliusApiKey,
      network: 'mainnet',
    });

    let intermediateRecords: IntermediateSwapRecord[] = []; // Explicitly typed
    const intermediateCachePath = getIntermediateCsvCachePath_Local(walletAddress);

    if (options.skipApi) {
      logger.info('Skipping API call (--skip-api). Attempting to load intermediate data from cache file...');
      if (fs.existsSync(intermediateCachePath)) {
        try {
          const csvContent = fs.readFileSync(intermediateCachePath, 'utf8');
          // Parse with header:true, dynamicTyping:true ensures numbers are parsed correctly
          const parseResult = Papa.parse<IntermediateSwapRecord>(csvContent, { 
              header: true, 
              dynamicTyping: true, 
              skipEmptyLines: true,
              transformHeader: (header) => header.trim(), // Trim headers
              // Explicitly transform to ensure correct types if needed
              transform: (value, header) => {
                 if (header === 'timestamp' || header === 'amount' || header === 'decimals') {
                    return typeof value === 'string' ? parseFloat(value) || 0 : value ?? 0;
                 }
                 return value;
              }
          });
          if (parseResult.errors.length > 0) {
             logger.warn('Encountered errors parsing cached intermediate CSV:', parseResult.errors);
          }
          // Filter out potential empty rows or rows that didn't parse correctly
          intermediateRecords = parseResult.data.filter(row => row.signature && row.mint && row.direction);
          
          if (intermediateRecords.length > 0) {
             logger.info(`Successfully loaded ${intermediateRecords.length} records from intermediate cache: ${intermediateCachePath}`);
          } else {
             logger.error(`Cache file exists but parsing yielded no valid records: ${intermediateCachePath}`);
             return; 
          }
        } catch (err) {
            logger.error(`Error reading or parsing intermediate cache file ${intermediateCachePath}:`, err);
            return; 
        }
      } else {
          logger.error(`Intermediate cache file not found: ${intermediateCachePath}. Cannot proceed with --skip-api.`);
          return; 
      }
    } else {
        logger.info(`Fetching all relevant transactions from Helius API for address: ${walletAddress} (Batch Limit: ${options.limit}, FetchAll: ${options.fetchAll})`);
        
        logger.debug(`Wallet address type: ${typeof walletAddress}, value: ${walletAddress}`);
        if (typeof walletAddress !== 'string') {
            logger.error('Critical: walletAddress is not a string before calling HeliusApiClient!');
            throw new Error('Wallet address is not a string.');
        }

        // Removed loop over types - fetch all relevant transactions in one go
        let allFetchedTransactions: HeliusTransaction[] = [];
        try {
           // Call getAllTransactionsForAddress with address, parse batch limit, and optional max signatures
           allFetchedTransactions = await heliusClient.getAllTransactionsForAddress(
               walletAddress, 
               options.limit, // Use the command-line limit as the Helius PARSE batch limit
               options.maxSignatures // Pass the new optional limit for signature fetching
           ); 
           logger.info(`Fetched ${allFetchedTransactions.length} total raw transactions from Helius.`);
        } catch (error) {
            logger.error(`Failed to fetch transactions from Helius.`, { error: error instanceof Error ? error.message : String(error) });
            // Decide if we should proceed with potentially cached data or exit
            // For now, let's attempt to use cache as fallback, similar to existing logic
            allFetchedTransactions = []; // Ensure it's empty if fetch failed
        }

        // logger.info(`Total unique raw Helius transactions fetched across types: ${allFetchedTransactions.length}`);

        const transactions = allFetchedTransactions; // Use the fetched list

        if (transactions.length > 0) {
            logger.info('Mapping relevant transactions to intermediate swap record format...');
            intermediateRecords = mapHeliusTransactionsToIntermediateRecords(walletAddress, transactions);
        } else {
            logger.info('No new transactions fetched. Attempting to load from intermediate cache file as fallback...');
            if (fs.existsSync(intermediateCachePath)) {
                 try {
                    const csvContent = fs.readFileSync(intermediateCachePath, 'utf8');
                    const parseResult = Papa.parse<IntermediateSwapRecord>(csvContent, { 
                        header: true, 
                        dynamicTyping: true, 
                        skipEmptyLines: true,
                        transformHeader: (header) => header.trim(),
                         transform: (value, header) => {
                            if (header === 'timestamp' || header === 'amount' || header === 'decimals') {
                               return typeof value === 'string' ? parseFloat(value) || 0 : value ?? 0;
                            }
                            return value;
                         }
                     });
                     if (parseResult.errors.length > 0) {
                         logger.warn('Encountered errors parsing cached intermediate CSV:', parseResult.errors);
                     }
                    intermediateRecords = parseResult.data.filter(row => row.signature && row.mint && row.direction);
                    if (intermediateRecords.length > 0) {
                        logger.info(`Successfully loaded ${intermediateRecords.length} records from intermediate cache: ${intermediateCachePath}`);
                    } else {
                         logger.warn(`Cache file exists but parsing yielded no valid records: ${intermediateCachePath}`);
                         intermediateRecords = []; // Ensure empty if no valid records
                    }
                 } catch (err) {
                    logger.error(`Error reading or parsing intermediate cache file ${intermediateCachePath}, continuing without cached data:`, err);
                    intermediateRecords = []; 
                 }
            } else {
                logger.warn('No new transactions and no intermediate cache file found.');
                intermediateRecords = [];
            }
        }
    }

    if (!intermediateRecords || intermediateRecords.length === 0) {
        logger.warn('No intermediate swap records available to analyze. Exiting.');
        return;
    }
    
    let userIntermediateCsvPath = '';
    if (options.saveIntermediateCsv) {
      userIntermediateCsvPath = saveIntermediateRecordsToCsv(intermediateRecords, walletAddress); 
      if (userIntermediateCsvPath) {
          console.log(`User-requested intermediate swap data saved to: ${userIntermediateCsvPath}`);
      }
    }

    logger.info('Analyzing intermediate records for SOL P/L...'); 
    // Capture the full analysis summary object
    const analysisSummary = analyzeSwapRecords(intermediateRecords);
    
    if (analysisSummary.results.length === 0) {
        logger.warn('Analysis did not yield any results (e.g., no paired swaps found).');
        return; 
    }

    logger.info('Displaying analysis summary...');
    // Pass only the results array to display functions
    displaySummary(analysisSummary.results, walletAddress);
    
    if (options.verbose) {
      logger.info('Displaying detailed results...');
      displayDetailedResults(analysisSummary.results);
    }
    
    logger.info('Writing SOL P/L analysis reports...'); 
    // Pass only results to CSV writer (keeping its structure simple)
    const csvReportPath = writeOnChainAnalysisToCsv(analysisSummary.results, walletAddress);
    // Pass full summary info to TXT writer
    const txtReportPath = writeOnChainAnalysisToTxt(
        analysisSummary.results,
        walletAddress,
        analysisSummary.totalSignaturesProcessed,
        analysisSummary.overallFirstTimestamp,
        analysisSummary.overallLastTimestamp
    );
    
    console.log(`\nAnalysis complete.`);
    console.log(`SOL P/L analysis CSV report saved to: ${csvReportPath}`);
    console.log(`SOL P/L analysis TXT summary saved to: ${txtReportPath}`);

  } catch (error) {
    logger.error('Error during analysis', { error });
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
    .option('saveIntermediateCsv', {
      alias: 's',
      description: 'Save intermediate token/SOL swap data to a CSV file in ./data',
      type: 'boolean',
      default: true
    })
    .option('verbose', {
      alias: 'v',
      description: 'Show detailed token swap activity (Top 10 by P/L) in console',
      type: 'boolean',
      default: false
    })
    .option('skipApi', {
        description: 'Skip Helius API calls entirely, rely solely on reading cached intermediate CSV file from ./data',
        type: 'boolean',
        default: false
    })
    .option('maxSignatures', {
        alias: 'ms',
        description: 'Optional maximum number of signatures to fetch via RPC (fetches all if omitted)',
        type: 'number',
        demandOption: false
    })
    .example('npx ts-node analyze-helius -- --address <WALLET_ADDRESS>', 'Analyze a wallet (fetches API data)')
    .example('npx ts-node analyze-helius -- --address <WALLET_ADDRESS> --skipApi', 'Analyze using only cached intermediate data from ./data')
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
      saveIntermediateCsv: boolean;
      verbose: boolean;
      skipApi: boolean;
      maxSignatures?: number | null;
      [key: string]: unknown; 
  };

  await analyzeWalletWithHelius(
    typedArgv.address,
    {
      limit: typedArgv.limit,
      fetchAll: typedArgv.fetchAll,
      saveIntermediateCsv: typedArgv.saveIntermediateCsv,
      verbose: typedArgv.verbose,
      skipApi: typedArgv.skipApi, 
      maxSignatures: typedArgv.maxSignatures || null
    }
  );
})(); 