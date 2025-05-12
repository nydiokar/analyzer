import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../utils/logger'; // Adjust path as needed
import { BehavioralMetrics } from '../../types/behavior'; // Adjust path as needed
import { CorrelationMetrics, CorrelatedPairData } from '../../types/correlation'; // Added Correlation types
import { SimilarityMetrics, WalletSimilarity } from '../../types/similarity'; // Added Similarity types
import { WalletInfo } from '../../types/wallet'; // Added WalletInfo

const logger = createLogger('ReportUtils');

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
 * Generates a formatted markdown report summarizing wallet similarity metrics.
 *
 * @param metrics - The calculated SimilarityMetrics object.
 * @param walletInfos - Array of WalletInfo for labels.
 * @returns A string containing the formatted report.
 */
export function generateSimilarityReport(
    metrics: SimilarityMetrics,
    walletInfos: WalletInfo[]
): string {
    logger.debug(`Generating similarity report for ${walletInfos.length} wallets.`);
    const lines: string[] = [];
    const topKResults = 10; // Show top 10 most similar pairs
    const walletLabels: Record<string, string> = {};
    walletInfos.forEach(w => { walletLabels[w.address] = w.label || w.address.substring(0, 8); });

    lines.push('=== WALLET SIMILARITY REPORT ===');
    lines.push(`Generated on: ${new Date().toISOString()}`);
    lines.push(`Wallets Analyzed: ${walletInfos.length}`);
    lines.push(`Average Pairwise Similarity: ${metrics.globalMetrics.averageSimilarity.toFixed(4)}`);
    lines.push('');

    // Clusters (if implemented)
    lines.push('--- Similarity Clusters ---');
    if (metrics.clusters.length === 0) {
        lines.push('Clustering not implemented or no clusters found.');
    } else {
        // Add cluster reporting logic here if SimilarityMetrics includes populated clusters
        lines.push('(Cluster reporting logic TBD)');
    }
    lines.push('');

    // Top Similar Pairs
    lines.push(`--- Top ${Math.min(topKResults, metrics.pairwiseSimilarities.length)} Most Similar Pairs ---`);
    if (metrics.pairwiseSimilarities.length === 0) {
        lines.push('No similarity pairs found.');
    } else {
        metrics.globalMetrics.mostSimilarPairs.slice(0, topKResults).forEach((pair, index) => {
            const labelA = walletLabels[pair.walletA] || pair.walletA.substring(0,8);
            const labelB = walletLabels[pair.walletB] || pair.walletB.substring(0,8);
            lines.push(`
#${index + 1}: ${labelA} <-> ${labelB} (Score: ${pair.similarityScore.toFixed(4)})`);
            // Optionally list top shared tokens contributing to similarity
            if (pair.sharedTokens && pair.sharedTokens.length > 0) {
                 lines.push(`  Top Shared Tokens (Max 5):`);
                 pair.sharedTokens.slice(0, 5).forEach(t => {
                    lines.push(`    - ${t.mint} (Weight A: ${t.weightA.toFixed(3)}, B: ${t.weightB.toFixed(3)})`);
                 });
                 if(pair.sharedTokens.length > 5) lines.push('    ...');
            }
        });
    }
    lines.push('');

    lines.push('=== END REPORT ===');
    return lines.join('\n');
}

/**
 * Saves the generated report content to a file.
 *
 * @param id - Identifier for the report file (e.g., wallet address or 'comparative').
 * @param content - The string content of the report.
 * @param type - The type of report ('individual' or 'comparison') used for subfolder.
 * @returns The full path to the saved report file.
 */
export function saveReport(id: string, content: string, type: 'individual' | 'comparison' | 'correlation' | 'similarity' | string): string { // Extended types
    const reportsDir = path.join(process.cwd(), 'analysis_reports', type); // Use type for subfolder
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
        logger.info(`Created reports directory: ${reportsDir}`);
    }

    const safeId = id.replace(/[^a-z0-9]/gi, '_').toLowerCase(); // Sanitize ID for filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportsDir, `${safeId}_${type}_report_${timestamp}.md`); // Added timestamp

    try {
        fs.writeFileSync(reportPath, content, 'utf8');
        logger.debug(`Report saved successfully to ${reportPath}`);
        return reportPath;
    } catch (error) {
        logger.error(`Failed to save report to ${reportPath}:`, { error });
        throw error; // Re-throw the error for calling function to handle
    }
} 