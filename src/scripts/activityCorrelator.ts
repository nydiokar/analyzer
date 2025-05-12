#!/usr/bin/env node
// import { PrismaClient } from '@prisma/client'; // Removed direct Prisma client
import { createLogger } from '../utils/logger';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { WalletInfo } from '../types/wallet'; // Keep WalletInfo type
import { DatabaseService } from '../wallet_analysis/services/database-service'; // Import DatabaseService
import { CorrelationService } from '../wallet_analysis/services/correlation-service'; // Import CorrelationService
import { ReportingService } from '../wallet_analysis/services/reporting-service'; // Import ReportingService
import { BaseAnalysisConfig, CorrelationAnalysisConfig } from '../types/analysis'; // Import BaseAnalysisConfig and specific config type

// Services will be imported later

// Initialize environment variables
dotenv.config();

// const prisma = new PrismaClient(); // Removed direct Prisma client
const logger = createLogger('WalletActivityCorrelatorScript'); // Renamed logger

// --- Configuration (Defaults for CLI parsing remain) ---
const DEFAULT_EXCLUDED_MINTS: string[] = [
    'So11111111111111111111111111111111111111112', // WSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

/**
 * Parses optional start/end date CLI args into a timeRange object.
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
        // If both were invalid or only one was provided but invalid, reset to undefined
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
 * Refactored main function to orchestrate the correlation analysis using services.
 */
async function main(
    targetWallets: WalletInfo[],
    cliExcludedMints: string[],
    timeRange?: { startTs?: number; endTs?: number } // Add timeRange parameter
) {
    const startTime = process.hrtime();
    logger.info(`Starting wallet activity correlation script for ${targetWallets.length} wallets.`);

    // Combine default and CLI excluded mints
    const finalExcludedMints = Array.from(new Set([...DEFAULT_EXCLUDED_MINTS, ...cliExcludedMints]));
    if (finalExcludedMints.length > DEFAULT_EXCLUDED_MINTS.length) {
         logger.info(`Using excluded mints (defaults + CLI): ${finalExcludedMints.join(', ')}`);
    } else {
        logger.debug(`Using default excluded mints: ${finalExcludedMints.join(', ')}`);
    }
    
    // --- Service Instantiation and Orchestration ---
    const dbService = new DatabaseService(); 

    try {
        // Remove redundant BaseAnalysisConfig
        // const analysisConfig: BaseAnalysisConfig = { ... };

        // Populate CorrelationAnalysisConfig directly
        const correlationConfig: CorrelationAnalysisConfig = {
            excludedMints: finalExcludedMints,
            timeRange: timeRange // Pass parsed timeRange
        }; 
        const correlationService = new CorrelationService(dbService, correlationConfig); // Pass full config
        
        // Instantiate ReportingService - ONLY provide the required CorrelationService
        const reportingService = new ReportingService(
            undefined, 
            undefined, 
            correlationService,
            undefined  
        );

        const walletAddresses = targetWallets.map(w => w.address);
        await reportingService.generateAndSaveCorrelationReport(walletAddresses);

        logger.info('Correlation analysis and report generation finished successfully.');

    } catch (error) {
        logger.error('Error during script execution:', { error });
        process.exitCode = 1; // Indicate error
    } finally {
        // Ensure database connection is closed
        // await dbService.disconnect(); // Removed - Assuming handled internally or not needed
        // logger.debug('Database disconnected.');
    }

    // --- Final Logging ---
    const endTime = process.hrtime(startTime);
    const durationSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);
    logger.info(`Wallet activity correlation script finished in ${durationSeconds}s.`);
}

// --- CLI argument parsing and execution (Modified) --- 
interface CliArgs { // Interface remains useful
    wallets?: string;
    walletsFile?: string;
    uploadCsv?: string; // Keep if needed
    excludeMints?: string;
    // Removed options related to logic moved to CLUSTERING_CONFIG
    [key: string]: unknown;
    _: (string | number)[];
    $0: string;
    startDate?: string;
    endDate?: string;
}

if (require.main === module) {
    const argv = yargs(hideBin(process.argv))
        .scriptName('run-correlation-analysis') // Updated script name
        .usage('$0 --wallets "addr1,addr2,..." | --walletsFile <path-to-json> | --uploadCsv <path-to-csv> [options]')
        .option('wallets', { /* ... existing ... */ })
        .option('walletsFile', { /* ... existing ... */ })
        .option('uploadCsv', { /* ... existing ... */ })
        .option('excludeMints', {
            alias: 'e',
            type: 'string',
            description: `Comma-separated list of token mints to exclude. Adds to defaults: ${DEFAULT_EXCLUDED_MINTS.join(', ')}`,
            default: '' // Default to empty string, merge later
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
        .check((argv) => {
            const sources = [argv.wallets, argv.walletsFile, argv.uploadCsv].filter(Boolean).length;
            if (sources === 0) throw new Error('One of --wallets, --walletsFile, or --uploadCsv is required.');
            if (sources > 1) throw new Error('Provide only one of --wallets, --walletsFile, or --uploadCsv.');
            return true;
        })
        .help()
        .alias('help', 'h')
        .argv as CliArgs;

    let targetWallets: WalletInfo[] = [];
    const cliExcludedMints = argv.excludeMints ? argv.excludeMints.split(',').map(m => m.trim()).filter(m => m) : [];
    const timeRange = parseTimeRange(argv.startDate, argv.endDate); // Parse time range

    // --- Wallet Loading Logic (remains the same) ---
    if (argv.wallets) {
        targetWallets = argv.wallets.split(',').map((address: string) => ({ address: address.trim() }));
    } else if (argv.walletsFile) {
        try {
            const fileContent = fs.readFileSync(argv.walletsFile, 'utf-8');
            const walletsData = JSON.parse(fileContent);
            if (Array.isArray(walletsData)) {
                targetWallets = walletsData.map((item: any): WalletInfo | null => {
                    if (typeof item === 'string') return { address: item.trim() };
                    if (item && typeof item.address === 'string') return { address: item.address.trim(), label: item.label };
                    logger.warn(`Skipping invalid wallet entry in file: ${JSON.stringify(item)}`);
                    return null;
                }).filter((w): w is WalletInfo => w !== null);
            } else {
                logger.error('Wallets file is not a JSON array.');
                process.exit(1);
            }
        } catch (error) {
            logger.error(`Error reading or parsing wallets file '${argv.walletsFile}':`, { error });
            process.exit(1);
        }
    } else if (argv.uploadCsv) {
        try {
            const fileContent = fs.readFileSync(argv.uploadCsv, 'utf-8');
            const lines = fileContent.split('\n').filter(line => line.trim() !== '');
            targetWallets = lines.map((line: string): WalletInfo | null => {
                const parts = line.split(',').map(p => p.trim());
                const address = parts[0];
                if (!address) return null; // Skip empty lines or lines without an address
                const label = parts[1] || undefined;
                return { address, label };
            }).filter((w): w is WalletInfo => w !== null);
            if (targetWallets.length === 0) {
                logger.warn(`No valid wallets found in CSV file: ${argv.uploadCsv}`);
            }
        } catch (error) {
            logger.error(`Error reading or parsing CSV wallets file '${argv.uploadCsv}':`, { error });
            process.exit(1);
        }
    }
    // --- End Wallet Loading Logic ---
    
    if (targetWallets.length === 0) {
        logger.error('No target wallets specified after processing inputs. Exiting.');
        process.exit(1);
    }
    if (targetWallets.length < 2) {
        logger.error('Correlation analysis requires at least two wallets. Exiting.');
            process.exit(1);
    }

    // Execute the refactored main function, passing timeRange
    main(targetWallets, cliExcludedMints, timeRange)
        .catch((e) => {
            logger.error('Unhandled error in script execution:', { error: e });
            process.exitCode = 1; // Ensure error exit code
        });
} 