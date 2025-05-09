#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../utils/logger';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Initialize environment variables
dotenv.config();

const prisma = new PrismaClient();
const logger = createLogger('WalletActivityCorrelator');

// --- Configuration ---
const DEFAULT_EXCLUDED_MINTS: string[] = [
    'So11111111111111111111111111111111111111112', // WSOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

const DEFAULT_RECENT_TRANSACTION_COUNT = 200;
const DEFAULT_SYNC_TIME_WINDOW_SECONDS = 300; // 5 minutes
const DEFAULT_MIN_SHARED_NON_OBVIOUS_TOKENS = 2;
const DEFAULT_MIN_SYNC_EVENTS = 2;
const DEFAULT_WEIGHT_SHARED_NON_OBVIOUS = 1.0;
const DEFAULT_WEIGHT_SYNC_EVENTS = 2.0; // Synchronized events might be a stronger signal
const DEFAULT_NON_OBVIOUS_THRESHOLD_PERCENT = 0.2; // Exclude top 20% most frequent tokens
const DEFAULT_MIN_OCCURRENCES_FOR_POPULAR = 100; // Or if a token appears > 100 times (adjust based on dataset size)
const DEFAULT_TOP_K_RESULTS = 50;

/**
 * Represents transaction data relevant for correlation analysis.
 */
interface CorrelatorTransactionData {
    mint: string;
    timestamp: number; // Unix timestamp (seconds)
    direction: 'in' | 'out';
    amount: number; // Added for completeness, though PNL relies on associatedSolValue
    associatedSolValue: number; // Crucial for PNL
}

/**
 * Basic information about a wallet.
 */
interface WalletInfo {
    address: string;
    label?: string;
}

/**
 * Data structure for a pair of correlated wallets.
 */
interface CorrelatedPairData {
    walletA_address: string;
    walletA_label?: string;
    walletB_address: string;
    walletB_label?: string;
    score: number;
    sharedNonObviousTokens: { mint: string, countA: number, countB: number }[];
    synchronizedEvents: {
        mint: string,
        direction: 'in' | 'out',
        timestampA: number,
        timestampB: number,
        timeDiffSeconds: number
    }[];
}

// --- Database Interaction ---
/**
 * Fetches recent transactions for a given wallet address, excluding specified mints.
 * @param walletAddress - The wallet address to fetch transactions for.
 * @param transactionCount - The maximum number of recent transactions to fetch.
 * @param excludedMints - An array of mint addresses to exclude from the results.
 * @returns A promise that resolves to an array of CorrelatorTransactionData.
 */
async function fetchRecentTransactions(
    walletAddress: string,
    transactionCount: number,
    excludedMints: string[]
): Promise<CorrelatorTransactionData[]> {
    logger.debug(`Fetching last ${transactionCount} transactions for ${walletAddress}...`);
    try {
        const transactions = await prisma.swapAnalysisInput.findMany({
            where: {
                walletAddress: walletAddress,
                NOT: {
                    mint: {
                        in: excludedMints,
                    },
                },
            },
            select: {
                mint: true,
                timestamp: true,
                direction: true,
                amount: true, // Fetch amount
                associatedSolValue: true, // Fetch associated SOL value
            },
            orderBy: {
                timestamp: 'desc',
            },
            take: transactionCount,
        });
        logger.debug(`Fetched ${transactions.length} transactions for ${walletAddress} (target: ${transactionCount}, after exclusion).`);
        
        return transactions.map(t => ({
            mint: t.mint,
            timestamp: t.timestamp,
            direction: t.direction === 'in' ? 'in' : 'out',
            amount: t.amount, // Map amount
            associatedSolValue: t.associatedSolValue, // Map associated SOL value
        } as CorrelatorTransactionData )).sort((a, b) => a.timestamp - b.timestamp);
    } catch (error) {
        logger.error(`Error fetching recent transactions for wallet ${walletAddress}:`, { error });
        return [];
    }
}

/**
 * Generates a textual report of the wallet correlation analysis.
 * @param wallets - Array of WalletInfo objects for the analyzed wallets.
 * @param correlatedPairsData - Array of CorrelatedPairData objects.
 * @param config - Configuration object used for the analysis.
 * @returns A string containing the formatted report.
 */
function generateCorrelatorReportText(
    wallets: WalletInfo[],
    correlatedPairsData: CorrelatedPairData[],
    config: {
        excludedMints: string[];
        recentTxCount: number;
        nonObviousTokenThresholdPercent: number;
        minOccurrencesForPopular: number;
        syncTimeWindowSeconds: number;
        minSharedNonObviousTokens: number;
        minSyncEvents: number;
        weightSharedNonObvious: number;
        weightSyncEvents: number;
        topKResults: number;
        totalUniqueTokens: number;
        totalPopularTokens: number;
        totalNonObviousTokens: number;
    }
): string {
    const reportLines: string[] = [];
    const { topKResults, totalUniqueTokens, totalPopularTokens, totalNonObviousTokens } = config;

    reportLines.push('==================================================');
    reportLines.push('    Wallet Activity Correlation Report (Pre-filter)');
    reportLines.push('==================================================');
    reportLines.push(`Generated on: ${new Date().toISOString()}`);
    reportLines.push(`Wallets Analyzed: ${wallets.length}`);
    reportLines.push(`Transactions Fetched per Wallet (approx): ${config.recentTxCount}`);
    reportLines.push('\n--- Configuration Highlights ---');
    reportLines.push(`Sync Time Window: ${config.syncTimeWindowSeconds}s`);
    reportLines.push(`Min Shared Non-Obvious Tokens: ${config.minSharedNonObviousTokens}`);
    reportLines.push(`Min Synchronized Events: ${config.minSyncEvents}`);
    reportLines.push(`Popular Token Threshold: Top ${config.nonObviousTokenThresholdPercent*100}% OR > ${config.minOccurrencesForPopular} occurrences`);
    reportLines.push(`Scoring Weights: SharedTokens=${config.weightSharedNonObvious}, SyncEvents=${config.weightSyncEvents}`);
    reportLines.push('\n--- Global Token Stats ---');
    reportLines.push(`Total Unique Mints Analyzed (post-exclusion): ${totalUniqueTokens}`);
    reportLines.push(`Identified Popular/Obvious Tokens: ${totalPopularTokens}`);
    reportLines.push(`Identified Non-Obvious Tokens for Correlation: ${totalNonObviousTokens}`);
    reportLines.push('');

    reportLines.push(`--- Top ${Math.min(topKResults, correlatedPairsData.length)} Correlated Wallet Pairs (out of ${correlatedPairsData.length} found meeting thresholds) ---`);
    if (correlatedPairsData.length === 0) {
        reportLines.push("No significantly correlated pairs found with current settings.");
    } else {
        correlatedPairsData.slice(0, topKResults).forEach((pair, index) => {
            reportLines.push(`\n#${index + 1} Pair: ${pair.walletA_label || pair.walletA_address} <-> ${pair.walletB_label || pair.walletB_address} (Score: ${pair.score})`);
            reportLines.push(`  Shared Non-Obvious Tokens (${pair.sharedNonObviousTokens.length}):`);
            pair.sharedNonObviousTokens.slice(0, 5).forEach(t => {
                reportLines.push(`    - ${t.mint} (Wallet A txns: ${t.countA}, Wallet B txns: ${t.countB})`);
            });
            if (pair.sharedNonObviousTokens.length > 5) reportLines.push('    ... and more.');
            
            reportLines.push(`  Synchronized Events (${pair.synchronizedEvents.length} within ${config.syncTimeWindowSeconds}s):`);
            pair.synchronizedEvents.slice(0, 5).forEach(e => {
                reportLines.push(`    - ${e.direction.toUpperCase()} ${e.mint} @ A: ${new Date(e.timestampA*1000).toISOString()} B: ${new Date(e.timestampB*1000).toISOString()} (Diff: ${e.timeDiffSeconds}s)`);
            });
            if (pair.synchronizedEvents.length > 5) reportLines.push('    ... and more.');
        });
    }
    reportLines.push('\n==================== END OF REPORT ====================');
    return reportLines.join('\n');
}

/**
 * Saves the correlator report content to a text file in the 'reports' directory.
 * The filename includes a timestamp.
 * @param reportContent - The string content of the report to save.
 * @returns The full path to the saved report file, or an empty string if saving failed.
 */
function saveCorrelatorReportToFile(reportContent: string): string {
    const dir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (error) {
            logger.error(`Failed to create report directory: ${dir}`, { error });
            return "";
        }
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `wallet_correlator_report_${timestamp}.txt`;
    const filepath = path.join(dir, filename);
    try {
        fs.writeFileSync(filepath, reportContent);
        logger.debug(`Correlator report saved to ${filepath}`);
        return filepath;
    } catch (error) {
        logger.error(`Failed to write correlator report file: ${filepath}`, { error });
        return "";
    }
}

// --- Multi-Wallet Cluster Identification ---
/**
 * Represents a collection of wallet clusters, where each cluster is an array of wallet addresses.
 * The key is a string identifier for the cluster (e.g., "cluster_0").
 */
interface WalletCluster {
    [clusterId: string]: string[];
}

/**
 * Identifies clusters (connected components) of 3 or more wallets based on correlated pairs.
 * A connection (edge) between two wallets exists if their correlation score meets minClusterScore.
 * @param correlatedPairsData - Array of correlated pair data.
 * @param minClusterScore - The minimum correlation score for a pair to be considered connected for clustering.
 * @returns A WalletCluster object where keys are cluster IDs and values are arrays of wallet addresses in that cluster.
 */
function identifyWalletClusters(
    correlatedPairsData: CorrelatedPairData[],
    minClusterScore: number
): WalletCluster {
    logger.debug(`Identifying wallet clusters with min pair score: ${minClusterScore}`);
    const adj: Record<string, { wallet: string, score: number }[]> = {};
    const allWalletsInScoredPairs = new Set<string>();

    correlatedPairsData.forEach(pair => {
        if (pair.score >= minClusterScore) {
            adj[pair.walletA_address] = adj[pair.walletA_address] || [];
            adj[pair.walletA_address].push({ wallet: pair.walletB_address, score: pair.score });
            adj[pair.walletB_address] = adj[pair.walletB_address] || [];
            adj[pair.walletB_address].push({ wallet: pair.walletA_address, score: pair.score });
            allWalletsInScoredPairs.add(pair.walletA_address);
            allWalletsInScoredPairs.add(pair.walletB_address);
        }
    });

    const clusters: WalletCluster = {};
    let clusterIdCounter = 0;
    const visited = new Set<string>();

    for (const wallet of allWalletsInScoredPairs) {
        if (!visited.has(wallet)) {
            const currentClusterMembers: string[] = [];
            const stack: string[] = [wallet];
            visited.add(wallet);

            while (stack.length > 0) {
                const u = stack.pop()!;
                currentClusterMembers.push(u);

                (adj[u] || []).forEach(edge => {
                    if (!visited.has(edge.wallet)) {
                        visited.add(edge.wallet);
                        stack.push(edge.wallet);
                    }
                });
            }

            if (currentClusterMembers.length >= 3) {
                clusters[`cluster_${clusterIdCounter++}`] = currentClusterMembers.sort();
            }
        }
    }
    logger.info(`Identified ${Object.keys(clusters).length} wallet clusters with 3+ members.`);
    return clusters;
}

/**
 * Appends the identified wallet clusters section to the main report content.
 * @param reportContent - The existing report content string.
 * @param clusters - The identified WalletCluster object.
 * @param walletLabels - A record mapping wallet addresses to their labels.
 * @param walletPnLs - A record mapping wallet addresses to their PNL values.
 * @returns The report content string with the cluster section appended.
 */
function addClusterSectionToReport(
    reportContent: string,
    clusters: WalletCluster,
    walletLabels: Record<string, string | undefined>,
    walletPnLs: Record<string, number>
): string {
    let clusterReport = ""; // Initialize as empty, will be prepended with title if not part of existing content
    if (!reportContent.includes("--- Multi-Wallet Cluster Analysis")) {
        clusterReport += "\n\n--- Multi-Wallet Cluster Analysis (Groups of 3+) ---";
    }

    if (Object.keys(clusters).length === 0) {
        clusterReport += "\nNo clusters of 3+ wallets found where pairs meet the minimum score threshold for clustering.\n";
    } else {
        Object.entries(clusters).forEach(([clusterId, clusterWallets]) => {
            const cleanClusterId = clusterId.substring(clusterId.indexOf('_') + 1);
            clusterReport += `\n\nCluster ${cleanClusterId} (${clusterWallets.length} wallets):\n`;
            clusterWallets.forEach(walletAddr => {
                const label = walletLabels[walletAddr] ? ` (${walletLabels[walletAddr]})` : '';
                const pnl = walletPnLs[walletAddr]?.toFixed(2) || 'N/A';
                clusterReport += `  - ${walletAddr}${label} (PNL: ${pnl} SOL)\n`;
            });
        });
    }
    clusterReport += "\n--- End of Multi-Wallet Cluster Analysis ---\n";
    return reportContent + clusterReport;
}

/**
 * Analyzes correlations between wallets based on their transaction data.
 * This function performs global token frequency analysis, pairwise wallet analysis,
 * identifies clusters, and generates a report.
 * @param wallets - An array of WalletInfo objects representing the wallets to analyze.
 * @param allWalletsTransactions - A record mapping wallet addresses to their transaction data.
 * @param walletPnLs - A record mapping wallet addresses to their calculated PNL.
 * @param config - Configuration object for the correlation analysis.
 */
async function analyzeCorrelations(
    wallets: WalletInfo[],
    allWalletsTransactions: Record<string, CorrelatorTransactionData[]>,
    walletPnLs: Record<string, number>,
    config: {
        excludedMints: string[];
        recentTxCount: number;
        nonObviousTokenThresholdPercent: number;
        minOccurrencesForPopular: number;
        syncTimeWindowSeconds: number;
        minSharedNonObviousTokens: number;
        minSyncEvents: number;
        weightSharedNonObvious: number;
        weightSyncEvents: number;
        topKResults: number;
    }
) {
    logger.info(`Starting correlation analysis for ${wallets.length} wallets. Sync window: ${config.syncTimeWindowSeconds}s.`);

    // 1. Global Token Frequency Analysis
    const globalTokenFrequency: Record<string, number> = {};
    let totalTransactionCountAcrossAllWallets = 0;

    for (const walletAddress in allWalletsTransactions) {
        const txs = allWalletsTransactions[walletAddress];
        totalTransactionCountAcrossAllWallets += txs.length;
        for (const tx of txs) {
            globalTokenFrequency[tx.mint] = (globalTokenFrequency[tx.mint] || 0) + 1;
        }
    }

    if (totalTransactionCountAcrossAllWallets === 0) {
        logger.warn("No transactions found across all wallets. Skipping further analysis.");
        console.log("No transactions to analyze for correlation.");
        return;
    }

    const sortedGlobalTokens = Object.entries(globalTokenFrequency)
        .sort(([, countA], [, countB]) => countB - countA);

    const popularTokens = new Set<string>();
    const thresholdIndex = Math.floor(sortedGlobalTokens.length * config.nonObviousTokenThresholdPercent);

    for (let i = 0; i < sortedGlobalTokens.length; i++) {
        const [mint, count] = sortedGlobalTokens[i];
        if (i < thresholdIndex || count > config.minOccurrencesForPopular) {
            popularTokens.add(mint);
        }
    }
    
    const totalUniqueGlobal = sortedGlobalTokens.length;
    const totalPopularGlobal = popularTokens.size;
    const totalNonObviousGlobal = totalUniqueGlobal - totalPopularGlobal;
    logger.info(`Global token analysis: ${totalUniqueGlobal} unique mints. ${totalPopularGlobal} popular. ${totalNonObviousGlobal} non-obvious.`);
    if (sortedGlobalTokens.length > 0 && popularTokens.size === sortedGlobalTokens.length) {
        logger.warn("All tokens identified as popular. Correlation based on non-obvious tokens might not yield results. Consider adjusting thresholds for 'nonObviousTokenThresholdPercent' or 'minOccurrencesForPopular'.");
    }


    // 2. Pairwise Analysis
    const correlatedPairs: CorrelatedPairData[] = [];
    const processedPairKeys = new Set<string>();

    logger.info('Starting pairwise correlation analysis...');
    for (let i = 0; i < wallets.length; i++) {
        for (let j = i + 1; j < wallets.length; j++) {
            const walletA = wallets[i];
            const walletB = wallets[j];
            const pairKey = [walletA.address, walletB.address].sort().join('|');
            // if (processedPairKeys.has(pairKey)) continue; // This check is redundant due to j = i + 1
            // processedPairKeys.add(pairKey);

            const txsA = allWalletsTransactions[walletA.address] || [];
            const txsB = allWalletsTransactions[walletB.address] || [];

            if (txsA.length === 0 || txsB.length === 0) continue;

            const nonObviousTradedByA = new Map<string, number>();
            txsA.forEach(tx => {
                if (!popularTokens.has(tx.mint)) {
                    nonObviousTradedByA.set(tx.mint, (nonObviousTradedByA.get(tx.mint) || 0) + 1);
                }
            });
            const nonObviousTradedByB = new Map<string, number>();
            txsB.forEach(tx => {
                if (!popularTokens.has(tx.mint)) {
                    nonObviousTradedByB.set(tx.mint, (nonObviousTradedByB.get(tx.mint) || 0) + 1);
                }
            });

            const currentSharedNonObvious: { mint: string, countA: number, countB: number }[] = [];
            nonObviousTradedByA.forEach((countA, mint) => {
                if (nonObviousTradedByB.has(mint)) {
                    currentSharedNonObvious.push({ mint, countA, countB: nonObviousTradedByB.get(mint)! });
                }
            });

            const currentSyncEvents: CorrelatedPairData['synchronizedEvents'] = [];
            for (const shared of currentSharedNonObvious) {
                const mintToAnalyze = shared.mint;
                const buysA = txsA.filter(tx => tx.mint === mintToAnalyze && tx.direction === 'in');
                const buysB = txsB.filter(tx => tx.mint === mintToAnalyze && tx.direction === 'in');
                const sellsA = txsA.filter(tx => tx.mint === mintToAnalyze && tx.direction === 'out');
                const sellsB = txsB.filter(tx => tx.mint === mintToAnalyze && tx.direction === 'out');

                for (const buyA of buysA) {
                    for (const buyB of buysB) {
                        const timeDiff = Math.abs(buyA.timestamp - buyB.timestamp);
                        if (timeDiff <= config.syncTimeWindowSeconds) {
                            currentSyncEvents.push({
                                mint: mintToAnalyze, direction: 'in',
                                timestampA: buyA.timestamp, timestampB: buyB.timestamp,
                                timeDiffSeconds: timeDiff
                            });
                        }
                    }
                }
                for (const sellA of sellsA) {
                    for (const sellB of sellsB) {
                        const timeDiff = Math.abs(sellA.timestamp - sellB.timestamp);
                        if (timeDiff <= config.syncTimeWindowSeconds) {
                            currentSyncEvents.push({
                                mint: mintToAnalyze, direction: 'out',
                                timestampA: sellA.timestamp, timestampB: sellB.timestamp,
                                timeDiffSeconds: timeDiff
                            });
                        }
                    }
                }
            }
            currentSyncEvents.sort((a,b) => a.timestampA - b.timestampA || a.timestampB - b.timestampB);

            if (currentSharedNonObvious.length >= config.minSharedNonObviousTokens || currentSyncEvents.length >= config.minSyncEvents) {
                let score = 0;
                score += currentSharedNonObvious.length * config.weightSharedNonObvious;
                score += currentSyncEvents.length * config.weightSyncEvents;

                if (score > 0) {
                    correlatedPairs.push({
                        walletA_address: walletA.address, walletA_label: walletA.label,
                        walletB_address: walletB.address, walletB_label: walletB.label,
                        score: parseFloat(score.toFixed(2)),
                        sharedNonObviousTokens: currentSharedNonObvious,
                        synchronizedEvents: currentSyncEvents
                    });
                }
            }
        }
    }
    logger.info(`Pairwise analysis completed. Found ${correlatedPairs.length} potentially correlated pairs meeting minimum thresholds.`);

    correlatedPairs.sort((a, b) => b.score - a.score);

    // --- CLUSTER IDENTIFICATION START ---
    const MIN_CLUSTER_SCORE_THRESHOLD = 20; // Threshold for a pair to be part of a cluster connection
    const walletLabelsMap: Record<string, string | undefined> = {};
    wallets.forEach(w => { walletLabelsMap[w.address] = w.label; }); // Use the passed 'wallets'

    const identifiedClusters = identifyWalletClusters(correlatedPairs, MIN_CLUSTER_SCORE_THRESHOLD);
    // --- CLUSTER IDENTIFICATION END ---

    // 4. Report Generation
    const reportConfigForOutput = {
        ...config,
        totalUniqueTokens: totalUniqueGlobal,
        totalPopularTokens: totalPopularGlobal,
        totalNonObviousTokens: totalNonObviousGlobal,
    };

    // Prepare base report text without PNL in pair headers yet.
    // PNL will be injected when formatting the final report string with clusters.
    let baseReportText = generateCorrelatorReportText(wallets, correlatedPairs, reportConfigForOutput);

    // Re-generate the "Top Pairs" section with PNL data.
    // This is a bit of a workaround to inject PNL into the existing generateCorrelatorReportText structure
    // without overly complicating its direct parameters for this specific part.
    let finalReportLines: string[] = [];
    const headerAndGlobalStats = baseReportText.substring(0, baseReportText.indexOf('--- Top'));
    finalReportLines.push(headerAndGlobalStats);

    // Add Cluster section FIRST if clusters exist
    if (Object.keys(identifiedClusters).length > 0) {
        const clusterReportSection = addClusterSectionToReport("", identifiedClusters, walletLabelsMap, walletPnLs).trim(); // Pass walletPnLs
        finalReportLines.push(clusterReportSection);
        finalReportLines.push(''); // Add a newline separator
    } else {
        logger.info("No multi-wallet clusters identified meeting the threshold.");
        finalReportLines.push("--- Multi-Wallet Cluster Analysis ---");
        finalReportLines.push("No clusters of 3+ wallets found meeting the current criteria.");
        finalReportLines.push(''); // Add a newline separator
    }

    // Now add Top Correlated Pairs section with PNL injected
    finalReportLines.push(`--- Top ${Math.min(reportConfigForOutput.topKResults, correlatedPairs.length)} Correlated Wallet Pairs (out of ${correlatedPairs.length} found meeting thresholds) ---`);
    if (correlatedPairs.length === 0) {
        finalReportLines.push("No significantly correlated pairs found with current settings.");
    } else {
        correlatedPairs.slice(0, reportConfigForOutput.topKResults).forEach((pair, index) => {
            const pnlA = walletPnLs[pair.walletA_address]?.toFixed(2) || 'N/A';
            const pnlB = walletPnLs[pair.walletB_address]?.toFixed(2) || 'N/A';
            const walletADisplay = `${pair.walletA_label || pair.walletA_address} (PNL: ${pnlA} SOL)`;
            const walletBDisplay = `${pair.walletB_label || pair.walletB_address} (PNL: ${pnlB} SOL)`;
            finalReportLines.push(`\n#${index + 1} Pair: ${walletADisplay} <-> ${walletBDisplay} (Score: ${pair.score})`);
            finalReportLines.push(`  Shared Non-Obvious Tokens (${pair.sharedNonObviousTokens.length}):`);
            pair.sharedNonObviousTokens.slice(0, 5).forEach(t => {
                finalReportLines.push(`    - ${t.mint} (Wallet A txns: ${t.countA}, Wallet B txns: ${t.countB})`);
            });
            if (pair.sharedNonObviousTokens.length > 5) finalReportLines.push('    ... and more.');
            
            finalReportLines.push(`  Synchronized Events (${pair.synchronizedEvents.length} within ${config.syncTimeWindowSeconds}s):`);
            pair.synchronizedEvents.slice(0, 5).forEach(e => {
                finalReportLines.push(`    - ${e.direction.toUpperCase()} ${e.mint} @ A: ${new Date(e.timestampA*1000).toISOString()} B: ${new Date(e.timestampB*1000).toISOString()} (Diff: ${e.timeDiffSeconds}s)`);
            });
            if (pair.synchronizedEvents.length > 5) finalReportLines.push('    ... and more.');
        });
    }
    finalReportLines.push('\n==================== END OF REPORT ====================');
    const reportText = finalReportLines.join('\n');

    const reportPath = saveCorrelatorReportToFile(reportText);

    if (reportPath) {
        logger.info(`Correlator report saved to: ${reportPath}`);
        console.log(`Correlator analysis complete. Report saved to: ${reportPath}`);
    } else {
        logger.error('Correlator analysis complete, but failed to save the report.');
        console.error('Correlator analysis complete, but failed to save the report. Check logs.');
    }
}

/**
 * Main function to orchestrate the wallet activity correlation process.
 * It fetches transaction data, performs bot filtering, calculates PNL,
 * and then runs the correlation analysis.
 * @param targetWallets - An array of WalletInfo objects for the wallets to be analyzed.
 * @param excludedMintsList - An array of mint addresses to exclude from analysis.
 * @param recentTxCount - The number of recent transactions to fetch per wallet.
 * @param cliConfig - Configuration options passed from the CLI.
 */
async function main(
    targetWallets: WalletInfo[],
    excludedMintsList: string[],
    recentTxCount: number,
    cliConfig: { // Pass CLI config down
        syncTimeWindowSeconds: number;
        minSharedNonObviousTokens: number;
        minSyncEvents: number;
        weightSharedNonObvious: number;
        weightSyncEvents: number;
        nonObviousTokenThresholdPercent: number;
        minOccurrencesForPopular: number;
        topKResults: number;
    }
) {
    const startTime = process.hrtime();
    logger.info(`Starting wallet activity correlation for ${targetWallets.length} wallets.`);
    logger.debug(`Fetching ${recentTxCount} recent transactions per wallet.`);
    logger.debug(`Excluded mints: ${excludedMintsList.join(', ')}`);

    const allFetchedTransactions: Record<string, CorrelatorTransactionData[]> = {};
    for (const walletInfo of targetWallets) {
        const txs = await fetchRecentTransactions(walletInfo.address, recentTxCount, excludedMintsList);
        allFetchedTransactions[walletInfo.address] = txs;
        if (txs.length === 0) {
            logger.warn(`No relevant recent transactions found for ${walletInfo.label || walletInfo.address}.`);
        }
    }
    
    // --- BOT FILTERING START ---
    const MAX_DAILY_TOKENS_FOR_FILTER = 50;
    const dailyTokenCountsByWallet: Record<string, Record<string, Set<string>>> = {}; // Renamed for clarity

    // Calculate daily unique token counts for each wallet
    for (const walletInfo of targetWallets) {
        const walletAddress = walletInfo.address;
        const transactions = allFetchedTransactions[walletAddress];
        if (!transactions) continue;

        dailyTokenCountsByWallet[walletAddress] = dailyTokenCountsByWallet[walletAddress] || {};

        transactions.forEach(txn => {
            const day = new Date(txn.timestamp * 1000).toISOString().split('T')[0];
            dailyTokenCountsByWallet[walletAddress][day] = dailyTokenCountsByWallet[walletAddress][day] || new Set<string>();
            dailyTokenCountsByWallet[walletAddress][day].add(txn.mint);
        });
    }

    const walletsForAnalysis = targetWallets.filter(wallet => {
        const walletDailyActivity = dailyTokenCountsByWallet[wallet.address] || {};
        const exceedsThreshold = Object.values(walletDailyActivity).some(
            tokenSetOnDay => tokenSetOnDay.size > MAX_DAILY_TOKENS_FOR_FILTER
        );

        if (exceedsThreshold) {
            logger.debug(`Filtering out wallet ${wallet.label || wallet.address} due to exceeding ${MAX_DAILY_TOKENS_FOR_FILTER} unique tokens on at least one day.`);
            return false;
        }
        return true;
    });

    if (targetWallets.length !== walletsForAnalysis.length) {
        logger.info(`Filtered out ${targetWallets.length - walletsForAnalysis.length} wallets suspected of bot activity (exceeding ${MAX_DAILY_TOKENS_FOR_FILTER} unique tokens traded in a single day). Reporting on ${walletsForAnalysis.length} wallets.`);
    } else {
        logger.info(`No wallets filtered out based on daily token activity. Reporting on all ${walletsForAnalysis.length} wallets.`);
    }
    // --- BOT FILTERING END ---
    
    // --- PNL CALCULATION START ---
    const walletPnLs: Record<string, number> = {};

    function calculateWalletPnlForCorrelator(transactions: CorrelatorTransactionData[]): number {
        let pnl = 0;
        // Transactions are already filtered by fetchRecentTransactions to exclude WSOL, USDC, USDT
        // So, all transactions here are for other SPL tokens.
        for (const tx of transactions) {
            if (tx.direction === 'in') {
                pnl -= tx.associatedSolValue; // Cost of acquiring token
            } else if (tx.direction === 'out') {
                pnl += tx.associatedSolValue; // Revenue from selling token
            }
        }
        return pnl;
    }

    for (const walletInfo of walletsForAnalysis) {
        const txs = allFetchedTransactions[walletInfo.address] || [];
        walletPnLs[walletInfo.address] = calculateWalletPnlForCorrelator(txs);
        logger.debug(`Calculated PNL for ${walletInfo.label || walletInfo.address}: ${walletPnLs[walletInfo.address].toFixed(2)} SOL`);
    }
    // --- PNL CALCULATION END ---
    
    const analysisConfig = {
        excludedMints: excludedMintsList,
        recentTxCount: recentTxCount,
        syncTimeWindowSeconds: cliConfig.syncTimeWindowSeconds,
        minSharedNonObviousTokens: cliConfig.minSharedNonObviousTokens,
        minSyncEvents: cliConfig.minSyncEvents,
        weightSharedNonObvious: cliConfig.weightSharedNonObvious,
        weightSyncEvents: cliConfig.weightSyncEvents,
        nonObviousTokenThresholdPercent: cliConfig.nonObviousTokenThresholdPercent,
        minOccurrencesForPopular: cliConfig.minOccurrencesForPopular,
        topKResults: cliConfig.topKResults,
    };

    await analyzeCorrelations(walletsForAnalysis, allFetchedTransactions, walletPnLs, analysisConfig);

    const endTime = process.hrtime(startTime);
    const durationSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);
    logger.info(`Wallet activity correlation process completed in ${durationSeconds}s.`);
}

/**
 * Interface for command-line arguments parsed by yargs.
 */
interface CliArgs {
    wallets?: string;
    walletsFile?: string;
    uploadCsv?: string;
    excludeMints?: string;
    txnCount?: number;
    syncTimeWindow?: number;
    minSharedTokens?: number;
    minSyncEvents?: number;
    weightShared?: number;
    weightSync?: number;
    popThresholdPct?: number;
    popMinOccurrences?: number;
    topK?: number;
    [key: string]: unknown;
    _: (string | number)[];
    $0: string;
}

if (require.main === module) {
    const argv = yargs(hideBin(process.argv))
        .scriptName('wallet-activity-correlator')
        .usage('$0 --wallets "addr1,addr2,..." | --walletsFile <path-to-json> | --uploadCsv <path-to-csv> [options]')
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
        .option('uploadCsv', {
            alias: 'c',
            type: 'string',
            description: 'Path to a CSV file containing wallet addresses (one per line, optionally with a label in a second column)',
        })
        .option('excludeMints', {
            alias: 'e',
            type: 'string',
            description: `Comma-separated list of token mints to exclude. Defaults: ${DEFAULT_EXCLUDED_MINTS.join(', ')}`,
        })
        .option('txnCount', {
            alias: 'n',
            type: 'number',
            description: 'Number of recent transactions to fetch per wallet.',
            default: DEFAULT_RECENT_TRANSACTION_COUNT,
        })
        .option('syncTimeWindow', { type: 'number', default: DEFAULT_SYNC_TIME_WINDOW_SECONDS, description: 'Time window in seconds for considering events synchronized.' })
        .option('minSharedTokens', { type: 'number', default: DEFAULT_MIN_SHARED_NON_OBVIOUS_TOKENS, description: 'Minimum shared non-obvious tokens for a pair to be considered.'})
        .option('minSyncEvents', { type: 'number', default: DEFAULT_MIN_SYNC_EVENTS, description: 'Minimum synchronized events for a pair to be considered.'})
        .option('weightShared', { type: 'number', default: DEFAULT_WEIGHT_SHARED_NON_OBVIOUS, description: 'Weight for shared non-obvious tokens in scoring.'})
        .option('weightSync', { type: 'number', default: DEFAULT_WEIGHT_SYNC_EVENTS, description: 'Weight for synchronized events in scoring.'})
        .option('popThresholdPct', { type: 'number', default: DEFAULT_NON_OBVIOUS_THRESHOLD_PERCENT, description: 'Top % of tokens to consider popular (e.g., 0.1 for top 10%).'})
        .option('popMinOccurrences', { type: 'number', default: DEFAULT_MIN_OCCURRENCES_FOR_POPULAR, description: 'Min global occurrences for a token to be popular.'})
        .option('topK', { type: 'number', default: DEFAULT_TOP_K_RESULTS, description: 'Number of top correlated pairs to display in the report.'})
        .check((argv) => {
            const sources = [argv.wallets, argv.walletsFile, argv.uploadCsv].filter(Boolean).length;
            if (sources === 0) throw new Error('One of --wallets, --walletsFile, or --uploadCsv is required.');
            if (sources > 1) throw new Error('Provide only one of --wallets, --walletsFile, or --uploadCsv.');
            if (argv.txnCount && argv.txnCount <= 0) throw new Error('--txnCount must be positive.');
            if (argv.syncTimeWindow && argv.syncTimeWindow <= 0) throw new Error('--syncTimeWindow must be positive.');
            return true;
        })
        .help()
        .alias('help', 'h')
        .argv as CliArgs;

    let targetWallets: WalletInfo[] = [];
    let finalExcludedMints: string[] = DEFAULT_EXCLUDED_MINTS;
    const transactionCount = argv.txnCount as number;

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
                // Basic address validation could be added here if needed
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

    if (argv.excludeMints) {
        const userExcludedMints = argv.excludeMints.split(',').map(m => m.trim()).filter(m => m);
        finalExcludedMints = Array.from(new Set([...DEFAULT_EXCLUDED_MINTS, ...userExcludedMints]));
    }
    
    if (targetWallets.length === 0) {
        logger.error('No target wallets specified after processing inputs. Exiting.');
        process.exit(1);
    }

    const cliPassedConfig = {
        syncTimeWindowSeconds: argv.syncTimeWindow as number,
        minSharedNonObviousTokens: argv.minSharedTokens as number,
        minSyncEvents: argv.minSyncEvents as number,
        weightSharedNonObvious: argv.weightShared as number,
        weightSyncEvents: argv.weightSync as number,
        nonObviousTokenThresholdPercent: argv.popThresholdPct as number,
        minOccurrencesForPopular: argv.popMinOccurrences as number,
        topKResults: argv.topK as number,
    };

    main(targetWallets, finalExcludedMints, transactionCount, cliPassedConfig)
        .catch(async (e) => {
            logger.error('Unhandled error in main execution:', { error: e });
            await prisma.$disconnect();
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
} 