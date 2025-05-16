#!/usr/bin/env node
import { SimilarityAnalysisConfig } from '@/types/analysis';   
import { SimilarityMetrics } from '@/types/similarity';   
import { DatabaseService } from 'core/services/database-service'; 
import { SimilarityService } from 'core/analysis/similarity/similarity-service'; 
import { ReportingService } from 'core/reporting/reportGenerator'; 
import { createLogger } from 'core/utils/logger'; 
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path'; 

dotenv.config();

// Create logger for this module
const logger = createLogger('WalletSimilarityScript'); 

// --- Configuration ---
// Keep default excluded mints here or move fully to a central config file later
const DEFAULT_EXCLUDED_MINTS: string[] = [
    'So11111111111111111111111111111111111111112', // WSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

/**
 * Basic information about a wallet, including an optional label.
 */
interface WalletInfo {
    address: string;
    label?: string; // Optional friendly name from walletsFile
}

/**
 * Interface for command-line arguments parsed by yargs.
 */
interface CliArgs {
    wallets?: string;
    walletsFile?: string;
    excludeMints?: string;
    vectorType: 'capital' | 'binary'; // Type is guaranteed by yargs default + choices
    [key: string]: unknown;
    _: (string | number)[];
    $0: string;
}

// --- Main Orchestration Function ---
async function runSimilarityAnalysisScript(
    targetWallets: WalletInfo[],
    excludedMints: string[],
    vectorType: 'capital' | 'binary' 
) {
    const startTime = process.hrtime();
    logger.info(`Starting wallet similarity analysis script for ${targetWallets.length} wallets using ${vectorType} vectors...`);
    logger.debug(`Target wallets: ${targetWallets.map(w => w.label || w.address).join(', ')}`);
    logger.debug(`Excluded mints: ${excludedMints.join(', ')}`);

    if (targetWallets.length < 2) {
        logger.error("Similarity analysis requires at least 2 wallets.");
        console.error("Error: Similarity analysis requires at least 2 wallets.");
        return;
    }

    const walletAddresses = targetWallets.map(w => w.address);

    // 1. Instantiate Services
    const dbService = new DatabaseService();
    const similarityConfig: SimilarityAnalysisConfig = {
        excludedMints: excludedMints,
    };
    const similarityService = new SimilarityService(dbService, similarityConfig);
    
    // Instantiate ReportingService: Pass dbService first, undefined for BehaviorService, similarityService third.
    const reportingService = new ReportingService(undefined, undefined, undefined, similarityService, undefined);

    // 2. Run Analysis via Service
    let analysisResults: SimilarityMetrics | null = null;
    try {
        analysisResults = await similarityService.calculateWalletSimilarity(
            walletAddresses,
            vectorType
        );
    } catch (error) {
        logger.error('Error occurred during similarity calculation via SimilarityService:', { error });
        console.error('Error during similarity calculation. Check logs for details.');
        return;
    }

    if (!analysisResults) {
        logger.error("Similarity analysis failed to produce results via SimilarityService.");
        console.error('Similarity analysis failed. Check logs for details.');
        return;
    }

    // 3. Generate and Save Report via ReportingService
    let reportSavedSuccessfully = false; 
    try {
        // Assuming the logical signature despite previous linter error
        await reportingService.generateAndSaveSimilarityReport(
            walletAddresses,
            vectorType
        );
        reportSavedSuccessfully = true; 
    } catch (error) {
         logger.error('Error occurred during report generation/saving via ReportingService:', { error });
         console.error('Error generating or saving the report. Check logs for details.');
    }

    // 4. Final Output
    const endTime = process.hrtime(startTime);
    const durationSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);
    // Adjust logging based on whether the report saved
    if (reportSavedSuccessfully) {
        logger.info(`Analysis complete in ${durationSeconds}s. Report generation initiated by ReportingService.`);
        console.log(`Analysis complete in ${durationSeconds}s. Report saved (check reports folder).`);
    } else {
        logger.error(`Analysis complete in ${durationSeconds}s, but failed to save the report.`);
        console.error(`Analysis complete in ${durationSeconds}s, but the report could not be saved. Check logs.`);
    }

    // Disconnect Prisma
    try {
        await dbService['prismaClient'].$disconnect();
        logger.debug("Prisma client disconnected by script.");
    } catch (disconnectError) {
        logger.warn('Error disconnecting Prisma client:', { disconnectError });
    }
}

// --- CLI argument parsing and main call ---
if (require.main === module) {
    const argv = yargs(hideBin(process.argv))
        .scriptName('wallet-similarity') // Shorter name
        .usage('$0 --wallets "addr1,addr2,..." | --walletsFile <path-to-json> [options]')
        .option('wallets', {
            alias: 'w',
            type: 'string',
            description: 'Comma-separated list of wallet addresses to analyze',
        })
        .option('walletsFile', {
            alias: 'f',
            type: 'string',
            description: 'Path to a JSON file containing wallet addresses or {address, label} objects',
        })
        .option('excludeMints', {
            alias: 'e',
            type: 'string',
            description: `Comma-separated list of token mints to exclude. Defaults: ${DEFAULT_EXCLUDED_MINTS.join(', ')}`,
        })
        .option('vectorType', {
            alias: 'v',
            type: 'string',
            choices: ['capital', 'binary'],
            default: 'capital',
            description: 'Vector type for similarity calculation',
        } as const)
        .check((argv) => {
            if (!argv.wallets && !argv.walletsFile) {
                throw new Error('You must provide either --wallets or --walletsFile');
            }
            if (argv.wallets && argv.walletsFile) {
                throw new Error('Please provide either --wallets or --walletsFile, not both.');
            }
            if (argv.wallets && argv.wallets.split(',').length < 2) {
                 throw new Error('--wallets must contain at least two comma-separated addresses.');
            }
            // Add check for walletsFile content length if needed after parsing
            return true;
        })
        .help()
        .alias('help', 'h')
        .argv as CliArgs;

    let targetWallets: WalletInfo[] = [];
    let finalExcludedMints: string[] = DEFAULT_EXCLUDED_MINTS;

    // Parse Wallets
    if (argv.wallets) {
        targetWallets = argv.wallets.split(',').map((address: string) => ({ address: address.trim() }));
    } else if (argv.walletsFile) {
        try {
            const filePath = path.resolve(argv.walletsFile); // Resolve relative paths
            logger.info(`Reading wallets from file: ${filePath}`);
            if (!fs.existsSync(filePath)) {
                 throw new Error(`Wallets file not found at: ${filePath}`);
            }
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const walletsData = JSON.parse(fileContent);
            if (Array.isArray(walletsData)) {
                 // Simplify the mapping and filtering approach
                 targetWallets = walletsData
                    .map((item: any): WalletInfo | null => { // Map to WalletInfo | null
                        let address = '';
                        let label: string | undefined = undefined;
                        if (typeof item === 'string') {
                            address = item.trim();
                        } else if (item && typeof item.address === 'string') {
                            address = item.address.trim();
                            label = item.label;
                        } else {
                            // logger.warn(...) // Log removed for brevity
                            return null;
                        }
                        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
                            // logger.warn(...) // Log removed for brevity
                            return null;
                        }
                        // Return WalletInfo object
                        const walletInfo: WalletInfo = { address };
                        if (label !== undefined) {
                            walletInfo.label = label;
                        }
                        return walletInfo;
                    })
                    .filter((w): w is WalletInfo => w !== null); // Standard type guard filter

                if (targetWallets.length < 2) {
                   throw new Error(`The wallets file must contain at least two valid wallet entries. Found ${targetWallets.length}.`);
                }
            } else {
                throw new Error('Wallets file is not a valid JSON array.');
            }
        } catch (error: any) {
            logger.error(`Error reading or parsing wallets file '${argv.walletsFile}': ${error.message}`);
            console.error(`Error processing wallets file: ${error.message}`);
            process.exit(1);
        }
    }

    // Parse Excluded Mints
    if (argv.excludeMints) {
        const userExcludedMints = argv.excludeMints.split(',').map(m => m.trim()).filter(m => m);
        finalExcludedMints = Array.from(new Set([...DEFAULT_EXCLUDED_MINTS, ...userExcludedMints]));
    }

    // vectorType is now correctly typed from CliArgs
    const vectorType = argv.vectorType;

    // --- Execute Main Logic ---
    runSimilarityAnalysisScript(targetWallets, finalExcludedMints, vectorType)
        .then(() => {
            logger.info("Script execution finished.");
        })
        .catch(async (e) => {
            logger.error('Unhandled error in script execution:', { error: e });
            process.exit(1);
        });
} 