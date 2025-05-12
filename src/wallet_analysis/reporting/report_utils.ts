import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../utils/logger'; 
import { BehavioralMetrics } from '../../types/behavior'; 
import { CorrelationMetrics } from '../../types/correlation'; 
import { WalletInfo } from '../../types/wallet'; 
import { ComprehensiveSimilarityResult } from '../core/similarity/similarity-service';
import { SwapAnalysisSummary, OnChainAnalysisResult, AdvancedTradeStats } from '../../types/helius-api';
import Papa from 'papaparse';
import { table } from 'table';
import { formatTimestamp, formatSolAmount, formatNumber } from '../utils/formatters';

const logger = createLogger('ReportUtils');

// --- Known Tokens & Helpers (Copied from transfer-analyzer-service) ---
const KNOWN_TOKENS: Record<string, string> = {
  'So11111111111111111111111111111111111111112': 'WSOL',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
};
function getTokenDisplayName(address: string): string {
    return KNOWN_TOKENS[address] || address;
}
function formatDate(timestamp: number): string {
    if (!timestamp || timestamp <= 0) return 'N/A';
    try {
        // Use UTC methods for consistency
        return new Date(timestamp * 1000).toISOString().split('T')[0];
    } catch (e) {
        return 'Invalid Date';
    }
}
function calculatePercentLeft(totalIn: number, netChange: number): string {
    if (totalIn <= 0) return 'N/A';
    const percentLeft = (netChange / totalIn) * 100;
    // Handle cases where netChange > totalIn (can happen with airdrops?)
    return `${percentLeft.toFixed(1)}%`;
}
function formatTokenQuantity(quantity: number): string {
    // Handle potential NaN/Infinity
    if (!isFinite(quantity)) return String(quantity);
    
    // Example: format large/small numbers nicely
    if (Math.abs(quantity) >= 1e7) return quantity.toExponential(2);
    if (Math.abs(quantity) <= 1e-4 && quantity !== 0) return quantity.toExponential(2);
    // Adjust precision based on magnitude if needed, default to 3 decimals
    if (Math.abs(quantity) < 1) return quantity.toFixed(4);
    return quantity.toFixed(3);
}
// --- End Helpers ---

/**
 * Generates a formatted markdown report summarizing wallet behavior metrics.
 *
 * @param walletAddress - The wallet address the report is for.
 * @param metrics - The calculated BehavioralMetrics object.
 * @returns A string containing the formatted report.
 */
export function generateBehaviorReport(
    walletAddress: string,
    metrics: BehavioralMetrics
): string {
    logger.debug(`Generating behavior report for ${walletAddress}`);
    const lines: string[] = [];

    lines.push(`=== WALLET BEHAVIOR REPORT: ${walletAddress} ===`);
    lines.push(`Generated on: ${new Date().toISOString()}`);
    lines.push('');

    // Trading Style Classification
    lines.push('**Trading Style Classification**');
    lines.push(`- Style: **${metrics.tradingStyle}**`);
    lines.push(`- Confidence: ${(metrics.confidenceScore * 100).toFixed(1)}%`);
    lines.push(`- Flipper Score: ${metrics.flipperScore.toFixed(3)}`);
    lines.push('');

    // Key Speed Metrics
    lines.push('**Speed & Hold Time**');
    lines.push(`- Avg Flip Duration: ${metrics.averageFlipDurationHours.toFixed(2)} hours`);
    lines.push(`- Median Hold Time: ${metrics.medianHoldTime.toFixed(2)} hours`);
    lines.push(`- % Trades < 1 Hour: ${(metrics.percentTradesUnder1Hour * 100).toFixed(1)}%`);
    lines.push(`- % Trades < 4 Hours: ${(metrics.percentTradesUnder4Hours * 100).toFixed(1)}%`);
    lines.push('');

    // Trading Time Distribution Table
    lines.push('**Trading Time Distribution**');
    lines.push('| Window   | % Trades |');
    lines.push('|----------|----------|');
    lines.push(`| < 30 min | ${(metrics.tradingTimeDistribution.ultraFast * 100).toFixed(1)}% |`);
    lines.push(`| 30-60min | ${(metrics.tradingTimeDistribution.veryFast * 100).toFixed(1)}% |`);
    lines.push(`| 1-4h     | ${(metrics.tradingTimeDistribution.fast * 100).toFixed(1)}% |`);
    lines.push(`| 4-8h     | ${(metrics.tradingTimeDistribution.moderate * 100).toFixed(1)}% |`);
    lines.push(`| 8-24h    | ${(metrics.tradingTimeDistribution.dayTrader * 100).toFixed(1)}% |`);
    lines.push(`| 1-7d     | ${(metrics.tradingTimeDistribution.swing * 100).toFixed(1)}% |`);
    lines.push(`| > 7d     | ${(metrics.tradingTimeDistribution.position * 100).toFixed(1)}% |`);
    lines.push('');

    // Buy/Sell Patterns
    lines.push('**Buy/Sell Patterns**');
    lines.push(`- Total Buy Count: ${metrics.totalBuyCount}`);
    lines.push(`- Total Sell Count: ${metrics.totalSellCount}`);
    lines.push(`- Buy:Sell Ratio (Overall): ${metrics.buySellRatio === Infinity ? 'INF' : metrics.buySellRatio.toFixed(2)}:1`);
    lines.push(`- Token-Level Symmetry: ${(metrics.buySellSymmetry * 100).toFixed(1)}%`);
    lines.push(`- Sequence Consistency: ${(metrics.sequenceConsistency * 100).toFixed(1)}%`);
    lines.push(`- Complete Buy->Sell Pairs: ${metrics.completePairsCount}`);
    lines.push('');

    // Activity Summary
    lines.push('**Activity Summary**');
    lines.push(`- Unique Tokens Traded: ${metrics.uniqueTokensTraded}`);
    lines.push(`- Tokens with Buys & Sells: ${metrics.tokensWithBothBuyAndSell}`);
    lines.push(`- Total Trades Recorded: ${metrics.totalTradeCount}`);
    lines.push(`- Avg Trades Per Token: ${metrics.averageTradesPerToken.toFixed(2)}`);
    lines.push('');

    lines.push('=== END REPORT ===');

    return lines.join('\n');
}

/**
 * Generates a formatted markdown report summarizing wallet correlation metrics.
 *
 * @param metrics - The calculated CorrelationMetrics object.
 * @param walletInfos - Array of WalletInfo for labels.
 * @param walletPnLs - Optional record of wallet PNLs.
 * @param config - Configuration used for the analysis (for context in report).
 * @returns A string containing the formatted report.
 */
export function generateCorrelationReport(
    metrics: CorrelationMetrics,
    walletInfos: WalletInfo[],
    walletPnLs?: Record<string, number>,
    config?: any // Use a more specific config type if available
): string {
    logger.debug(`Generating correlation report for ${walletInfos.length} wallets.`);
    const lines: string[] = [];
    const topKResults = config?.topKResults || 10; // Example: Get top K from config or default
    const syncTimeWindowSeconds = config?.syncTimeWindowSeconds || 300;
    const walletLabels: Record<string, string> = {};
    walletInfos.forEach(w => { walletLabels[w.address] = w.label || w.address.substring(0, 8); });

    lines.push('=== WALLET CORRELATION REPORT ===');
    lines.push(`Generated on: ${new Date().toISOString()}`);
    lines.push(`Wallets Analyzed: ${walletInfos.length}`);
    if (config) {
        lines.push('--- Configuration Highlights ---');
        // Add relevant config details
        lines.push(`Sync Time Window: ${syncTimeWindowSeconds}s`);
        lines.push(`Min Shared Non-Obvious Tokens: ${config.minSharedNonObviousTokens}`);
        lines.push(`Min Synchronized Events: ${config.minSyncEvents}`);
    }
    lines.push('');

    // Global Token Stats
    lines.push('--- Global Token Stats ---');
    lines.push(`Total Unique Mints Analyzed: ${metrics.globalTokenStats.totalUniqueTokens}`);
    lines.push(`Identified Popular/Obvious Tokens: ${metrics.globalTokenStats.totalPopularTokens}`);
    lines.push(`Identified Non-Obvious Tokens for Correlation: ${metrics.globalTokenStats.totalNonObviousTokens}`);
    lines.push('');

    // Clusters
    lines.push('--- Multi-Wallet Clusters (Size >= 3) ---');
    if (metrics.clusters.length === 0) {
        lines.push('No clusters found meeting the criteria.');
    } else {
        metrics.clusters.forEach((cluster, index) => {
            lines.push(`Cluster ${index + 1} (Score: ${cluster.score.toFixed(2)}, Size: ${cluster.wallets.length}):`);
            cluster.wallets.forEach(addr => {
                const label = walletLabels[addr] ? `(${walletLabels[addr]})` : '';
                const pnl = walletPnLs?.[addr]?.toFixed(2) ?? 'N/A';
                lines.push(`  - ${addr}${label} (PNL: ${pnl} SOL)`);
            });
            // Optionally list top shared tokens within the cluster
            // const topClusterTokens = cluster.sharedNonObviousTokens.slice(0, 5).map(t => t.mint).join(', ');
            // lines.push(`    Shared Tokens (sample): ${topClusterTokens}${cluster.sharedNonObviousTokens.length > 5 ? '...' : ''}`);
        });
    }
    lines.push('');

    // Top Correlated Pairs
    lines.push(`--- Top ${Math.min(topKResults, metrics.pairs.length)} Correlated Pairs ---`);
    if (metrics.pairs.length === 0) {
        lines.push('No significantly correlated pairs found.');
    } else {
        metrics.pairs.slice(0, topKResults).forEach((pair, index) => {
            const pnlA = walletPnLs?.[pair.walletA_address]?.toFixed(2) ?? 'N/A';
            const pnlB = walletPnLs?.[pair.walletB_address]?.toFixed(2) ?? 'N/A';
            const labelA = walletLabels[pair.walletA_address] || pair.walletA_address.substring(0,8);
            const labelB = walletLabels[pair.walletB_address] || pair.walletB_address.substring(0,8);
            lines.push(`
#${index + 1}: ${labelA} <-> ${labelB} (Score: ${pair.score})`);
            lines.push(`  PNL: Wallet A: ${pnlA} SOL | Wallet B: ${pnlB} SOL`);
            lines.push(`  Shared Non-Obvious Tokens (${pair.sharedNonObviousTokens.length}):`);
            pair.sharedNonObviousTokens.slice(0, 3).forEach(t => {
                lines.push(`    - ${t.mint} (A:${t.countA}, B:${t.countB})`);
            });
            if (pair.sharedNonObviousTokens.length > 3) lines.push('    ...');
            lines.push(`  Synchronized Events (${pair.synchronizedEvents.length} within ${syncTimeWindowSeconds}s):`);
            pair.synchronizedEvents.slice(0, 3).forEach(e => {
                lines.push(`    - ${e.direction.toUpperCase()} ${e.mint} (Diff: ${e.timeDiffSeconds}s)`);
            });
            if (pair.synchronizedEvents.length > 3) lines.push('    ...');
        });
    }
    lines.push('');

    lines.push('=== END REPORT ===');
    return lines.join('\n');
}

/**
 * Generates a formatted markdown report summarizing comprehensive wallet similarity metrics.
 *
 * @param metrics - The calculated ComprehensiveSimilarityResult object.
 * @param walletInfos - Array of WalletInfo for labels.
 * @returns A string containing the formatted report.
 */
export function generateSimilarityReport(
    metrics: ComprehensiveSimilarityResult,
    walletInfos: WalletInfo[]
): string {
    logger.debug(`Generating similarity report for ${walletInfos.length} wallets.`);
    const lines: string[] = [];
    const topKResults = 10; // Show top 10 most similar pairs
    const walletAddresses = walletInfos.map(w => w.address).sort();
    const walletLabels: Record<string, string> = {};
    walletInfos.forEach(w => { walletLabels[w.address] = w.label || w.address.substring(0, 8); });

    // Pre-calculate unique traded token counts for percentage calculation (needed for Connection Strength)
    // This might need the original transaction data OR be calculated/passed within metrics
    // For now, assume it needs to be recalculated or is missing for the summary
    // Let's fetch unique token counts directly from the vectors used if available
    const uniqueTokensPerWallet: Record<string, number> = {};
    for (const addr of walletAddresses) {
        const vector = metrics.walletVectorsUsed[addr];
        if (vector) {
            uniqueTokensPerWallet[addr] = Object.values(vector).filter(v => v > 0).length; // Count non-zero entries
        } else {
            uniqueTokensPerWallet[addr] = 0;
        }
    }

    // --- 1. Header ---
    lines.push('==================================================');
    lines.push(`    Wallet Similarity Analysis Report (Type: ${metrics.vectorTypeUsed})`);
    lines.push('==================================================');
    lines.push(`Generated on: ${new Date().toISOString()}`);
    lines.push(`Wallets Analyzed (${walletInfos.length}):`);
    walletInfos.forEach(w => lines.push(`- ${w.address}${w.label ? ' (' + w.label + ')' : ''}`));
    // Add excluded mints if available in metrics? config needs passing?
    // lines.push(`Excluded Mints (${excludedMints.length}): ${excludedMints.join(', ')}`);
    lines.push('');

    // --- 2. Connection Strength Summary (Re-implemented) ---
    lines.push('=== Connection Strength Summary ===');
    lines.push('(Based on Shared Token Counts, Jaccard Similarity, and Primary Similarity Score)');
    lines.push('');
    const categories: { [key: string]: string[] } = { Strongly: [], Mildly: [], Barely: [], NotConnected: [] };
    const processedPairs = new Set<string>();

    // Define thresholds (similar to original script)
    const THRESHOLDS = {
        STRONG: { count: 10, primarySim: 0.75, jaccardSim: 0.5, sharedPct: 0.5 },
        MILD:   { count: 5,  primarySim: 0.5,  jaccardSim: 0.3, sharedPct: 0.25 },
        BARELY: { count: 3,  primarySim: 0.25, jaccardSim: 0.15, sharedPct: 0.1 },
    };

    for (let i = 0; i < walletAddresses.length; i++) {
        for (let j = i + 1; j < walletAddresses.length; j++) {
            const addrA = walletAddresses[i];
            const addrB = walletAddresses[j];
            const pairKey = [addrA, addrB].sort().join('|');
            if (processedPairs.has(pairKey)) continue;
            processedPairs.add(pairKey);

            const count = metrics.sharedTokenCountsMatrix[addrA]?.[addrB] || 0;
            // Find the primary similarity score for this pair
            const primarySimPair = metrics.pairwiseSimilarities.find(p => 
                (p.walletA === addrA && p.walletB === addrB) || (p.walletA === addrB && p.walletB === addrA)
            );
            const primarySim = primarySimPair?.similarityScore || 0;
            const jaccardSim = metrics.jaccardSimilarityMatrix[addrA]?.[addrB] || 0;
            const pairLabel = `${walletLabels[addrA]} <-> ${walletLabels[addrB]}`;

            const uniqueA = uniqueTokensPerWallet[addrA] || 0;
            const uniqueB = uniqueTokensPerWallet[addrB] || 0;
            // Use raw count / unique count for percentage
            const pctA = uniqueA > 0 ? (count / uniqueA) * 100 : 0;
            const pctB = uniqueB > 0 ? (count / uniqueB) * 100 : 0;
            const maxSharedPct = Math.max(pctA / 100, pctB / 100); // Use the larger percentage

            const details = `(Shared: ${count} [A:${pctA.toFixed(1)}%, B:${pctB.toFixed(1)}%], Primary Sim (${metrics.vectorTypeUsed}): ${primarySim.toFixed(3)}, Jaccard Sim: ${jaccardSim.toFixed(3)})`;
            
            // Apply thresholds (adjust logic as needed to match original intent)
            if ( (primarySim >= THRESHOLDS.STRONG.primarySim && count >= THRESHOLDS.STRONG.count && maxSharedPct >= THRESHOLDS.STRONG.sharedPct) || 
                 (jaccardSim >= THRESHOLDS.STRONG.jaccardSim && count >= THRESHOLDS.STRONG.count && maxSharedPct >= THRESHOLDS.STRONG.sharedPct) ||
                 (primarySim >= THRESHOLDS.STRONG.primarySim && jaccardSim >= THRESHOLDS.STRONG.jaccardSim && maxSharedPct >= THRESHOLDS.STRONG.sharedPct) ) {
                categories.Strongly.push(`${pairLabel} ${details}`);
            } else if ( (primarySim >= THRESHOLDS.MILD.primarySim && count >= THRESHOLDS.MILD.count && maxSharedPct >= THRESHOLDS.MILD.sharedPct) || 
                        (jaccardSim >= THRESHOLDS.MILD.jaccardSim && count >= THRESHOLDS.MILD.count && maxSharedPct >= THRESHOLDS.MILD.sharedPct) ||
                        (primarySim >= THRESHOLDS.MILD.primarySim && jaccardSim >= THRESHOLDS.MILD.jaccardSim && maxSharedPct >= THRESHOLDS.MILD.sharedPct) ||
                        (primarySim >= THRESHOLDS.STRONG.primarySim || jaccardSim >= THRESHOLDS.STRONG.jaccardSim || maxSharedPct >= THRESHOLDS.STRONG.sharedPct) ) {
                categories.Mildly.push(`${pairLabel} ${details}`);
            } else if ( (primarySim >= THRESHOLDS.BARELY.primarySim && count >= THRESHOLDS.BARELY.count) || 
                        (jaccardSim >= THRESHOLDS.BARELY.jaccardSim && count >= THRESHOLDS.BARELY.count) || 
                        (primarySim >= THRESHOLDS.MILD.primarySim || jaccardSim >= THRESHOLDS.MILD.jaccardSim || count >= THRESHOLDS.STRONG.count || maxSharedPct >= THRESHOLDS.MILD.sharedPct) ) {
                categories.Barely.push(`${pairLabel} ${details}`);
            } else {
                // categories.NotConnected.push(pairLabel); // Optional
            }
        }
    }

    if (categories.Strongly.length > 0) { lines.push('Strongly Connected Pairs:'); categories.Strongly.forEach(s => lines.push(`- ${s}`)); lines.push(''); }
    if (categories.Mildly.length > 0) { lines.push('Mildly Connected Pairs:'); categories.Mildly.forEach(s => lines.push(`- ${s}`)); lines.push(''); }
    if (categories.Barely.length > 0) { lines.push('Barely Connected Pairs:'); categories.Barely.forEach(s => lines.push(`- ${s}`)); lines.push(''); }
    if (categories.Strongly.length === 0 && categories.Mildly.length === 0 && categories.Barely.length === 0) {
        lines.push('No significant connections found based on current thresholds.','');
    }

    // --- 3. Detailed Matrices ---
    lines.push(...formatMatrix(metrics.sharedTokenCountsMatrix, walletAddresses, walletLabels, 'Wallet-Pair Shared Token Counts (Raw)', (v) => String(v)));
    // Decide whether to show Cosine matrix explicitly based on primary type
    // This uses the pairwiseSimilarities which should be cosine scores
    const cosineMatrixForReport: Record<string, Record<string, number>> = {};
    walletAddresses.forEach(addrA => {
        cosineMatrixForReport[addrA] = {};
        walletAddresses.forEach(addrB => {
            if (addrA === addrB) return;
            const pair = metrics.pairwiseSimilarities.find(p => (p.walletA === addrA && p.walletB === addrB) || (p.walletA === addrB && p.walletB === addrA));
            cosineMatrixForReport[addrA][addrB] = pair?.similarityScore ?? 0;
        });
    });
    lines.push(...formatMatrix(cosineMatrixForReport, walletAddresses, walletLabels, `Primary Similarity (${metrics.vectorTypeUsed} - Cosine)`, (v) => typeof v === 'number' ? v.toFixed(4) : String(v)));
    lines.push(...formatMatrix(metrics.jaccardSimilarityMatrix, walletAddresses, walletLabels, 'Asset Overlap Similarity (Jaccard)', (v) => typeof v === 'number' ? v.toFixed(4) : String(v)));

    // --- 4. Shared Token Details (Token-Centric) ---
    lines.push('=== Shared Token Details (Token-Centric, Post-Exclusion) ===');
    if (metrics.fullSharedTokenList && metrics.fullSharedTokenList.length > 0) {
        lines.push(`Found ${metrics.fullSharedTokenList.length} tokens shared by 2 or more wallets.`);
        lines.push('(Mint Address | Shared by X Wallets | Wallet Addresses)');
        lines.push('---');
        metrics.fullSharedTokenList.forEach(info => {
            lines.push(`- ${info.mint} | ${info.count} Wallets | ${info.sharedByWallets.join(', ')}`);
        });
    } else {
        lines.push('No tokens were found to be shared by 2 or more specified wallets after exclusions.');
    }
    lines.push('');

    // --- 5. Top Similar Pairs (Simplified - already in globalMetrics) ---
    lines.push(`--- Top ${Math.min(topKResults, metrics.globalMetrics.mostSimilarPairs.length)} Most Similar Pairs (Primary Score: ${metrics.vectorTypeUsed}) ---`);
    if (metrics.globalMetrics.mostSimilarPairs.length === 0) {
        lines.push('No similarity pairs found.');
    } else {
        metrics.globalMetrics.mostSimilarPairs.slice(0, topKResults).forEach((pair, index) => {
            const labelA = walletLabels[pair.walletA] || pair.walletA.substring(0,8);
            const labelB = walletLabels[pair.walletB] || pair.walletB.substring(0,8);
            lines.push(`
#${index + 1}: ${labelA} <-> ${labelB} (Score: ${pair.similarityScore.toFixed(4)})`);
            if (pair.sharedTokens && pair.sharedTokens.length > 0) {
                 lines.push(`  Top Shared Tokens (Max 5 by Weight):`);
                 pair.sharedTokens.slice(0, 5).forEach(t => {
                    lines.push(`    - ${t.mint} (Weight A: ${t.weightA.toFixed(3)}, B: ${t.weightB.toFixed(3)})`);
                 });
                 if(pair.sharedTokens.length > 5) lines.push('    ...');
            }
        });
    }
    lines.push('');
    
    // --- Clusters (if implemented) ---
    // lines.push('--- Similarity Clusters ---');
    // if (metrics.clusters.length === 0) { lines.push('Clustering not implemented or no clusters found.'); } else { /* ... */ }
    // lines.push('');

    lines.push('=== END REPORT ===');
    return lines.join('\n');
}

/**
 * Utility function to format a matrix for reporting.
 * (Copied from original script - keep as internal helper or move to shared utils)
 */
function formatMatrix(matrix: Record<string, Record<string, number | string>>, walletOrder: string[], labels: Record<string, string>, title: string, valueFormatter: (val: number | string) => string): string[] {
    const lines: string[] = [`=== ${title} ===`, ''];
    const displayLabels = walletOrder.map(addr => labels[addr] || addr.substring(0, 10));
    const colWidth = 12; // Adjust as needed
    let header = " ".padEnd(15);
    displayLabels.forEach(label => header += label.padEnd(colWidth));
    lines.push(header);
    lines.push("".padEnd(15 + displayLabels.length * colWidth, '-')); // Separator

    for (let i = 0; i < walletOrder.length; i++) {
        const walletA_addr = walletOrder[i];
        const walletA_label = displayLabels[i];
        let row = walletA_label.padEnd(15);
        for (let j = 0; j < walletOrder.length; j++) {
            const walletB_addr = walletOrder[j];
            if (i === j) {
                row += "N/A".padEnd(colWidth);
            } else {
                const value = matrix[walletA_addr]?.[walletB_addr] ?? 0;
                row += valueFormatter(value).padEnd(colWidth);
            }
        }
        lines.push(row);
    }
    lines.push(''); // Add space after matrix
    return lines;
}

/**
 * Generates a Markdown report summarizing swap P/L analysis.
 * Uses existing helper functions like formatDate, formatSolAmount etc. defined above.
 */
export function generateSwapPnlReport(
    summary: SwapAnalysisSummary,
    walletAddress: string,
    timeRange?: string // Added timeRange parameter based on previous version
): string {
    logger.debug(`Generating Markdown PNL report for wallet: ${walletAddress}`);
    let report = `# Swap P/L Analysis Report for ${walletAddress}\n\n`;
    if (timeRange) {
        report += `**Time Range:** ${timeRange}\n`;
    }

    report += `**First Transaction:** ${summary.firstTransactionTimestamp ? formatTimestamp(summary.firstTransactionTimestamp * 1000) : 'N/A'}\n`;
    report += `**Last Transaction:** ${summary.lastTransactionTimestamp ? formatTimestamp(summary.lastTransactionTimestamp * 1000) : 'N/A'}\n\n`;

    report += `## Overall Summary\n`;
    report += `- **Total Signatures Processed:** ${summary.totalSignaturesProcessed}\n`;
    report += `- **Total Trading Volume (Approx):** ${formatSolAmount(summary.totalVolume)} SOL\n`;
    report += `- **Total Fees Paid (SOL):** ${formatSolAmount(summary.totalFees)}\n`;
    report += `- **Realized P/L:** ${formatSolAmount(summary.realizedPnl)} SOL\n`;
    report += `- **Unrealized P/L (Stablecoins/HODL):** ${formatSolAmount(summary.unrealizedPnl)} SOL\n`;
    report += `- **Net P/L:** ${formatSolAmount(summary.netPnl)} SOL\n`;
    report += `- **Stablecoin Net Flow:** ${formatSolAmount(summary.stablecoinNetFlow)} SOL\n`;
    report += `- **Average Swap Size (Approx):** ${formatSolAmount(summary.averageSwapSize)} SOL\n`;
    report += `- **Profitable Tokens:** ${summary.profitableSwaps}\n`;
    report += `- **Unprofitable Tokens:** ${summary.unprofitableSwaps}\n\n`;

    if (summary.advancedStats) {
        report += `## Advanced Trading Stats\n`;
        report += `- **Median P/L per Token:** ${formatSolAmount(summary.advancedStats.medianPnlPerToken)} SOL\n`;
        report += `- **Trimmed Mean P/L per Token:** ${formatSolAmount(summary.advancedStats.trimmedMeanPnlPerToken)} SOL\n`;
        report += `- **Token Win Rate:** ${formatNumber(summary.advancedStats.tokenWinRatePercent, 2)}%\n`;
        report += `- **Standard Deviation of P/L:** ${formatSolAmount(summary.advancedStats.standardDeviationPnl)} SOL\n`;
        report += `\n`;
    }

    report += `## Detailed Results per Token\n`;
    const tableData: (string | number)[][] = [
        ['Token Address', 'Net Change', 'SOL Spent', 'SOL Received', 'Fees (SOL)', 'Net P/L (SOL)', 'First Seen', 'Last Seen']
    ];

    // Sort results by Net SOL P/L (descending) - using netSolProfitLoss for sorting consistency
    const sortedResults = [...summary.results].sort((a, b) => (b.netSolProfitLoss ?? 0) - (a.netSolProfitLoss ?? 0));

    sortedResults.forEach(result => {
        tableData.push([
            getTokenDisplayName(result.tokenAddress), // Use helper
            formatTokenQuantity(result.netAmountChange), // Use helper
            formatSolAmount(result.totalSolSpent),
            formatSolAmount(result.totalSolReceived),
            formatSolAmount(result.totalFeesPaidInSol ?? 0),
            formatSolAmount(result.netSolProfitLoss), // Display individual token PNL
            formatDate(result.firstTransferTimestamp), // Use helper
            formatDate(result.lastTransferTimestamp) // Use helper
        ]);
    });

    if (tableData.length > 1) {
        report += table(tableData);
    } else {
        report += 'No detailed swap results found.\n';
    }

    logger.debug(`Finished generating Markdown PNL report for wallet: ${walletAddress}`);
    return report;
}

/**
 * Generates a CSV string from the swap P/L analysis summary.
 * Includes optional walletAddress and runId columns if provided.
 */
export function generateSwapPnlCsv(summary: SwapAnalysisSummary, walletAddress?: string, runId?: number): string {
    logger.debug(`Generating CSV PNL report for wallet: ${walletAddress}`);
    
    // Base headers
    const baseHeaders = [
        'Token Address', 'Token Symbol',
        'Total Amount In', 'Total Amount Out', 'Net Amount Change', 
        'Total SOL Spent', 'Total SOL Received', 'Total Fees Paid (SOL)', 
        'Net SOL P/L', 'Is Value Preservation', 'Preservation Type', 
        'Estimated Preserved Value (SOL)', 'Adjusted Net SOL P/L',
        'Transfer Count In', 'Transfer Count Out', 
        'First Transfer Timestamp', 'Last Transfer Timestamp',
        // Overall summary stats added to each row
        'Overall First Tx Timestamp', 'Overall Last Tx Timestamp', 
        'Overall Realized PNL', 'Overall Unrealized PNL', 'Overall Net PNL', 'Overall Stablecoin Net Flow'
    ];

    // Dynamically add headers for optional fields
    let finalHeaders = [...baseHeaders];
    if (walletAddress) finalHeaders.unshift('Wallet Address');
    if (runId) finalHeaders.unshift('Run ID');

    const rows = summary.results.map(result => {
        const rowData = [
            result.tokenAddress, getTokenDisplayName(result.tokenAddress),
            result.totalAmountIn,
            result.totalAmountOut,
            result.netAmountChange,
            result.totalSolSpent,
            result.totalSolReceived,
            result.totalFeesPaidInSol ?? 0,
            result.netSolProfitLoss,
            result.isValuePreservation ? 'TRUE' : 'FALSE',
            result.preservationType ?? 'N/A',
            result.estimatedPreservedValue ?? 0,
            result.adjustedNetSolProfitLoss ?? result.netSolProfitLoss,
            result.transferCountIn,
            result.transferCountOut,
            result.firstTransferTimestamp,
            result.lastTransferTimestamp,
            // Add overall summary stats
            summary.firstTransactionTimestamp ?? 'N/A',
            summary.lastTransactionTimestamp ?? 'N/A',
            summary.realizedPnl,
            summary.unrealizedPnl,
            summary.netPnl,
            summary.stablecoinNetFlow
        ];
        // Add optional fields in correct order
        if (walletAddress) rowData.unshift(walletAddress);
        if (runId) rowData.unshift(runId);
        return rowData;
    });

    try {
        const csvContent = Papa.unparse({ fields: finalHeaders, data: rows }, { header: true });
        logger.debug(`Finished generating CSV PNL report`);
        return csvContent;
    } catch (error) {
        logger.error('Failed to generate CSV string:', { error });
        return ''; // Return empty string on error
    }
}

/**
 * Saves the generated report content to a file.
 *
 * @param id - Identifier for the report file (e.g., wallet address or 'comparative').
 * @param content - The string content of the report.
 * @param type - The type of report ('individual' or 'comparison') used for subfolder.
 * @returns The full path to the saved report file.
 */
export function saveReport(id: string, content: string, type: 'individual' | 'comparison' | 'correlation' | 'similarity' | 'swap_pnl' | 'swap_pnl_csv' | string, fileExtension: 'md' | 'csv' = 'md'): string { // Added types and extension
    const reportsDir = path.join(process.cwd(), 'analysis_reports', type); // Use type for subfolder
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
        logger.info(`Created reports directory: ${reportsDir}`);
    }

    const safeId = id.replace(/[^a-z0-9]/gi, '_').toLowerCase(); // Sanitize ID for filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Use fileExtension parameter
    const reportPath = path.join(reportsDir, `${safeId}_${type}_report_${timestamp}.${fileExtension}`); 

    try {
        fs.writeFileSync(reportPath, content, 'utf8');
        logger.debug(`Report saved successfully to ${reportPath}`);
        return reportPath;
    } catch (error) {
        logger.error(`Failed to save report to ${reportPath}:`, { error });
        throw error; // Re-throw the error for calling function to handle
    }
} 