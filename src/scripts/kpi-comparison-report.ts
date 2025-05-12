/**
 * @fileoverview KPI Comparison Report Script
 * 
 * CLI entry point to generate a comparative behavior analysis report for multiple wallets.
 * It fetches wallet data, uses BehaviorService and KPIComparisonAnalyzer via ReportingService 
 * to perform the analysis and generate both individual and comparative reports.
 * 
 * Usage:
 * ```
 * npx ts-node src/scripts/kpi-comparison-report.ts --walletList <path/to/wallets.json> [--output <report_name>]
 * ```
 * 
 * @module KPIComparisonReportScript
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';
import { DatabaseService } from '../wallet_analysis/services/database-service';
import { BehaviorService } from '../wallet_analysis/services/behavior-service';
import { ReportingService } from '../wallet_analysis/services/reporting-service';
import { KPIComparisonAnalyzer } from '../wallet_analysis/core/reporting/kpi_analyzer'; // Need the analyzer core
import { WalletInfo } from '../types/wallet';
import { BehaviorAnalysisConfig } from '../types/analysis'; // Import specific config

// Removed imports from wallet-behavior-analyzer.ts
// import { 
//     analyzeTradingBehavior, 
//     generateBehaviorReport 
// } from './wallet-behavior-analyzer'; 

// Initialize logger
const logger = createLogger('KPIComparisonReportScript');

// Default excluded mints (can be overridden by CLI)
const DEFAULT_EXCLUDED_MINTS: string[] = [
    'So11111111111111111111111111111111111111112', // WSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

/**
 * Parses optional start/end date CLI args into a timeRange object.
 * (Duplicate - consider moving to a shared util)
 */
function parseTimeRange(startDate?: string, endDate?: string): { startTs?: number; endTs?: number } | undefined {
    let timeRange: { startTs?: number; endTs?: number } | undefined = undefined;
    if (startDate || endDate) {
        timeRange = {};
        if (startDate) {
            try {
                timeRange.startTs = Math.floor(Date.parse(startDate + 'T00:00:00Z') / 1000);
                if (isNaN(timeRange.startTs)) throw new Error('Invalid start date format');
            } catch (e) {
                logger.warn(`Invalid start date format: ${startDate}. Ignoring.`);
                delete timeRange.startTs;
            }
        }
        if (endDate) {
             try {
                timeRange.endTs = Math.floor(Date.parse(endDate + 'T23:59:59Z') / 1000);
                if (isNaN(timeRange.endTs)) throw new Error('Invalid end date format');
            } catch (e) {
                logger.warn(`Invalid end date format: ${endDate}. Ignoring.`);
                delete timeRange.endTs;
            }
        }
        if (Object.keys(timeRange).length === 0) {
            timeRange = undefined;
        }
    }
    if (timeRange) {
        logger.info(`Applying time range filter:`, timeRange);
    }
    return timeRange;
}

/**
 * Loads wallet information from a JSON file.
 */
function loadWallets(filePath: string): WalletInfo[] {
    try {
        const absolutePath = path.resolve(filePath);
        if (!fs.existsSync(absolutePath)) {
            logger.error(`Wallet list file not found: ${absolutePath}`);
            throw new Error(`File not found: ${absolutePath}`);
        }
        const fileContent = fs.readFileSync(absolutePath, 'utf-8');
        const wallets: WalletInfo[] = JSON.parse(fileContent);
        // Basic validation
        if (!Array.isArray(wallets) || wallets.some(w => typeof w.address !== 'string')) {
            throw new Error('Invalid wallet list format. Expected an array of {address: string, label?: string}.');
        }
        logger.info(`Loaded ${wallets.length} wallets from ${absolutePath}`);
        return wallets;
    } catch (error) {
        logger.error(`Failed to load or parse wallet list from ${filePath}:`, error);
        throw error; // Re-throw to be caught by main handler
    }
}

/**
 * Main execution function.
 */
async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option('walletList', {
      alias: 'w',
            description: 'Path to the JSON file containing the list of wallet addresses and optional labels',
      type: 'string',
            demandOption: true,
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

    try {
        // 1. Load wallets from the specified file
        const wallets = loadWallets(argv.walletList);
        if (wallets.length === 0) {
            logger.warn('Wallet list is empty. No report generated.');
            return; 
        }

        // Parse other CLI args for config
        const timeRange = parseTimeRange(argv.startDate, argv.endDate);
        const cliExcludedMints = argv.excludeMints ? argv.excludeMints.split(',').map(m => m.trim()).filter(m => m) : [];
        const finalExcludedMints = Array.from(new Set([...DEFAULT_EXCLUDED_MINTS, ...cliExcludedMints]));
         if (finalExcludedMints.length > DEFAULT_EXCLUDED_MINTS.length) {
             logger.info(`Using excluded mints (defaults + CLI): ${finalExcludedMints.join(', ')}`);
        } else {
            logger.debug(`Using default excluded mints: ${finalExcludedMints.join(', ')}`);
        }
        
        logger.info(`Starting KPI comparison report generation for ${wallets.length} wallets.`);

        // 2. Instantiate necessary services
        const dbService = new DatabaseService(); 
        // Populate BehaviorAnalysisConfig for BehaviorService
        const analysisConfig: BehaviorAnalysisConfig = {
            timeRange: timeRange,
            excludedMints: finalExcludedMints
        }; 
        const behaviorService = new BehaviorService(dbService, analysisConfig); // Pass populated config
        
        const kpiAnalyzer = new KPIComparisonAnalyzer(); 
        const reportingService = new ReportingService(behaviorService, kpiAnalyzer, undefined, undefined);

        // 3. Call ReportingService to handle the entire process
        await reportingService.generateComparativeBehaviorReport(wallets);

        logger.info('KPI comparison report generation process completed.');

    } catch (error) {
         if (error instanceof Error) {
             logger.error(`An error occurred during KPI comparison report generation: ${error.message}`, { stack: error.stack });
        } else {
             logger.error('An unknown error occurred during KPI comparison report generation:', error);
        }
        process.exitCode = 1; // Indicate failure
    } finally {
        // Prisma handles disconnection
        logger.info('Script finished.');
    }
}

// Execute main function
main().catch((error) => {
    if (error instanceof Error) {
        logger.error(`Unhandled error in main execution: ${error.message}`, { stack: error.stack });
    } else {
        logger.error('Unhandled unknown error in main execution:', error);
    }
    process.exit(1);
}); 