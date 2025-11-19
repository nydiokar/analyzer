import { BehaviorAnalysisConfig } from '@/types/analysis';
import { BehavioralMetrics, ActiveTradingPeriods, IdentifiedTradingWindow, WalletHistoricalPattern, TokenPositionLifecycle, WalletTokenPrediction } from '@/types/behavior';
import { SwapAnalysisInput } from '@prisma/client';
import { createLogger } from 'core/utils/logger';
import { classifyHolderBehavior, classifyTradingSpeed } from './constants';

// List of common utility token mints to exclude from behavioral analysis
const EXCLUDED_TOKEN_MINTS: string[] = [
  'So11111111111111111111111111111111111111112', // SOL / wSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  // Add other quasi-native or stablecoin mints here if needed (e.g., JitoSOL, mSOL, other stables)
];

// Create logger at module level? Or pass instance?
// Let's keep it internal to the class for now.

// --- Internal Types specific to this analyzer ---
interface TokenTrade {
  timestamp: number;
  direction: 'in' | 'out';
  amount: number;
  associatedSolValue: number;
  associatedUsdcValue?: number; // Optional since some trades might not have USDC value
}

interface TokenTradeSequence {
  mint: string;
  trades: TokenTrade[];
  buyCount: number;
  sellCount: number;
  completePairs: number;
  buySellRatio: number;
}

// --- Analyzer Class ---
export class BehaviorAnalyzer {
  private config: BehaviorAnalysisConfig;
  private logger;

  constructor(config: BehaviorAnalysisConfig) {
    this.config = config;
    this.logger = createLogger('BehaviorAnalyzer');
    this.logger.debug('BehaviorAnalyzer instantiated with behavior-specific config.');
  }

  /**
   * Public method to analyze trading behavior from raw swap records.
   * Orchestrates the internal steps of sequence building, metric calculation, and classification.
   * 
   * @param swapRecords - Array of SwapAnalysisInput records for the wallet.
   * @returns BehavioralMetrics object.
   */
  public analyze(
    rawSwapRecords: SwapAnalysisInput[],
    walletAddress: string,
    historicalPatternRecords?: SwapAnalysisInput[],
  ): BehavioralMetrics {
    this.logger.debug(`Starting behavior analysis for wallet ${walletAddress} with ${rawSwapRecords.length} raw swap records.`);

    // Filter out records involving excluded tokens FIRST
    const swapRecords = rawSwapRecords.filter(
      record => !EXCLUDED_TOKEN_MINTS.includes(record.mint)
    );
    this.logger.debug(`Filtered down to ${swapRecords.length} swap records after excluding utility tokens.`);

    let firstTransactionTimestamp: number | undefined = undefined;
    let lastTransactionTimestamp: number | undefined = undefined;

    if (swapRecords.length === 0) {
      this.logger.warn('No swap records provided to analyze, returning empty metrics.');
      return this.getEmptyMetrics(); // Empty metrics won't have timestamps
    }

    // Calculate min/max timestamps from the records used for analysis
    firstTransactionTimestamp = Math.min(...swapRecords.map(r => r.timestamp));
    lastTransactionTimestamp = Math.max(...swapRecords.map(r => r.timestamp));
    
    // 1. Build token sequences
    const tokenSequences = this.buildTokenSequences(swapRecords);
    
    // 2. Calculate core behavioral metrics
    const metrics = this.calculateBehavioralMetrics(tokenSequences);

    // Calculate risk metrics directly from swapRecords
    let totalSolValue = 0;
    let largestTxnValue = 0;
    swapRecords.forEach(record => {
      const value = record.associatedSolValue ?? 0;
      totalSolValue += value;
      if (value > largestTxnValue) {
        largestTxnValue = value;
      }
    });
    metrics.riskMetrics.averageTransactionValueSol = metrics.totalTradeCount > 0 ? totalSolValue / metrics.totalTradeCount : 0;
    metrics.riskMetrics.largestTransactionValueSol = largestTxnValue;
    
    // Calculate trading frequency
    if (metrics.totalTradeCount > 0 && firstTransactionTimestamp && lastTransactionTimestamp && lastTransactionTimestamp >= firstTransactionTimestamp) {
      const wallClockDurationSeconds = lastTransactionTimestamp - firstTransactionTimestamp;
      // actualDurationDays can be 0 if first and last timestamp are the same.
      let actualDurationDays = wallClockDurationSeconds / (60 * 60 * 24);

      // For tradesPerDay:
      // If activity spans less than a day (i.e., actualDurationDays < 1),
      // normalizationDaysForTpd becomes 1. So, tradesPerDay effectively becomes totalTradeCount.
      // If activity spans more than a day, tradesPerDay is totalTradeCount / actualDurationDays.
      const normalizationDaysForTpd = Math.max(1.0, actualDurationDays);
      metrics.tradingFrequency.tradesPerDay = metrics.totalTradeCount / normalizationDaysForTpd;
      
      // For rate calculations (week/month), ensure we don't divide by zero if actualDurationDays is 0.
      // Use a minimum of 1 minute (in days) for the denominator if actualDurationDays is 0.
      // This handles cases like a single trade, or multiple trades at the exact same timestamp.
      const minRateCalculationDurationDays = (actualDurationDays === 0) 
        ? (1 / (24 * 60)) // 1 minute in days
        : actualDurationDays;

      // For tradesPerWeek:
      // Always calculate the weekly rate based on the observed duration.
      metrics.tradingFrequency.tradesPerWeek = (metrics.totalTradeCount / minRateCalculationDurationDays) * 7;

      // For tradesPerMonth:
      const daysInAverageMonth = 30.4375;
      // Always calculate the monthly rate based on the observed duration.
      metrics.tradingFrequency.tradesPerMonth = (metrics.totalTradeCount / minRateCalculationDurationDays) * daysInAverageMonth;
    }

    // Calculate session metrics
    const sessionMetrics = this.calculateSessionMetrics(swapRecords);
    metrics.sessionCount = sessionMetrics.sessionCount;
    metrics.avgTradesPerSession = sessionMetrics.avgTradesPerSession;
    metrics.activeTradingPeriods = sessionMetrics.activeTradingPeriods;
    metrics.averageSessionStartHour = sessionMetrics.averageSessionStartHour;
    metrics.averageSessionDurationMinutes = sessionMetrics.averageSessionDurationMinutes;

    // 3. Calculate historical pattern from completed positions ONLY
    // This must happen BEFORE classifyTradingStyle() which depends on it
    const patternRecords = historicalPatternRecords && historicalPatternRecords.length > 0
      ? historicalPatternRecords
      : rawSwapRecords;
    metrics.historicalPattern = this.calculateHistoricalPattern(patternRecords, walletAddress);

    if (metrics.historicalPattern) {
      this.logger.debug(
        `Historical pattern calculated: ${metrics.historicalPattern.completedCycleCount} completed cycles, ` +
        `median: ${metrics.historicalPattern.medianCompletedHoldTimeHours.toFixed(2)}h, ` +
        `weighted avg: ${metrics.historicalPattern.historicalAverageHoldTimeHours.toFixed(2)}h, ` +
        `type: ${metrics.historicalPattern.behaviorType}`
      );
    } else {
      this.logger.debug('Historical pattern could not be calculated (insufficient completed cycles)');
    }

    // 4. Classify trading style based on revised criteria (uses historicalPattern if available)
    this.classifyTradingStyle(metrics);

    // Add timestamps to the final metrics object
    metrics.firstTransactionTimestamp = firstTransactionTimestamp;
    metrics.lastTransactionTimestamp = lastTransactionTimestamp;
    
    this.logger.debug('Completed behavior analysis orchestration.');
    return metrics;
  }

  /**
   * Calculate historical pattern from completed token positions only.
   * This provides a clean baseline for predicting future behavior.
   *
   * @param swapRecords - Array of SwapAnalysisInput records for the wallet
   * @param walletAddress - Wallet address for the pattern
   * @returns WalletHistoricalPattern or null if insufficient data
   */
  public calculateHistoricalPattern(
    rawSwapRecords: SwapAnalysisInput[],
    walletAddress: string
  ): WalletHistoricalPattern | null {
    this.logger.debug(`Calculating historical pattern for wallet ${walletAddress}`);

    // Filter out excluded tokens
    const swapRecords = rawSwapRecords.filter(
      record => !EXCLUDED_TOKEN_MINTS.includes(record.mint)
    );

    if (swapRecords.length === 0) {
      this.logger.warn('No swap records after filtering, cannot calculate historical pattern.');
      return null;
    }

    // Build token sequences and lifecycles
    const tokenSequences = this.buildTokenSequences(swapRecords);
    const latestTimestamp = Math.max(...swapRecords.map(r => r.timestamp));
    const analysisTimestamp = latestTimestamp + 3600; // Add 1 hour buffer
    const lifecycles = this.buildTokenLifecycles(tokenSequences, analysisTimestamp);

    // Filter to completed positions only (EXITED ONLY, not DUST)
    // DUST tokens (≤5% remaining) are often incomplete data (missing historical buys)
    // and would corrupt the weighted average calculation
    const completedLifecycles = lifecycles.filter(
      lc => lc.positionStatus === 'EXITED'
    );

    // Get config thresholds
    const minCompletedCycles = this.config.historicalPatternConfig?.minimumCompletedCycles ?? 3;
    const maxDataAgeDays = this.config.historicalPatternConfig?.maximumDataAgeDays ?? 90;
    const maxDataAgeSeconds = maxDataAgeDays * 24 * 60 * 60;

    // Filter by data age if configured
    const filteredLifecycles = maxDataAgeDays > 0
      ? completedLifecycles.filter(lc => {
          const age = analysisTimestamp - lc.entryTimestamp;
          return age <= maxDataAgeSeconds;
        })
      : completedLifecycles;

    // Check if we have enough data
    if (filteredLifecycles.length < minCompletedCycles) {
      this.logger.debug(
        `Insufficient completed cycles (${filteredLifecycles.length}/${minCompletedCycles}) for reliable pattern.`
      );
      return null;
    }

    // Additional quality check: Ensure we have meaningful hold times
    // Filter out any positions with hold times that seem corrupted (negative or impossibly long)
    // Allow times as low as 1 second (0.000278 hours) - important for bot detection!
    const MIN_VALID_HOLD_HOURS = 0.0001; // ~0.36 seconds minimum (prevents true zero/corruption)
    const MAX_VALID_HOLD_HOURS = 18760; // 1 year maximum

    let filteredOutCount = 0;
    const validLifecycles = filteredLifecycles.filter(lc => {
      const isValid = lc.weightedHoldingTimeHours >= MIN_VALID_HOLD_HOURS && lc.weightedHoldingTimeHours < MAX_VALID_HOLD_HOURS;
      if (!isValid) {
        filteredOutCount++;
      }
      return isValid;
    });

    // Log aggregated filter results (instead of spamming per-token)
    if (filteredOutCount > 0) {
      this.logger.debug(
        `Filtered out ${filteredOutCount} tokens with invalid hold times (< ${MIN_VALID_HOLD_HOURS}h or > ${MAX_VALID_HOLD_HOURS}h)`
      );
    }

    // Re-check minimum after filtering invalid data
    if (validLifecycles.length < minCompletedCycles) {
      this.logger.debug(
        `Insufficient valid cycles after quality filtering (${validLifecycles.length}/${minCompletedCycles}).`
      );
      return null;
    }

    // Calculate weighted average holding time
    let totalWeightedDuration = 0;
    let totalWeight = 0;

    for (const lc of filteredLifecycles) {
      // Use peak position as weight (more significant positions have more influence)
      const weight = lc.peakPosition;
      totalWeightedDuration += lc.weightedHoldingTimeHours * weight;
      totalWeight += weight;
    }

    const historicalAverageHoldTimeHours = totalWeight > 0
      ? totalWeightedDuration / totalWeight
      : 0;

    // ✅ FIX: Aggregate lifecycles by TOKEN first, then calculate wallet-level median
    // Group lifecycles by token mint
    const lifecyclesByToken = new Map<string, typeof filteredLifecycles>();
    for (const lc of filteredLifecycles) {
      if (!lifecyclesByToken.has(lc.mint)) {
        lifecyclesByToken.set(lc.mint, []);
      }
      lifecyclesByToken.get(lc.mint)!.push(lc);
    }

    // Calculate per-token median hold time (ONE value per token)
    const perTokenHoldTimes: number[] = [];
    for (const [mint, tokenLifecycles] of lifecyclesByToken.entries()) {
      const tokenDurations = tokenLifecycles.map(lc => lc.weightedHoldingTimeHours);
      const tokenMedian = this.calculateMedian(tokenDurations);
      perTokenHoldTimes.push(tokenMedian);
    }

    // Calculate wallet-level median across tokens (NOT across all lifecycles)
    const medianCompletedHoldTimeHours = this.calculateMedian(perTokenHoldTimes);

    // Also calculate distribution based on per-token medians (not all lifecycles)
    const sortedDurations = perTokenHoldTimes.sort((a, b) => a - b);

    // Calculate hold time distribution for insights
    const distribution = {
      instant: sortedDurations.filter(d => d < 0.0001).length,      // <0.36 seconds (same tx)
      ultraFast: sortedDurations.filter(d => d >= 0.0001 && d < 1/60).length,  // <1min
      fast: sortedDurations.filter(d => d >= 1/60 && d < 5/60).length,         // 1-5min
      momentum: sortedDurations.filter(d => d >= 5/60 && d < 0.5).length,      // 5-30min
      intraday: sortedDurations.filter(d => d >= 0.5 && d < 4).length,         // 30min-4h
      day: sortedDurations.filter(d => d >= 4 && d < 24).length,               // 4-24h
      swing: sortedDurations.filter(d => d >= 24 && d < 168).length,           // 1-7d
      position: sortedDurations.filter(d => d >= 168).length,                  // 7+d
    };

    // Build token mapping for drilldown (which tokens are in each bucket)
    const tokenMap = {
      instant: [] as string[],
      ultraFast: [] as string[],
      fast: [] as string[],
      momentum: [] as string[],
      intraday: [] as string[],
      day: [] as string[],
      swing: [] as string[],
      position: [] as string[],
    };

    for (const [mint, tokenLifecycles] of lifecyclesByToken.entries()) {
      const tokenDurations = tokenLifecycles.map(lc => lc.weightedHoldingTimeHours);
      const tokenMedian = this.calculateMedian(tokenDurations);

      // Classify into bucket
      if (tokenMedian < 0.0001) {
        tokenMap.instant.push(mint);
      } else if (tokenMedian < 1/60) {
        tokenMap.ultraFast.push(mint);
      } else if (tokenMedian < 5/60) {
        tokenMap.fast.push(mint);
      } else if (tokenMedian < 0.5) {
        tokenMap.momentum.push(mint);
      } else if (tokenMedian < 4) {
        tokenMap.intraday.push(mint);
      } else if (tokenMedian < 24) {
        tokenMap.day.push(mint);
      } else if (tokenMedian < 168) {
        tokenMap.swing.push(mint);
      } else {
        tokenMap.position.push(mint);
      }
    }

    this.logger.debug(
      `Hold time distribution (${sortedDurations.length} tokens with ${filteredLifecycles.length} total cycles): ` +
      `instant: ${distribution.instant}, <1m: ${distribution.ultraFast}, ` +
      `1-5m: ${distribution.fast}, 5-30m: ${distribution.momentum}, ` +
      `30m-4h: ${distribution.intraday}, 4-24h: ${distribution.day}, ` +
      `1-7d: ${distribution.swing}, 7+d: ${distribution.position} | ` +
      `median: ${medianCompletedHoldTimeHours < 1 ? (medianCompletedHoldTimeHours * 60).toFixed(2) + 'min' : medianCompletedHoldTimeHours.toFixed(2) + 'h'}`
    );

    // Classify behavior type based on median completed holding time
    // Uses constants for single source of truth
    const behaviorType = classifyHolderBehavior(medianCompletedHoldTimeHours);

    // Determine exit pattern by analyzing sell distribution
    const sellPatterns = filteredLifecycles.map(lc => {
      return lc.sellCount;
    });
    const avgSellsPerToken = sellPatterns.reduce((sum, count) => sum + count, 0) / sellPatterns.length;
    const exitPattern: 'GRADUAL' | 'ALL_AT_ONCE' = avgSellsPerToken > 2 ? 'GRADUAL' : 'ALL_AT_ONCE';

    // ✅ FIX: Use token count (not lifecycle count) for metrics
    const uniqueTokenCount = perTokenHoldTimes.length;

    // Calculate data quality score (0-1)
    // Based on token count (sample size) relative to minimum required
    const sampleSizeScore = Math.min(1, uniqueTokenCount / (minCompletedCycles * 3)); // Perfect score at 3x minimum

    // Calculate observation period
    const oldestEntry = Math.min(...filteredLifecycles.map(lc => lc.entryTimestamp));
    const newestExit = Math.max(
      ...filteredLifecycles.map(lc => lc.exitTimestamp || lc.entryTimestamp)
    );
    const observationPeriodDays = (newestExit - oldestEntry) / (24 * 60 * 60);

    this.logger.debug(
      `Historical pattern calculated: ${historicalAverageHoldTimeHours.toFixed(2)}h avg, ` +
      `${uniqueTokenCount} completed tokens (${filteredLifecycles.length} total lifecycles), ${behaviorType} type`
    );

    return {
      walletAddress,
      historicalAverageHoldTimeHours,
      completedCycleCount: uniqueTokenCount,  // ✅ FIX: Return token count, not lifecycle count
      medianCompletedHoldTimeHours,
      behaviorType,
      exitPattern,
      dataQuality: sampleSizeScore,
      observationPeriodDays,
      holdTimeDistribution: distribution, // Include distribution for UI display
      holdTimeTokenMap: tokenMap, // Include token mint mapping for drilldown
    };
  }

  /**
   * Predict when a wallet will exit a specific token position.
   *
   * Uses historical pattern (from OTHER completed tokens) to predict behavior
   * on THIS specific token based on current position age.
   *
   * @param walletAddress - Wallet address
   * @param tokenMint - Specific token mint to predict
   * @param rawSwapRecords - All swap records for this wallet
   * @param currentTimestamp - Current time (defaults to now)
   * @returns Prediction object or null if cannot predict
   */
  public predictTokenExit(
    walletAddress: string,
    tokenMint: string,
    rawSwapRecords: SwapAnalysisInput[],
    currentTimestamp: number = Date.now() / 1000
  ): WalletTokenPrediction | null {
    this.logger.debug(`Predicting exit for wallet ${walletAddress} on token ${tokenMint}`);

    // 1. Calculate historical pattern (from completed positions)
    const pattern = this.calculateHistoricalPattern(rawSwapRecords, walletAddress);
    if (!pattern) {
      this.logger.debug('Cannot predict: insufficient historical data');
      return null;
    }

    // 2. Build lifecycles to find current position in THIS token
    const swapRecords = rawSwapRecords.filter(
      record => !EXCLUDED_TOKEN_MINTS.includes(record.mint)
    );
    const sequences = this.buildTokenSequences(swapRecords);
    const lifecycles = this.buildTokenLifecycles(sequences, currentTimestamp);

    // 3. Find lifecycle for this specific token
    const lifecycle = lifecycles.find(lc => lc.mint === tokenMint);

    if (!lifecycle) {
      this.logger.debug(`Cannot predict: wallet does not hold token ${tokenMint}`);
      return null;
    }

    if (lifecycle.positionStatus !== 'ACTIVE') {
      this.logger.debug(`Cannot predict: position already ${lifecycle.positionStatus}`);
      return null;
    }

    // 4. Calculate position age
    const positionAgeHours = (currentTimestamp - lifecycle.entryTimestamp) / 3600;

    // 5. Calculate time remaining until predicted exit
    const remainingHours = Math.max(0, pattern.medianCompletedHoldTimeHours - positionAgeHours);
    const estimatedExitTimestamp = currentTimestamp + (remainingHours * 3600);

    // 6. Assign risk level based on time remaining
    // Based on actual meme coin holder behavior (minutes/hours, not days!)
    let riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    const remainingMinutes = remainingHours * 60;

    if (remainingMinutes < 5) {
      riskLevel = 'CRITICAL';  // < 5 minutes: dump imminent
    } else if (remainingMinutes < 30) {
      riskLevel = 'HIGH';      // 5-30 minutes: dump very soon
    } else if (remainingHours < 2) {
      riskLevel = 'MEDIUM';    // 30min-2h: short-term risk
    } else {
      riskLevel = 'LOW';       // 2+ hours: you have time
    }

    // 7. Calculate percent already sold
    const percentAlreadySold = 100 - (lifecycle.percentOfPeakRemaining * 100);

    return {
      walletAddress,
      tokenMint,
      predictedAt: currentTimestamp,

      // Historical context
      historicalMedianHoldHours: pattern.medianCompletedHoldTimeHours,
      historicalSampleSize: pattern.completedCycleCount,
      behaviorType: pattern.behaviorType,
      exitPattern: pattern.exitPattern,

      // Current position
      entryTimestamp: lifecycle.entryTimestamp,
      currentPositionAgeHours: positionAgeHours,
      percentAlreadySold,
      positionStatus: lifecycle.positionStatus,

      // THE PREDICTION
      estimatedExitHours: remainingHours,
      estimatedExitTimestamp,
      riskLevel,

      // Confidence
      predictionConfidence: pattern.dataQuality,
    };
  }

  // --- Private Helper Methods (Extracted Logic) ---

  /**
   * Calculate peak position for a token across all trades.
   * Uses FIFO logic to track the maximum position ever held.
   */
  private calculatePeakPosition(trades: TokenTrade[]): number {
    let peakPosition = 0;
    let currentPosition = 0;
    const buyQueue: Array<{ amount: number }> = [];

    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

    for (const trade of sortedTrades) {
      if (trade.direction === 'in') {
        buyQueue.push({ amount: trade.amount });
        currentPosition += trade.amount;
        if (currentPosition > peakPosition) {
          peakPosition = currentPosition;
        }
      } else if (trade.direction === 'out') {
        let remainingSellAmount = trade.amount;

        while (remainingSellAmount > 0 && buyQueue.length > 0) {
          const oldestBuy = buyQueue[0];

          if (oldestBuy.amount <= remainingSellAmount) {
            currentPosition -= oldestBuy.amount;
            remainingSellAmount -= oldestBuy.amount;
            buyQueue.shift();
          } else {
            currentPosition -= remainingSellAmount;
            oldestBuy.amount -= remainingSellAmount;
            remainingSellAmount = 0;
          }
        }
      }
    }

    return peakPosition;
  }

  /**
   * Determine if/when a position was exited based on threshold.
   * A position is considered "exited" when it drops to or below the exit threshold % of peak.
   */
  private detectPositionExit(
    trades: TokenTrade[],
    peakPosition: number
  ): { exited: boolean; exitTimestamp: number | null } {
    const exitThreshold = this.config.holdingThresholds?.exitThreshold ?? 0.20;
    const exitThresholdAmount = peakPosition * exitThreshold;

    let currentPosition = 0;
    const buyQueue: Array<{ amount: number }> = [];
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

    for (const trade of sortedTrades) {
      if (trade.direction === 'in') {
        buyQueue.push({ amount: trade.amount });
        currentPosition += trade.amount;
      } else if (trade.direction === 'out') {
        let remainingSellAmount = trade.amount;

        while (remainingSellAmount > 0 && buyQueue.length > 0) {
          const oldestBuy = buyQueue[0];

          if (oldestBuy.amount <= remainingSellAmount) {
            currentPosition -= oldestBuy.amount;
            remainingSellAmount -= oldestBuy.amount;
            buyQueue.shift();
          } else {
            currentPosition -= remainingSellAmount;
            oldestBuy.amount -= remainingSellAmount;
            remainingSellAmount = 0;
          }
        }

        // Check if position dropped to or below exit threshold
        if (currentPosition <= exitThresholdAmount) {
          return { exited: true, exitTimestamp: trade.timestamp };
        }
      }
    }

    return { exited: false, exitTimestamp: null };
  }

  /**
   * Calculate weighted average entry time for a position with multiple buys.
   * Formula: Σ(amount_i × timestamp_i) / Σ(amount_i)
   */
  private calculateWeightedEntryTime(trades: TokenTrade[]): number {
    let totalWeightedTime = 0;
    let totalAmount = 0;

    const buyTrades = trades.filter(t => t.direction === 'in');

    for (const buy of buyTrades) {
      totalWeightedTime += buy.amount * buy.timestamp;
      totalAmount += buy.amount;
    }

    return totalAmount > 0 ? totalWeightedTime / totalAmount : 0;
  }

  /**
   * Calculate weighted holding time for a SINGLE token.
   * For completed positions: calculates actual weighted holding duration.
   * For active positions: calculates current weighted holding duration.
   */
  private calculateTokenWeightedHoldTime(
    trades: TokenTrade[],
    isCompleted: boolean,
    currentTimestamp?: number
  ): number {
    const buyQueue: Array<{ timestamp: number; amount: number }> = [];
    let totalWeightedDuration = 0;
    let totalAmountProcessed = 0;
    const secondsToHours = (seconds: number) => seconds / 3600;

    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

    for (const trade of sortedTrades) {
      if (trade.direction === 'in') {
        buyQueue.push({
          timestamp: trade.timestamp,
          amount: trade.amount
        });
      } else if (trade.direction === 'out' && buyQueue.length > 0) {
        let remainingSellAmount = trade.amount;
        const sellTimestamp = trade.timestamp;

        while (remainingSellAmount > 0 && buyQueue.length > 0) {
          const oldestBuy = buyQueue[0];
          const durationSeconds = sellTimestamp - oldestBuy.timestamp;

          if (oldestBuy.amount <= remainingSellAmount) {
            // Fully consume this buy position
            totalWeightedDuration += secondsToHours(durationSeconds) * oldestBuy.amount;
            totalAmountProcessed += oldestBuy.amount;
            remainingSellAmount -= oldestBuy.amount;
            buyQueue.shift();
          } else {
            // Partially consume this buy position
            totalWeightedDuration += secondsToHours(durationSeconds) * remainingSellAmount;
            totalAmountProcessed += remainingSellAmount;
            oldestBuy.amount -= remainingSellAmount;
            remainingSellAmount = 0;
          }
        }
      }
    }

    // For active positions, include remaining holdings
    if (!isCompleted && currentTimestamp && buyQueue.length > 0) {
      for (const position of buyQueue) {
        const durationSeconds = currentTimestamp - position.timestamp;
        totalWeightedDuration += secondsToHours(durationSeconds) * position.amount;
        totalAmountProcessed += position.amount;
      }
    }

    return totalAmountProcessed > 0 ? totalWeightedDuration / totalAmountProcessed : 0;
  }

  /**
   * Build full position lifecycle for each token.
   * Tracks entry, exit, peak position, and current state.
   *
   * IMPORTANT: This function now detects RE-ENTRIES (balance = 0 then new buy).
   * Each time balance hits 0 and trader buys again, it creates a NEW lifecycle.
   * This ensures we don't undercount holding times when traders exit and re-enter.
   */
  private buildTokenLifecycles(
    sequences: TokenTradeSequence[],
    currentTimestamp: number
  ): TokenPositionLifecycle[] {
    const lifecycles: TokenPositionLifecycle[] = [];
    const exitThreshold = this.config.holdingThresholds?.exitThreshold ?? 0.20;

    for (const seq of sequences) {
      const sortedTrades = [...seq.trades].sort((a, b) => a.timestamp - b.timestamp);

      // Split trades into separate cycles whenever balance hits 0
      const cycles: TokenTrade[][] = [];
      let currentCycle: TokenTrade[] = [];
      let currentPosition = 0;
      const buyQueue: Array<{ amount: number }> = [];

      for (const trade of sortedTrades) {
        if (trade.direction === 'in') {
          buyQueue.push({ amount: trade.amount });
          currentPosition += trade.amount;
          currentCycle.push(trade);
        } else if (trade.direction === 'out') {
          let remainingSellAmount = trade.amount;

          while (remainingSellAmount > 0 && buyQueue.length > 0) {
            const oldestBuy = buyQueue[0];

            if (oldestBuy.amount <= remainingSellAmount) {
              currentPosition -= oldestBuy.amount;
              remainingSellAmount -= oldestBuy.amount;
              buyQueue.shift();
            } else {
              currentPosition -= remainingSellAmount;
              oldestBuy.amount -= remainingSellAmount;
              remainingSellAmount = 0;
            }
          }

          currentCycle.push(trade);

          // If balance hit 0, close this cycle and start a new one
          if (currentPosition === 0 && buyQueue.length === 0) {
            if (currentCycle.length > 0) {
              cycles.push(currentCycle);
              currentCycle = [];
            }
          }
        }
      }

      // Add final cycle if there are trades remaining (active position)
      if (currentCycle.length > 0) {
        cycles.push(currentCycle);
      }

      // Now build a lifecycle for each cycle
      for (const cycleTrades of cycles) {
        const peakPosition = this.calculatePeakPosition(cycleTrades);
        const exitInfo = this.detectPositionExit(cycleTrades, peakPosition);

        // Calculate final position for this cycle
        let cycleCurrentPosition = 0;
        const cycleBuyQueue: Array<{ amount: number }> = [];

        for (const trade of cycleTrades) {
          if (trade.direction === 'in') {
            cycleBuyQueue.push({ amount: trade.amount });
            cycleCurrentPosition += trade.amount;
          } else if (trade.direction === 'out') {
            let remainingSellAmount = trade.amount;

            while (remainingSellAmount > 0 && cycleBuyQueue.length > 0) {
              const oldestBuy = cycleBuyQueue[0];

              if (oldestBuy.amount <= remainingSellAmount) {
                cycleCurrentPosition -= oldestBuy.amount;
                remainingSellAmount -= oldestBuy.amount;
                cycleBuyQueue.shift();
              } else {
                cycleCurrentPosition -= remainingSellAmount;
                oldestBuy.amount -= remainingSellAmount;
                remainingSellAmount = 0;
              }
            }
          }
        }

        const percentOfPeakRemaining = peakPosition > 0 ? cycleCurrentPosition / peakPosition : 0;

        // Determine position status
        let positionStatus: 'ACTIVE' | 'EXITED' | 'DUST';
        if (exitInfo.exited || percentOfPeakRemaining <= exitThreshold) {
          positionStatus = 'EXITED';
        } else {
          positionStatus = 'ACTIVE';
        }

        // Determine behavior type
        let behaviorType: 'FULL_HOLDER' | 'PROFIT_TAKER' | 'MOSTLY_EXITED' | null = null;
        if (positionStatus === 'ACTIVE') {
          if (percentOfPeakRemaining > 0.75) {
            behaviorType = 'FULL_HOLDER';
          } else if (percentOfPeakRemaining > exitThreshold) {
            behaviorType = 'PROFIT_TAKER';
          }
        } else if (positionStatus === 'EXITED') {
          behaviorType = 'MOSTLY_EXITED';
        }

        // Calculate weighted holding time for this cycle
        const isCompleted = positionStatus === 'EXITED';
        const weightedHoldingTimeHours = this.calculateTokenWeightedHoldTime(
          cycleTrades,
          isCompleted,
          currentTimestamp
        );

        // Get entry timestamp (first buy in this cycle)
        const entryTimestamp = Math.min(...cycleTrades.filter(t => t.direction === 'in').map(t => t.timestamp));

        // Calculate total bought/sold for this cycle
        const totalBought = cycleTrades.filter(t => t.direction === 'in').reduce((sum, t) => sum + t.amount, 0);
        const totalSold = cycleTrades.filter(t => t.direction === 'out').reduce((sum, t) => sum + t.amount, 0);
        const buyCount = cycleTrades.filter(t => t.direction === 'in').length;
        const sellCount = cycleTrades.filter(t => t.direction === 'out').length;

        lifecycles.push({
          mint: seq.mint,
          entryTimestamp,
          exitTimestamp: exitInfo.exitTimestamp,
          peakPosition,
          currentPosition: cycleCurrentPosition,
          percentOfPeakRemaining,
          positionStatus,
          behaviorType,
          weightedHoldingTimeHours,
          totalBought,
          totalSold,
          buyCount,
          sellCount,
        });
      }
    }

    return lifecycles;
  }

  /**
   * Returns an empty/default metrics structure.
   */
  private getEmptyMetrics(): BehavioralMetrics {
    return {
      // Core flipper metrics
      buySellRatio: 0,
      buySellSymmetry: 0,
      averageFlipDurationHours: 0,
      medianHoldTime: 0,
      averageCurrentHoldingDurationHours: 0,
      medianCurrentHoldingDurationHours: 0,
      weightedAverageHoldingDurationHours: 0,
      percentOfValueInCurrentHoldings: 0,
      // Unrealized P&L metrics (now calculated using DexScreener price data)
      currentHoldingsValueUsd: 0, // Total USD value of current holdings
      unrealizedPnlUsd: 0, // Unrealized profit/loss in USD
      unrealizedPnlSol: 0, // Unrealized profit/loss in SOL
      percentOfCurrentPortfolioValue: 0, // Percentage of total portfolio value in current holdings
      sequenceConsistency: 0,
      flipperScore: 0,
      // Supporting metrics
      uniqueTokensTraded: 0,
      tokensWithBothBuyAndSell: 0,
      tokensWithOnlyBuys: 0,
      tokensWithOnlySells: 0,
      totalTradeCount: 0,
      totalBuyCount: 0,
      totalSellCount: 0,
      completePairsCount: 0,
      averageTradesPerToken: 0,
      // Time distribution
      tradingTimeDistribution: { ultraFast: 0, veryFast: 0, fast: 0, moderate: 0, dayTrader: 0, swing: 0, position: 0 },
      // Additional time metrics
      percentTradesUnder1Hour: 0,
      percentTradesUnder4Hours: 0,
      // Classification
      tradingStyle: "Insufficient Data",
      confidenceScore: 0,
      // Original placeholders (now explicitly initialized)
      tradingFrequency: { tradesPerDay: 0, tradesPerWeek: 0, tradesPerMonth: 0 },
      tokenPreferences: { mostTradedTokens: [], mostHeld: [] },
      riskMetrics: { averageTransactionValueSol: 0, largestTransactionValueSol: 0 },
      reentryRate: 0,
      percentageOfUnpairedTokens: 0,
      sessionCount: 0,
      avgTradesPerSession: 0,
      activeTradingPeriods: {
        hourlyTradeCounts: {},
        identifiedWindows: [],
        activityFocusScore: 0,
      },
      averageSessionStartHour: 0,
      averageSessionDurationMinutes: 0,
    };
  }

  /**
   * Groups swap records by token and sorts them chronologically.
   */
  private buildTokenSequences(swapRecords: SwapAnalysisInput[]): TokenTradeSequence[] {
    this.logger.debug(`Built ${swapRecords.length > 0 ? Object.keys(this.groupSwapsByToken(swapRecords)).length : 0} token sequences.`);
    const sequences = this.groupSwapsByToken(swapRecords);
    // Calculate complete pairs within buildTokenSequences or here
    sequences.forEach(seq => {
      seq.completePairs = this.countBuySellPairs(seq.trades);
    });
    return sequences;
  }

  private groupSwapsByToken(swapRecords: SwapAnalysisInput[]): TokenTradeSequence[] {
    const groupedByMint: { [key: string]: SwapAnalysisInput[] } = {};
    swapRecords.forEach(record => {
      if (!groupedByMint[record.mint]) {
        groupedByMint[record.mint] = [];
      }
      groupedByMint[record.mint].push(record);
    });

    const sequences: TokenTradeSequence[] = [];
    for (const [mint, records] of Object.entries(groupedByMint)) {
      const sortedRecords = records.sort((a, b) => a.timestamp - b.timestamp);
      const buyCount = records.filter(r => r.direction === 'in').length;
      const sellCount = records.filter(r => r.direction === 'out').length;
      let buySellRatio = 0;
      if (sellCount > 0) {
        buySellRatio = buyCount / sellCount;
      } else if (buyCount > 0) {
        buySellRatio = Infinity; // Only buys
      }
      sequences.push({
        mint,
        trades: sortedRecords.map(r => ({
          timestamp: r.timestamp,
          direction: r.direction as 'in' | 'out',
          amount: r.amount,
          associatedSolValue: r.associatedSolValue ?? 0, // Handle null
          associatedUsdcValue: r.associatedUsdcValue // Handle null
        })),
        buyCount,
        sellCount,
        completePairs: 0, // Calculated later
        buySellRatio
      });
    }
    return sequences;
  }

  /**
   * Counts completed buy-sell pairs using FIFO logic to match the flip duration calculation.
   * This ensures consistency between pair counting and duration calculation.
   */
  private countBuySellPairs(trades: TokenTradeSequence['trades']): number {
    const buyQueue: Array<{ timestamp: number; amount: number }> = [];
    let completePairs = 0;

    // Sort trades by timestamp to ensure chronological processing
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

    for (const trade of sortedTrades) {
      if (trade.direction === 'in') {
        // Add buy to the queue
        buyQueue.push({
          timestamp: trade.timestamp,
          amount: trade.amount
        });
      } else if (trade.direction === 'out' && buyQueue.length > 0) {
        // Process sell against FIFO buy queue
        let remainingSellAmount = trade.amount;

        while (remainingSellAmount > 0 && buyQueue.length > 0) {
          const oldestBuy = buyQueue[0];
          
          if (oldestBuy.amount <= remainingSellAmount) {
            // Fully consume this buy position - this counts as one complete pair
            completePairs++;
            remainingSellAmount -= oldestBuy.amount;
            buyQueue.shift(); // Remove the fully consumed buy
          } else {
            // Partially consume this buy position - this also counts as one complete pair
            // since we're selling against a buy position
            completePairs++;
            oldestBuy.amount -= remainingSellAmount;
            remainingSellAmount = 0;
            // Keep the partially consumed buy in the queue
          }
        }
      }
    }

    return completePairs;
  }

  /**
   * Calculates flip durations using proper FIFO (First-In, First-Out) logic.
   * Maintains a queue of buy positions and matches them with sells chronologically.
   */
  private calculateFlipDurations(trades: TokenTradeSequence['trades']): number[] {
    const durations: number[] = [];
    const buyQueue: Array<{ timestamp: number; amount: number }> = [];
    const secondsToHours = (seconds: number) => seconds / 3600;

    // Sort trades by timestamp to ensure chronological processing
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

    for (const trade of sortedTrades) {
      if (trade.direction === 'in') {
        // Add buy to the queue
        buyQueue.push({
          timestamp: trade.timestamp,
          amount: trade.amount
        });
      } else if (trade.direction === 'out' && buyQueue.length > 0) {
        // Process sell against FIFO buy queue
        let remainingSellAmount = trade.amount;
        const sellTimestamp = trade.timestamp;

        while (remainingSellAmount > 0 && buyQueue.length > 0) {
          const oldestBuy = buyQueue[0];
          const durationSeconds = sellTimestamp - oldestBuy.timestamp;
          
          if (oldestBuy.amount <= remainingSellAmount) {
            // Fully consume this buy position
            durations.push(secondsToHours(durationSeconds));
            remainingSellAmount -= oldestBuy.amount;
            buyQueue.shift(); // Remove the fully consumed buy
          } else {
            // Partially consume this buy position
            durations.push(secondsToHours(durationSeconds));
            oldestBuy.amount -= remainingSellAmount;
            remainingSellAmount = 0;
            // Keep the partially consumed buy in the queue
          }
        }
        
        // If there's still remaining sell amount, it means we're selling more than we bought
        // This could happen due to data inconsistencies, but we'll just ignore the excess
        if (remainingSellAmount > 0) {
          // this.logger.debug(`Excess sell amount ${remainingSellAmount} for token, possibly due to missing buy data or pre-analysis holdings`);
        }
      }
    }

    return durations;
  }

  /**
   * Calculates current holdings durations and value metrics for "trapped" positions.
   * Returns positions that were bought but never fully sold.
   * Applies smart thresholds to filter out dust positions.
   */
  private calculateCurrentHoldingsMetrics(trades: TokenTradeSequence['trades'], currentTimestamp: number): {
    durations: number[];
    totalValueStillHeld: number;
    totalValueTraded: number;
  } {
    const durations: number[] = [];
    const buyQueue: Array<{ timestamp: number; amount: number; solValue: number }> = [];
    const secondsToHours = (seconds: number) => seconds / 3600;
    let totalValueTraded = 0;

    // Sort trades by timestamp to ensure chronological processing
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

    for (const trade of sortedTrades) {
      totalValueTraded += trade.associatedSolValue;
      
      if (trade.direction === 'in') {
        // Add buy to the queue
        buyQueue.push({
          timestamp: trade.timestamp,
          amount: trade.amount,
          solValue: trade.associatedSolValue
        });
      } else if (trade.direction === 'out' && buyQueue.length > 0) {
        // Process sell against FIFO buy queue (same logic as flip calculation)
        let remainingSellAmount = trade.amount;

        while (remainingSellAmount > 0 && buyQueue.length > 0) {
          const oldestBuy = buyQueue[0];
          
          if (oldestBuy.amount <= remainingSellAmount) {
            // Fully consume this buy position
            remainingSellAmount -= oldestBuy.amount;
            buyQueue.shift(); // Remove the fully consumed buy
          } else {
            // Partially consume this buy position
            oldestBuy.amount -= remainingSellAmount;
            // Adjust the SOL value proportionally
            const consumedRatio = remainingSellAmount / (oldestBuy.amount + remainingSellAmount);
            oldestBuy.solValue *= (1 - consumedRatio);
            remainingSellAmount = 0;
            // Keep the partially consumed buy in the queue
          }
        }
      }
    }

    // Calculate durations and total value for remaining positions
    // Apply smart thresholds to filter out dust/negligible positions
    let totalValueStillHeld = 0;
    const originalPositionValues = new Map<number, number>(); // timestamp -> original SOL value
    
    // First pass: collect original position values for percentage calculation
    // Note: If multiple buys at same timestamp, this will use the last one (limitation to address later)
    const tradesForOriginalValues = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    tradesForOriginalValues.forEach(trade => {
      if (trade.direction === 'in') {
        originalPositionValues.set(trade.timestamp, trade.associatedSolValue);
      }
    });

    buyQueue.forEach(position => {
      const originalValue = originalPositionValues.get(position.timestamp) || position.solValue;
      const remainingPercentage = position.solValue / originalValue;
      
      // Smart thresholds for what constitutes a "real" holding vs dust:
      const thresholds = this.config.holdingThresholds || {};
      const isSignificantHolding = 
        position.solValue >= (thresholds.minimumSolValue ?? 0.001) &&                           // Configurable minimum SOL value
        remainingPercentage >= (thresholds.minimumPercentageRemaining ?? 0.05) &&               // Configurable minimum % of original
        (currentTimestamp - position.timestamp) >= (thresholds.minimumHoldingTimeSeconds ?? 60); // Reduced from 300 to 60 seconds (1 minute)
      
      if (isSignificantHolding) {
        const holdingDurationSeconds = currentTimestamp - position.timestamp;
        durations.push(secondsToHours(holdingDurationSeconds));
        totalValueStillHeld += position.solValue;
      } else {
        // Log dust positions for debugging
       // this.logger.debug(`Filtering out dust position: ${position.solValue.toFixed(6)} SOL (${(remainingPercentage * 100).toFixed(1)}% of original)`);
      }
    });

    return {
      durations,
      totalValueStillHeld,
      totalValueTraded
    };
  }

  /**
   * Calculates the median of a number array.
   */
  private calculateMedian(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Calculates various time-based distributions and metrics.
   */
  private calculateTimeDistributions(sequences: TokenTradeSequence[]): {
    durations: number[];
    distribution: BehavioralMetrics['tradingTimeDistribution'];
    percentUnder1Hour: number;
    percentUnder4Hours: number;
    avgDuration: number;
    medianDuration: number;
  } {
    let allDurations: number[] = [];
    sequences.forEach(seq => {
      allDurations = allDurations.concat(this.calculateFlipDurations(seq.trades));
    });

    const distribution: BehavioralMetrics['tradingTimeDistribution'] = {
      ultraFast: 0, veryFast: 0, fast: 0, moderate: 0, dayTrader: 0, swing: 0, position: 0
    };
    const totalFlips = allDurations.length;
    let sumDurations = 0;

    if (totalFlips === 0) {
      return { durations: [], distribution, percentUnder1Hour: 0, percentUnder4Hours: 0, avgDuration: 0, medianDuration: 0 };
    }

    allDurations.forEach(hours => {
      sumDurations += hours;
      if (hours < 0.5) distribution.ultraFast++;        // < 30 min
      else if (hours < 1) distribution.veryFast++;    // 30-60 min
      else if (hours < 4) distribution.fast++;        // 1-4h
      else if (hours < 8) distribution.moderate++;    // 4-8h
      else if (hours < 24) distribution.dayTrader++; // 8-24h
      else if (hours < 168) distribution.swing++;   // 1-7d (24*7)
      else distribution.position++;                      // > 7d
    });

    // Normalize distribution
    for (const key in distribution) {
      (distribution as any)[key] /= totalFlips;
    }

    const percentUnder1Hour = (distribution.ultraFast + distribution.veryFast);
    const percentUnder4Hours = percentUnder1Hour + distribution.fast;
    const avgDuration = sumDurations / totalFlips;
    const medianDuration = this.calculateMedian(allDurations);

    return { durations: allDurations, distribution, percentUnder1Hour, percentUnder4Hours, avgDuration, medianDuration };
  }

  /**
   * Calculates current holdings distributions across all token sequences.
   */
  private calculateCurrentHoldingsDistributions(sequences: TokenTradeSequence[], currentTimestamp: number): {
    avgDuration: number;
    medianDuration: number;
    percentOfValueInCurrentHoldings: number;
  } {
    let allCurrentDurations: number[] = [];
    let totalValueStillHeld = 0;
    let totalValueTraded = 0;

    sequences.forEach(seq => {
      const holdingsMetrics = this.calculateCurrentHoldingsMetrics(seq.trades, currentTimestamp);
      allCurrentDurations = allCurrentDurations.concat(holdingsMetrics.durations);
      totalValueStillHeld += holdingsMetrics.totalValueStillHeld;
      totalValueTraded += holdingsMetrics.totalValueTraded;
    });

    const avgDuration = allCurrentDurations.length > 0 
      ? allCurrentDurations.reduce((sum, d) => sum + d, 0) / allCurrentDurations.length 
      : 0;
    
    const medianDuration = this.calculateMedian(allCurrentDurations);
    
    const percentOfValueInCurrentHoldings = totalValueTraded > 0 
      ? (totalValueStillHeld / totalValueTraded) * 100 
      : 0;

    return { avgDuration, medianDuration, percentOfValueInCurrentHoldings };
  }

  /**
   * Calculates the overall behavioral metrics from token sequences.
   */
  private calculateBehavioralMetrics(sequences: TokenTradeSequence[]): BehavioralMetrics {
    this.logger.debug(`Calculating metrics for ${sequences.length} token sequences.`);
    const metrics = this.getEmptyMetrics();
    if (sequences.length === 0) return metrics;

    metrics.uniqueTokensTraded = sequences.length;
    metrics.tokensWithBothBuyAndSell = sequences.filter(s => s.buyCount > 0 && s.sellCount > 0).length;
    metrics.tokensWithOnlyBuys = sequences.filter(s => s.buyCount > 0 && s.sellCount === 0).length;
    metrics.tokensWithOnlySells = sequences.filter(s => s.sellCount > 0 && s.buyCount === 0).length;
    
    // Verification (can be logged or asserted during development)
    if (metrics.uniqueTokensTraded !== (metrics.tokensWithBothBuyAndSell + metrics.tokensWithOnlyBuys + metrics.tokensWithOnlySells)) {
      this.logger.warn(
        `Token category sanity check failed: uniqueTokensTraded (${metrics.uniqueTokensTraded}) !== ` +
        `tokensWithBothBuyAndSell (${metrics.tokensWithBothBuyAndSell}) + ` +
        `tokensWithOnlyBuys (${metrics.tokensWithOnlyBuys}) + ` +
        `tokensWithOnlySells (${metrics.tokensWithOnlySells})`
      );
    }

    metrics.totalBuyCount = sequences.reduce((sum, s) => sum + s.buyCount, 0);
    metrics.totalSellCount = sequences.reduce((sum, s) => sum + s.sellCount, 0);
    metrics.totalTradeCount = metrics.totalBuyCount + metrics.totalSellCount;
    metrics.completePairsCount = sequences.reduce((sum, s) => sum + s.completePairs, 0);
    
    if (metrics.totalSellCount > 0) {
      metrics.buySellRatio = metrics.totalBuyCount / metrics.totalSellCount;
    } else if (metrics.totalBuyCount > 0) {
      metrics.buySellRatio = Infinity; // Indicate only buys
    } // Else remains 0
    
    if (metrics.tokensWithBothBuyAndSell > 0) {
      const symmetrySum = sequences.reduce((sum, s) => {
        if (s.buyCount > 0 && s.sellCount > 0) {
          const minCount = Math.min(s.buyCount, s.sellCount);
          const maxCount = Math.max(s.buyCount, s.sellCount);
          return sum + (minCount / maxCount); // Closer to 1 is better symmetry
        }
        return sum;
      }, 0);
      metrics.buySellSymmetry = symmetrySum / metrics.tokensWithBothBuyAndSell;
      
      const consistencySum = sequences.reduce((sum, s) => {
         if (s.buyCount > 0 && s.sellCount > 0) {
            // Max possible pairs is min(buys, sells)
            const maxPossiblePairs = Math.min(s.buyCount, s.sellCount); 
            // If maxPossiblePairs is 0, no pairs possible, so no consistency contribution
            return sum + (maxPossiblePairs > 0 ? (s.completePairs / maxPossiblePairs) : 0);
         }
         return sum;
      }, 0);
      metrics.sequenceConsistency = consistencySum / metrics.tokensWithBothBuyAndSell;

      metrics.averageTradesPerToken = metrics.uniqueTokensTraded > 0 ? metrics.totalTradeCount / metrics.uniqueTokensTraded : 0;
    }
    
    const timeCalcs = this.calculateTimeDistributions(sequences);
    metrics.tradingTimeDistribution = timeCalcs.distribution;
    metrics.averageFlipDurationHours = timeCalcs.avgDuration;
    metrics.medianHoldTime = timeCalcs.medianDuration;
    metrics.percentTradesUnder1Hour = timeCalcs.percentUnder1Hour;
    metrics.percentTradesUnder4Hours = timeCalcs.percentUnder4Hours;

    // Calculate current holdings metrics (for "trapped" positions)
    // Use a reasonable analysis timestamp: latest transaction + 1 hour for deterministic results
    let latestTimestamp = 0;
    sequences.forEach(seq => {
      seq.trades.forEach(trade => {
        if (trade.timestamp > latestTimestamp) {
          latestTimestamp = trade.timestamp;
        }
      });
    });
    // Add 1 hour (3600 seconds) to latest transaction to ensure current holdings have reasonable duration
    const analysisTimestamp = latestTimestamp > 0 ? latestTimestamp + 3600 : Math.floor(Date.now() / 1000);
    const currentHoldingsCalcs = this.calculateCurrentHoldingsDistributions(sequences, analysisTimestamp);
    metrics.averageCurrentHoldingDurationHours = currentHoldingsCalcs.avgDuration;
    metrics.medianCurrentHoldingDurationHours = currentHoldingsCalcs.medianDuration;
    metrics.percentOfValueInCurrentHoldings = currentHoldingsCalcs.percentOfValueInCurrentHoldings;
    
    // Calculate weighted average combining flips and current holdings
    const flipValueWeight = 1 - (currentHoldingsCalcs.percentOfValueInCurrentHoldings / 100);
    const currentValueWeight = currentHoldingsCalcs.percentOfValueInCurrentHoldings / 100;
    
    if (flipValueWeight > 0 || currentValueWeight > 0) {
      metrics.weightedAverageHoldingDurationHours = 
        (metrics.averageFlipDurationHours * flipValueWeight) + 
        (metrics.averageCurrentHoldingDurationHours * currentValueWeight);
    }

    metrics.flipperScore = this.calculateFlipperScore(metrics);

    // Calculate mostTradedTokens
    const tokenDataForMostTraded: { 
        [mint: string]: { count: number, totalValue: number, totalUsdcValue: number, firstSeen: number, lastSeen: number }
    } = {};

    sequences.forEach(seq => {
      let firstSeen = Infinity;
      let lastSeen = 0;
      let totalValue = 0;
      let totalUsdcValue = 0;
      seq.trades.forEach(trade => {
        if (trade.timestamp < firstSeen) firstSeen = trade.timestamp;
        if (trade.timestamp > lastSeen) lastSeen = trade.timestamp;
        totalValue += trade.associatedSolValue;
        totalUsdcValue += trade.associatedUsdcValue ?? 0; // Use actual USDC value from database
      });

      tokenDataForMostTraded[seq.mint] = {
        count: seq.buyCount + seq.sellCount,
        totalValue: totalValue,
        totalUsdcValue: totalUsdcValue,
        firstSeen: firstSeen === Infinity ? 0 : firstSeen,
        lastSeen: lastSeen,
      };
    });

    // Filter out scam tokens from mostTradedTokens
    const filteredTokenData: { 
        [mint: string]: { count: number, totalValue: number, totalUsdcValue: number, firstSeen: number, lastSeen: number }
    } = {};

    let scamTokensFiltered = 0;
    let totalTokensProcessed = 0;

    // Check if scam filtering is enabled (default to true if not specified)
    const scamFilteringEnabled = this.config.scamFiltering?.enabled !== false;
    const logFilteredTokens = this.config.scamFiltering?.logFilteredTokens === true;

    for (const [mint, data] of Object.entries(tokenDataForMostTraded)) {
      totalTokensProcessed++;
      
      // SIMPLE FILTER: Only use totalValue to detect scams
      // Tokens with high trade counts but zero/low SOL value are likely scams
      if (scamFilteringEnabled) {
        const isScam = this.isScamTokenByValue(data.count, data.totalValue, data.totalUsdcValue);
        
        if (isScam) {
          scamTokensFiltered++;
          if (logFilteredTokens) {
            this.logger.debug(`Filtered out scam token ${mint}: ${data.count} trades but only ${data.totalValue.toFixed(6)} SOL total value`);
          }
          continue; // Skip this token
        }
      }

      // Include legitimate tokens
      filteredTokenData[mint] = data;
    }

    if (scamFilteringEnabled) {
      this.logger.info(`Scam token filtering: Processed ${totalTokensProcessed} tokens, filtered out ${scamTokensFiltered} scam tokens (${((scamTokensFiltered / totalTokensProcessed) * 100).toFixed(1)}%)`);
    }

    metrics.tokenPreferences.mostTradedTokens = Object.entries(filteredTokenData)
      .sort(([, dataA], [, dataB]) => dataB.count - dataA.count) // Sort by trade count
      .slice(0, 5) // Top 5
      .map(([mint, data]) => ({
        mint: mint,
        count: data.count,
        totalValue: data.totalValue,
        totalUsdcValue: data.totalUsdcValue,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
      }));

    // Calculate reentryRate
    const tokensWithMultipleCycles = sequences.filter(s => s.completePairs > 1).length;
    if (metrics.tokensWithBothBuyAndSell > 0) {
      metrics.reentryRate = tokensWithMultipleCycles / metrics.tokensWithBothBuyAndSell;
    }

    // Calculate percentageOfUnpairedTokens
    if (metrics.uniqueTokensTraded > 0) {
      metrics.percentageOfUnpairedTokens = ((metrics.uniqueTokensTraded - metrics.tokensWithBothBuyAndSell) / metrics.uniqueTokensTraded) * 100;
    }

    this.logger.debug('Finished calculating metrics.');
    return metrics;
  }

  /**
   * Calculates a score indicating flipper behavior based on speed and balance.
   */
  private calculateFlipperScore(metrics: BehavioralMetrics): number {
    const speedScore = (
      metrics.tradingTimeDistribution.ultraFast * 0.85 +
      metrics.tradingTimeDistribution.veryFast * 0.10 +
      metrics.tradingTimeDistribution.fast * 0.05
    );
    const balanceScore = (metrics.buySellSymmetry + metrics.sequenceConsistency) / 2;
    
    // Give more weight to speed, especially ultra-fast
    let score = (speedScore * 0.7) + (balanceScore * 0.3);
    
    // Boost score significantly if ultra-fast trading is dominant
    if(metrics.tradingTimeDistribution.ultraFast > 0.5) {
      score = Math.min(1, score + 0.2);
    }
    
    return Math.max(0, Math.min(1, score)); // Clamp between 0 and 1
  }

  /**
   * Classifies the trading style based on calculated metrics.
   * ✅ REFACTORED: Uses median hold time (outlier-robust) + new speed thresholds
   * Combines speed category with behavioral pattern for comprehensive classification
   */
  private classifyTradingStyle(metrics: BehavioralMetrics): void {
    const {
      buySellSymmetry,
      sequenceConsistency,
      medianHoldTime,
      buySellRatio,
      totalTradeCount,
      tokensWithBothBuyAndSell,
      totalBuyCount,
      totalSellCount
    } = metrics;

    // Check minimum data requirements
    if (totalTradeCount < 5 || tokensWithBothBuyAndSell < 2) {
      metrics.tradingStyle = 'Low Activity';
      metrics.confidenceScore = 1.0;
      this.logger.debug(`Classified as Low Activity (${totalTradeCount} trades, ${tokensWithBothBuyAndSell} tokens)`);
      return;
    }

    // ✅ NEW: Use MEDIAN hold time from historical pattern (outlier-robust)
    // If historicalPattern is null (insufficient completed cycles), use legacy metric
    // but this should be rare after wiring up the calculation
    const medianHoldHours = metrics.historicalPattern?.medianCompletedHoldTimeHours ?? medianHoldTime;

    if (!metrics.historicalPattern) {
      this.logger.warn(
        `No historical pattern available for classification (insufficient completed cycles). ` +
        `Falling back to legacy medianHoldTime: ${medianHoldTime.toFixed(2)}h`
      );
    }

    // ✅ NEW: Classify trading SPEED based on median (typical behavior)
    // Uses constants for single source of truth
    const speedCategory = classifyTradingSpeed(medianHoldHours);

    // ✅ NEW: Classify BEHAVIORAL PATTERN (buy/sell characteristics)
    let behavioralPattern: string;
    const isBalanced = buySellSymmetry > 0.7 && sequenceConsistency > 0.7;

    if (totalSellCount === 0) {
      behavioralPattern = 'HOLDER';
    } else if (totalBuyCount === 0) {
      behavioralPattern = 'DUMPER';
    } else if (buySellRatio > 2.5 && totalBuyCount > totalSellCount * 2) {
      behavioralPattern = 'ACCUMULATOR';
    } else if (buySellRatio < 0.4 && totalSellCount > totalBuyCount * 2) {
      behavioralPattern = 'DISTRIBUTOR';
    } else if (isBalanced) {
      behavioralPattern = 'BALANCED';
    } else if (buySellRatio > 1.5) {
      behavioralPattern = 'HOLDER';
    } else {
      behavioralPattern = 'MIXED';
    }

    // ✅ NEW: Combine speed + pattern for comprehensive style
    const combinedStyle = `${speedCategory} (${behavioralPattern})`;

    // ✅ NEW: Calculate confidence based on data quality
    const completedCycles = metrics.historicalPattern?.completedCycleCount || 0;
    const dataQuality = metrics.historicalPattern?.dataQuality || 0.5;

    let confidence = dataQuality * 0.4;

    // Bonus for sufficient sample size
    if (completedCycles >= 10) {
      confidence += 0.3;
    } else if (completedCycles >= 5) {
      confidence += 0.2;
    } else if (completedCycles >= 3) {
      confidence += 0.1;
    }

    // Bonus for pattern consistency
    confidence += (buySellSymmetry * sequenceConsistency) * 0.3;

    metrics.tradingStyle = combinedStyle;
    metrics.confidenceScore = Math.max(0, Math.min(1, confidence));

    // ✅ NEW: Generate rich trading interpretation (speed vs economic analysis)
    // Use weighted average from historicalPattern, or fallback to median if pattern unavailable
    const economicHoldTimeHours = metrics.historicalPattern?.historicalAverageHoldTimeHours || medianHoldHours;

    if (!metrics.historicalPattern) {
      this.logger.warn(
        `No historical pattern for trading interpretation. Economic hold time will equal typical hold time.`
      );
    }

    metrics.tradingInterpretation = this.generateTradingInterpretation(
      speedCategory,
      behavioralPattern,
      medianHoldHours,
      economicHoldTimeHours
    );

    this.logger.debug(
      `Classified as ${combinedStyle} (median hold: ${medianHoldHours.toFixed(2)}h, ` +
      `confidence: ${metrics.confidenceScore.toFixed(2)}, cycles: ${completedCycles})`
    );
  }

  /**
   * Generate comprehensive trading interpretation
   * Separates SPEED (typical behavior) from ECONOMIC RISK (where money goes)
   */
  private generateTradingInterpretation(
    speedCategory: string,
    behavioralPattern: string,
    medianHoldHours: number,
    weightedAvgHoldHours: number
  ): any {
    // Determine economic risk based on weighted average
    let economicRisk: string;
    if (weightedAvgHoldHours < 1) {
      economicRisk = 'CRITICAL';  // <1 hour average = very risky
    } else if (weightedAvgHoldHours < 24) {
      economicRisk = 'HIGH';  // <1 day average = high risk
    } else if (weightedAvgHoldHours < 168) {
      economicRisk = 'MEDIUM';  // <1 week average = medium risk
    } else {
      economicRisk = 'LOW';  // 1+ week average = lower risk
    }

    // Generate human-readable interpretation
    const speedText = speedCategory.toLowerCase().replace(/_/g, ' ');
    const patternText = behavioralPattern.toLowerCase();

    let interpretation = `${speedCategory} (${behavioralPattern}): `;

    if (speedCategory === 'ULTRA_FLIPPER' || speedCategory === 'FLIPPER') {
      interpretation += 'Extremely fast trading, ';
    } else if (speedCategory === 'FAST_TRADER' || speedCategory === 'DAY_TRADER') {
      interpretation += 'Active day trading, ';
    } else {
      interpretation += 'Longer-term holds, ';
    }

    if (behavioralPattern === 'ACCUMULATOR') {
      interpretation += 'tends to buy more than sell';
    } else if (behavioralPattern === 'DISTRIBUTOR') {
      interpretation += 'tends to sell more than buy';
    } else if (behavioralPattern === 'BALANCED') {
      interpretation += 'balanced buy/sell activity';
    } else {
      interpretation += `${patternText} behavior`;
    }

    return {
      speedCategory,
      typicalHoldTimeHours: medianHoldHours,
      economicHoldTimeHours: weightedAvgHoldHours,
      economicRisk,
      behavioralPattern,
      interpretation
    };
  }

  private _identifyActiveTradingWindows(
    hourlyTradeCounts: Record<number, number>,
    totalNetworkTransactions: number
  ): IdentifiedTradingWindow[] {
    const identifiedWindows: IdentifiedTradingWindow[] = [];
    if (totalNetworkTransactions === 0) {
      return identifiedWindows;
    }

    // 1. (Optional) Smoothing - Apply a 3-hour moving average
    const smoothedHourlyCounts: Record<number, number> = {};
    for (let hour = 0; hour < 24; hour++) {
      let sum = 0;
      let count = 0;
      for (let i = -1; i <= 1; i++) { // 3-hour window (h-1, h, h+1)
        const currentHour = (hour + i + 24) % 24; // Handle wrap-around for 0 and 23
        sum += hourlyTradeCounts[currentHour] || 0;
        count++;
      }
      smoothedHourlyCounts[hour] = sum / count;
    }

    // 2. Thresholding - Use 75th percentile of non-zero smoothed counts
    const nonZeroSmoothedCounts = Object.values(smoothedHourlyCounts).filter(c => c > 0).sort((a, b) => a - b);
    let activityThreshold = 0;
    if (nonZeroSmoothedCounts.length > 0) {
      const percentileIndex = Math.floor(nonZeroSmoothedCounts.length * 0.75);
      activityThreshold = nonZeroSmoothedCounts[percentileIndex] || (nonZeroSmoothedCounts.length > 0 ? nonZeroSmoothedCounts[0] : 1); // Fallback to smallest non-zero or 1
      // Ensure threshold is at least 1 trade on average if there's any activity
      if (nonZeroSmoothedCounts.length > 0 && activityThreshold < 1) activityThreshold = 1;
    }
    // If still no threshold (e.g. all smoothed counts are 0), don't proceed
    if (activityThreshold === 0 && totalNetworkTransactions > 0) {
        // If there was activity, but smoothing/percentile resulted in 0 threshold, 
        // it implies very sparse, non-clustered activity. Set a minimal threshold to catch at least the peak hour.
        activityThreshold = Math.max(...Object.values(smoothedHourlyCounts), 0.1) / 2; // Or some small fraction of max, but >0
        if (activityThreshold <=0 && totalNetworkTransactions > 0) activityThreshold = 0.1; // final fallback
    }
    if (activityThreshold === 0) return []; // No significant activity identified


    // 3. Window Identification
    let currentWindow: Partial<IdentifiedTradingWindow> | null = null;
    for (let hour = 0; hour < 24; hour++) {
      if (smoothedHourlyCounts[hour] >= activityThreshold) {
        if (!currentWindow) {
          currentWindow = { startTimeUTC: hour, tradeCountInWindow: 0 };
        }
      } else {
        if (currentWindow) {
          // End of current window
          currentWindow.endTimeUTC = (hour - 1 + 24) % 24; // Previous hour was the end
          currentWindow.durationHours = ((currentWindow.endTimeUTC - currentWindow.startTimeUTC! + 24) % 24) + 1;
          
          // Sum original trade counts for the window period
          let tradesInThisWindow = 0;
          for (let h = 0; h < currentWindow.durationHours; h++) {
            const actualHourInWindow = (currentWindow.startTimeUTC! + h) % 24;
            tradesInThisWindow += hourlyTradeCounts[actualHourInWindow] || 0;
          }
          currentWindow.tradeCountInWindow = tradesInThisWindow;

          if (currentWindow.tradeCountInWindow > 0) { // Only add if it actually has trades from original data
            currentWindow.percentageOfTotalTrades = (currentWindow.tradeCountInWindow / totalNetworkTransactions) * 100;
            currentWindow.avgTradesPerHourInWindow = currentWindow.tradeCountInWindow / currentWindow.durationHours;
            identifiedWindows.push(currentWindow as IdentifiedTradingWindow);
          }
          currentWindow = null;
        }
      }
    }

    // Check if a window was open and extended to hour 23
    if (currentWindow) {
      currentWindow.endTimeUTC = 23;
      currentWindow.durationHours = ((currentWindow.endTimeUTC - currentWindow.startTimeUTC! + 24) % 24) + 1;
      
      let tradesInThisWindow = 0;
      for (let h = 0; h < currentWindow.durationHours; h++) {
        const actualHourInWindow = (currentWindow.startTimeUTC! + h) % 24;
        tradesInThisWindow += hourlyTradeCounts[actualHourInWindow] || 0;
      }
      currentWindow.tradeCountInWindow = tradesInThisWindow;

      if (currentWindow.tradeCountInWindow > 0) {
        currentWindow.percentageOfTotalTrades = (currentWindow.tradeCountInWindow / totalNetworkTransactions) * 100;
        currentWindow.avgTradesPerHourInWindow = currentWindow.tradeCountInWindow / currentWindow.durationHours;
        identifiedWindows.push(currentWindow as IdentifiedTradingWindow);
      }
    }

    // 4. (Optional) Filter out very insignificant windows
    // e.g., duration < 2 hours AND percentageOfTotalTrades < 5%
    const significantWindows = identifiedWindows.filter(w => {
      return !(w.durationHours < 2 && w.percentageOfTotalTrades < 5);
    });

    // 6. (New Step) Merge adjacent or very close significant windows
    if (significantWindows.length < 2) {
      this.logger.debug(`Identified ${significantWindows.length} active trading windows after filtering. No merging needed.`);
      return significantWindows;
    }

    const mergedWindows: IdentifiedTradingWindow[] = [];
    let currentMergedWindow = { ...significantWindows[0] }; // Start with the first significant window

    for (let i = 1; i < significantWindows.length; i++) {
      const nextWindow = significantWindows[i];
      const gapHours = (nextWindow.startTimeUTC - currentMergedWindow.endTimeUTC! + 24 - 1) % 24;
      
      // Define merge condition: e.g., gap is 0 or 1 hour (windows are adjacent or separated by 1 hour)
      // Add a check for the smoothed activity in the gap hour if it's a 1-hour gap.
      let canMerge = false;
      if (gapHours === 0) { // Adjacent
          canMerge = true;
      } else if (gapHours === 1) {
          const gapHour = (currentMergedWindow.endTimeUTC! + 1) % 24;
          // Merge if the gap hour's smoothed activity is not drastically lower than the threshold (e.g., at least 50% of threshold)
          if (smoothedHourlyCounts[gapHour] >= activityThreshold * 0.5) {
              canMerge = true;
          }
      }

      if (canMerge) {
        // Merge nextWindow into currentMergedWindow
        currentMergedWindow.endTimeUTC = nextWindow.endTimeUTC;
        currentMergedWindow.durationHours = ((currentMergedWindow.endTimeUTC - currentMergedWindow.startTimeUTC! + 24) % 24) + 1;
        
        // Recalculate tradeCountInWindow, percentageOfTotalTrades, avgTradesPerHourInWindow for the new merged window
        let mergedTrades = 0;
        for (let h = 0; h < currentMergedWindow.durationHours; h++) {
          const actualHourInWindow = (currentMergedWindow.startTimeUTC! + h) % 24;
          mergedTrades += hourlyTradeCounts[actualHourInWindow] || 0;
        }
        currentMergedWindow.tradeCountInWindow = mergedTrades;
        currentMergedWindow.percentageOfTotalTrades = (mergedTrades / totalNetworkTransactions) * 100;
        currentMergedWindow.avgTradesPerHourInWindow = mergedTrades / currentMergedWindow.durationHours;
      } else {
        // Finalize the currentMergedWindow and start a new one
        mergedWindows.push(currentMergedWindow);
        currentMergedWindow = { ...nextWindow };
      }
    }
    mergedWindows.push(currentMergedWindow); // Add the last processed window

    this.logger.debug(`Identified ${mergedWindows.length} active trading windows after merging.`);
    return mergedWindows;
  }

  private calculateSessionMetrics(swapRecords: SwapAnalysisInput[]): {
    sessionCount: number;
    avgTradesPerSession: number;
    activeTradingPeriods: ActiveTradingPeriods;
    averageSessionStartHour: number;
    averageSessionDurationMinutes: number;
  } {
    this.logger.debug(`Calculating session metrics for ${swapRecords.length} records.`);
    if (swapRecords.length === 0) {
      return {
        sessionCount: 0,
        avgTradesPerSession: 0,
        activeTradingPeriods: {
          hourlyTradeCounts: {},
          identifiedWindows: [],
          activityFocusScore: 0,
        },
        averageSessionStartHour: 0,
        averageSessionDurationMinutes: 0,
      };
    }

    const timestamps = swapRecords.map(r => r.timestamp).sort((a, b) => a - b);
    const totalTrades = timestamps.length;

    // --- 1. Calculate hourlyTradeCounts (raw UTC hourly counts) ---
    const hourlyTradeCounts: Record<number, number> = {};
    for (let i = 0; i < 24; i++) hourlyTradeCounts[i] = 0; 

    timestamps.forEach(ts => {
      const date = new Date(ts * 1000);
      const hour = date.getUTCHours();
      hourlyTradeCounts[hour] = (hourlyTradeCounts[hour] || 0) + 1;
    });

    // --- 2. Identify Trading Windows using the sophisticated _identifyActiveTradingWindows method ---
    const identifiedWindows = this._identifyActiveTradingWindows(hourlyTradeCounts, totalTrades);
    
    // --- 3. Calculate Activity Focus Score ---
    const tradesInAllWindows = identifiedWindows.reduce((sum, w) => sum + w.tradeCountInWindow, 0);
    const activityFocusScore = totalTrades > 0 ? (tradesInAllWindows / totalTrades) * 100 : 0;

    // --- 4. Session Identification (Original/Simplified Logic) ---
    let sessionCount = 0;
    let currentSessionTradeCount = 0; 
    let currentSessionStartTime = 0;
    let totalSessionDurationMinutes = 0;
    const sessionStartHours: number[] = [];
    const SESSION_GAP_THRESHOLD_HOURS = this.config.sessionGapThresholdHours ?? 2;

    if (timestamps.length > 0) {
      sessionCount = 1;
      currentSessionTradeCount = 1;
      currentSessionStartTime = timestamps[0];
      const startDate = new Date(timestamps[0] * 1000);
      sessionStartHours.push(startDate.getUTCHours());

      for (let i = 1; i < timestamps.length; i++) {
        const previousTimestamp = timestamps[i-1];
        const currentTimestamp = timestamps[i];
        const diffHours = (currentTimestamp - previousTimestamp) / 3600;

        if (diffHours > SESSION_GAP_THRESHOLD_HOURS) {
          totalSessionDurationMinutes += (previousTimestamp - currentSessionStartTime) / 60;
          sessionCount++;
          currentSessionTradeCount = 1;
          currentSessionStartTime = currentTimestamp;
          const currentStartDate = new Date(currentTimestamp * 1000);
          sessionStartHours.push(currentStartDate.getUTCHours());
        } else {
          currentSessionTradeCount++;
        }
      }
      totalSessionDurationMinutes += (timestamps[timestamps.length - 1] - currentSessionStartTime) / 60;
    }
    
    const avgTradesPerSession = sessionCount > 0 ? totalTrades / sessionCount : 0;
    const averageSessionDurationMinutes = sessionCount > 0 ? totalSessionDurationMinutes / sessionCount : 0;
    
    let averageSessionStartHour = 0;
    if (sessionStartHours.length > 0) {
        const sumSin = sessionStartHours.reduce((sum, h) => sum + Math.sin(h * (2 * Math.PI / 24)), 0);
        const sumCos = sessionStartHours.reduce((sum, h) => sum + Math.cos(h * (2 * Math.PI / 24)), 0);
        averageSessionStartHour = (Math.atan2(sumSin, sumCos) * (24 / (2 * Math.PI)) + 24) % 24;
        if (averageSessionStartHour < 0) averageSessionStartHour += 24;
    }

    return {
      sessionCount,
      avgTradesPerSession,
      activeTradingPeriods: {
        hourlyTradeCounts,
        identifiedWindows, // Now populated by _identifyActiveTradingWindows
        activityFocusScore,
      },
      averageSessionStartHour,
      averageSessionDurationMinutes,
    };
  }

  /**
   * Simple scam detection based on totalValue vs trade count.
   * This is the core insight: scam tokens have high trade counts but zero/low value.
   * 
   * @param tradeCount - Number of trades for this token
   * @param totalValue - Total SOL value of all trades
   * @param totalUsdcValue - Total USDC value of all trades (optional)
   * @returns true if this token is likely a scam
   */
  private isScamTokenByValue(tradeCount: number, totalValue: number, totalUsdcValue?: number): boolean {
    // Get thresholds from config or use defaults
    const thresholds = this.config.scamFiltering?.thresholds || {};
    const minTradeCount = thresholds.minTradeCount ?? 100;  // Default: 100+ trades
    const minTotalValue = thresholds.minTotalValue ?? 0.001; // Default: 0.001 SOL minimum
    const minTotalUsdcValue = thresholds.minTotalUsdcValue ?? 5; // Default: $0.01 USDC minimum

    // Check if token has meaningful value in either SOL or USDC
    const hasSolValue = totalValue >= minTotalValue;
    const hasUsdcValue = totalUsdcValue && totalUsdcValue >= minTotalUsdcValue;
    const hasAnyValue = hasSolValue || hasUsdcValue;

    // A token is considered a scam if:
    // 1. It has many trades (indicating activity) AND no meaningful value in either currency
    const highTradeCountNoValue = (tradeCount >= minTradeCount && !hasAnyValue);

    // 2. OR, if it has absolutely zero value in both currencies, regardless of trade count
    const zeroTotalValue = (totalValue === 0 && (!totalUsdcValue || totalUsdcValue === 0));

    return highTradeCountNoValue || zeroTotalValue;
  }
}
