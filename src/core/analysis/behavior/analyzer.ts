import { BehaviorAnalysisConfig } from '@/types/analysis';
import { BehavioralMetrics } from '@/types/behavior';
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
      tradingFrequency: { daily: 0, weekly: 0, monthly: 0 },
      tokenPreferences: { mostTraded: [], mostProfitable: [], mostHeld: [] },
      riskMetrics: { averageTransactionSize: 0, largestTransaction: 0, diversificationScore: 0 },
      profitMetrics: { totalPnL: 0, winRate: 0, averageProfitPerTrade: 0, profitConsistency: 0 }
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
}
