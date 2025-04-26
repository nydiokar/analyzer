import { createLogger } from '../utils/logger';
import { OnChainAnalysisResult, AdvancedTradeStats } from '../types/helius-api';

// Logger instance for this module
const logger = createLogger('AdvancedStatsService');

const TRIM_PERCENT = 0.10; // Trim 10% from top and bottom for trimmed mean
const WIN_THRESHOLD_SOL = 0; // Minimum SOL P/L to count as a "win"

/**
 * Calculates the standard deviation of a list of numbers.
 * @param values Array of numbers
 * @returns Standard deviation, or 0 if fewer than 2 values
 */
function calculateStandardDeviation(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (n - 1); // Sample standard deviation
  return Math.sqrt(variance);
}

/**
 * Calculates various advanced trading statistics based on per-token P/L results.
 * @param results Array of OnChainAnalysisResult from the core analysis
 * @returns AdvancedTradeStats object or null if insufficient data
 */
export function calculateAdvancedStats(
  results: OnChainAnalysisResult[]
): AdvancedTradeStats | null {
  if (!results || results.length === 0) {
    logger.warn('Cannot calculate advanced stats: No analysis results provided.');
    return null;
  }

  const pnlValues = results.map(r => r.netSolProfitLoss).sort((a, b) => a - b);
  const n = pnlValues.length;

  // --- Basic Metrics ---
  const totalTokens = n;
  const overallNetPnl = pnlValues.reduce((sum, pnl) => sum + pnl, 0);

  // --- Median PnL (calculated on NON-ZERO PnLs only) ---
  const nonZeroPnlValues = pnlValues.filter(pnl => pnl !== 0);
  const nz_n = nonZeroPnlValues.length;
  let medianPnlPerToken: number = 0; // Default to 0 if no non-zero PnLs
  if (nz_n > 0) {
    if (nz_n % 2 === 0) {
      // Need to re-sort nonZeroPnlValues as filter doesn't preserve order relative to each other
      nonZeroPnlValues.sort((a, b) => a - b);
      const mid1 = nonZeroPnlValues[nz_n / 2 - 1];
      const mid2 = nonZeroPnlValues[nz_n / 2];
      medianPnlPerToken = (mid1 + mid2) / 2;
    } else {
      // Sort is only needed if length is even, but doesn't hurt here
      nonZeroPnlValues.sort((a, b) => a - b);
      medianPnlPerToken = nonZeroPnlValues[Math.floor(nz_n / 2)];
    }
  } else {
      logger.info('Median PnL is 0 because no tokens with non-zero P/L were found after filtering.');
  }

  // --- Trimmed Mean PnL (uses original pnlValues) ---
  const trimCount = Math.floor(n * TRIM_PERCENT);
  let trimmedMeanPnlPerToken = 0;
  if (n > trimCount * 2) {
    const trimmedPnlValues = pnlValues.slice(trimCount, n - trimCount);
    trimmedMeanPnlPerToken = trimmedPnlValues.reduce((sum, pnl) => sum + pnl, 0) / trimmedPnlValues.length;
  } else {
    // Not enough data to trim, use regular mean (or median?) - let's use regular mean
    trimmedMeanPnlPerToken = n > 0 ? overallNetPnl / n : 0;
    logger.debug('Not enough data points to trim for mean PnL, using overall mean.');
  }

  // --- Token Win Rate (uses original pnlValues) ---
  const profitableTokens = pnlValues.filter(pnl => pnl > WIN_THRESHOLD_SOL).length;
  const tokenWinRatePercent = totalTokens > 0 ? (profitableTokens / totalTokens) * 100 : 0;

  // --- Standard Deviation PnL (uses original pnlValues) ---
  const standardDeviationPnl = calculateStandardDeviation(pnlValues);

  // --- Profit Consistency Index (PCI) - uses the potentially non-zero median now ---
  let profitConsistencyIndex = 0;
  if (standardDeviationPnl > 0) {
    // Use win rate as percentage (0-100)
    profitConsistencyIndex = (medianPnlPerToken * tokenWinRatePercent) / standardDeviationPnl;
  } else {
    // Handle edge case: If StdDev is 0, all PnLs are the same.
    // Assign based on the potentially non-zero median PnL now.
    profitConsistencyIndex = medianPnlPerToken > WIN_THRESHOLD_SOL ? Infinity : (medianPnlPerToken < WIN_THRESHOLD_SOL ? -Infinity : 0); 
    logger.debug('Standard deviation is 0, PCI assigned based on median PnL.');
  }

  // --- Weighted Efficiency Score ---
  // Score = (Net PnL / Total Tokens Swapped) * log(1 + Win Rate %)
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
      if (durationDays > 0) { // Avoid division by zero for same-day activity
          totalDaysActive += durationDays;
          tokensWithDuration++;
      }
    }
  });
  const averageDaysActive = tokensWithDuration > 0 ? totalDaysActive / tokensWithDuration : 0;
  const averagePnlPerToken = totalTokens > 0 ? overallNetPnl / totalTokens : 0;
  const averagePnlPerDayActiveApprox = averageDaysActive > 0
      ? averagePnlPerToken / averageDaysActive
      : 0; // Or assign based on PnL if duration is zero?

  logger.info('Calculated advanced trading stats.');

  return {
    medianPnlPerToken,
    trimmedMeanPnlPerToken,
    tokenWinRatePercent,
    standardDeviationPnl,
    profitConsistencyIndex,
    weightedEfficiencyScore,
    averagePnlPerDayActiveApprox,
  };
} 