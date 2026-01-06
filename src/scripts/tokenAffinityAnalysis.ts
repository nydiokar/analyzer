#!/usr/bin/env node
import { DatabaseService } from '../core/services/database-service';
import { createLogger } from '../core/utils/logger';
import { WalletBalanceService } from '../core/services/wallet-balance-service';
import { HeliusApiClient } from '../core/services/helius-api-client';
import { HeliusApiConfig } from '../types/helius-api';
import { WalletBalance } from '../types/wallet';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as Papa from 'papaparse';

dotenv.config();

// Create logger for this module
const logger = createLogger('TokenAffinityAnalysisScript');

// --- Configuration ---
const DEFAULT_EXCLUDED_MINTS: string[] = [
    'So1111111111111111111111111111111111111112', // WSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

// --- Session Management Types ---
interface AffinitySession {
    sessionId: string;
    createdAt: number;
    updatedAt: number;
    initialWallets: string[];
    analyzedTokens: string[];
    results: TokenAffinityResult[];
    status: 'initializing' | 'analyzing' | 'completed' | 'error';
}

interface TokenMatchDetails {
    mint: string;
    name?: string;
    symbol?: string;
    firstSeen: number;
    lastSeen: number;
    transactionCount: number;
}

interface WalletSimilarity {
    walletA: string;
    walletB: string;
    overlapCount: number;  // How many target tokens both hold
    overlapPercentage: number;  // Percentage of target tokens they share
    jaccardSimilarity: number;  // Jaccard similarity of their token holdings
    sharedTokens: string[];
}

interface TokenAffinityResult {
    targetTokens: string[];
    analyzedAt: number;
    candidateWallets: string[];
    topMatchingWallets: Array<{
        wallet: string;
        overlapCount: number;
        overlapPercentage: number;
        matchedTokens: string[];
        totalHeldTokens: number;
        tokenDetails: TokenMatchDetails[];
    }>;
    walletSimilarities: WalletSimilarity[];
    analysisMetadata: {
        totalWalletsAnalyzed: number;
        totalTokensMatched: number;
        similarityPairsAnalyzed: number;
        processingTimeSeconds: number;
    };
}

// --- CLI Argument Types ---
interface CliArgs {
    sessionId?: string;
    wallets?: string;
    walletsFile?: string;
    tokens?: string;
    tokensFile?: string;
    batchSize?: number;
    topResults?: number;
    vectorType: 'capital' | 'binary';
    continue?: boolean;
    [key: string]: unknown;
    _: (string | number)[];
    $0: string;
}

// --- Session Management Functions ---
function getSessionFilePath(sessionId: string): string {
    return path.join(process.cwd(), 'analysis_sessions', `token_affinity_${sessionId}.json`);
}

function loadSession(sessionId: string): AffinitySession | null {
    const sessionFile = getSessionFilePath(sessionId);
    if (!fs.existsSync(sessionFile)) {
        return null;
    }

    try {
        const data = fs.readFileSync(sessionFile, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        logger.error(`Error loading session ${sessionId}:`, { error });
        return null;
    }
}

function saveSession(session: AffinitySession): void {
    const sessionDir = path.join(process.cwd(), 'analysis_sessions');
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const sessionFile = getSessionFilePath(session.sessionId);
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));
    logger.info(`Session ${session.sessionId} saved to ${sessionFile}`);
}

function createNewSession(initialWallets: string[]): AffinitySession {
    const sessionId = `affinity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const session: AffinitySession = {
        sessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        initialWallets,
        analyzedTokens: [],
        results: [],
        status: 'initializing'
    };

    saveSession(session);
    return session;
}

// --- Report Generation Functions ---
function generateMarkdownReport(result: TokenAffinityResult, sessionId: string): string {
    const timestamp = new Date(result.analyzedAt).toLocaleString();
    const reportPath = require('path').join(process.cwd(), 'analysis_sessions', `token_affinity_report_${sessionId}.md`);

    let markdown = `# Token Affinity Analysis Report

**Session ID:** ${sessionId}  
**Analysis Date:** ${timestamp}  
**Target Tokens:** ${result.targetTokens.length}  
**Wallets Analyzed:** ${result.analysisMetadata.totalWalletsAnalyzed}  
**Processing Time:** ${result.analysisMetadata.processingTimeSeconds.toFixed(2)} seconds  

## Target Tokens
${result.targetTokens.map(token => `- \`${token}\``).join('\n')}

## Top Matching Wallets

The following wallets hold the most tokens from the target set:

`;

    result.topMatchingWallets.forEach((wallet, index) => {
        markdown += `### ${index + 1}. Wallet: \`${wallet.wallet}\`

- **Tokens Held:** ${wallet.overlapCount}/${result.targetTokens.length} (${(wallet.overlapPercentage * 100).toFixed(1)}%)
- **Total Tokens in Wallet:** ${wallet.totalHeldTokens}

#### Token Details
| Token | First Seen | Last Seen | Transactions | Days Held |
|-------|------------|-----------|--------------|-----------|
`;

        wallet.tokenDetails.forEach(token => {
            const tokenName = token.name || token.symbol || token.mint;
            const firstSeen = token.firstSeen > 0 ? new Date(token.firstSeen).toLocaleDateString() : 'Unknown';
            const lastSeen = token.lastSeen > 0 ? new Date(token.lastSeen).toLocaleDateString() : 'Unknown';
            const daysHeld = token.firstSeen > 0 && token.lastSeen > 0 ?
                Math.floor((token.lastSeen - token.firstSeen) / (1000 * 60 * 60 * 24)) : 'N/A';

            markdown += `| \`${tokenName}\` | ${firstSeen} | ${lastSeen} | ${token.transactionCount} | ${daysHeld} |\n`;
        });

        markdown += '\n---\n\n';
    });

    if (result.walletSimilarities.length > 0) {
        markdown += `## Wallet Similarities

Analysis of similarity between top matching wallets (${result.walletSimilarities.length} pairs analyzed):

| Wallet A | Wallet B | Token Overlap | Jaccard Similarity | Shared Tokens |
|----------|----------|---------------|-------------------|---------------|
`;

        result.walletSimilarities.forEach(sim => {
            const overlap = `${sim.overlapCount}/${result.targetTokens.length} (${(sim.overlapPercentage * 100).toFixed(1)}%)`;
            const jaccard = `${(sim.jaccardSimilarity * 100).toFixed(1)}%`;
            const sharedTokens = sim.sharedTokens.map(token => `\`${token.slice(0, 8)}...\``).join(', ');

            markdown += `| \`${sim.walletA}\` | \`${sim.walletB}\` | ${overlap} | ${jaccard} | ${sharedTokens} |\n`;
        });

        markdown += '\n### Similarity Insights\n\n';

        // Add some insights about highly similar wallets
        const highSimilarityPairs = result.walletSimilarities.filter(sim => sim.jaccardSimilarity > 0.5);
        if (highSimilarityPairs.length > 0) {
            markdown += `**Highly Similar Pairs (Jaccard > 50%):**\n\n`;
            highSimilarityPairs.forEach(sim => {
                markdown += `- \`${sim.walletA}\` ↔ \`${sim.walletB}\`: ${(sim.jaccardSimilarity * 100).toFixed(1)}% similar\n`;
            });
            markdown += '\n';
        }

        const mostSharedToken = result.targetTokens
            .map(token => ({
                token,
                sharedBy: result.walletSimilarities.filter(sim => sim.sharedTokens.includes(token)).length
            }))
            .sort((a, b) => b.sharedBy - a.sharedBy)[0];

        if (mostSharedToken && mostSharedToken.sharedBy > 0) {
            markdown += `**Most Shared Token:** \`${mostSharedToken.token}\` (shared by ${mostSharedToken.sharedBy} wallet pairs)\n\n`;
        }
    }

    markdown += `## Analysis Metadata

- **Similarity Pairs Analyzed:** ${result.analysisMetadata.similarityPairsAnalyzed}
- **Report Generated:** ${new Date().toLocaleString()}
- **Report File:** \`${reportPath}\`

---
*Generated by Token Affinity Analysis Script*`;

    return markdown;
}

// --- Similarity Functions ---
function calculateWalletSimilarities(
    wallets: Array<{
        wallet: string;
        matchedTokens: string[];
    }>,
    targetTokens: string[]
): WalletSimilarity[] {
    const similarities: WalletSimilarity[] = [];

    // Calculate pairwise similarities between top wallets
    for (let i = 0; i < wallets.length; i++) {
        for (let j = i + 1; j < wallets.length; j++) {
            const walletA = wallets[i];
            const walletB = wallets[j];

            // Find shared target tokens
            const sharedTokens = walletA.matchedTokens.filter(token => walletB.matchedTokens.includes(token));
            const overlapCount = sharedTokens.length;
            const overlapPercentage = targetTokens.length > 0 ? overlapCount / targetTokens.length : 0;

            // Calculate Jaccard similarity: |A ∩ B| / |A ∪ B|
            const unionTokens = new Set([...walletA.matchedTokens, ...walletB.matchedTokens]);
            const jaccardSimilarity = unionTokens.size > 0 ? overlapCount / unionTokens.size : 0;

            similarities.push({
                walletA: walletA.wallet,
                walletB: walletB.wallet,
                overlapCount,
                overlapPercentage,
                jaccardSimilarity,
                sharedTokens
            });
        }
    }

    // Sort by similarity (highest first)
    return similarities.sort((a, b) => b.jaccardSimilarity - a.jaccardSimilarity);
}

// --- Token Matching Functions ---
async function calculateTokenOverlapWithDetails(
    wallet: string,
    targetTokens: string[],
    heldTokens: string[],
    dbService: DatabaseService,
    tokenInfoMap: Map<string, any>
): Promise<{
    wallet: string;
    overlapCount: number;
    overlapPercentage: number;
    matchedTokens: string[];
    totalHeldTokens: number;
    tokenDetails: TokenMatchDetails[];
}> {
    const matchedTokens = heldTokens.filter(token => targetTokens.includes(token));
    const overlapCount = matchedTokens.length;
    const overlapPercentage = targetTokens.length > 0 ? overlapCount / targetTokens.length : 0;

    let tokenDetails: TokenMatchDetails[] = [];

    if (matchedTokens.length > 0) {
        try {
            // Fetch transaction data for this wallet to get first/last seen timestamps
            const transactions = await dbService.getTransactionsForAnalysis([wallet], {
                excludedMints: DEFAULT_EXCLUDED_MINTS,
                timeRange: { startTs: 0, endTs: Date.now() } // Get all historical data
            });

            const walletTxs = transactions[wallet] || [];

            // Process each matched token
            tokenDetails = matchedTokens.map(mint => {
                const tokenTxs = walletTxs.filter(tx => tx.mint === mint);
                const timestamps = tokenTxs.map(tx => tx.timestamp);

                const tokenInfo = tokenInfoMap.get(mint);

                return {
                    mint,
                    name: tokenInfo?.name,
                    symbol: tokenInfo?.symbol,
                    firstSeen: timestamps.length > 0 ? Math.min(...timestamps) : 0,
                    lastSeen: timestamps.length > 0 ? Math.max(...timestamps) : 0,
                    transactionCount: tokenTxs.length
                };
            });
        } catch (error) {
            logger.warn(`Could not fetch transaction details for wallet ${wallet}:`, { error });
            // Fallback to basic info without timestamps
            tokenDetails = matchedTokens.map(mint => {
                const tokenInfo = tokenInfoMap.get(mint);
                return {
                    mint,
                    name: tokenInfo?.name,
                    symbol: tokenInfo?.symbol,
                    firstSeen: 0,
                    lastSeen: 0,
                    transactionCount: 0
                };
            });
        }
    }

    return {
        wallet,
        overlapCount,
        overlapPercentage,
        matchedTokens,
        totalHeldTokens: heldTokens.length,
        tokenDetails
    };
}

// --- Main Analysis Function ---
async function runTokenMatchingAnalysis(
    session: AffinitySession,
    targetTokens: string[],
    topResults: number = 10
): Promise<TokenAffinityResult> {
    const startTime = process.hrtime();
    logger.info(`Starting token matching analysis for session ${session.sessionId}`);
    logger.info(`Analyzing ${targetTokens.length} target tokens against ${session.initialWallets.length} wallets`);
    logger.info(`Finding top ${topResults} wallets with most token matches`);

    if (session.initialWallets.length === 0) {
        throw new Error("No wallets to analyze. Session must have initial wallets.");
    }

    if (targetTokens.length === 0) {
        throw new Error("No target tokens specified for analysis.");
    }

    // 1. Instantiate Services
    const dbService = new DatabaseService();

    // ---- Instantiate WalletBalanceService ----
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
        logger.error("HELIUS_API_KEY is not set. Cannot fetch wallet balances.");
        throw new Error("HELIUS_API_KEY environment variable is required");
    }

    const heliusConfig: HeliusApiConfig = {
        apiKey: heliusApiKey,
        network: 'mainnet'
    };
    const heliusClient = new HeliusApiClient(heliusConfig, dbService);
    const walletBalanceService = new WalletBalanceService(heliusClient, dbService);

    // 2. Fetch wallet balances for all candidate wallets
    logger.info(`Fetching balances for ${session.initialWallets.length} candidate wallets...`);
    const walletBalancesMap = await walletBalanceService.fetchWalletBalances(session.initialWallets);
    logger.info(`Fetched balances for ${walletBalancesMap.size} wallets.`);

    // 3. Get unique tokens across all wallets for metadata enrichment
    const allTokens = new Set<string>();
    walletBalancesMap.forEach(balance => {
        balance.tokenBalances.forEach(tb => {
            if (!DEFAULT_EXCLUDED_MINTS.includes(tb.mint)) {
                allTokens.add(tb.mint);
            }
        });
    });
    targetTokens.forEach(token => allTokens.add(token));

    // 4. Fetch token metadata
    logger.info(`Fetching metadata for ${allTokens.size} unique tokens...`);
    const tokenInfos = await dbService['prismaClient'].tokenInfo.findMany({
        where: {
            tokenAddress: {
                in: Array.from(allTokens)
            }
        },
        select: {
            tokenAddress: true,
            name: true,
            symbol: true,
            imageUrl: true
        }
    });
    const tokenInfoMap = new Map<string, any>(tokenInfos.map(info => [info.tokenAddress, info]));

    // 5. Calculate token overlap for each wallet with transaction details
    logger.info("Calculating token overlaps and transaction details...");
    const walletOverlaps = [];
    for (const wallet of session.initialWallets) {
        const walletBalance = walletBalancesMap.get(wallet);
        const heldTokens = walletBalance ?
            walletBalance.tokenBalances
                .filter(tb => !DEFAULT_EXCLUDED_MINTS.includes(tb.mint))
                .map(tb => tb.mint) : [];

        const overlap = await calculateTokenOverlapWithDetails(
            wallet,
            targetTokens,
            heldTokens,
            dbService,
            tokenInfoMap
        );
        walletOverlaps.push(overlap);
    }

    // 4. Sort by overlap count (descending) and take top results
    const topMatchingWallets = walletOverlaps
        .filter(w => w.overlapCount > 0) // Only include wallets that hold at least one target token
        .sort((a, b) => {
            // Primary sort: overlap count
            if (b.overlapCount !== a.overlapCount) {
                return b.overlapCount - a.overlapCount;
            }
            // Secondary sort: overlap percentage
            return b.overlapPercentage - a.overlapPercentage;
        })
        .slice(0, topResults);

    // 5. Calculate similarities between top matching wallets
    logger.info("Calculating similarities between top matching wallets...");
    const walletSimilarities = calculateWalletSimilarities(
        topMatchingWallets.map(w => ({ wallet: w.wallet, matchedTokens: w.matchedTokens })),
        targetTokens
    );

    // 6. Create result
    const result: TokenAffinityResult = {
        targetTokens,
        analyzedAt: Date.now(),
        candidateWallets: session.initialWallets,
        topMatchingWallets,
        walletSimilarities,
        analysisMetadata: {
            totalWalletsAnalyzed: session.initialWallets.length,
            totalTokensMatched: targetTokens.length,
            similarityPairsAnalyzed: walletSimilarities.length,
            processingTimeSeconds: 0 // Will be set below
        }
    };

    // Calculate processing time
    const endTime = process.hrtime(startTime);
    result.analysisMetadata.processingTimeSeconds = endTime[0] + endTime[1] / 1e9;

    // Update session
    session.analyzedTokens.push(...targetTokens.filter(t => !session.analyzedTokens.includes(t)));
    session.results.push(result);
    session.updatedAt = Date.now();
    session.status = 'completed';
    saveSession(session);

    // Disconnect Prisma
    try {
        await dbService['prismaClient'].$disconnect();
        logger.debug("Prisma client disconnected by script.");
    } catch (disconnectError) {
        logger.warn('Error disconnecting Prisma client:', { disconnectError });
    }

    const durationSeconds = result.analysisMetadata.processingTimeSeconds.toFixed(2);
    logger.info(`Token matching analysis completed in ${durationSeconds}s for session ${session.sessionId}`);
    logger.info(`Found ${topMatchingWallets.length} wallets holding target tokens`);

    return result;
}

// --- Utility Functions ---
function parseWalletsFromCsv(fileContent: string): string[] {
    const parsed = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
    const wallets: string[] = [];

    if (parsed.errors.length > 0) {
        parsed.errors.forEach(err => logger.warn(`CSV parsing error: ${err.message} on row ${err.row}`));
    }

    const data = parsed.data as Record<string, string>[];
    const addressHeaderCandidates = ['address', 'wallet', 'addresses', 'wallets'];

    let actualAddressHeader: string | undefined = undefined;

    if (data.length > 0) {
        const headers = Object.keys(data[0]).map(h => h.toLowerCase());
        actualAddressHeader = addressHeaderCandidates.find(cand => headers.includes(cand));
    }

    if (!actualAddressHeader && data.length > 0 && Object.keys(data[0]).length === 1) {
        actualAddressHeader = Object.keys(data[0])[0];
        logger.info(`No specific address header found in CSV, using column '${actualAddressHeader}' for addresses.`);
    } else if (!actualAddressHeader) {
        throw new Error('CSV file must contain an address column (e.g., \'address\', \'wallet\') or be a single column of addresses.');
    }

    for (const row of data) {
        const address = row[actualAddressHeader!]?.trim();
        if (address && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
            wallets.push(address);
        } else if (address) {
            logger.warn(`Skipping invalid wallet address from CSV: ${address}`);
        }
    }

    return wallets;
}

// --- Main CLI Logic ---
if (require.main === module) {
    const argv = yargs(hideBin(process.argv))
        .scriptName('token-affinity')
        .usage('$0 --wallets "addr1,addr2,..." --tokens "token1,token2,..." [options]')
        .option('sessionId', {
            alias: 's',
            type: 'string',
            description: 'Session ID to continue an existing analysis',
        })
        .option('wallets', {
            alias: 'w',
            type: 'string',
            description: 'Comma-separated list of wallet addresses to analyze initially',
        })
        .option('walletsFile', {
            alias: 'f',
            type: 'string',
            description: 'Path to a CSV/JSON file containing wallet addresses',
        })
        .option('tokens', {
            alias: 't',
            type: 'string',
            description: 'Comma-separated list of token mint addresses to analyze',
        })
        .option('tokensFile', {
            type: 'string',
            description: 'Path to a file containing token mint addresses (one per line)',
        })
        .option('topResults', {
            alias: 'r',
            type: 'number',
            default: 10,
            description: 'Number of top matching wallets to return',
        })
        .option('continue', {
            alias: 'c',
            type: 'boolean',
            default: false,
            description: 'Continue an existing session with new tokens',
        })
        .check((argv) => {
            // Must have either sessionId OR wallets/tokens for new session
            if (!argv.sessionId && !argv.wallets && !argv.walletsFile) {
                throw new Error('Must provide either --sessionId to continue OR --wallets/--walletsFile for new session');
            }
            if (argv.sessionId && (argv.wallets || argv.walletsFile)) {
                throw new Error('Cannot specify both --sessionId and wallet sources. Use --sessionId to continue, or omit it for new session.');
            }
            if (!argv.sessionId && !argv.tokens && !argv.tokensFile) {
                throw new Error('Must provide --tokens or --tokensFile when starting new session');
            }
            return true;
        })
        .help()
        .alias('help', 'h')
        .argv as CliArgs;

    // Parse wallets
    let initialWallets: string[] = [];
    if (argv.wallets) {
        initialWallets = argv.wallets.split(',').map(addr => addr.trim());
    } else if (argv.walletsFile) {
        try {
            const filePath = path.resolve(argv.walletsFile);
            logger.info(`Reading wallets from file: ${filePath}`);
            if (!fs.existsSync(filePath)) {
                throw new Error(`Wallets file not found at: ${filePath}`);
            }
            const fileContent = fs.readFileSync(filePath, 'utf-8');

            if (filePath.toLowerCase().endsWith('.csv')) {
                logger.info('Parsing wallets from CSV file.');
                initialWallets = parseWalletsFromCsv(fileContent);
            } else if (filePath.toLowerCase().endsWith('.json')) {
                logger.info('Parsing wallets from JSON file.');
                const walletsData = JSON.parse(fileContent);
                if (Array.isArray(walletsData)) {
                    initialWallets = walletsData
                        .map((item: any) => {
                            if (typeof item === 'string') return item.trim();
                            if (item && typeof item.address === 'string') return item.address.trim();
                            return null;
                        })
                        .filter((addr): addr is string => addr !== null && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr));
                } else {
                    throw new Error('Wallets file is not a valid JSON array.');
                }
            } else {
                throw new Error('Wallets file must be a .json or .csv file.');
            }
        } catch (error: any) {
            logger.error(`Error reading wallets file: ${error.message}`);
            console.error(`Error processing wallets file: ${error.message}`);
            process.exit(1);
        }
    }

    // Parse tokens
    let targetTokens: string[] = [];
    if (argv.tokens) {
        targetTokens = argv.tokens.split(',').map(token => token.trim());
    } else if (argv.tokensFile) {
        try {
            const filePath = path.resolve(argv.tokensFile);
            logger.info(`Reading tokens from file: ${filePath}`);
            if (!fs.existsSync(filePath)) {
                throw new Error(`Tokens file not found at: ${filePath}`);
            }
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            targetTokens = fileContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));
        } catch (error: any) {
            logger.error(`Error reading tokens file: ${error.message}`);
            console.error(`Error processing tokens file: ${error.message}`);
            process.exit(1);
        }
    }

    // Main execution logic
    (async () => {
        try {
            let session: AffinitySession;

            if (argv.sessionId) {
                // Continue existing session
                session = loadSession(argv.sessionId);
                if (!session) {
                    throw new Error(`Session ${argv.sessionId} not found`);
                }
                logger.info(`Continuing session ${argv.sessionId} (${session.analyzedTokens.length} tokens already analyzed)`);

                if (argv.continue && targetTokens.length > 0) {
                    // Add new tokens to existing session
                    const newTokens = targetTokens.filter(token => !session.analyzedTokens.includes(token));
                    if (newTokens.length === 0) {
                        logger.info('All specified tokens have already been analyzed in this session.');
                        return;
                    }
                    targetTokens = newTokens;
                    logger.info(`Adding ${newTokens.length} new tokens to session`);
                }
            } else {
                // Create new session
                if (initialWallets.length < 1) {
                    throw new Error('Must provide at least one wallet for new session');
                }
                session = createNewSession(initialWallets);
                logger.info(`Created new session ${session.sessionId} with ${initialWallets.length} wallets`);
            }

            // Check if we already analyzed these exact tokens
            const tokenSetKey = targetTokens.sort().join(',');
            const existingResult = session.results.find(r => {
                const resultTokenSet = r.targetTokens.sort().join(',');
                return resultTokenSet === tokenSetKey;
            });

            if (existingResult) {
                logger.info('These tokens have already been analyzed in this session. Use --continue to analyze different tokens.');
                console.log(`\n=== Previous Results ===`);
                console.log(`Session ID: ${session.sessionId}`);
                console.log(`Target tokens: ${targetTokens.length}`);
                console.log(`Top matching wallets: ${existingResult.topMatchingWallets.length}`);
                return;
            }

            // Run analysis
            const result = await runTokenMatchingAnalysis(
                session,
                targetTokens,
                argv.topResults
            );

            // Output summary
            console.log(`\n=== Analysis Complete ===`);
            console.log(`Session ID: ${session.sessionId}`);
            console.log(`Target tokens: ${result.targetTokens.length}`);
            console.log(`Wallets analyzed: ${result.analysisMetadata.totalWalletsAnalyzed}`);
            console.log(`Similarity pairs analyzed: ${result.analysisMetadata.similarityPairsAnalyzed}`);
            console.log(`Processing time: ${result.analysisMetadata.processingTimeSeconds.toFixed(2)}s`);
            console.log(`Session file: ${getSessionFilePath(session.sessionId)}`);
            console.log(`📄 Markdown report: ${reportPath}`);

            // Show top results in table format
            console.log(`\nTop ${result.topMatchingWallets.length} matching wallets:`);
            console.log(`┌─────┬────────────┬─────────────────┬─────────────────────────────────────────────────────────────┐`);
            console.log(`│ #   │ Wallet     │ Tokens Held     │ Token Details                                        │`);
            console.log(`├─────┼────────────┼─────────────────┼─────────────────────────────────────────────────────────────┤`);

            result.topMatchingWallets.forEach((wallet, index) => {
                const walletShort = wallet.wallet.slice(0, 8) + '...';
                const tokensHeld = `${wallet.overlapCount}/${targetTokens.length} (${(wallet.overlapPercentage * 100).toFixed(1)}%)`;

                console.log(`│ ${String(index + 1).padEnd(3)} │ ${walletShort.padEnd(10)} │ ${tokensHeld.padEnd(15)} │ ${wallet.tokenDetails.length > 0 ? 'See below' : 'None'.padEnd(47)} │`);

                // Show token details table for this wallet
                if (wallet.tokenDetails.length > 0) {
                    console.log(`├─────┴────────────┴─────────────────┴─────────────────────────────────────────────────────────────┤`);
                    console.log(`│ Token Details:                                                                                  │`);
                    console.log(`├─────────────────────────────────────┬─────────────────┬─────────────────┬─────────────┬─────────┤`);
                    console.log(`│ Token Name                          │ First Seen      │ Last Seen       │ TX Count    │ Days    │`);
                    console.log(`├─────────────────────────────────────┼─────────────────┼─────────────────┼─────────────┼─────────┤`);

                    wallet.tokenDetails.forEach(token => {
                        const tokenName = (token.name || token.symbol || token.mint.slice(0, 8) + '...').padEnd(35);
                        const firstSeen = token.firstSeen > 0 ? new Date(token.firstSeen).toLocaleDateString() : 'Unknown';
                        const lastSeen = token.lastSeen > 0 ? new Date(token.lastSeen).toLocaleDateString() : 'Unknown';
                        const txCount = String(token.transactionCount).padEnd(11);
                        const daysHeld = token.firstSeen > 0 && token.lastSeen > 0 ?
                            String(Math.floor((token.lastSeen - token.firstSeen) / (1000 * 60 * 60 * 24))).padEnd(7) : 'N/A'.padEnd(7);

                        console.log(`│ ${tokenName} │ ${firstSeen.padEnd(15)} │ ${lastSeen.padEnd(15)} │ ${txCount} │ ${daysHeld} │`);
                    });

                    console.log(`├─────────────────────────────────────┴─────────────────┴─────────────────┴─────────────┴─────────┤`);
                }

                // Add separator between wallets (except for the last one)
                if (index < result.topMatchingWallets.length - 1) {
                    console.log(`├─────┬────────────┬─────────────────┬─────────────────────────────────────────────────────────────┤`);
                }
            });

            console.log(`└─────┴────────────┴─────────────────┴─────────────────────────────────────────────────────────────┘`);

            // Generate and save markdown report
            const markdownReport = generateMarkdownReport(result, session.sessionId);
            const reportPath = require('path').join(process.cwd(), 'analysis_sessions', `token_affinity_report_${session.sessionId}.md`);

            try {
                // Ensure the analysis_sessions directory exists
                const fs = require('fs');
                const path = require('path');
                const dir = path.join(process.cwd(), 'analysis_sessions');
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                fs.writeFileSync(reportPath, markdownReport);
                console.log(`\n📄 Markdown report saved: ${reportPath}`);
            } catch (error) {
                console.error(`Failed to save markdown report:`, error);
            }

            // Show wallet similarities if we have them
            if (result.walletSimilarities.length > 0) {
                console.log(`\nWallet Similarities (${result.walletSimilarities.length} pairs analyzed):`);
                console.log(`┌─────────────────┬─────────────────┬──────────────┬──────────────┬─────────────────────────────────┐`);
                console.log(`│ Wallet A        │ Wallet B        │ Overlap      │ Jaccard      │ Shared Tokens                   │`);
                console.log(`├─────────────────┼─────────────────┼──────────────┼──────────────┼─────────────────────────────────┤`);

                // Show top 10 most similar pairs
                result.walletSimilarities.slice(0, 10).forEach((sim, index) => {
                    const walletA = sim.walletA.slice(0, 8) + '...';
                    const walletB = sim.walletB.slice(0, 8) + '...';
                    const overlap = `${sim.overlapCount}/${targetTokens.length} (${(sim.overlapPercentage * 100).toFixed(1)}%)`;
                    const jaccard = (sim.jaccardSimilarity * 100).toFixed(1) + '%';
                    const shared = sim.sharedTokens.length > 0 ?
                        sim.sharedTokens.slice(0, 2).map(t => t.slice(0, 6) + '...').join(', ') +
                        (sim.sharedTokens.length > 2 ? '...' : '') :
                        'None';

                    console.log(`│ ${walletA.padEnd(15)} │ ${walletB.padEnd(15)} │ ${overlap.padEnd(12)} │ ${jaccard.padEnd(12)} │ ${shared.padEnd(31)} │`);
                });

                console.log(`└─────────────────┴─────────────────┴──────────────┴──────────────┴─────────────────────────────────┘`);

                if (result.walletSimilarities.length > 10) {
                    console.log(`\n... and ${result.walletSimilarities.length - 10} more similarity pairs`);
                }
            }

        } catch (error: any) {
            logger.error('Script execution failed:', { error });
            console.error(`Error: ${error.message}`);
            process.exit(1);
        }
    })();
}
