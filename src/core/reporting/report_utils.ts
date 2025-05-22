import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from 'core/utils/logger'; 
import { BehavioralMetrics } from '@/types/behavior'; 
import { CorrelationMetrics, GlobalTokenStats, CorrelatedPairData } from '@/types/correlation'; 
import { WalletInfo, WalletCluster } from '@/types/wallet'; 
import { ComprehensiveSimilarityResult } from 'core/analysis/similarity/similarity-service';
import { SwapAnalysisSummary, OnChainAnalysisResult, AdvancedTradeStats } from '@/types/helius-api';
import Papa from 'papaparse';
import { table, getBorderCharacters as getTableBorderChars } from 'table';
import { formatTimestamp, formatSolAmount, formatNumber } from 'core/utils/formatters';

const logger = createLogger('ReportUtils');

// --- Local ProcessingStats interface (Consider moving to a shared types file later) ---
interface ProcessingStats {
  totalTransactions: number;
  overallFirstTimestamp?: number;
  overallLastTimestamp?: number;
}
// --- End Local ProcessingStats ---

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

    lines.push(`## WALLET BEHAVIOR REPORT: ${walletAddress}`);
    lines.push(`Generated on: ${new Date().toISOString()}`);
    lines.push('');

    // --- Trading Style Classification ---
    lines.push('### Trading Style Classification');
    lines.push(`- Style: **${metrics.tradingStyle}**`);
    lines.push(`- Confidence: ${formatNumber(metrics.confidenceScore * 100, 1)}%`);
    lines.push(`- Flipper Score: ${formatNumber(metrics.flipperScore, 3)}`);
    lines.push('');

    // --- Key Speed Metrics & Hold Time ---
    lines.push('### Speed & Hold Time');
    lines.push(`- Average Flip Duration: ${formatNumber(metrics.averageFlipDurationHours, 2)} hours`);
    lines.push(`- Median Hold Time: ${formatNumber(metrics.medianHoldTime, 2)} hours`);
    lines.push(`- % Swaps < 1 Hour: ${formatNumber(metrics.percentTradesUnder1Hour * 100, 1)}%`);
    lines.push(`- % Swaps < 4 Hours: ${formatNumber(metrics.percentTradesUnder4Hours * 100, 1)}%`);
    lines.push('');

    // --- Trading Time Distribution (Existing Bucketed) ---
    lines.push('### Trading Time Distribution (Categorized)');
    lines.push('| Window          | % Swaps |');
    lines.push('|-----------------|----------|');
    lines.push(`| < 30 min        | ${formatNumber(metrics.tradingTimeDistribution.ultraFast * 100, 1)}% |`);
    lines.push(`| 30-60 min       | ${formatNumber(metrics.tradingTimeDistribution.veryFast * 100, 1)}% |`);
    lines.push(`| 1-4 hours       | ${formatNumber(metrics.tradingTimeDistribution.fast * 100, 1)}% |`);
    lines.push(`| 4-8 hours       | ${formatNumber(metrics.tradingTimeDistribution.moderate * 100, 1)}% |`);
    lines.push(`| 8-24 hours      | ${formatNumber(metrics.tradingTimeDistribution.dayTrader * 100, 1)}% |`);
    lines.push(`| 1-7 days        | ${formatNumber(metrics.tradingTimeDistribution.swing * 100, 1)}% |`);
    lines.push(`| > 7 days        | ${formatNumber(metrics.tradingTimeDistribution.position * 100, 1)}% |`);
    lines.push('');

    // --- Trading Frequency ---
    lines.push('### Trading Frequency');
    lines.push(`- Swaps per Day: ${formatNumber(metrics.tradingFrequency.tradesPerDay, 2)}`);
    lines.push(`- Swaps per Week: ${formatNumber(metrics.tradingFrequency.tradesPerWeek, 2)}`);
    lines.push(`- Swaps per Month: ${formatNumber(metrics.tradingFrequency.tradesPerMonth, 2)}`);
    lines.push('');

    // --- Session-Based Metrics ---
    lines.push('### Session-Based Metrics');
    lines.push(`- Session Count: ${metrics.sessionCount}`);
    lines.push(`- Average Swaps per Session: ${formatNumber(metrics.avgTradesPerSession, 2)}`);
    lines.push(`- Average Session Start Hour (UTC): ${metrics.averageSessionStartHour === -1 ? 'N/A' : metrics.averageSessionStartHour.toFixed(0).padStart(2, '0') + ':00'}`);
    lines.push(`- Average Session Duration: ${formatNumber(metrics.averageSessionDurationMinutes, 1)} minutes`);
    lines.push('');
    
    // --- Active Trading Periods ---
    lines.push('### Active Trading Periods');
    lines.push(`- Activity Focus Score: ${formatNumber(metrics.activeTradingPeriods.activityFocusScore, 1)}%`);
    lines.push('');

    lines.push('#### Hourly Swap Counts (UTC)');
    if (Object.keys(metrics.activeTradingPeriods.hourlyTradeCounts).length > 0) {
        const hourlyData = [['Hour (UTC)', 'Swap Count']];
        for (const hour in metrics.activeTradingPeriods.hourlyTradeCounts) {
            hourlyData.push([`${hour.padStart(2, '0')}:00-${(parseInt(hour) + 1).toString().padStart(2, '0')}:00`, metrics.activeTradingPeriods.hourlyTradeCounts[hour].toString()]);
        }
        lines.push(table(hourlyData));
    } else {
        lines.push('No hourly swap data available.');
    }
    lines.push('');

    lines.push('#### Identified Trading Windows');
    if (metrics.activeTradingPeriods.identifiedWindows.length > 0) {
        const windowsData = [['Start (UTC)', 'End (UTC)', 'Duration (hrs)', 'Swaps', '% Total Swaps', 'Avg Swaps/hr']];
        metrics.activeTradingPeriods.identifiedWindows.forEach(w => {
            windowsData.push([
                `${w.startTimeUTC.toString().padStart(2, '0')}:00 UTC`,
                `${w.endTimeUTC.toString().padStart(2, '0')}:00 UTC`,
                formatNumber(w.durationHours, 2),
                w.tradeCountInWindow.toString(),
                formatNumber(w.percentageOfTotalTrades, 1) + '%',
                formatNumber(w.avgTradesPerHourInWindow, 2)
            ]);
        });
        lines.push(table(windowsData));
    } else {
        lines.push('No significant trading windows identified.');
    }
    lines.push('');

    // --- Buy/Sell Patterns & Token Interaction ---
    lines.push('### Buy/Sell Patterns & Token Interaction');
    lines.push(`- Total Buy Count: ${metrics.totalBuyCount}`);
    lines.push(`- Total Sell Count: ${metrics.totalSellCount}`);
    lines.push(`- Buy:Sell Ratio (Overall): ${metrics.buySellRatio === Infinity ? 'INF' : formatNumber(metrics.buySellRatio, 2)}:1`);
    lines.push(`- Token-Level Buy/Sell Symmetry: ${formatNumber(metrics.buySellSymmetry * 100, 1)}%`);
    lines.push(`- Sequence Consistency (Buy before Sell): ${formatNumber(metrics.sequenceConsistency * 100, 1)}%`);
    lines.push(`- Complete Buy->Sell Pairs: ${metrics.completePairsCount}`);
    lines.push(`- Re-entry Rate (Repurchasing sold tokens): ${formatNumber(metrics.reentryRate * 100, 1)}%`);
    lines.push(`- Percentage of Unpaired Tokens: ${formatNumber(metrics.percentageOfUnpairedTokens, 1)}%`);
    lines.push('');

    // --- Risk & Value Metrics ---
    lines.push('### Risk & Value Metrics');
    lines.push(`- Average Transaction Value (SOL): ${formatSolAmount(metrics.riskMetrics.averageTransactionValueSol)}`);
    lines.push(`- Largest Transaction Value (SOL): ${formatSolAmount(metrics.riskMetrics.largestTransactionValueSol)}`);
    // Diversification score was removed.
    lines.push('');

    // --- Token Preferences ---
    lines.push('### Token Preferences');
    lines.push('#### Most Traded Tokens (by Count)');
    if (metrics.tokenPreferences.mostTradedTokens.length > 0) {
        const mostTradedData = [['Token', 'Swap Count']];
        metrics.tokenPreferences.mostTradedTokens.slice(0, 10).forEach(t => {
            mostTradedData.push([
                getTokenDisplayName(t.mint),
                t.count.toString()
            ]);
        });
        lines.push(table(mostTradedData));
    } else {
        lines.push('No trading activity to determine most traded tokens.');
    }
    lines.push('');
    // mostProfitableTokens was removed. topNetPositiveAmountTokens was postponed.

    // --- Activity Summary (Counts) ---
    lines.push('### Activity Summary (Counts)');
    lines.push(`- Unique Tokens Traded: ${metrics.uniqueTokensTraded}`);
    lines.push(`- Tokens with Both Buys & Sells: ${metrics.tokensWithBothBuyAndSell}`);
    lines.push(`- Tokens with Only Buys (No Sells): ${metrics.tokensWithOnlyBuys}`);
    lines.push(`- Tokens with Only Sells (No Buys): ${metrics.tokensWithOnlySells}`);
    lines.push(`- Total Swaps Recorded: ${metrics.totalTradeCount}`); // totalTradeCount is more aligned with swaps
    lines.push(`- Average Swaps Per Token: ${formatNumber(metrics.averageTradesPerToken, 2)}`);
    lines.push('');

    lines.push('--- END OF BEHAVIOR REPORT ---');

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
 * Generates a detailed Markdown report for Swap P/L analysis.
 *
 * @param summary The SwapAnalysisSummary containing all P/L data.
 * @param walletAddress The wallet address being reported on.
 * @param timeRange Optional string describing the time range of the analysis.
 * @returns A string containing the formatted Markdown report.
 */
export function generateSwapPnlReport(
    summary: SwapAnalysisSummary,
    walletAddress: string,
    timeRange?: string
): string {
    const lines: string[] = [];
    const {
        results,
        netPnl,
        profitableTokensCount,
        unprofitableTokensCount,
        totalExecutedSwapsCount,
        averageRealizedPnlPerExecutedSwap,
        realizedPnlToTotalVolumeRatio,
        advancedStats,
        overallFirstTimestamp,
        overallLastTimestamp,
        totalVolume
    } = summary;

    // Calculate overallSolSpent and overallSolReceived from results if not directly on summary
    // PnlAnalysisService *should* be adding these if they are for top-level reporting.
    // For this fix, we'll assume PnlAnalysisService ensures summary has these,
    // or we calculate them. Let's calculate for robustness here.
    const calculatedOverallSolSpent = results.reduce((acc, r) => acc + (r.totalSolSpent || 0), 0);
    const calculatedOverallSolReceived = results.reduce((acc, r) => acc + (r.totalSolReceived || 0), 0);

    lines.push(`## 📊 Solana Wallet P/L Analysis: ${walletAddress}`);
    if (timeRange) {
        lines.push(`**Analysis Period:** ${timeRange}`);
    }
    lines.push(`**Report Generated:** ${new Date().toISOString()}`);
    lines.push(`**Data from:** ${overallFirstTimestamp ? formatTimestamp(overallFirstTimestamp) : 'N/A'} to ${overallLastTimestamp ? formatTimestamp(overallLastTimestamp) : 'N/A'}`);
    lines.push("\n---\n");

    // Overall Summary Section - Directly from SwapAnalysisSummary
    lines.push("### 📈 Overall Performance Summary");
    lines.push(`- **Total Realized P/L (SOL):** ${formatSolAmount(netPnl)}`);
    lines.push(`- **Total SOL Spent (on buys):** ${formatSolAmount(calculatedOverallSolSpent)}`);
    lines.push(`- **Total SOL Received (from sells):** ${formatSolAmount(calculatedOverallSolReceived)}`);
    lines.push(`- **Profitable Tokens:** ${profitableTokensCount}`);
    lines.push(`- **Unprofitable Tokens:** ${unprofitableTokensCount}`);
    const totalTokensCounted = profitableTokensCount + unprofitableTokensCount;
    const winRatePercent = totalTokensCounted > 0 ? (profitableTokensCount / totalTokensCounted) * 100 : 0;
    lines.push(`- **Token Win Rate:** ${formatNumber(winRatePercent, 1)}% (based on ${totalTokensCounted} tokens)`);
    lines.push(`- **Total Executed Swaps:** ${totalExecutedSwapsCount}`);
    lines.push(`- **Avg. Realized PNL per Executed Swap:** ${formatSolAmount(averageRealizedPnlPerExecutedSwap)}`);
    lines.push(`- **Realized PNL to Total Volume Ratio:** ${formatNumber(realizedPnlToTotalVolumeRatio * 100, 2)}%`);
    lines.push(`- **Total SOL Volume (Buy+Sell):** ${formatSolAmount(totalVolume)}`);
    lines.push("\n---\n");

    // Advanced Stats Section - Directly from SwapAnalysisSummary.advancedStats (type AdvancedTradeStats)
    if (advancedStats) {
        lines.push("### 🔬 Advanced Statistics (from Helius API advancedStats)");
        lines.push(`- **Median P/L per Token (SOL):** ${formatSolAmount(advancedStats.medianPnlPerToken)}`);
        lines.push(`- **Token Win Rate:** ${formatNumber(advancedStats.tokenWinRatePercent, 1)}%`);
        lines.push(`- **Standard Deviation of P/L:** ${formatSolAmount(advancedStats.standardDeviationPnl)}`);
        lines.push(`- **Median PnL to Volatility Ratio:** ${formatNumber(advancedStats.medianPnlToVolatilityRatio, 2)}`);
        lines.push(`- **Weighted Efficiency Score:** ${formatNumber(advancedStats.weightedEfficiencyScore, 2)}`);
        lines.push(`- **Average P/L per Day Active (Approx):** ${formatSolAmount(advancedStats.averagePnlPerDayActiveApprox)}`);
        lines.push("\n---\n");
    }

    // Token Details Table - from SwapAnalysisSummary.results (OnChainAnalysisResult[])
    lines.push("### 🪙 Token P/L Details (Top 15 by Realized P/L)");
    const tableData: any[][] = [[
        'Token', 'Symbol', 'Realized P/L (SOL)', 'Net Token Change (Units)', 'SOL Spent', 'SOL Received', 'Swaps In/Out', 'First/Last Seen'
    ]];

    // Sort tokens by realized P/L descending, take top 15
    const sortedTokenDetails = [...results].sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss).slice(0, 15);

    for (const token of sortedTokenDetails) {
        tableData.push([
            token.tokenAddress.substring(0, 6) + '...',
            getTokenDisplayName(token.tokenAddress),
            formatSolAmount(token.netSolProfitLoss),
            formatTokenQuantity(token.netAmountChange),
            formatSolAmount(token.totalSolSpent),
            formatSolAmount(token.totalSolReceived),
            `${token.transferCountIn}/${token.transferCountOut}`,
            `${formatDate(token.firstTransferTimestamp)} / ${formatDate(token.lastTransferTimestamp)}`
        ]);
    }
    lines.push(table(tableData, { border: getTableBorderChars('ramac') }));
    lines.push("\n---\n");
    lines.push("Generated by Solana P/L Analyzer.");

    lines.push('--- END OF P/L REPORT ---');
    return lines.join('\n');
}

/**
 * Generates a CSV string from the SwapAnalysisSummary.
 *
 * @param summary The SwapAnalysisSummary object.
 * @param walletAddress Optional wallet address to include in the CSV metadata (if applicable).
 * @param runId Optional run ID to include in the CSV metadata.
 * @returns A string in CSV format.
 */
export function generateSwapPnlCsv(summary: SwapAnalysisSummary, walletAddress?: string, runId?: number): string {
    if (!summary || !summary.results) {
        logger.warn('[ReportUtils] No summary or results provided for CSV generation.');
        return '';
    }

    const csvData = summary.results.map(res => ({
        Wallet: walletAddress || 'N/A',
        RunID: runId || 'N/A',
        TokenAddress: res.tokenAddress,
        TokenSymbol: getTokenDisplayName(res.tokenAddress),
        TotalSolSpent: res.totalSolSpent,
        TotalSolReceived: res.totalSolReceived,
        NetSolProfitLoss: res.netSolProfitLoss,
        TotalTokenIn: res.totalAmountIn,
        TotalTokenOut: res.totalAmountOut,
        NetAmountChange: res.netAmountChange,
        AvgBuyPriceSol: 'N/A',
        AvgSellPriceSol: 'N/A',
        FirstTransferTimestamp: formatTimestamp(res.firstTransferTimestamp),
        LastTransferTimestamp: formatTimestamp(res.lastTransferTimestamp),
        TransferCountIn: res.transferCountIn,
        TransferCountOut: res.transferCountOut,
        ValuePreservation: res.isValuePreservation,
        EstimatedPreservedValue: res.estimatedPreservedValue,
    }));

    // Calculate these from summary.results for robustness if not on top-level summary passed to this function
    const calculatedOverallSolSpent = summary.results.reduce((acc, r) => acc + (r.totalSolSpent || 0), 0);
    const calculatedOverallSolReceived = summary.results.reduce((acc, r) => acc + (r.totalSolReceived || 0), 0);

    const overallSummaryLine = {
        Wallet: walletAddress || 'N/A',
        RunID: runId || 'N/A',
        TokenAddress: 'OVERALL_SUMMARY',
        TokenSymbol: 'N/A',
        TotalSolSpent: calculatedOverallSolSpent,
        TotalSolReceived: calculatedOverallSolReceived,
        NetSolProfitLoss: summary.netPnl,
        TotalTokenIn: 'N/A',
        TotalTokenOut: 'N/A',
        NetAmountChange: 'N/A',
        AvgBuyPriceSol: 'N/A',
        AvgSellPriceSol: 'N/A',
        FirstTransferTimestamp: formatTimestamp(summary.overallFirstTimestamp),
        LastTransferTimestamp: formatTimestamp(summary.overallLastTimestamp),
        TransferCountIn: 'N/A',
        TransferCountOut: 'N/A',
        ValuePreservation: 'N/A',
        EstimatedPreservedValue: 'N/A',
        ProfitableTokensCount: summary.profitableTokensCount,
        UnprofitableTokensCount: summary.unprofitableTokensCount,
        TotalExecutedSwapsCount: summary.totalExecutedSwapsCount,
        AverageRealizedPnlPerExecutedSwap: summary.averageRealizedPnlPerExecutedSwap,
        RealizedPnlToTotalVolumeRatio: summary.realizedPnlToTotalVolumeRatio,
        TotalVolume: summary.totalVolume,
    };

    if (summary.advancedStats) {
        // @ts-ignore - Assuming these fields exist for the CSV
        overallSummaryLine.WinRate = summary.advancedStats.tokenWinRatePercent;
        // @ts-ignore
        overallSummaryLine.ProfitFactor = summary.advancedStats.profitFactor;
    }

    try {
        return Papa.unparse([overallSummaryLine, ...csvData]);
    } catch (err) {
        logger.error('Error unparsing CSV data:', err);
        return '';
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
export function saveReport(id: string, content: string, type: 'individual' | 'comparison' | 'correlation' | 'similarity' | 'swap_pnl' | 'swap_pnl_csv' | string, fileExtension: 'md' | 'csv' = 'md'): string {
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

// -- Telegram Specific Report Utilities (Now HTML) --

/**
 * Generates a concise PNL overview string in HTML for Telegram.
 *
 * @param walletAddress The wallet address.
 * @param summary The SwapAnalysisSummary object from PnlAnalysisService.
 * @returns A string formatted as HTML for a Telegram message.
 */
export function generatePnlOverviewHtmlTelegram(
    walletAddress: string,
    summary: SwapAnalysisSummary | null | undefined 
): string {
    if (!summary) {
        return `<b>💰 PNL Overview for <code>${walletAddress}</code>:</b>\n⚠️ No PNL data available or analysis was skipped.`;
    }
    const { realizedPnl, profitableTokensCount, unprofitableTokensCount, totalVolume, advancedStats, overallFirstTimestamp, overallLastTimestamp, totalExecutedSwapsCount } = summary;
    const totalPnlTokens = (profitableTokensCount || 0) + (unprofitableTokensCount || 0);
    const winRate = totalPnlTokens > 0 ? ((profitableTokensCount || 0) / totalPnlTokens) * 100 : 0;
    // Use totalExecutedSwapsCount for avgPnlPerSwap if available and makes sense, otherwise stick to totalPnlTokens for per-token-pnl-event average
    const avgPnlPerSwap = (totalExecutedSwapsCount ?? 0) > 0 ? (realizedPnl || 0) / (totalExecutedSwapsCount! ) : 0; 

    let message = `<b>💰 PNL Overview for <code>${walletAddress}</code>:</b>\n`;
    if (overallFirstTimestamp && overallLastTimestamp) {
        message += `<i>Data from: ${formatTimestamp(overallFirstTimestamp)} to ${formatTimestamp(overallLastTimestamp)}</i>\n`;
    }
    message += `  Realized PNL: <b>${formatSolAmount(realizedPnl || 0, 2)} SOL</b>\n`;
    message += `  Win Rate: <b>${winRate.toFixed(1)}%</b> (${profitableTokensCount || 0}/${totalPnlTokens} wins)\n`;
    // Changed Avg P/L Trade to Avg P/L Swap
    message += `  Avg P/L Swap: <b>${formatSolAmount(avgPnlPerSwap, 2)} SOL</b>\n`; 

    if (advancedStats) {
        message += `  Token Win Rate: <b>${formatNumber(advancedStats.tokenWinRatePercent, 1)}%</b>\n`;
        message += `  Median P/L Token: <b>${formatSolAmount(advancedStats.medianPnlPerToken, 2)} SOL</b>\n`;
    } else {
        message += `  Advanced stats: N/A\n`;
    }
    message += `  Total Volume: <b>${formatSolAmount(totalVolume || 0, 2)} SOL</b>`;

    return message;
}

/**
 * Generates a concise behavior summary string in HTML for Telegram.
 *
 * @param walletAddress The wallet address.
 * @param metrics The BehavioralMetrics object from BehaviorService.
 * @returns A string formatted as HTML for a Telegram message.
 */
export function generateBehaviorSummaryHtmlTelegram(
    walletAddress: string,
    metrics: BehavioralMetrics | null | undefined
): string {
    if (!metrics) {
        return `<b>🧠 Behavior Summary for <code>${walletAddress}</code>:</b>\n⚠️ No behavior data available.`;
    }

    let message = `<b>🧠 Behavior Summary for <code>${walletAddress}</code>:</b>\n`;
    if (metrics.firstTransactionTimestamp && metrics.lastTransactionTimestamp) {
        message += `<i>Data from: ${formatTimestamp(metrics.firstTransactionTimestamp)} to ${formatTimestamp(metrics.lastTransactionTimestamp)}</i>\n`;
    }
    message += `  Style: <b>${metrics.tradingStyle ?? 'N/A'}</b> (Confidence: <b>${((metrics.confidenceScore ?? 0) * 100).toFixed(1)}%</b>)\n`;
    message += `  Avg. Flip: <b>${(metrics.averageFlipDurationHours ?? 0).toFixed(1)} hrs</b> | Med. Hold: <b>${(metrics.medianHoldTime ?? 0).toFixed(1)} hrs</b>\n`;
    message += `  Key Traits: %&lt;1hr: <b>${((metrics.percentTradesUnder1Hour ?? 0) * 100).toFixed(0)}%</b>, Buy/Sell Symm: <b>${((metrics.buySellSymmetry ?? 0) * 100).toFixed(0)}%</b>\n`;
    // Changed Total Trades to Total Swaps
    message += `  Unique Tokens: <b>${metrics.uniqueTokensTraded ?? 0}</b> | Total Swaps: <b>${metrics.totalTradeCount ?? 0}</b>`; 

    return message;
}

// --- NEW DETAILED HTML GENERATORS FOR TELEGRAM ---

/**
 * Generates a detailed HTML report for behavioral analysis for Telegram.
 * @param walletAddress - The wallet address.
 * @param metrics - The behavioral metrics.
 * @returns HTML string report.
 */
export function generateDetailedBehaviorHtmlTelegram(walletAddress: string, metrics: BehavioralMetrics | null | undefined): string {
    if (!metrics) {
        return `<b>📊 Behavioral Analysis Report for <code>${walletAddress}</code></b>\n⚠️ No behavioral metrics data available to generate a detailed report.`;
    }
    const lines: string[] = [];
    
    lines.push(`<b>📊 Behavioral Analysis Report for <code>${walletAddress}</code></b>`);
    if (metrics.firstTransactionTimestamp && metrics.lastTransactionTimestamp) {
        lines.push(`<i>Data from: ${formatTimestamp(metrics.firstTransactionTimestamp)} to ${formatTimestamp(metrics.lastTransactionTimestamp)}</i>`);
    }
    lines.push(`<i>Generated: ${new Date().toLocaleString()}</i>\n`);
    
    // Trading Style
    lines.push(`Trading Style: <b>${metrics.tradingStyle ?? 'N/A'}</b> (Confidence: <b>${((metrics.confidenceScore ?? 0) * 100).toFixed(1)}%</b>)`);
    lines.push(`Flipper Score: <b>${formatNumber(metrics.flipperScore ?? 0, 2)}</b>\n`);
    
    // Time Distribution
    lines.push('<b>Time Distribution:</b>');
    lines.push(`• Ultra Fast (&lt;30min): <b>${((metrics.tradingTimeDistribution?.ultraFast ?? 0) * 100).toFixed(1)}%</b>`);
    lines.push(`• Very Fast (30-60min): <b>${((metrics.tradingTimeDistribution?.veryFast ?? 0) * 100).toFixed(1)}%</b>`);
    lines.push(`• Fast (1-4h): <b>${((metrics.tradingTimeDistribution?.fast ?? 0) * 100).toFixed(1)}%</b>`);
    lines.push(`• Moderate (4-8h): <b>${((metrics.tradingTimeDistribution?.moderate ?? 0) * 100).toFixed(1)}%</b>`);
    lines.push(`• Day Trader (8-24h): <b>${((metrics.tradingTimeDistribution?.dayTrader ?? 0) * 100).toFixed(1)}%</b>`);
    lines.push(`• Swing (1-7d): <b>${((metrics.tradingTimeDistribution?.swing ?? 0) * 100).toFixed(1)}%</b>`);
    lines.push(`• Position (>7d): <b>${((metrics.tradingTimeDistribution?.position ?? 0) * 100).toFixed(1)}%</b>\n`);
    
    // Activity Summary
    lines.push('<b>Activity Summary:</b>');
    lines.push(`• Unique Tokens: <b>${metrics.uniqueTokensTraded ?? 'N/A'}</b>`);
    lines.push(`• Tokens with Both Buy/Sell: <b>${metrics.tokensWithBothBuyAndSell ?? 'N/A'}</b>`);
    // Changed Total Trades to Total Swaps
    lines.push(`• Total Swaps: <b>${metrics.totalTradeCount ?? 'N/A'}</b> (<b>${metrics.totalBuyCount ?? 0}</b> buys, <b>${metrics.totalSellCount ?? 0}</b> sells)`); 
    lines.push(`• Complete Pairs: <b>${metrics.completePairsCount ?? 'N/A'}</b>\n`);
    
    // Key Metrics
    lines.push('<b>Key Metrics:</b>');
    const buySellRatio = metrics.buySellRatio ?? 0;
    lines.push(`• Buy/Sell Ratio: <b>${buySellRatio === Infinity ? 'INF' : formatNumber(buySellRatio, 2)}:1</b>`);
    lines.push(`• Buy/Sell Symmetry: <b>${((metrics.buySellSymmetry ?? 0) * 100).toFixed(1)}%</b>`);
    lines.push(`• Sequence Consistency: <b>${((metrics.sequenceConsistency ?? 0) * 100).toFixed(1)}%</b>`);
    lines.push(`• Average Hold Time: <b>${(metrics.averageFlipDurationHours ?? 0).toFixed(1)}h</b>`);
    lines.push(`• Median Hold Time: <b>${(metrics.medianHoldTime ?? 0).toFixed(1)}h</b>`);
    // Changed % Trades to % Swaps
    lines.push(`• % Swaps Under 1h: <b>${((metrics.percentTradesUnder1Hour ?? 0) * 100).toFixed(1)}%</b>`); 
    lines.push(`• % Swaps Under 4h: <b>${((metrics.percentTradesUnder4Hours ?? 0) * 100).toFixed(1)}%</b>`); 

    return lines.join('\n');
}

/**
 * Generates a detailed HTML report for advanced trading statistics for Telegram.
 * @param walletAddress - The wallet address.
 * @param stats - The advanced trade statistics.
 * @returns HTML string report.
 */
export function generateDetailedAdvancedStatsHtmlTelegram(walletAddress: string, stats: AdvancedTradeStats | null | undefined): string {
    if (!stats) {
        return `<b>📈 Advanced Trading Statistics for <code>${walletAddress}</code></b>\n⚠️ No advanced statistics data available to generate a detailed report.`;
    }
    const lines: string[] = [];
    
    lines.push(`<b>📈 Advanced Trading Statistics for <code>${walletAddress}</code></b>`);
    if (stats.firstTransactionTimestamp && stats.lastTransactionTimestamp) {
        lines.push(`<i>Data from: ${formatTimestamp(stats.firstTransactionTimestamp)} to ${formatTimestamp(stats.lastTransactionTimestamp)}</i>`);
    }
    lines.push(`<i>Generated: ${new Date().toLocaleString()}</i>\n`);
    
    // Core Statistics
    lines.push('<b>Core Statistics:</b>');
    lines.push(`• Median PnL per Token: <b>${formatSolAmount(stats.medianPnlPerToken ?? 0, 2)} SOL</b>`);
    lines.push(`• Trimmed Mean PnL: <b>${formatSolAmount(stats.trimmedMeanPnlPerToken ?? 0, 2)} SOL</b>`);
    lines.push(`• Token Win Rate: <b>${formatNumber(stats.tokenWinRatePercent ?? 0, 1)}%</b>`);
    lines.push(`• Standard Deviation: <b>${formatSolAmount(stats.standardDeviationPnl ?? 0, 2)} SOL</b>\n`);
    
    // Advanced Metrics
    lines.push('<b>Advanced Metrics:</b>');
    lines.push(`• Median PnL to Volatility Ratio: <b>${formatNumber(stats.medianPnlToVolatilityRatio ?? 0, 2)}</b>`);
    lines.push(`• Weighted Efficiency Score: <b>${formatNumber(stats.weightedEfficiencyScore ?? 0, 2)}</b>`);
    lines.push(`• Average PnL per Day Active: <b>${formatSolAmount(stats.averagePnlPerDayActiveApprox ?? 0, 2)} SOL</b>`);

    return lines.join('\n');
}

// --- NEW CORRELATION HTML GENERATOR FOR TELEGRAM ---

/**
 * Generates a multi-part HTML report for Telegram, summarizing wallet correlation analysis results.
 * Splits the report into multiple messages if it exceeds Telegram's message length limits.
 * @param requestedWalletsCount - The initial number of wallets requested for analysis.
 * @param analyzedWalletsCount - The number of wallets actually analyzed after filtering.
 * @param botFilteredCount - The number of wallets filtered out due to suspected bot activity.
 * @param walletPnLs - A map of wallet addresses to their calculated PnL.
 * @param globalTokenStats - Statistics about token distribution.
 * @param identifiedClusters - An array of identified wallet clusters.
 * @param topCorrelatedPairs - An array of top correlated wallet pairs.
 * @param processingStats - Statistics about the transaction processing.
 * @param uniqueTokenCountsPerWallet - A map of wallet addresses to their unique token counts.
 * @returns An array of strings, where each string is a part of the report formatted for Telegram (HTML).
 */
export function generateCorrelationReportTelegram(
    requestedWalletsCount: number,
    analyzedWalletsCount: number,
    botFilteredCount: number,
    walletPnLs: Record<string, number>,
    globalTokenStats: GlobalTokenStats | null,
    identifiedClusters: WalletCluster[],
    topCorrelatedPairs: CorrelatedPairData[],
    processingStats: ProcessingStats, // Re-enabled
    uniqueTokenCountsPerWallet: Record<string, number>
  ): string[] {
    const messages: string[] = [];
    let currentMessageLines: string[] = [];
    const MAX_MESSAGE_LENGTH = 3800; // Telegram message length limit

    const addLine = (line: string) => currentMessageLines.push(line);
    const pushCurrentMessage = () => {
      if (currentMessageLines.length > 0) {
        messages.push(currentMessageLines.join('\n'));
        currentMessageLines = [];
      }
    };

    addLine('<b>📊 Wallet Correlation Analysis Report</b>');
    addLine(`<i>Generated: ${new Date().toLocaleString()}</i>`);
    if (processingStats.overallFirstTimestamp && processingStats.overallLastTimestamp) {
      addLine(`<i>Data from: ${formatTimestamp(processingStats.overallFirstTimestamp)} to ${formatTimestamp(processingStats.overallLastTimestamp)}</i>`);
    } else {
      addLine('<i>Data period: Not available</i>'); // Fallback if timestamps are missing
    }
    addLine('');
    addLine('<b>📋 Summary:</b>');
    addLine(`Requested for Analysis: ${requestedWalletsCount} wallets`);
    
    if (botFilteredCount > 0) {
      addLine(`Wallets Filtered (e.g., bot-like): ${botFilteredCount}`);
    }
    addLine(`Wallets Analyzed (post-filter): ${analyzedWalletsCount}`);
    if (globalTokenStats && analyzedWalletsCount > 0) {
        addLine(`Total Unique Mints (in analyzed wallets): ${globalTokenStats.totalUniqueTokens ?? 'N/A'}`);
    }
    if (processingStats && analyzedWalletsCount > 0) { // Added check for processingStats
        addLine(`Total Transactions Analyzed (post-filter): ${processingStats.totalTransactions}`);
    }
    // Ensure first message is pushed if it has content, to avoid empty initial messages
    if (currentMessageLines.length > 0) {
        pushCurrentMessage(); 
    }

    if (identifiedClusters.length > 0) {
      if (messages.length > 0 && messages[messages.length-1].trim() !== '') currentMessageLines.push(''); 
      addLine('<b>🔗 Identified Wallet Clusters (3+ members):</b>');

      identifiedClusters.forEach((cluster, index) => {
        const clusterSpecificLines: string[] = [];
        clusterSpecificLines.push(''); // Add a blank line for spacing before each cluster
        clusterSpecificLines.push(`🧲 <b>Cluster ${index + 1}:</b> (${cluster.wallets.length} wallets)`);
        clusterSpecificLines.push(`Avg Pair Score in Cluster: ${(cluster.score ?? 0).toFixed(2)}`);
        
        if (cluster.sharedNonObviousTokens) {
            clusterSpecificLines.push(`Shared Non-Obvious Tokens in Cluster: ${cluster.sharedNonObviousTokens.length}`);
        } else {
            clusterSpecificLines.push('Shared Non-Obvious Tokens in Cluster: 0');
        }

        clusterSpecificLines.push('Wallets (PNL approx.):');
        cluster.wallets.forEach(walletAddr => {
            const pnl = walletPnLs[walletAddr]?.toFixed(2) ?? 'N/A';
            const uniqueTokenCount = uniqueTokenCountsPerWallet[walletAddr] ?? 0;
            clusterSpecificLines.push(`  - <code>${walletAddr}</code> (${uniqueTokenCount} unique tokens, ${pnl} SOL)`);
        });

        const tempClusterReportFragment = clusterSpecificLines.join('\n');
        // Check if adding this fragment would overflow the current message part
        if (currentMessageLines.join('\n').length + tempClusterReportFragment.length > MAX_MESSAGE_LENGTH && currentMessageLines.length > 0) {
            pushCurrentMessage(); // Push what we have so far
            // Start new message part with continued header if necessary
            if (messages.length === 0 || !messages[messages.length-1].includes('Identified Wallet Clusters')){
                 currentMessageLines.push('<b>🔗 Identified Wallet Clusters (3+ members) (continued):</b>');
            }
        }
        currentMessageLines.push(...clusterSpecificLines);
      });
    } else if (analyzedWalletsCount >= 2) {
      if (messages.length > 0 && messages[messages.length-1].trim() !== '') currentMessageLines.push(''); 
      addLine('<i>No significant clusters (3+ wallets) identified with current settings.</i>');
      addLine('<i>This means no groups of 3 or more wallets were found where pairs consistently met the minimum correlation score for clustering.</i>');
    } else if (requestedWalletsCount > 0 && analyzedWalletsCount < 2 ) {
        if (messages.length > 0 && messages[messages.length-1].trim() !== '') currentMessageLines.push(''); 
        addLine('<i>Not enough wallets remained after filtering to perform cluster analysis (need at least 2).</i>');
    } else {
      if (messages.length > 0 && messages[messages.length-1].trim() !== '') currentMessageLines.push(''); 
      addLine('<i>No wallets provided or all failed initial processing.</i>');
    }
    
    // Potentially push message before adding pairs if clusters section was large
    if (currentMessageLines.join('\n').length > MAX_MESSAGE_LENGTH - 500) { // Check before adding next section title
        pushCurrentMessage();
    }

    if (topCorrelatedPairs.length > 0) {
      // Start a new message part for pairs if the current one is too full or to ensure the header is with its content
      if (currentMessageLines.join('\n').length > MAX_MESSAGE_LENGTH - 500 && currentMessageLines.length > 0) { 
        pushCurrentMessage();
      }
      if (messages.length > 0 && messages[messages.length-1].trim() !== '' && currentMessageLines.length === 0) currentMessageLines.push(''); // Add separator if starting new message for pairs
      
      let pairsHeaderAdded = false;
      topCorrelatedPairs.forEach((pair, index) => {
        if (!pairsHeaderAdded) {
            addLine('<b>✨ Top Correlated Wallet Pairs:</b>');
            pairsHeaderAdded = true;
        }
        const pairLines: string[] = [];
        const pnlA = walletPnLs[pair.walletA_address]?.toFixed(2) ?? 'N/A';
        const pnlB = walletPnLs[pair.walletB_address]?.toFixed(2) ?? 'N/A';
        const uniqueTokensA = uniqueTokenCountsPerWallet[pair.walletA_address] ?? 0;
        const uniqueTokensB = uniqueTokenCountsPerWallet[pair.walletB_address] ?? 0;

        pairLines.push(''); // Add a blank line for spacing before each pair
        pairLines.push(`Pair #${index + 1} (Score: ${(pair.score ?? 0).toFixed(2)}):`);
        pairLines.push(`  A: <code>${pair.walletA_address}</code> (PNL: ${pnlA} SOL, ${uniqueTokensA} unique tokens)`);
        pairLines.push(`  B: <code>${pair.walletB_address}</code> (PNL: ${pnlB} SOL, ${uniqueTokensB} unique tokens)`);
        
        const tempPairReportFragment = pairLines.join('\n');
        if (currentMessageLines.join('\n').length + tempPairReportFragment.length > MAX_MESSAGE_LENGTH && currentMessageLines.length > 0) {
          pushCurrentMessage();
            // Start new message part with continued header if necessary
            if (messages.length === 0 || !messages[messages.length-1].includes('Top Correlated Wallet Pairs')){
                 currentMessageLines.push('<b>✨ Top Correlated Wallet Pairs (continued):</b>');
                 pairsHeaderAdded = true; // Ensure header is marked as added for this new part
            } else {
                 pairsHeaderAdded = false; // Reset if new message doesn't start with header
            }
        }
        currentMessageLines.push(...pairLines);
      });
    }

    // Finalize last message part
    if (currentMessageLines.length > 0) {
        if (!currentMessageLines.some(line => line.includes("<i>PNL is approximate. Verify independently.</i>"))) {
            currentMessageLines.push('');
            currentMessageLines.push("<i>PNL is approximate. Verify independently.</i>");
        }
        pushCurrentMessage();
    } else if (messages.length > 0) { 
        const lastMsgIndex = messages.length - 1;
        if (!messages[lastMsgIndex].includes("<i>PNL is approximate. Verify independently.</i>")) {
            messages[lastMsgIndex] = messages[lastMsgIndex] + '\n\n' + "<i>PNL is approximate. Verify independently.</i>";
        }
    } else { // Case where no content was generated at all (e.g., no wallets analyzed)
         if (messages.length === 0 && currentMessageLines.length === 0) { // Truly empty
            currentMessageLines.push('<i>No correlation data to report.</i>');
            pushCurrentMessage();
        }
    }
    
    return messages.filter(msg => msg.trim().length > 0);
  } 