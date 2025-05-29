import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from 'core/utils/logger'; 
import { BehavioralMetrics } from '@/types/behavior'; 
import { CorrelationMetrics, GlobalTokenStats, CorrelatedPairData } from '@/types/correlation'; 
import { WalletInfo, WalletCluster } from '@/types/wallet'; 
import { ComprehensiveSimilarityResult } from 'core/analysis/similarity/similarity-service';
import { SwapAnalysisSummary, OnChainAnalysisResult, AdvancedTradeStats } from '@/types/helius-api';
import Papa from 'papaparse';
import { table, getBorderCharacters } from 'table'; // Added getBorderCharacters
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

    // Pre-calculate unique traded token counts for percentage calculation
    const uniqueTokensPerWallet: Record<string, number> = {};
    for (const addr of walletAddresses) {
        const vector = metrics.walletVectorsUsed[addr];
        if (vector) {
            // For 'capital' vector, count tokens with >0 capital. For 'binary', count tokens with presence (value=1).
            uniqueTokensPerWallet[addr] = Object.values(vector).filter(v => v > 0).length;
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
    lines.push('');

    // --- NEW: Key Insights & Potential Wallets for Review ---
    lines.push('=== Key Insights & Potential Wallets for Review ===');
    const keyInsights: string[] = [];
    const insightProcessedPairs = new Set<string>(); // To avoid duplicate insights for pairs

    // Define thresholds for insights - these can be tuned
    const INSIGHT_THRESHOLDS = {
        VERY_HIGH_SIM_CAPITAL: 0.9,
        VERY_HIGH_SIM_BINARY: 0.25, // Binary scores are often lower
        STRONG_CONCORDANCE_SIM: 0.5,
        STRONG_CONCORDANCE_PCT: 50, // A and B must both be > 50%
        ASYMMETRY_SIM: 0.4,
        ASYMMETRY_HIGH_PCT: 70,
        ASYMMETRY_LOW_PCT: 20,
    };

    for (let i = 0; i < walletAddresses.length; i++) {
        for (let j = i + 1; j < walletAddresses.length; j++) {
            const addrA = walletAddresses[i];
            const addrB = walletAddresses[j];
            const pairKey = [addrA, addrB].sort().join('|');
            if (insightProcessedPairs.has(pairKey)) continue;
            insightProcessedPairs.add(pairKey);

            const labelA = walletLabels[addrA];
            const labelB = walletLabels[addrB];

            const primarySimPair = metrics.pairwiseSimilarities.find(p =>
                (p.walletA === addrA && p.walletB === addrB) || (p.walletA === addrB && p.walletB === addrA)
            );
            const primarySim = primarySimPair?.similarityScore || 0;
            const count = metrics.sharedTokenCountsMatrix[addrA]?.[addrB] || 0;
            const uniqueA = uniqueTokensPerWallet[addrA] || 0;
            const uniqueB = uniqueTokensPerWallet[addrB] || 0;
            const pctA = uniqueA > 0 ? (count / uniqueA) * 100 : 0;
            const pctB = uniqueB > 0 ? (count / uniqueB) * 100 : 0;

            const veryHighSimThreshold = metrics.vectorTypeUsed === 'capital' ? INSIGHT_THRESHOLDS.VERY_HIGH_SIM_CAPITAL : INSIGHT_THRESHOLDS.VERY_HIGH_SIM_BINARY;
            if (primarySim >= veryHighSimThreshold) {
                keyInsights.push(`- **Very High Similarity:** ${labelA} & ${labelB} (Score: ${primarySim.toFixed(3)}, Shared: ${count}, A:${pctA.toFixed(1)}%, B:${pctB.toFixed(1)}%). Investigate further.`);
            }

            if (primarySim >= INSIGHT_THRESHOLDS.STRONG_CONCORDANCE_SIM && pctA >= INSIGHT_THRESHOLDS.STRONG_CONCORDANCE_PCT && pctB >= INSIGHT_THRESHOLDS.STRONG_CONCORDANCE_PCT) {
                keyInsights.push(`- **Strong Concordance:** ${labelA} & ${labelB} (Score: ${primarySim.toFixed(3)}, Shared: ${count} [A:${pctA.toFixed(1)}%, B:${pctB.toFixed(1)}%]). Both wallets have a significant portion of their unique token ${metrics.vectorTypeUsed === 'capital' ? 'investments' : 'interactions'} overlapping with notable similarity.`);
            }
            
            const isAsymmetricAB = pctA >= INSIGHT_THRESHOLDS.ASYMMETRY_HIGH_PCT && pctB <= INSIGHT_THRESHOLDS.ASYMMETRY_LOW_PCT;
            const isAsymmetricBA = pctB >= INSIGHT_THRESHOLDS.ASYMMETRY_HIGH_PCT && pctA <= INSIGHT_THRESHOLDS.ASYMMETRY_LOW_PCT;
            if (primarySim >= INSIGHT_THRESHOLDS.ASYMMETRY_SIM && (isAsymmetricAB || isAsymmetricBA)) {
                keyInsights.push(`- **Significant Asymmetry:** ${labelA} & ${labelB} (Score: ${primarySim.toFixed(3)}, Shared: ${count} [A:${pctA.toFixed(1)}%, B:${pctB.toFixed(1)}%]). One wallet's shared tokens are a large part of its ${metrics.vectorTypeUsed === 'capital' ? 'investments' : 'interactions'}, while for the other, it's minor, despite notable similarity.`);
            }
            
            if (pctA > 100 || pctB > 100) {
                 const walletWithOver100 = pctA > 100 ? labelA : labelB;
                 const otherWallet = pctA > 100 ? labelB : labelA;
                 const overPct = pctA > 100 ? pctA : pctB;
                 const uniqueInvestedCount = pctA > 100 ? uniqueA : uniqueB;
                 keyInsights.push(`- **Focused Investment Pattern:** For ${walletWithOver100} in pair with ${otherWallet} (Shared: ${count}, ${walletWithOver100}:${overPct.toFixed(1)}%), the ${count} shared tokens exceed its ${uniqueInvestedCount} unique capital-invested tokens. This implies ${walletWithOver100} has a very narrow capital focus, and all its capital-invested tokens are shared with ${otherWallet}, plus it trades other shared tokens without capital commitment.`);
            }
        }
    }
    if (keyInsights.length === 0) {
        lines.push('No specific key insights or outstanding pairs identified based on current criteria.');
    } else {
        lines.push(...keyInsights);
    }

    // NEW: Summarize wallets appearing in multiple key insight categories
    const walletKeyInsightCounts: Record<string, { count: number, labels: Set<string> }> = {};
    keyInsights.forEach(insight => {
        // Extract wallet labels mentioned in the insight string (this is a bit rudimentary)
        // Example insight: "- **Very High Similarity:** labelA & labelB (...)"
        const matches = insight.match(/\*\*:(.*?)&\s*(.*?)\s*\(/);
        if (matches && matches.length >= 3) {
            const walletLabelA = matches[1].trim();
            const walletLabelB = matches[2].trim();
            
            // Find original addresses for these labels to use as consistent keys
            const addrA = Object.keys(walletLabels).find(k => walletLabels[k] === walletLabelA);
            const addrB = Object.keys(walletLabels).find(k => walletLabels[k] === walletLabelB);

            if (addrA) {
                if (!walletKeyInsightCounts[addrA]) walletKeyInsightCounts[addrA] = { count: 0, labels: new Set() };
                walletKeyInsightCounts[addrA].count++;
                walletKeyInsightCounts[addrA].labels.add(insight.substring(0, insight.indexOf(':') +1 ).replace('-','').trim()); //e.g. "**Very High Similarity:**"
            }
            if (addrB) {
                if (!walletKeyInsightCounts[addrB]) walletKeyInsightCounts[addrB] = { count: 0, labels: new Set() };
                walletKeyInsightCounts[addrB].count++;
                // Avoid double counting for the same insight type if labels were extracted imperfectly
                walletKeyInsightCounts[addrB].labels.add(insight.substring(0, insight.indexOf(':') +1 ).replace('-','').trim()); 
            }
        }
    });

    const multiInsightWallets: string[] = [];
    Object.entries(walletKeyInsightCounts).forEach(([addr, data]) => {
        if (data.labels.size > 1) { // Count distinct types of insights a wallet is involved in
            multiInsightWallets.push(`- Wallet ${walletLabels[addr] || addr.substring(0,8)} (${addr.substring(0,4)}...${addr.substring(addr.length-4)}) involved in ${data.labels.size} distinct key insight categories. Worth closer review.`);
        }
    });

    if (multiInsightWallets.length > 0) {
        lines.push('\n**Wallets with Multiple Key Insight Triggers:**');
        lines.push(...multiInsightWallets);
    }

    lines.push('');

    // --- 2. Top Similar Pairs (Moved Up for Prominence) ---
    lines.push(`--- Top ${Math.min(topKResults, metrics.globalMetrics.mostSimilarPairs.length)} Most Similar Pairs (Primary Score: ${metrics.vectorTypeUsed}) ---`);
    if (metrics.globalMetrics.mostSimilarPairs.length === 0) {
        lines.push('No similarity pairs found.');
    } else {
        metrics.globalMetrics.mostSimilarPairs.slice(0, topKResults).forEach((pair, index) => {
            const labelA = walletLabels[pair.walletA] || pair.walletA.substring(0,8);
            const labelB = walletLabels[pair.walletB] || pair.walletB.substring(0,8);
            lines.push(`\n#${index + 1}: ${labelA} <-> ${labelB} (Score: ${pair.similarityScore.toFixed(4)})`);

            const count = metrics.sharedTokenCountsMatrix[pair.walletA]?.[pair.walletB] || 0;
            const uniqueA = uniqueTokensPerWallet[pair.walletA] || 0;
            const uniqueB = uniqueTokensPerWallet[pair.walletB] || 0;
            const pctA = uniqueA > 0 ? (count / uniqueA) * 100 : 0;
            const pctB = uniqueB > 0 ? (count / uniqueB) * 100 : 0;
            lines.push(`  Shared Token Count: ${count} (${pctA.toFixed(1)}% of ${labelA}\'s unique ${metrics.vectorTypeUsed === 'capital' ? 'invested' : 'traded'} tokens, ${pctB.toFixed(1)}% of ${labelB}\'s)`);

            if (pair.sharedTokens && pair.sharedTokens.length > 0) {
                 lines.push(`  Top Shared Tokens (Max 5 by Weight - ${metrics.vectorTypeUsed === 'capital' ? '% of wallet capital in token' : 'presence'}):`);
                 pair.sharedTokens.slice(0, 5).forEach(t => {
                    let tokenWeightDetail = '';
                    if (metrics.vectorTypeUsed === 'capital') {
                        tokenWeightDetail = `(Capital: ${labelA}-${(t.weightA * 100).toFixed(1)}%, ${labelB}-${(t.weightB * 100).toFixed(1)}%)`;
                    } else { // Binary
                        tokenWeightDetail = `(Present for both)`;
                    }
                    lines.push(`    - ${getTokenDisplayName(t.mint)} ${tokenWeightDetail}`);
                 });
                 if(pair.sharedTokens.length > 5) lines.push('    ...');
            }
        });
    }
    lines.push('');

    // --- 3. Connection Strength Summary --- 
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
    const legendMarkers: string[] = [];

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

            let details = `(Shared: ${count} [A:${pctA.toFixed(1)}%, B:${pctB.toFixed(1)}%], Primary Sim (${metrics.vectorTypeUsed}): ${primarySim.toFixed(3)}, Jaccard Sim: ${jaccardSim.toFixed(3)})`;
            let extraMarker = '';

            // Add markers based on key insight criteria
            const veryHighSimThreshold = metrics.vectorTypeUsed === 'capital' ? INSIGHT_THRESHOLDS.VERY_HIGH_SIM_CAPITAL : INSIGHT_THRESHOLDS.VERY_HIGH_SIM_BINARY;
            if (primarySim >= veryHighSimThreshold) { extraMarker += ' *VHS*'; if (!legendMarkers.includes('*VHS*: Very High Similarity')) legendMarkers.push('*VHS*: Very High Similarity');}
            if (primarySim >= INSIGHT_THRESHOLDS.STRONG_CONCORDANCE_SIM && pctA >= INSIGHT_THRESHOLDS.STRONG_CONCORDANCE_PCT && pctB >= INSIGHT_THRESHOLDS.STRONG_CONCORDANCE_PCT) {
                extraMarker += ' *SC*'; if (!legendMarkers.includes('*SC*: Strong Concordance')) legendMarkers.push('*SC*: Strong Concordance');
            }
            const isAsymmetricAB = pctA >= INSIGHT_THRESHOLDS.ASYMMETRY_HIGH_PCT && pctB <= INSIGHT_THRESHOLDS.ASYMMETRY_LOW_PCT;
            const isAsymmetricBA = pctB >= INSIGHT_THRESHOLDS.ASYMMETRY_HIGH_PCT && pctA <= INSIGHT_THRESHOLDS.ASYMMETRY_LOW_PCT;
            if (primarySim >= INSIGHT_THRESHOLDS.ASYMMETRY_SIM && (isAsymmetricAB || isAsymmetricBA)) {
                 extraMarker += ' *SA*'; if (!legendMarkers.includes('*SA*: Significant Asymmetry')) legendMarkers.push('*SA*: Significant Asymmetry');
            }
             if (pctA > 100 || pctB > 100) {
                 extraMarker += ' *FIP*'; if (!legendMarkers.includes('*FIP*: Focused Investment Pattern (see Key Insights)')) legendMarkers.push('*FIP*: Focused Investment Pattern (see Key Insights)');
            }
            details += extraMarker;
            
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
        lines.push('No significant connections found based on current thresholds.', '\n');
    }

    if (legendMarkers.length > 0) {
        lines.push('Legend: ' + legendMarkers.join(', '));
        lines.push('');
    }

    // --- 4. Detailed Matrices ---
    // The original section 3 is now section 4
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
    lines.push(...formatMatrix(cosineMatrixForReport, walletAddresses, walletLabels, `Primary Similarity (${metrics.vectorTypeUsed} - Cosine)`, (v) => typeof v === 'number' ? v.toFixed(4) : String(v), metrics.vectorTypeUsed === 'capital' ? 0.75 : 0.2)); // Added significance threshold for primary sim
    lines.push(...formatMatrix(metrics.jaccardSimilarityMatrix, walletAddresses, walletLabels, 'Asset Overlap Similarity (Jaccard)', (v) => typeof v === 'number' ? v.toFixed(4) : String(v), 0.5)); // Added significance threshold for Jaccard

    // --- 5. Shared Token Details (Token-Centric) ---
    // The original section 4 is now section 5
    lines.push('=== Shared Token Details (Token-Centric, Post-Exclusion) ===');
    const minWalletsForSharedTokenDisplay = Math.max(2, Math.floor(walletAddresses.length / 3)); // e.g., for 10 wallets, min is 3; for 4 wallets, min is 2.
    const maxWalletsToListPerToken = 5;

    if (metrics.fullSharedTokenList && metrics.fullSharedTokenList.length > 0) {
        const significantSharedTokens = metrics.fullSharedTokenList.filter(info => info.count >= minWalletsForSharedTokenDisplay);

        if (significantSharedTokens.length > 0) {
            lines.push(`Found ${significantSharedTokens.length} tokens shared by at least ${minWalletsForSharedTokenDisplay} wallets (out of ${metrics.fullSharedTokenList.length} total shared tokens).`);
            lines.push(`(Mint Address | Shared by X Wallets | Sample Wallet Addresses (max ${maxWalletsToListPerToken}))`);
            lines.push('---'); // Corrected to --- for markdown horizontal rule
            significantSharedTokens.sort((a,b) => b.count - a.count).slice(0, 25).forEach(info => { // Show top 25 of these significant tokens
                let walletsDisplay = info.sharedByWallets.slice(0, maxWalletsToListPerToken).map(addr => walletLabels[addr] || addr.substring(0,6)).join(', ');
                if (info.sharedByWallets.length > maxWalletsToListPerToken) {
                    walletsDisplay += `, ...and ${info.sharedByWallets.length - maxWalletsToListPerToken} more`;
                }
                lines.push(`- ${info.mint} | ${info.count} Wallets | ${walletsDisplay}`);
            });
            if (significantSharedTokens.length > 25) {
                lines.push(`... and ${significantSharedTokens.length - 25} more tokens shared by at least ${minWalletsForSharedTokenDisplay} wallets.`);
            }
        } else {
            lines.push(`No tokens were found to be shared by at least ${minWalletsForSharedTokenDisplay} wallets (out of ${metrics.fullSharedTokenList.length} total shared tokens).`);
        }
    } else {
        lines.push('No tokens were found to be shared by 2 or more specified wallets after exclusions.');
    }
    lines.push('');

    // --- 5. Top Similar Pairs (Simplified - already in globalMetrics) ---
    // THIS SECTION IS MOVED UP AND RENAMED/INTEGRATED as section 2.
    // The old logic for section 5 (which was this) is removed from here.
    
    // --- Clusters (if implemented) ---
    // lines.push('--- Similarity Clusters ---');
    // if (metrics.clusters.length === 0) { lines.push('Clustering not implemented or no clusters found.'); } else { /* ... */ }
    // lines.push('');

    // --- Metrics Glossary ---
    lines.push('\n=== Metrics Glossary ===');
    lines.push('This section explains the key metrics and symbols used in this report.\n');

    lines.push('**Primary Similarity (capital):**');
    lines.push('- Measures the cosine similarity between wallets based on their *capital allocation* to different tokens. ');
    lines.push('- A score closer to 1 indicates that wallets have invested their capital proportionally in the same set of tokens.');
    lines.push('- Values range from 0 (no similarity) to 1 (identical capital distribution across shared tokens).\n');

    lines.push('**Primary Similarity (binary):**');
    lines.push('- Measures the cosine similarity between wallets based on the *presence or absence* of token trades (buys/sells).');
    lines.push('- It considers whether wallets have interacted with the same tokens, regardless of the amount traded or invested.');
    lines.push('- Values range from 0 (no common tokens traded) to 1 (traded all the same tokens).\n');

    lines.push('**Asset Overlap Similarity (Jaccard):**');
    lines.push('- Calculates the Jaccard Index based on the sets of unique tokens each wallet has interacted with (traded/held).');
    lines.push('- Formula: (Number of Shared Tokens) / (Total Number of Unique Tokens held by Either Wallet). ');
    lines.push('- A score closer to 1 means a higher proportion of their total unique tokens are shared. Ranges from 0 to 1.\n');

    lines.push('**Shared: X [A:Y%, B:Z%]** (in Connection Strength Summary & Top Pairs): ');
    lines.push('- `X`: The absolute number of unique tokens shared between Wallet A and Wallet B (based on the vector type context - capital or binary interaction).');
    lines.push('- `A:Y%`: The `X` shared tokens represent `Y%` of Wallet A\'s total unique tokens (for which it has capital allocated if \'capital\' type, or interacted with if \'binary\' type). Formula: (X / Wallet A\'s Unique Tokens) * 100.');
    lines.push('- `B:Z%`: Similarly, the `X` shared tokens represent `Z%` of Wallet B\'s total unique tokens. Formula: (X / Wallet B\'s Unique Tokens) * 100.');
    lines.push('- *Why >100%?* If a wallet (e.g., B) has \`Z% > 100%\` (like \`B:200.0%\`), it means the number of shared tokens \`X\` is greater than the number of unique tokens Wallet B has *capital invested in* (for \'capital\' type reports). This occurs when Wallet B has a very narrow capital focus (e.g., invested in only 3 unique tokens), and *all* of those are shared with Wallet A. Additionally, Wallet B might have interacted with other tokens (bringing the shared count \`X\` up) without committing capital to them, and these additional interactions are also shared with A. It signals a strong overlap where Wallet B\'s core capital strategy is entirely contained within its shared activity with A, plus some extra non-capital shared interactions.\n');

    lines.push('**Token Weights (in Top Similar Pairs for `capital` type):**');
    lines.push('- Example: `(Capital: WalletA-WW.W%, WalletB-XX.X%)` for a shared token.');
    lines.push('- `WalletA-WW.W%`: Indicates that this specific shared token constitutes WW.W% of Wallet A\'s *total capital analyzed* in the report.');
    lines.push('- This helps understand if a high similarity score is driven by a few tokens where both wallets have significant capital concentration.\n');

    lines.push('**Insight Markers (in Connection Strength Summary):**');
    lines.push('- `*VHS* (Very High Similarity):` Primary similarity score meets a high threshold (e.g., >0.9 capital, >0.25 binary).');
    lines.push('- `*SC* (Strong Concordance):` High primary similarity AND shared tokens are a significant percentage of *both* wallets\' unique activities.');
    lines.push('- `*SA* (Significant Asymmetry):` Notable primary similarity, but shared tokens are a large part of one wallet\'s activity and minor for the other.');
    lines.push('- `*FIP* (Focused Investment Pattern):` Number of shared tokens exceeds a wallet\'s unique capital-invested tokens (see explanation for `A:Y%, B:Z% >100%` above).\n');

    lines.push('**Table Value Highlighting:**');
    lines.push('- `*` (asterisk next to a value in a matrix): Indicates the value meets or exceeds a pre-defined significance threshold for that particular metric (e.g., Primary Similarity > 0.75). Helps to quickly spot potentially important scores in large tables.\n');

    lines.push('=== END REPORT ===');
    return lines.join('\n');
}

/**
 * Utility function to format a matrix for reporting.
 * (Copied from original script - keep as internal helper or move to shared utils)
 */
function formatMatrix(
    matrix: Record<string, Record<string, number | string>>, 
    walletOrder: string[], 
    labels: Record<string, string>, 
    title: string, 
    valueFormatter: (val: number | string) => string,
    significanceThreshold?: number // Optional threshold for marking values
): string[] {
    const MAX_WALLETS_FOR_FULL_MATRIX = 15;
    if (walletOrder.length > MAX_WALLETS_FOR_FULL_MATRIX) {
        return [`=== ${title} ===`, `\nFull matrix omitted for brevity as number of wallets (${walletOrder.length}) > ${MAX_WALLETS_FOR_FULL_MATRIX}.\nKey relationships are in 'Connection Strength Summary' and 'Top Similar Pairs'.\n`]; // Corrected: Removed trailing escaped backtick
    }

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
                let formattedValue = valueFormatter(value);
                if (significanceThreshold !== undefined && typeof value === 'number' && value >= significanceThreshold) {
                    formattedValue += '*'; // Mark significant values
                }
                row += formattedValue.padEnd(colWidth);
            }
        }
        lines.push(row);
    }
    lines.push(''); // Add space after matrix
    if (significanceThreshold !== undefined) {
        lines.push(`  (* values >= ${significanceThreshold.toFixed(2)} are marked as potentially significant)`);
        lines.push('');
    }
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
    lines.push(`## Swap P&L Report for Wallet: ${walletAddress}`);
    if (timeRange) {
        lines.push(`Time Range: ${timeRange}`);
    }
    lines.push(`Report Generated: ${new Date().toISOString()}`);
    lines.push('');

    // Overall Summary Section
    lines.push('### I. Overall P&L Summary');
    lines.push('| Metric                          | Value               |');
    lines.push('|---------------------------------|---------------------|');
    lines.push(`| Realized P&L (SOL)            | ${formatSolAmount(summary.realizedPnl)}          |`);
    lines.push(`| Unrealized P&L (SOL)          | ${formatSolAmount(summary.unrealizedPnl)}        |`);
    lines.push(`| **Net P&L (SOL)**             | **${formatSolAmount(summary.netPnl)}**         |`);
    lines.push(`| Total Volume Traded (SOL)       | ${formatSolAmount(summary.totalVolume)}         |`);
    lines.push(`| Total Fees Paid (SOL)         | ${formatSolAmount(summary.totalFees)}           |`);
    lines.push(`| Stablecoin Net Flow (SOL)     | ${formatSolAmount(summary.stablecoinNetFlow)}   |`);
    lines.push(`| Total Signatures Processed      | ${summary.totalSignaturesProcessed?.toString() || 'N/A'}         |`);
    lines.push(`| First Transaction (Overall)   | ${summary.overallFirstTimestamp ? formatDate(summary.overallFirstTimestamp) : 'N/A'} |`);
    lines.push(`| Last Transaction (Overall)    | ${summary.overallLastTimestamp ? formatDate(summary.overallLastTimestamp) : 'N/A'}  |`);
    lines.push(`| Current SOL Balance           | ${summary.currentSolBalance !== undefined ? formatSolAmount(summary.currentSolBalance) : 'N/A'} |`);
    lines.push(`| Balances Fetched At         | ${summary.balancesFetchedAt ? summary.balancesFetchedAt.toISOString() : 'N/A'} |`);
    lines.push('');

    // Advanced Trading Stats Section
    if (summary.advancedStats) {
        lines.push("### II. Advanced Statistics"); // Changed from Helius API to generic
        lines.push(`- Median P/L per Token (SOL): ${formatSolAmount(summary.advancedStats.medianPnlPerToken)}`);
        lines.push(`- Token Win Rate: ${formatNumber(summary.advancedStats.tokenWinRatePercent, 1)}%`);
        lines.push(`- Standard Deviation of P/L: ${formatSolAmount(summary.advancedStats.standardDeviationPnl)}`);
        lines.push(`- Median PnL to Volatility Ratio: ${formatNumber(summary.advancedStats.medianPnlToVolatilityRatio, 2)}`);
        lines.push(`- Weighted Efficiency Score: ${formatNumber(summary.advancedStats.weightedEfficiencyScore, 2)}`);
        lines.push(`- Average P/L per Day Active (Approx): ${formatSolAmount(summary.advancedStats.averagePnlPerDayActiveApprox)}`);
        lines.push("\n---\n");
    }

    // Per-Token P&L Details Section
    lines.push('### III. Per-Token P&L Details');
    if (summary.results && summary.results.length > 0) {
        const tokenDataHeader = [
            'Token',
            'Net P&L (SOL)',
            'Total In', 
            'Total Out', 
            'Net Change',
            'SOL Spent', 
            'SOL Recv\'d', // Corrected: removed extra 'd'
            'Fees (SOL)',
            '# In', '# Out',
            'First Swap', 'Last Swap',
            'Is Stable?', 'Preserved Val (SOL)',
            'Cur. Balance', 'Dec.', 'Balance Fetched'
        ];
        const tokenData = [tokenDataHeader];

        summary.results.forEach((r: OnChainAnalysisResult) => {
            tokenData.push([
                getTokenDisplayName(r.tokenAddress),
                formatSolAmount(r.netSolProfitLoss),
                formatTokenQuantity(r.totalAmountIn),
                formatTokenQuantity(r.totalAmountOut),
                formatTokenQuantity(r.netAmountChange),
                formatSolAmount(r.totalSolSpent),
                formatSolAmount(r.totalSolReceived),
                r.totalFeesPaidInSol ? formatSolAmount(r.totalFeesPaidInSol) : '0.00',
                r.transferCountIn.toString(),
                r.transferCountOut.toString(),
                formatDate(r.firstTransferTimestamp),
                formatDate(r.lastTransferTimestamp),
                r.isValuePreservation ? (r.preservationType || 'Yes') : 'No',
                r.isValuePreservation && r.estimatedPreservedValue ? formatSolAmount(r.estimatedPreservedValue) : 'N/A',
                r.currentUiBalanceString !== undefined 
                    ? r.currentUiBalanceString 
                    : (r.currentUiBalance !== undefined 
                        ? formatTokenQuantity(r.currentUiBalance) 
                        : (r.currentRawBalance !== undefined ? r.currentRawBalance + ' (raw)' : 'N/A')),
                r.balanceDecimals !== undefined ? r.balanceDecimals.toString() : 'N/A',
                r.balanceFetchedAt ? formatDate(Math.floor(r.balanceFetchedAt.getTime() / 1000)) : 'N/A' // Ensure it's a number (Unix timestamp in seconds)
            ]);
        });

        lines.push(table(tokenData, { border: getBorderCharacters('ramac') }));
        lines.push("\n---\n");
        // REMOVED: lines.push("Generated by Solana P/L Analyzer.");
    } else {
        lines.push('No per-token P&L data available.');
    }

    // Section IV: Current Holdings Snapshot
    lines.push('### IV. Current Holdings Snapshot');
    if (summary.balancesFetchedAt) {
        lines.push(`_(Balances as of ${summary.balancesFetchedAt.toISOString()})_`);
    }
    lines.push('');
    if (summary.currentSolBalance !== undefined) {
        lines.push(`**Current SOL Balance:** ${formatSolAmount(summary.currentSolBalance)}`);
    }
    if (summary.tokenBalances && summary.tokenBalances.length > 0) {
        lines.push('');
        lines.push('**Current Token Holdings:**');
        const holdingsDataHeader = ['Token', 'Balance', 'Mint Address'];
        const holdingsData = [holdingsDataHeader];
        summary.tokenBalances.forEach(tb => {
            holdingsData.push([
                getTokenDisplayName(tb.mint), // Assumes getTokenDisplayName can be used
                tb.uiBalanceString !== undefined ? tb.uiBalanceString : (tb.uiBalance !== undefined ? formatTokenQuantity(tb.uiBalance) : tb.balance + ' (raw)'),
                tb.mint
            ]);
        });
        lines.push(table(holdingsData, { border: getBorderCharacters('ramac') }));
    } else if (summary.currentSolBalance !== undefined) {
        lines.push('No SPL token balances found in snapshot.');
    } else {
        lines.push('No current balance snapshot available.');
    }
    lines.push("\n---\n");
    lines.push("Generated by Solana P/L Analyzer."); // Moved here

    lines.push('--- END OF P&L REPORT ---');
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

// HTML Escaping utility function
function escapeHtml(unsafe: string | number | undefined | null): string {
    if (unsafe === null || unsafe === undefined) return '';
    const str = String(unsafe);
    return str
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

/**
 * Generates a detailed HTML report for advanced trading statistics for Telegram.
 * @param walletAddress - The wallet address.
 * @param stats - The advanced trade statistics.
 * @returns HTML string report.
 */
export function generateDetailedAdvancedStatsHtmlTelegram(walletAddress: string, stats: AdvancedTradeStats | null | undefined): string {
    if (!stats) {
        return `<b>📈 Advanced Trading Statistics for <code>${escapeHtml(walletAddress)}</code></b>\n⚠️ No advanced statistics data available to generate a detailed report.`;
    }
    const lines: string[] = [];
    
    lines.push(`<b>📈 Advanced Trading Statistics for <code>${escapeHtml(walletAddress)}</code></b>`);
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
            // Apply escapeHtml to walletAddr
            clusterSpecificLines.push(`  - <code>${escapeHtml(walletAddr)}</code> (${uniqueTokenCount} unique tokens, ${pnl} SOL)`);
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
        // Apply escapeHtml to pair.walletA_address and pair.walletB_address
        pairLines.push(`  A: <code>${escapeHtml(pair.walletA_address)}</code> (PNL: ${pnlA} SOL, ${uniqueTokensA} unique tokens)`);
        pairLines.push(`  B: <code>${escapeHtml(pair.walletB_address)}</code> (PNL: ${pnlB} SOL, ${uniqueTokensB} unique tokens)`);
        
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