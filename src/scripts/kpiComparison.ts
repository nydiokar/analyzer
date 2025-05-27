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
import { createLogger } from 'core/utils/logger';
import { DatabaseService } from 'core/services/database-service';
import { BehaviorService } from 'core/analysis/behavior/behavior-service';
import { ReportingService } from 'core/reporting/reportGenerator';
import { KPIComparisonAnalyzer } from 'core/analysis/behavior/kpi_analyzer'; // Need the analyzer core
import { WalletInfo } from '@/types/wallet';
import { BehaviorAnalysisConfig } from '@/types/analysis'; // Import specific config
import { parseTimeRange } from 'core/utils/cliUtils';


// Initialize logger
const logger = createLogger('KPIComparisonReportScript');

// Default excluded mints (can be overridden by CLI)
const DEFAULT_EXCLUDED_MINTS: string[] = [
    'So11111111111111111111111111111111111111112', // WSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

/**
 * Main execution function.
 */
async function main() {
    const argv = await yargs(hideBin(process.argv))
        .option('wallets', {
            alias: 'w',
            description: 'A comma-separated list of wallet addresses (e.g., "addr1,addr2,addr3")',
            type: 'string',
            demandOption: true,
            coerce: (arg: string): WalletInfo[] => { // Coerce the comma-separated string into WalletInfo[]
                if (!arg || typeof arg !== 'string') {
                    return [];
                }
                return arg.split(',').map(address => ({ address: address.trim() })).filter(w => w.address);
            }
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
        // 1. Get wallets from CLI arguments
        const wallets: WalletInfo[] = argv.wallets;

        if (!wallets || wallets.length === 0) {
            logger.warn('No wallets provided or invalid format. Use --wallets "addr1,addr2,addr3". No report generated.');
            return; 
        }
        logger.info(`Processing ${wallets.length} wallets provided via CLI: ${wallets.map(w => w.address).join(', ')}`);

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
        const analysisConfig: BehaviorAnalysisConfig = {
            timeRange: timeRange,
            excludedMints: finalExcludedMints
        }; 
        const behaviorService = new BehaviorService(dbService, analysisConfig); 
        
        const kpiAnalyzer = new KPIComparisonAnalyzer(); 
        const reportingService = new ReportingService(behaviorService, kpiAnalyzer, undefined, undefined, undefined);

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