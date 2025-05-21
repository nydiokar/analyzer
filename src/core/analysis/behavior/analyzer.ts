import { BehaviorAnalysisConfig } from '@/types/analysis';
import { BehavioralMetrics, ActiveTradingPeriods, IdentifiedTradingWindow } from '@/types/behavior';
import { SwapAnalysisInput } from '@prisma/client';
import { createLogger } from 'core/utils/logger';

// Create logger at module level? Or pass instance?
// Let's keep it internal to the class for now.

// --- Internal Types specific to this analyzer ---
interface TokenTrade {
  timestamp: number;
  direction: 'in' | 'out';
  amount: number;
  associatedSolValue: number;
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
    this.logger.info('BehaviorAnalyzer instantiated with behavior-specific config.');
  }

  /**
   * Public method to analyze trading behavior from raw swap records.
   * Orchestrates the internal steps of sequence building, metric calculation, and classification.
   * 
   * @param swapRecords - Array of SwapAnalysisInput records for the wallet.
   * @returns BehavioralMetrics object.
   */
  public analyze(swapRecords: SwapAnalysisInput[]): BehavioralMetrics {
    this.logger.debug(`Starting behavior analysis for ${swapRecords.length} swap records.`);
    
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
      let durationDays = (lastTransactionTimestamp - firstTransactionTimestamp) / (60 * 60 * 24);
      if (durationDays <= 0) {
        durationDays = 1; // Avoid division by zero or negative for single-day activity, count as 1 day
      }
      metrics.tradingFrequency.tradesPerDay = metrics.totalTradeCount / durationDays;
      metrics.tradingFrequency.tradesPerWeek = metrics.tradingFrequency.tradesPerDay * 7;
      metrics.tradingFrequency.tradesPerMonth = metrics.tradingFrequency.tradesPerDay * 30.4375; // Average days per month
    }

    // Calculate session metrics
    const sessionMetrics = this.calculateSessionMetrics(swapRecords);
    metrics.sessionCount = sessionMetrics.sessionCount;
    metrics.avgTradesPerSession = sessionMetrics.avgTradesPerSession;
    metrics.activeTradingPeriods = sessionMetrics.activeTradingPeriods;
    metrics.averageSessionStartHour = sessionMetrics.averageSessionStartHour;
    metrics.averageSessionDurationMinutes = sessionMetrics.averageSessionDurationMinutes;

    // 3. Classify trading style based on revised criteria
    this.classifyTradingStyle(metrics);

    // Add timestamps to the final metrics object
    metrics.firstTransactionTimestamp = firstTransactionTimestamp;
    metrics.lastTransactionTimestamp = lastTransactionTimestamp;
    
    this.logger.debug('Completed behavior analysis orchestration.');
    return metrics;
  }

  // --- Private Helper Methods (Extracted Logic) ---

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
      sequenceConsistency: 0,
      flipperScore: 0,
      // Supporting metrics
      uniqueTokensTraded: 0,
      tokensWithBothBuyAndSell: 0,
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
      if (buyCount > 0 && sellCount > 0) {
        buySellRatio = buyCount / sellCount;
        if (buySellRatio < 1) buySellRatio = 1 / buySellRatio;
      }
      sequences.push({
        mint,
        trades: sortedRecords.map(r => ({
          timestamp: r.timestamp,
          direction: r.direction as 'in' | 'out',
          amount: r.amount,
          associatedSolValue: r.associatedSolValue ?? 0 // Handle null
        })),
        buyCount,
        sellCount,
        completePairs: 0, // Calculated later
        buySellRatio
      });
    }
    return sequences;
  }

  private countBuySellPairs(trades: TokenTradeSequence['trades']): number {
    let pairCount = 0;
    let expectingDirection: 'in' | 'out' = 'in';
    for (const trade of trades) {
      if (trade.direction === expectingDirection) {
        expectingDirection = expectingDirection === 'in' ? 'out' : 'in';
        if (expectingDirection === 'in') pairCount++; // Completed a sell after a buy
      } else if (trade.direction === 'in' && expectingDirection === 'out') {
        // Reset: Saw a buy when expecting a sell
        expectingDirection = 'out'; // Still need a sell for the new buy
      }
    }
    return pairCount;
  }

  /**
   * Calculates flip durations (time between buy and subsequent sell) in hours.
   */
  private calculateFlipDurations(trades: TokenTradeSequence['trades']): number[] {
    const durations: number[] = [];
    let lastBuyTimestamp = -1;
    const secondsToHours = (seconds: number) => seconds / 3600;

    for (const trade of trades) {
      if (trade.direction === 'in') {
        lastBuyTimestamp = trade.timestamp;
      } else if (trade.direction === 'out' && lastBuyTimestamp !== -1) {
        const durationSeconds = trade.timestamp - lastBuyTimestamp;
        durations.push(secondsToHours(durationSeconds));
        lastBuyTimestamp = -1; // Reset after a sell completes the pair
      }
    }
    return durations;
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
   * Calculates the overall behavioral metrics from token sequences.
   */
  private calculateBehavioralMetrics(sequences: TokenTradeSequence[]): BehavioralMetrics {
    this.logger.debug(`Calculating metrics for ${sequences.length} token sequences.`);
    const metrics = this.getEmptyMetrics();
    if (sequences.length === 0) return metrics;

    metrics.uniqueTokensTraded = sequences.length;
    metrics.tokensWithBothBuyAndSell = sequences.filter(s => s.buyCount > 0 && s.sellCount > 0).length;
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
            // If maxPossiblePairs is 0, consistency is irrelevant (or 1?)
            return sum + (maxPossiblePairs > 0 ? (s.completePairs / maxPossiblePairs) : 1);
         }
         return sum;
      }, 0);
      metrics.sequenceConsistency = consistencySum / metrics.tokensWithBothBuyAndSell;

      metrics.averageTradesPerToken = metrics.totalTradeCount / metrics.uniqueTokensTraded;
    }
    
    const timeCalcs = this.calculateTimeDistributions(sequences);
    metrics.tradingTimeDistribution = timeCalcs.distribution;
    metrics.averageFlipDurationHours = timeCalcs.avgDuration;
    metrics.medianHoldTime = timeCalcs.medianDuration;
    metrics.percentTradesUnder1Hour = timeCalcs.percentUnder1Hour;
    metrics.percentTradesUnder4Hours = timeCalcs.percentUnder4Hours;

    metrics.flipperScore = this.calculateFlipperScore(metrics);

    // Calculate mostTradedTokens
    const tokenDataForMostTraded: { 
        [mint: string]: { count: number, totalValue: number, firstSeen: number, lastSeen: number }
    } = {};

    sequences.forEach(seq => {
      let firstSeen = Infinity;
      let lastSeen = 0;
      let totalValue = 0;
      seq.trades.forEach(trade => {
        if (trade.timestamp < firstSeen) firstSeen = trade.timestamp;
        if (trade.timestamp > lastSeen) lastSeen = trade.timestamp;
        totalValue += trade.associatedSolValue;
      });

      tokenDataForMostTraded[seq.mint] = {
        count: seq.buyCount + seq.sellCount,
        totalValue: totalValue,
        firstSeen: firstSeen === Infinity ? 0 : firstSeen,
        lastSeen: lastSeen,
      };
    });

    metrics.tokenPreferences.mostTradedTokens = Object.entries(tokenDataForMostTraded)
      .sort(([, dataA], [, dataB]) => dataB.count - dataA.count) // Sort by trade count
      .slice(0, 5) // Top 5
      .map(([mint, data]) => ({
        mint: mint,
        count: data.count,
        totalValue: data.totalValue,
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
    
    // Penalize heavily lopsided buy/sell ratios unless total trades are very low
    if (metrics.totalTradeCount > 10) {
      if (metrics.buySellRatio > 3 || metrics.buySellRatio < (1/3)) {
        score *= 0.7; 
      }
    }
    
    return Math.max(0, Math.min(1, score)); // Clamp between 0 and 1
  }

  /**
   * Classifies the trading style based on calculated metrics.
   */
  private classifyTradingStyle(metrics: BehavioralMetrics): void {
    let style = 'Inconclusive';
    let confidence = 0;

    const { 
      flipperScore, 
      buySellSymmetry, 
      sequenceConsistency, 
      averageFlipDurationHours, 
      medianHoldTime, 
      percentTradesUnder1Hour,
      percentTradesUnder4Hours,
      buySellRatio,
      tradingTimeDistribution,
      totalTradeCount,
      tokensWithBothBuyAndSell,
      totalBuyCount,     // Ensure this is destructured
      totalSellCount     // Ensure this is destructured
    } = metrics;

    const isBalanced = buySellSymmetry > 0.7 && sequenceConsistency > 0.7;
    const isFast = percentTradesUnder4Hours > 0.6 || averageFlipDurationHours < 6;
    const isUltraFast = percentTradesUnder1Hour > 0.5 || averageFlipDurationHours < 1;

    if (totalTradeCount < 5 || tokensWithBothBuyAndSell < 2) {
       style = 'Low Activity';
       confidence = 1.0;
    } else if (isUltraFast && isBalanced && flipperScore > 0.75) {
      style = 'True Flipper';
      confidence = Math.min(1, flipperScore + (buySellSymmetry - 0.7) + (percentTradesUnder1Hour - 0.5));
    } else if (isFast && isBalanced && flipperScore > 0.5) {
      style = 'Fast Trader';
      confidence = Math.min(1, flipperScore * 0.8 + (buySellSymmetry - 0.5) + (percentTradesUnder4Hours - 0.6));
    } else if (tradingTimeDistribution.swing + tradingTimeDistribution.position > 0.5 && isBalanced) {
      style = 'Swing Trader';
      confidence = Math.min(1, (tradingTimeDistribution.swing + tradingTimeDistribution.position) + (buySellSymmetry - 0.5));
    } else if (tradingTimeDistribution.position > 0.6) {
      style = 'Position Trader';
       confidence = Math.min(1, tradingTimeDistribution.position * 1.2);
    } else if (buySellRatio > 2.5 && totalBuyCount > totalSellCount * 2 && totalSellCount > 0) { // Avoid Infinity > ratio check if sell count is 0
      style = 'Accumulator';
      confidence = Math.min(1, (buySellRatio - 2) * 0.3 + (1 - buySellSymmetry) * 0.5); // Confidence higher if less symmetric
    } else if (buySellRatio !== Infinity && buySellRatio < (1/2.5) && totalSellCount > totalBuyCount * 2 && totalBuyCount > 0) { // Avoid check if buy count is 0
      style = 'Distributor';
      confidence = Math.min(1, ((1/buySellRatio) - 2) * 0.3 + (1 - buySellSymmetry) * 0.5);
    } else if (flipperScore > 0.4) {
       style = 'Partial Flipper'; // Default for moderately flippy
       confidence = flipperScore * 0.8;
    } else {
       style = 'Mixed / Unclear';
       confidence = 0.3;
    }

    metrics.tradingStyle = style;
    metrics.confidenceScore = Math.max(0, Math.min(1, confidence)); // Clamp confidence
    this.logger.debug(`Classified style as ${style} with confidence ${metrics.confidenceScore.toFixed(2)}`);
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
    activeTradingPeriods: ActiveTradingPeriods; // Changed from activeHoursDistribution
    averageSessionStartHour: number;
    averageSessionDurationMinutes: number;
  } {
    const hourlyTradeCounts: Record<number, number> = {};
    for (let i = 0; i < 24; i++) hourlyTradeCounts[i] = 0;
    
    let totalNetworkTransactions = 0; // To pass to _identifyActiveTradingWindows

    if (swapRecords.length === 0) {
      return {
        sessionCount: 0,
        avgTradesPerSession: 0,
        activeTradingPeriods: {
          hourlyTradeCounts,
          identifiedWindows: [],
          activityFocusScore: 0,
        },
        averageSessionStartHour: 0,
        averageSessionDurationMinutes: 0,
      };
    }

    const sortedRecords = [...swapRecords].sort((a, b) => a.timestamp - b.timestamp);
    const SESSION_GAP_THRESHOLD_MINUTES = 60;
    let sessionCount = 0;
    let currentSessionTrades: SwapAnalysisInput[] = [];
    const sessionStartHours: number[] = []; // Keep collecting individual start hours
    const sessionDurationsMinutes: number[] = [];
    let totalTradesInSessions = 0;

    sortedRecords.forEach((record, index) => {
      const hour = new Date(record.timestamp * 1000).getUTCHours();
      hourlyTradeCounts[hour] = (hourlyTradeCounts[hour] || 0) + 1;
      totalNetworkTransactions++; // Increment total transactions count

      if (currentSessionTrades.length === 0) {
        currentSessionTrades.push(record);
        sessionStartHours.push(new Date(record.timestamp * 1000).getUTCHours());
      } else {
        const prevRecord = currentSessionTrades[currentSessionTrades.length - 1];
        const gapMinutes = (record.timestamp - prevRecord.timestamp) / 60;
        if (gapMinutes <= SESSION_GAP_THRESHOLD_MINUTES) {
          currentSessionTrades.push(record);
        } else {
          // End current session
          sessionCount++;
          totalTradesInSessions += currentSessionTrades.length;
          const sessionDuration = (currentSessionTrades[currentSessionTrades.length -1].timestamp - currentSessionTrades[0].timestamp) / 60;
          sessionDurationsMinutes.push(sessionDuration);
          // Start new session
          currentSessionTrades = [record];
          sessionStartHours.push(new Date(record.timestamp * 1000).getUTCHours());
        }
      }
    });

    // Account for the last session
    if (currentSessionTrades.length > 0) {
      sessionCount++;
      totalTradesInSessions += currentSessionTrades.length;
      const sessionDuration = (currentSessionTrades[currentSessionTrades.length -1].timestamp - currentSessionTrades[0].timestamp) / 60;
      sessionDurationsMinutes.push(sessionDuration);
    }

    const avgTradesPerSession = sessionCount > 0 ? totalTradesInSessions / sessionCount : 0;
    
    // Calculate circular mean for averageSessionStartHour
    let averageSessionStartHour = 0;
    if (sessionStartHours.length > 0) {
      const angleSumX = sessionStartHours.reduce((sum, hour) => sum + Math.cos(hour * (2 * Math.PI / 24)), 0);
      const angleSumY = sessionStartHours.reduce((sum, hour) => sum + Math.sin(hour * (2 * Math.PI / 24)), 0);
      const meanAngle = Math.atan2(angleSumY, angleSumX);
      averageSessionStartHour = (meanAngle * (24 / (2 * Math.PI)) + 24) % 24;
    } // else remains 0

    const averageSessionDurationMinutes = sessionDurationsMinutes.length > 0 ? sessionDurationsMinutes.reduce((a,b) => a+b,0) / sessionDurationsMinutes.length : 0;

    // New logic for activeTradingPeriods
    const identifiedWindows = this._identifyActiveTradingWindows(hourlyTradeCounts, totalNetworkTransactions);
    
    let tradesInAllWindows = 0;
    identifiedWindows.forEach(window => {
      tradesInAllWindows += window.tradeCountInWindow;
    });

    const activityFocusScore = totalNetworkTransactions > 0 ? tradesInAllWindows / totalNetworkTransactions : 0;

    const activeTradingPeriods: ActiveTradingPeriods = {
      hourlyTradeCounts,
      identifiedWindows,
      activityFocusScore,
    };

    return {
      sessionCount,
      avgTradesPerSession,
      activeTradingPeriods, // Now returning the full object
      averageSessionStartHour,
      averageSessionDurationMinutes,
    };
  }
}
