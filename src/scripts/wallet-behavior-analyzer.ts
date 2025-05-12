/**
 * @fileoverview Wallet Behavior Analyzer Script
 * 
 * CLI entry point to analyze a single Solana wallet's transaction history 
 * to identify trading patterns and behaviors using the BehaviorService 
 * and generate a report using the ReportingService.
 * 
 * Usage:
 * ```
 * npx ts-node src/scripts/wallet-behavior-analyzer.ts --walletAddress <WALLET_ADDRESS> [--label <LABEL>]
 * ```
 * 
 * @module WalletBehaviorAnalyzerScript
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createLogger } from '@/utils/logger';
import { DatabaseService } from '@/services/database-service';
import { BehaviorService } from '@/core/behavior/behavior-service';
import { ReportingService } from '@/reporting/reportGenerator';
// Keep WalletInfo for potential use with labels, although not strictly needed by services
import { WalletInfo } from '@/types/wallet';
import { BehaviorAnalysisConfig } from '@/types/analysis';
// Import the shared utility function
import { parseTimeRange } from '@/utils/cliUtils';

// Initialize logger
const logger = createLogger('WalletBehaviorAnalyzerScript');

// Default excluded mints (can be overridden by CLI)
const DEFAULT_EXCLUDED_MINTS: string[] = [
    'So11111111111111111111111111111111111111112', // WSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

/**
 * Main execution function for the script.
 */
async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option('walletAddress', {
      alias: 'w',
            description: 'The wallet address to analyze',
      type: 'string',
            demandOption: true, // Make wallet address mandatory
        })
        .option('label', {
            alias: 'l',
            description: 'Optional label for the wallet',
            type: 'string',
        })
        // Add Time Range Options
        .option('startDate', {
            type: 'string',
            description: 'Start date for analysis (YYYY-MM-DD)'
        })
        .option('endDate', {
            type: 'string',
            description: 'End date for analysis (YYYY-MM-DD)'
        })
        // Add Excluded Mints Option
        .option('excludeMints', {
            alias: 'e',
            type: 'string',
            description: `Comma-separated list of token mints to exclude. Adds to defaults: ${DEFAULT_EXCLUDED_MINTS.join(', ')}`,
            default: '' 
        })
        .help()
        .alias('help', 'h')
        .argv;

    const walletAddress = argv.walletAddress;
    const label = argv.label;
    const walletId = label ? `${walletAddress} (${label})` : walletAddress;

    // Parse CLI args for config
    const timeRange = parseTimeRange(argv.startDate, argv.endDate);
    const cliExcludedMints = argv.excludeMints ? argv.excludeMints.split(',').map(m => m.trim()).filter(m => m) : [];
    const finalExcludedMints = Array.from(new Set([...DEFAULT_EXCLUDED_MINTS, ...cliExcludedMints]));
    if (finalExcludedMints.length > DEFAULT_EXCLUDED_MINTS.length) {
         logger.info(`Using excluded mints (defaults + CLI): ${finalExcludedMints.join(', ')}`);
    } else {
        logger.debug(`Using default excluded mints: ${finalExcludedMints.join(', ')}`);
    }
    
    logger.info(`Starting analysis for wallet: ${walletId}`);

    // Instantiate services required for single behavior analysis and reporting
    const dbService = new DatabaseService(); 
    const analysisConfig: BehaviorAnalysisConfig = {
        timeRange: timeRange,
        excludedMints: finalExcludedMints
    }; 
    const behaviorService = new BehaviorService(dbService, analysisConfig); 
    
    const reportingService = new ReportingService(behaviorService, undefined, undefined, undefined, undefined); 

    try {
        // Prisma connection pooling is handled internally. Explicit connect/disconnect 
        // in scripts is usually unnecessary unless managing transactions directly.

        // 1. Analyze behavior using BehaviorService
        logger.info(`Fetching data and analyzing behavior for ${walletId}...`);
        const metrics = await behaviorService.analyzeWalletBehavior(walletAddress);

        if (metrics) {
            // 2. Generate and save the report using ReportingService
            logger.info(`Generating and saving report for ${walletId}...`);
            // Use the specific method added to ReportingService
            reportingService.generateAndSaveIndividualBehaviorReport(walletAddress, metrics);
            logger.info(`Analysis and report generation complete for ${walletId}.`);
        } else {
            logger.warn(`No metrics could be generated for wallet ${walletId}. Report not created.`);
        }

    } catch (error) {
        // Use 'unknown' type for error and check instance if needed
        if (error instanceof Error) {
             logger.error(`An error occurred during the analysis for wallet ${walletId}: ${error.message}`, { stack: error.stack });
        } else {
             logger.error(`An unknown error occurred during the analysis for wallet ${walletId}:`, error);
        }
        process.exitCode = 1; // Indicate failure
    } finally {
        // Prisma typically handles disconnection automatically on process exit.
        // Explicit disconnect can sometimes cause issues if called prematurely.
        // await dbService.disconnect(); 
        logger.info('Script finished.');
        // Ensure process exits if there are pending background tasks (less common with Prisma)
        // process.exit(process.exitCode ?? 0); 
    }
}

// Execute main function
main().catch((error) => {
    // Catch unhandled errors in the main async function execution
    if (error instanceof Error) {
        logger.error(`Unhandled error in main execution: ${error.message}`, { stack: error.stack });
    } else {
        logger.error('Unhandled unknown error in main execution:', error);
    }
    process.exit(1); // Exit with error code
}); 