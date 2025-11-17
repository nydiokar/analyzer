import { createLogger } from '../../utils/logger';
import { SwapAnalysisInput } from '@prisma/client';
import { BehavioralMetrics } from '@/types/behavior';
import { TRANSACTION_MAPPING_CONFIG } from '../../../config/constants';

const logger = createLogger('BotDetector');

export interface BotDetectionResult {
  classification: 'bot' | 'human' | 'unknown' | 'institutional';
  confidence: number; // 0.0 - 1.0
  botType?: 'arbitrage' | 'mev' | 'market_maker' | 'liquidity' | 'spam';
  patterns: string[]; // Detected behavioral patterns
  reasons: string[]; // Human-readable reasons for classification
  metrics: {
    dailyTokensTraded: number;
    avgTransactionValue: number;
    totalTransactions: number;
    flipperScore?: number;
    frequencyScore: number;
    consistencyScore: number;
  };
}

export interface DailyActivity {
  [date: string]: Set<string>; // date -> set of unique tokens traded
}

export class BotDetector {
  private readonly logger = createLogger('BotDetector');

  /**
   * Analyzes swap records and behavioral metrics to classify wallet type
   */
  public async detectBotBehavior(
    swapRecords: SwapAnalysisInput[],
    behavioralMetrics?: BehavioralMetrics,
    walletAddress?: string
  ): Promise<BotDetectionResult> {
    if (swapRecords.length === 0) {
      return this.createResult('unknown', 0, [], ['No transaction data available']);
    }

    const patterns: string[] = [];
    const reasons: string[] = [];
    let confidence = 0;
    let classification: 'bot' | 'human' | 'unknown' | 'institutional' = 'unknown';
    let botType: 'arbitrage' | 'mev' | 'market_maker' | 'liquidity' | 'spam' | undefined;

    // Calculate basic metrics
    const totalTransactions = swapRecords.length;
    const totalValue = swapRecords.reduce((sum, record) => sum + (record.associatedSolValue || 0), 0);
    const avgTransactionValue = totalValue / totalTransactions;
    const uniqueTokens = new Set(swapRecords.map(r => r.mint)).size;

    // Analyze daily activity
    const dailyActivity = this.calculateDailyActivity(swapRecords);
    const maxDailyTokens = Math.max(...Object.values(dailyActivity).map(tokenSet => tokenSet.size));

    // Calculate frequency metrics
    const timespan = this.calculateTimespan(swapRecords);
    const transactionsPerDay = totalTransactions / (timespan / (24 * 60 * 60));
    const frequencyScore = Math.min(transactionsPerDay / 50, 1); // Normalize to 0-1

    // Calculate consistency score (how regular the trading pattern is)
    const consistencyScore = this.calculateConsistencyScore(swapRecords);

    let botScore = 0;

    // Pattern 1: High-frequency micro transactions (Strong bot indicator)
    if (totalTransactions >= TRANSACTION_MAPPING_CONFIG.HIGH_FREQUENCY_THRESHOLD && 
        avgTransactionValue < TRANSACTION_MAPPING_CONFIG.MICRO_TRANSACTION_SOL_THRESHOLD) {
      botScore += 0.4;
      patterns.push('high_frequency_micro_transactions');
      reasons.push(`High frequency (${totalTransactions}) with micro transactions (avg: ${avgTransactionValue.toFixed(4)} SOL)`);
    }

    // Pattern 2: Excessive daily token trading (Strong bot indicator)
    if (maxDailyTokens > 50) {
      botScore += 0.3;
      patterns.push('excessive_daily_tokens');
      reasons.push(`Trades too many tokens per day (max: ${maxDailyTokens})`);
    }

    // Pattern 3: True Flipper behavior (Bot indicator)
    if (behavioralMetrics?.tradingStyle === 'True Flipper' && behavioralMetrics?.confidenceScore > 0.8) {
      botScore += 0.25;
      patterns.push('true_flipper');
      reasons.push('Exhibits True Flipper behavior with high confidence');
    }

    // Pattern 4: Extremely high consistency (Bot indicator)
    if (consistencyScore > 0.9) {
      botScore += 0.2;
      patterns.push('high_consistency');
      reasons.push('Trading pattern is too consistent for human behavior');
    }

    // Pattern 5: Round numbers preference (Bot indicator)
    if (this.detectRoundNumberPreference(swapRecords)) {
      botScore += 0.15;
      patterns.push('round_numbers');
      reasons.push('Prefers round number amounts');
    }

    // Pattern 6: Very short holding periods (Bot indicator)
    // ✅ REFACTORED: Use MEDIAN hold time (outlier-robust) with new 3-minute threshold
    // Median is better for bot detection - not skewed by occasional longer holds
    const medianHoldTime = behavioralMetrics?.historicalPattern?.medianCompletedHoldTimeHours
                        || behavioralMetrics?.medianHoldTime;

    // Bot threshold: <3 minutes (0.05 hours) = ultra-fast flipping behavior
    if (medianHoldTime && medianHoldTime < 0.05) {
      botScore += 0.2;
      patterns.push('ultra_short_holds');
      reasons.push(`Extremely short typical holding time: ${(medianHoldTime * 60).toFixed(1)} minutes (median)`);
    }

    // Determine bot type if classified as bot
    if (botScore > 0.5) {
      classification = 'bot';
      
      // Determine specific bot type
      if (patterns.includes('high_frequency_micro_transactions') && 
          patterns.includes('true_flipper')) {
        botType = 'arbitrage';
      } else if (patterns.includes('excessive_daily_tokens')) {
        botType = 'market_maker';
      } else if (avgTransactionValue < 0.01) {
        botType = 'spam';
      } else {
        botType = 'mev';
      }
    } else if (botScore < 0.2) {
      classification = 'human';
      reasons.push('Behavior patterns consistent with human trading');
    } else {
      classification = 'unknown';
      reasons.push('Mixed indicators, unable to classify with confidence');
    }

    confidence = Math.min(Math.max(botScore, 0.1), 0.95); // Clamp between 0.1 and 0.95

    return {
      classification,
      confidence,
      botType,
      patterns,
      reasons,
      metrics: {
        dailyTokensTraded: maxDailyTokens,
        avgTransactionValue,
        totalTransactions,
        flipperScore: behavioralMetrics?.flipperScore,
        frequencyScore,
        consistencyScore,
      }
    };
  }

  private calculateDailyActivity(swapRecords: SwapAnalysisInput[]): DailyActivity {
    const dailyActivity: DailyActivity = {};
    
    swapRecords.forEach(record => {
      const date = new Date(record.timestamp * 1000).toISOString().split('T')[0];
      if (!dailyActivity[date]) {
        dailyActivity[date] = new Set();
      }
      dailyActivity[date].add(record.mint);
    });
    
    return dailyActivity;
  }

  private calculateTimespan(swapRecords: SwapAnalysisInput[]): number {
    if (swapRecords.length < 2) return 1;
    
    const timestamps = swapRecords.map(r => r.timestamp).sort((a, b) => a - b);
    return timestamps[timestamps.length - 1] - timestamps[0];
  }

  private calculateConsistencyScore(swapRecords: SwapAnalysisInput[]): number {
    if (swapRecords.length < 5) return 0;

    // Calculate intervals between transactions
    const sortedRecords = swapRecords.sort((a, b) => a.timestamp - b.timestamp);
    const intervals: number[] = [];
    
    for (let i = 1; i < sortedRecords.length; i++) {
      intervals.push(sortedRecords[i].timestamp - sortedRecords[i-1].timestamp);
    }

    // Calculate coefficient of variation (lower = more consistent)
    const mean = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - mean, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = stdDev / mean;

    // Convert to consistency score (1 = perfectly consistent, 0 = highly random)
    return Math.max(0, 1 - Math.min(coefficientOfVariation, 2) / 2);
  }

  private detectRoundNumberPreference(swapRecords: SwapAnalysisInput[]): boolean {
    let roundNumberCount = 0;
    
    swapRecords.forEach(record => {
      const amount = record.amount;
      
      // Check if amount is a "round" number (ends in many zeros or is a simple fraction)
      if (amount % 1 === 0 || // Whole number
          amount % 0.1 === 0 || // Ends in .0
          amount % 0.01 === 0 || // Ends in .00
          this.isSimpleFraction(amount)) {
        roundNumberCount++;
      }
    });

    return roundNumberCount / swapRecords.length > 0.7; // 70% of transactions are round numbers
  }

  private isSimpleFraction(amount: number): boolean {
    // Check if the number is a simple fraction like 0.5, 0.25, 0.33, etc.
    const commonFractions = [0.5, 0.25, 0.33, 0.66, 0.75, 0.125, 0.375, 0.625, 0.875];
    const fractionalPart = amount % 1;
    
    return commonFractions.some(fraction => Math.abs(fractionalPart - fraction) < 0.01);
  }

  private createResult(
    classification: 'bot' | 'human' | 'unknown' | 'institutional',
    confidence: number,
    patterns: string[],
    reasons: string[],
    botType?: 'arbitrage' | 'mev' | 'market_maker' | 'liquidity' | 'spam'
  ): BotDetectionResult {
    return {
      classification,
      confidence,
      botType,
      patterns,
      reasons,
      metrics: {
        dailyTokensTraded: 0,
        avgTransactionValue: 0,
        totalTransactions: 0,
        frequencyScore: 0,
        consistencyScore: 0,
      }
    };
  }
} 