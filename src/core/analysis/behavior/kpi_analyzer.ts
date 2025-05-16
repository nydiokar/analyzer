import { BehavioralMetrics } from '@/types/behavior'; // Corrected path
import { createLogger } from 'core/utils/logger'; // Corrected path, removed Logger type

// Define WalletInfo here or import from a shared types file if it exists elsewhere
interface WalletInfo {
    address: string;
    label?: string; // Optional friendly name
}

export class KPIComparisonAnalyzer {
    private logger; // Let TS infer type

    constructor() {
        this.logger = createLogger('KPIComparisonAnalyzer');
        this.logger.info('KPIComparisonAnalyzer instantiated');
    }

    /**
     * Generate a report comparing multiple wallets' trading metrics.
     *
     * Creates a formatted report with markdown-style tables comparing all
     * major trading KPIs across wallets. Includes sections for:
     * - Trading style classification
     * - Buy/sell patterns with token-level symmetry
     * - Trading time distribution
     * - Activity summary
     * - Key insights with automated identification of notable patterns
     *
     * @param walletMetrics - Array of objects containing wallet info and calculated metrics
     * @returns Formatted string containing the complete comparative report
     */
    public generateComparisonReport(walletMetrics: Array<{ wallet: WalletInfo, metrics: BehavioralMetrics }>): string {
        this.logger.debug(`Generating comparison report for ${walletMetrics.length} wallets.`);
        const lines = [
            '=== COMPARATIVE WALLET BEHAVIOR ANALYSIS ===',
            `Generated on: ${new Date().toISOString()}`,
            `Wallets analyzed: ${walletMetrics.length}`,
            '',
            '=== TRADING STYLE CLASSIFICATION ===',
            '',
        ];

        // Table header for trading styles
        lines.push('| Wallet | Trading Style | Confidence | Flipper Score | Avg Hold Time | Median Hold Time | % Under 1h |');
        lines.push('|--------|--------------|------------|---------------|---------------|-----------------|------------|');

        // Table rows for each wallet
        for (const { wallet, metrics } of walletMetrics) {
            const walletId = wallet.label || wallet.address.substring(0, 8);
            lines.push(
                `| ${walletId} | ${metrics.tradingStyle} | ${(metrics.confidenceScore * 100).toFixed(1)}% | ` +
                `${metrics.flipperScore.toFixed(3)} | ${metrics.averageFlipDurationHours.toFixed(1)}h | ` +
                `${metrics.medianHoldTime.toFixed(1)}h | ${(metrics.percentTradesUnder1Hour * 100).toFixed(1)}% |`
            );
        }

        lines.push('');

        // === BUY/SELL PATTERNS ===
        lines.push('=== BUY/SELL PATTERNS ===');
        lines.push('');

        // Table for buy/sell patterns
        lines.push('| Wallet | Token-Level Symmetry | Buy:Sell Ratio | Sequence Consistency | Complete Pairs |');
        lines.push('|--------|----------------------|----------------|----------------------|----------------|');

        for (const { wallet, metrics } of walletMetrics) {
            const walletId = wallet.label || wallet.address.substring(0, 8);
            lines.push(
                `| ${walletId} | ${(metrics.buySellSymmetry * 100).toFixed(1)}% | ` +
                `${metrics.buySellRatio === Infinity ? 'INF' : metrics.buySellRatio.toFixed(2)}:1 | ` +
                `${(metrics.sequenceConsistency * 100).toFixed(1)}% | ` +
                `${metrics.completePairsCount}/${metrics.tokensWithBothBuyAndSell} |`
            );
        }

        lines.push('');

        // === TRADING TIME DISTRIBUTION ===
        lines.push('=== TRADING TIME DISTRIBUTION ===');
        lines.push('');

        // Table for trading windows (more granular now)
        lines.push('| Wallet | <30min | 30-60min | 1-4h | 4-8h | 8-24h | 1-7d | >7d |');
        lines.push('|--------|--------|----------|------|------|-------|------|-----|');

        for (const { wallet, metrics } of walletMetrics) {
            const walletId = wallet.label || wallet.address.substring(0, 8);
            lines.push(
                `| ${walletId} | ${(metrics.tradingTimeDistribution.ultraFast * 100).toFixed(1)}% | ` +
                `${(metrics.tradingTimeDistribution.veryFast * 100).toFixed(1)}% | ` +
                `${(metrics.tradingTimeDistribution.fast * 100).toFixed(1)}% | ` +
                `${(metrics.tradingTimeDistribution.moderate * 100).toFixed(1)}% | ` +
                `${(metrics.tradingTimeDistribution.dayTrader * 100).toFixed(1)}% | ` +
                `${(metrics.tradingTimeDistribution.swing * 100).toFixed(1)}% | ` +
                `${(metrics.tradingTimeDistribution.position * 100).toFixed(1)}% |`
            );
        }

        lines.push('');

        // === ACTIVITY SUMMARY ===
        lines.push('=== ACTIVITY SUMMARY ===');
        lines.push('');

        // Table for activity metrics
        lines.push('| Wallet | Unique Tokens | Tokens w/ Both | Total Buys | Total Sells | Total Trades |');
        lines.push('|--------|---------------|----------------|------------|-------------|--------------|');

        for (const { wallet, metrics } of walletMetrics) {
            const walletId = wallet.label || wallet.address.substring(0, 8);
            lines.push(
                `| ${walletId} | ${metrics.uniqueTokensTraded} | ${metrics.tokensWithBothBuyAndSell} | ` +
                `${metrics.totalBuyCount} | ${metrics.totalSellCount} | ${metrics.totalTradeCount} |`
            );
        }

        lines.push('');

        // === KEY INSIGHTS ===
        lines.push('=== KEY INSIGHTS ===');
        lines.push('');

        // Look for True Flippers
        const trueFlippers = walletMetrics.filter(({ metrics }) =>
            metrics.tradingStyle === 'True Flipper' && metrics.confidenceScore > 0.7
        );

        if (trueFlippers.length > 0) {
            lines.push('TRUE FLIPPERS:');
            for (const { wallet, metrics } of trueFlippers) {
                const walletId = wallet.label || wallet.address;
                lines.push(`- ${walletId}: ${(metrics.percentTradesUnder1Hour * 100).toFixed(1)}% of trades under 1h, ` +
                    `${(metrics.buySellSymmetry * 100).toFixed(1)}% token-level symmetry`);
            }
            lines.push('');
        }

        // Look for Fast Traders
        const fastTraders = walletMetrics.filter(({ metrics }) =>
            metrics.tradingStyle === 'Fast Trader' && metrics.confidenceScore > 0.6
        );

        if (fastTraders.length > 0) {
            lines.push('FAST TRADERS:');
            for (const { wallet, metrics } of fastTraders) {
                const walletId = wallet.label || wallet.address;
                lines.push(`- ${walletId}: ${(metrics.percentTradesUnder4Hours * 100).toFixed(1)}% of trades under 4h, avg hold time ${metrics.averageFlipDurationHours.toFixed(1)}h`);
            }
            lines.push('');
        }

        // Look for Accumulators
        const accumulators = walletMetrics.filter(({ metrics }) =>
            metrics.tradingStyle === 'Accumulator' && metrics.confidenceScore > 0.6
        );

        if (accumulators.length > 0) {
            lines.push('ACCUMULATORS:');
            for (const { wallet, metrics } of accumulators) {
                const walletId = wallet.label || wallet.address;
                lines.push(`- ${walletId}: Buy/Sell ratio ${metrics.buySellRatio === Infinity ? 'INF' : metrics.buySellRatio.toFixed(2)}:1, ${metrics.tokensWithBothBuyAndSell}/${metrics.uniqueTokensTraded} tokens with both buys & sells`);
            }
            lines.push('');
        }

        // Look for Distributors
        const distributors = walletMetrics.filter(({ metrics }) =>
            metrics.tradingStyle === 'Distributor' && metrics.confidenceScore > 0.6
        );

        if (distributors.length > 0) {
            lines.push('DISTRIBUTORS:');
            for (const { wallet, metrics } of distributors) {
                const walletId = wallet.label || wallet.address;
                // Calculate sell/buy ratio for clarity
                const sellBuyRatio = metrics.buySellRatio === 0 ? Infinity : (1 / metrics.buySellRatio);
                lines.push(`- ${walletId}: Sell/Buy ratio ${sellBuyRatio === Infinity ? 'INF' : sellBuyRatio.toFixed(2)}:1, ${metrics.tokensWithBothBuyAndSell}/${metrics.uniqueTokensTraded} tokens with both buys & sells`);
            }
            lines.push('');
        }
        
        // Add other insight sections if needed (e.g., Swing Traders, Position Traders)

        lines.push('=== END COMPARISON ===');

        return lines.join('\n');
    }
} 