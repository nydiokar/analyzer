#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import { createLogger } from '../utils/logger';
import { HeliusApiClient } from '../services/helius-api-client';
import {
  mapHeliusTransactionsToIntermediateRecords,
  saveIntermediateRecordsToCsv
} from '../services/helius-transaction-mapper';
import { 
  analyzeSolPnl, 
  writeSolPnlAnalysisToCsv,
  writeSolPnlAnalysisToTxt
} from '../services/transfer-analyzer-service';
import { displaySummary, displayDetailedResults } from '../cli/display-utils';

// Initialize environment variables
dotenv.config();

// Create logger for this module
const logger = createLogger('HeliusAnalyzer');

/**
 * Main function updated for SOL P/L analysis
 */
async function analyzeWalletWithHelius(
  walletAddress: string,
  options: {
    limit: number;
    fetchAll: boolean;
    saveIntermediateCsv: boolean;
    verbose: boolean;
  }
): Promise<void> {
  try {
    logger.info(`Starting SOL P/L SWAP analysis for wallet: ${walletAddress}`);

    // Validate Helius API key
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
      throw new Error('HELIUS_API_KEY environment variable is required. Please add it to your .env file.');
    }

    // Initialize Helius API client
    const heliusClient = new HeliusApiClient({
      apiKey: heliusApiKey,
      network: 'mainnet', // Default to mainnet
    });

    // 1. Fetch Helius transactions (SWAPs containing token transfers)
    // Note: fetchAll logic might need review based on Helius limits and performance
    const fetchLimit = options.fetchAll ? 5000 : options.limit; // Use a reasonable upper limit if fetchAll
    logger.info(`Fetching SWAP transactions from Helius API for address: ${walletAddress} (batchLimit: ${options.limit}, fetchAll-Max: ${fetchLimit})`);
    const transactions = await heliusClient.getAllTransactionsForAddress(walletAddress, options.limit); // Pass batch limit
    logger.info(`Retrieved ${transactions.length} raw Helius SWAP transactions (containing token transfers)`);

    // 2. Map Helius transactions to intermediate format
    const intermediateRecords = mapHeliusTransactionsToIntermediateRecords(walletAddress, transactions);
    logger.info(`Mapped to ${intermediateRecords.length} intermediate swap records (token/SOL movements)`);

    // 3. Save intermediate records to CSV if requested
    let intermediateCsvPath = '';
    if (options.saveIntermediateCsv && intermediateRecords.length > 0) {
      intermediateCsvPath = saveIntermediateRecordsToCsv(intermediateRecords, walletAddress);
      if (intermediateCsvPath) {
          console.log(`Intermediate swap data saved to: ${intermediateCsvPath}`);
      }
    }
    
    // 4. Analyze intermediate records for SOL P/L metrics
    const solPnlResults = analyzeSolPnl(intermediateRecords);
    
    // 5. Display summary results to console (displaySummary needs update for SolPnlAnalysisResult)
    // displaySummary(solPnlResults, walletAddress); // Assuming displaySummary is updated separately
    // For now, log basic info
    const overallNetSolPL = solPnlResults.reduce((sum, r) => sum + r.netSolProfitLoss, 0);
    console.log(`\n=== ANALYSIS SUMMARY ===`);
    console.log(`Wallet: ${walletAddress}`);
    console.log(`Unique SPL Tokens Swapped: ${solPnlResults.length}`);
    console.log(`Total Net SOL P/L: ${overallNetSolPL.toFixed(6)} SOL`);
    console.log(`(Detailed SOL P/L report saved)`);

    // 6. Show detailed results if requested (displayDetailedResults needs update)
    if (options.verbose) {
      // displayDetailedResults(solPnlResults); // Assuming displayDetailedResults is updated
      console.log(`\n(Verbose console output for SOL P/L to be implemented in display-utils)`);
    }
    
    // 7. Write SOL P/L analysis results to CSV and TXT reports
    const csvReportPath = writeSolPnlAnalysisToCsv(solPnlResults, walletAddress);
    const txtReportPath = writeSolPnlAnalysisToTxt(solPnlResults, walletAddress);
    
    console.log(`\nAnalysis complete.`);
    if(intermediateCsvPath) console.log(`Intermediate swap data saved to: ${intermediateCsvPath}`);
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
      description: 'Attempt to fetch all available SWAP signatures (up to internal limit)',
      type: 'boolean',
      default: false
    })
    .option('saveIntermediateCsv', {
      alias: 's',
      description: 'Save intermediate token swap data to a CSV file in ./data',
      type: 'boolean',
      default: true
    })
    .option('verbose', {
      alias: 'v',
      description: 'Show detailed token swap activity in console',
      type: 'boolean',
      default: false
    })
    .example('$0 -a 8z5awGJDDYVy1j2oeKP1nUauPDkhxnNGEZDkX8tNSQdb', 'Analyze a wallet with default settings')
    .example('$0 -a 8z5awGJDDYVy1j2oeKP1nUauPDkhxnNGEZDkX8tNSQdb -l 500', 'Analyze with larger batch size')
    .example('$0 -a 8z5awGJDDYVy1j2oeKP1nUauPDkhxnNGEZDkX8tNSQdb --fetchAll', 'Attempt to fetch all SWAP signatures')
    .wrap(yargs.terminalWidth())
    .help()
    .alias('help', 'h')
    .version()
    .alias('version', 'V')
    .epilogue('Focuses on Phase 1: On-chain swap analysis via Helius.')
    .argv;

  await analyzeWalletWithHelius(
    argv.address,
    {
      limit: argv.limit,
      fetchAll: argv.fetchAll,
      saveIntermediateCsv: argv.saveIntermediateCsv,
      verbose: argv.verbose,
    }
  );
})(); 