import { createLogger } from 'core/utils/logger';
import { OnChainAnalysisResult, AdvancedTradeStats } from '@/types/helius-api';

// Logger instance for this module
const logger = createLogger('AdvancedStatsAnalyzer');

// Constants can be defined here or passed via config
const TRIM_PERCENT = 0.10; // Trim 10% from top and bottom for trimmed mean
const WIN_THRESHOLD_SOL = 0; // Minimum SOL P/L to count as a "win"


export class AdvancedStatsAnalyzer {

    constructor() {
        // Configuration could be passed here if needed (e.g., trim %, win threshold)
        logger.info('AdvancedStatsAnalyzer instantiated.');
    }

    /**
     * Calculates various advanced trading statistics based on per-token P/L results.
     * Handles edge cases like empty input, insufficient data for trimming, and zero standard deviation.
     * Median PnL is calculated only on tokens with non-zero PnL to avoid skewing by $0 results.
     *
     * @param results Array of OnChainAnalysisResult objects.
     * @returns An AdvancedTradeStats object containing calculated metrics,
     *          or null if the input `results` array is null or empty.
     */
    analyze(results: OnChainAnalysisResult[]): AdvancedTradeStats | null {
      if (!results || results.length === 0) {
        logger.warn('[AdvancedStatsAnalyzer] Cannot calculate advanced stats: No analysis results provided.');
        return null;
      }

      let overallFirstTimestamp: number | undefined = undefined;
      let overallLastTimestamp: number | undefined = undefined;

      results.forEach(r => {
        if (r.firstTransferTimestamp) {
          if (overallFirstTimestamp === undefined || r.firstTransferTimestamp < overallFirstTimestamp) {
            overallFirstTimestamp = r.firstTransferTimestamp;
          }
        }
        if (r.lastTransferTimestamp) {
          if (overallLastTimestamp === undefined || r.lastTransferTimestamp > overallLastTimestamp) {
            overallLastTimestamp = r.lastTransferTimestamp;
          }
        }
      });

      const pnlValues = results.map(r => r.netSolProfitLoss).sort((a, b) => a - b);
      const n = pnlValues.length;

      // --- Basic Metrics ---
      const totalTokens = n;
      const overallNetPnl = pnlValues.reduce((sum, pnl) => sum + pnl, 0);

      // --- Median PnL (calculated on NON-ZERO PnLs only) ---
      const nonZeroPnlValues = pnlValues.filter(pnl => pnl !== 0);
      const nz_n = nonZeroPnlValues.length;
      logger.debug(`[AdvancedStatsAnalyzer] Median PnL Calc: Found ${nz_n} tokens with non-zero PnL out of ${n} total.`); 
      let medianPnlPerToken: number = 0; // Default to 0 if no non-zero PnLs
      if (nz_n > 0) {
        nonZeroPnlValues.sort((a, b) => a - b); // Sort the non-zero values
        if (nz_n % 2 === 0) {
          const mid1 = nonZeroPnlValues[nz_n / 2 - 1];
          const mid2 = nonZeroPnlValues[nz_n / 2];
          medianPnlPerToken = (mid1 + mid2) / 2;
        } else {
          medianPnlPerToken = nonZeroPnlValues[Math.floor(nz_n / 2)];
        }
      } else {
          logger.info('[AdvancedStatsAnalyzer] Median PnL is 0 because no tokens with non-zero P/L were found.');
      }

      // --- Trimmed Mean PnL (uses original pnlValues) ---
      const trimCount = Math.floor(n * TRIM_PERCENT);
      let trimmedMeanPnlPerToken = 0;
      if (n > trimCount * 2) {
        const trimmedPnlValues = pnlValues.slice(trimCount, n - trimCount);
        trimmedMeanPnlPerToken = trimmedPnlValues.reduce((sum, pnl) => sum + pnl, 0) / trimmedPnlValues.length;
      } else {
        trimmedMeanPnlPerToken = n > 0 ? overallNetPnl / n : 0;
        logger.debug('[AdvancedStatsAnalyzer] Not enough data points to trim for mean PnL, using overall mean.');
      }

      // --- Token Win Rate (uses original pnlValues) ---
      const profitableTokens = pnlValues.filter(pnl => pnl > WIN_THRESHOLD_SOL).length;
      const tokenWinRatePercent = totalTokens > 0 ? (profitableTokens / totalTokens) * 100 : 0;

      // --- Standard Deviation PnL (uses original pnlValues) ---
      const standardDeviationPnl = this.calculateStandardDeviation(pnlValues);

      // --- Profit Consistency Index (PCI) ---
      let profitConsistencyIndex = 0;
      if (standardDeviationPnl > 0) {
        profitConsistencyIndex = (medianPnlPerToken * tokenWinRatePercent) / standardDeviationPnl;
      } else {
        profitConsistencyIndex = medianPnlPerToken > WIN_THRESHOLD_SOL ? Infinity : (medianPnlPerToken < WIN_THRESHOLD_SOL ? -Infinity : 0); 
      }

      // --- Weighted Efficiency Score ---
      const winRateDecimal = tokenWinRatePercent / 100;
      const weightedEfficiencyScore = totalTokens > 0
        ? (overallNetPnl / totalTokens) * Math.log(1 + winRateDecimal) // Using natural log
        : 0;

      // --- Average PnL Per Day Active (Proxy) ---
      let totalDaysActive = 0;
      let tokensWithDuration = 0;
      results.forEach(r => {
        if (r.lastTransferTimestamp > r.firstTransferTimestamp) {
          const durationSeconds = r.lastTransferTimestamp - r.firstTransferTimestamp;
          const durationDays = durationSeconds / (60 * 60 * 24);
          if (durationDays > 0) {
              totalDaysActive += durationDays;
              tokensWithDuration++;
          }
        }
      });
      const averageDaysActive = tokensWithDuration > 0 ? totalDaysActive / tokensWithDuration : 0;
      const averagePnlPerToken = totalTokens > 0 ? overallNetPnl / totalTokens : 0;
      const averagePnlPerDayActiveApprox = averageDaysActive > 0
          ? averagePnlPerToken / averageDaysActive
          : 0;

      logger.info('[AdvancedStatsAnalyzer] Calculated advanced trading stats.');

      return {
        medianPnlPerToken,
        trimmedMeanPnlPerToken,
        tokenWinRatePercent,
        standardDeviationPnl,
        profitConsistencyIndex,
        weightedEfficiencyScore,
        averagePnlPerDayActiveApprox,
        firstTransactionTimestamp: overallFirstTimestamp,
        lastTransactionTimestamp: overallLastTimestamp,
      };
    }

    /**
     * Calculates the sample standard deviation of a list of numbers.
     * Uses (n-1) in the denominator.
     * @param values Array of numbers.
     * @returns The sample standard deviation, or 0 if fewer than 2 values are provided.
     */
    private calculateStandardDeviation(values: number[]): number {
      const n = values.length;
      if (n < 2) return 0;

      const mean = values.reduce((sum, value) => sum + value, 0) / n;
      const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (n - 1); // Sample standard deviation
      return Math.sqrt(variance);
    }
} 