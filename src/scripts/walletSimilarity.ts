#!/usr/bin/env node
import { SimilarityAnalysisConfig } from '@/types/analysis';   
import { SingleSimilarityResult } from '@/types/similarity';   
import { DatabaseService } from 'core/services/database-service'; 
import { SimilarityService } from 'core/analysis/similarity/similarity-service'; 
import { ReportingService } from 'core/reporting/reportGenerator'; 
import { createLogger } from 'core/utils/logger'; 
import { WalletBalanceService } from 'core/services/wallet-balance-service';
import { HeliusApiClient } from 'core/services/helius-api-client';
import { HeliusApiConfig } from '@/types/helius-api';
import { WalletBalance } from '@/types/wallet';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path'; 
import Papa from 'papaparse'; // Added for CSV parsing

dotenv.config();

// Create logger for this module
const logger = createLogger('WalletSimilarityScript'); 

// --- Configuration ---
// Keep default excluded mints here or move fully to a central config file later
const DEFAULT_EXCLUDED_MINTS: string[] = [
    'So1111111111111111111111111111111111111112', // WSOL
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
    
    // ---- Instantiate WalletBalanceService ----
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
        logger.error("HELIUS_API_KEY is not set in .env file. Cannot fetch wallet balances.");
        // Decide if to proceed without balances or exit
        // For now, we'll log and proceed, but services below will need to handle missing balances.
        // Consider exiting: process.exit(1); 
    }

    // Construct HeliusApiConfig
    const heliusConfig: HeliusApiConfig = {
        apiKey: heliusApiKey || '', // Provide empty string if undefined, HeliusApiClient should handle or error
        network: 'mainnet' // Assuming mainnet, adjust if needed or make configurable
    };
    const heliusClient = new HeliusApiClient(heliusConfig, dbService);
    const walletBalanceService = new WalletBalanceService(heliusClient, dbService);
    // ---- End WalletBalanceService Instantiation ----
    
    // Instantiate ReportingService: Pass dbService first, undefined for BehaviorService, similarityService third.
    const reportingService = new ReportingService(undefined, undefined, undefined, similarityService, undefined);

    // ---- Fetch Wallet Balances ----
    let walletBalancesMap: Map<string, WalletBalance> = new Map();
    if (heliusApiKey) { // Only attempt fetch if API key is present
        try {
            logger.info("Fetching current wallet balances for similarity analysis...");
            walletBalancesMap = await walletBalanceService.fetchWalletBalances(walletAddresses);
            logger.info(`Successfully fetched balances for ${walletBalancesMap.size} wallets.`);
        } catch (balanceError) {
            logger.error("Error fetching wallet balances for similarity analysis. Proceeding without live balances.", { balanceError });
            // Continue with an empty map, services should handle this gracefully or report it.
        }
    } else {
        logger.warn("HELIUS_API_KEY not found, skipping live balance fetching for similarity analysis.");
    }
    // ---- End Fetch Wallet Balances ----

    // 2. Run Analysis via Service
    let analysisResults: SingleSimilarityResult | null = null;
    try {
        analysisResults = await similarityService.calculateWalletSimilarity(
            walletAddresses,
            vectorType,
            walletBalancesMap // Pass the balances map
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
            vectorType,
            walletBalancesMap // Pass the balances map
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
            description: 'Path to a JSON or CSV file containing wallet addresses or {address, label} objects. CSV should have headers like \'address\' and optional \'label\'.',
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

    // Helper function to parse wallets from CSV
    function parseWalletsFromCsv(fileContent: string): WalletInfo[] {
        const parsed = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
        const wallets: WalletInfo[] = [];

        if (parsed.errors.length > 0) {
            parsed.errors.forEach(err => logger.warn(`CSV parsing error: ${err.message} on row ${err.row}`));
            // Decide if to throw or continue with partial data
            if (!parsed.data || parsed.data.length === 0) {
                 throw new Error('Failed to parse CSV or CSV is empty after errors.');
            }
        }

        const data = parsed.data as Record<string, string>[];
        const addressHeaderCandidates = ['address', 'wallet', 'addresses', 'wallets'];
        const labelHeaderCandidates = ['label', 'name', 'tag'];

        let actualAddressHeader: string | undefined = undefined;
        let actualLabelHeader: string | undefined = undefined;

        if (data.length > 0) {
            const headers = Object.keys(data[0]).map(h => h.toLowerCase());
            actualAddressHeader = addressHeaderCandidates.find(cand => headers.includes(cand));
            actualLabelHeader = labelHeaderCandidates.find(cand => headers.includes(cand));
        }

        if (!actualAddressHeader && data.length > 0 && Object.keys(data[0]).length === 1) {
            // If no specific address header, but only one column, assume it's addresses
            actualAddressHeader = Object.keys(data[0])[0];
            logger.info(`No specific address header found in CSV, but only one column detected. Using column '${actualAddressHeader}' for addresses.`);
        } else if (!actualAddressHeader) {
            throw new Error('CSV file must contain an address column (e.g., \'address\', \'wallet\') or be a single column of addresses.');
        }

        for (const row of data) {
            const address = row[actualAddressHeader!]?.trim();
            const label = actualLabelHeader ? row[actualLabelHeader]?.trim() : undefined;

            if (address && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
                const walletInfo: WalletInfo = { address };
                if (label) {
                    walletInfo.label = label;
                }
                wallets.push(walletInfo);
            } else if (address) {
                logger.warn(`Skipping invalid wallet address from CSV: ${address}`);
            }
        }
        return wallets;
    }

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
            
            if (filePath.toLowerCase().endsWith('.csv')) {
                logger.info('Parsing wallets from CSV file.');
                targetWallets = parseWalletsFromCsv(fileContent);
            } else if (filePath.toLowerCase().endsWith('.json')) {
                logger.info('Parsing wallets from JSON file.');
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
            } else {
                throw new Error('Wallets file must be a .json or .csv file.');
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