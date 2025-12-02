/**
 * Trading Speed Classification Constants
 *
 * Used by: TradingInterpretation.speedCategory
 * Purpose: General wallet behavior analysis (uses ALL positions: active + completed)
 * These thresholds define trading speed categories based on MEDIAN hold time
 * (robust to outliers, represents typical behavior)
 */

export const TRADING_SPEED_THRESHOLDS_MINUTES = {
  ULTRA_FLIPPER: 3,      // <3 minutes: Extreme flipping (bot-like, MEV, arbitrage)
  FLIPPER: 10,           // 3-10 minutes: Very fast flipping (snipe-and-dump)
  FAST_TRADER: 60,       // 10-60 minutes: Fast day trading (intra-hour momentum)
  DAY_TRADER: 1440,      // 1-24 hours: Same-day trading (standard day trading)
  SWING_TRADER: 10080,   // 1-7 days: Multi-day holds (swing positions)
  // 7+ days = POSITION_TRADER (long-term holds)
} as const;

export const TRADING_SPEED_THRESHOLDS_HOURS = {
  ULTRA_FLIPPER: 0.05,      // 3 minutes
  FLIPPER: 0.167,           // 10 minutes
  FAST_TRADER: 1,           // 1 hour
  DAY_TRADER: 24,           // 1 day
  SWING_TRADER: 168,        // 7 days
} as const;

/**
 * Holder Behavior Classification Constants
 *
 * Used by: WalletHistoricalPattern.behaviorType
 * Purpose: Holder risk analysis and exit predictions (uses COMPLETED positions only)
 * More granular than trading speed - optimized for memecoin holder behavior
 */

export const HOLDER_BEHAVIOR_THRESHOLDS_MINUTES = {
  SNIPER: 1,        // <1 min: Bot/MEV behavior
  SCALPER: 5,       // 1-5 min: Ultra-fast scalping
  MOMENTUM: 30,     // 5-30 min: Momentum trading
  INTRADAY: 240,    // 30min-4h: Short-term intraday (4h * 60)
  DAY_TRADER: 1440, // 4-24h: Day trading (24h * 60)
  SWING: 10080,     // 1-7 days: Swing trading (7d * 24 * 60)
  POSITION: 43200,  // 7-30 days: Position trading (30d * 24 * 60)
  // 30+ days = HOLDER
} as const;

export const HOLDER_BEHAVIOR_THRESHOLDS_HOURS = {
  SNIPER: 1 / 60,   // 0.0167 hours (1 minute)
  SCALPER: 5 / 60,  // 0.0833 hours (5 minutes)
  MOMENTUM: 0.5,    // 30 minutes
  INTRADAY: 4,      // 4 hours
  DAY_TRADER: 24,   // 24 hours
  SWING: 168,       // 7 days
  POSITION: 720,    // 30 days
  // 30+ days = HOLDER
} as const;

/**
 * Trading style categories (for general wallet behavior)
 */
export type TradingSpeedCategory =
  | 'ULTRA_FLIPPER'
  | 'FLIPPER'
  | 'FAST_TRADER'
  | 'DAY_TRADER'
  | 'SWING_TRADER'
  | 'POSITION_TRADER'
  | 'LOW_ACTIVITY';

/**
 * Holder behavior categories (for exit predictions)
 */
export type HolderBehaviorType =
  | 'SNIPER'
  | 'SCALPER'
  | 'MOMENTUM'
  | 'INTRADAY'
  | 'DAY_TRADER'
  | 'SWING'
  | 'POSITION'
  | 'HOLDER';

/**
 * Behavioral patterns based on buy/sell characteristics
 */
export type BehavioralPattern =
  | 'BALANCED'      // Symmetrical buy/sell behavior
  | 'ACCUMULATOR'   // More buying than selling
  | 'DISTRIBUTOR'   // More selling than buying
  | 'HOLDER'        // Mostly buys, rarely sells
  | 'DUMPER';       // Mostly sells

/**
 * Bot detection thresholds
 */
export const BOT_DETECTION = {
  // Ultra-short hold time (bot indicator)
  ULTRA_SHORT_HOLD_HOURS: 0.05,  // 3 minutes

  // High frequency threshold
  HIGH_FREQUENCY_TRADES_PER_DAY: 50,

  // Round number preference (bot indicator)
  ROUND_NUMBER_THRESHOLD: 0.7,   // 70% of trades are round numbers
} as const;

/**
 * Data quality thresholds for confidence scoring
 */
export const DATA_QUALITY = {
  // Minimum completed cycles for reliable classification
  MIN_CYCLES_FOR_HIGH_CONFIDENCE: 10,
  MIN_CYCLES_FOR_MEDIUM_CONFIDENCE: 5,
  MIN_CYCLES_FOR_LOW_CONFIDENCE: 3,

  // Minimum trades for classification
  MIN_TRADES_FOR_CLASSIFICATION: 5,
  MIN_TOKENS_FOR_CLASSIFICATION: 2,
} as const;

/**
 * Classify trading speed based on median hold time
 * Uses ALL positions (active + completed) for general wallet behavior analysis
 * Median is robust to outliers and represents typical behavior
 *
 * @param medianHoldTimeHours - Median holding time in hours (all positions)
 * @returns Trading speed category
 */
export function classifyTradingSpeed(medianHoldTimeHours: number): TradingSpeedCategory {
  if (medianHoldTimeHours < TRADING_SPEED_THRESHOLDS_HOURS.ULTRA_FLIPPER) {
    return 'ULTRA_FLIPPER';
  } else if (medianHoldTimeHours < TRADING_SPEED_THRESHOLDS_HOURS.FLIPPER) {
    return 'FLIPPER';
  } else if (medianHoldTimeHours < TRADING_SPEED_THRESHOLDS_HOURS.FAST_TRADER) {
    return 'FAST_TRADER';
  } else if (medianHoldTimeHours < TRADING_SPEED_THRESHOLDS_HOURS.DAY_TRADER) {
    return 'DAY_TRADER';
  } else if (medianHoldTimeHours < TRADING_SPEED_THRESHOLDS_HOURS.SWING_TRADER) {
    return 'SWING_TRADER';
  } else {
    return 'POSITION_TRADER';
  }
}

/**
 * Classify holder behavior based on median COMPLETED hold time
 * Uses ONLY completed/exited positions for exit prediction
 * More granular than trading speed - optimized for memecoin holder risk analysis
 *
 * @param medianCompletedHoldTimeHours - Median holding time from completed positions only
 * @returns Holder behavior category
 */
export function classifyHolderBehavior(medianCompletedHoldTimeHours: number): HolderBehaviorType {
  const minutes = medianCompletedHoldTimeHours * 60;

  if (minutes < HOLDER_BEHAVIOR_THRESHOLDS_MINUTES.SNIPER) {
    return 'SNIPER';
  } else if (minutes < HOLDER_BEHAVIOR_THRESHOLDS_MINUTES.SCALPER) {
    return 'SCALPER';
  } else if (minutes < HOLDER_BEHAVIOR_THRESHOLDS_MINUTES.MOMENTUM) {
    return 'MOMENTUM';
  } else if (medianCompletedHoldTimeHours < HOLDER_BEHAVIOR_THRESHOLDS_HOURS.INTRADAY) {
    return 'INTRADAY';
  } else if (medianCompletedHoldTimeHours < HOLDER_BEHAVIOR_THRESHOLDS_HOURS.DAY_TRADER) {
    return 'DAY_TRADER';
  } else if (medianCompletedHoldTimeHours < HOLDER_BEHAVIOR_THRESHOLDS_HOURS.SWING) {
    return 'SWING';
  } else if (medianCompletedHoldTimeHours < HOLDER_BEHAVIOR_THRESHOLDS_HOURS.POSITION) {
    return 'POSITION';
  } else {
    return 'HOLDER';
  }
}

/**
 * Classify behavioral pattern based on buy/sell ratios
 *
 * @param buySellRatio - Ratio of buy volume to sell volume
 * @param totalBuyCount - Total number of buys
 * @param totalSellCount - Total number of sells
 * @returns Behavioral pattern category
 */
export function classifyBehavioralPattern(
  buySellRatio: number,
  totalBuyCount: number,
  totalSellCount: number
): BehavioralPattern {
  // Avoid division by zero
  if (totalSellCount === 0) {
    return 'HOLDER';
  }
  if (totalBuyCount === 0) {
    return 'DUMPER';
  }

  const buyToSellCount = totalBuyCount / totalSellCount;

  // Accumulator: Significantly more buying than selling
  if (buySellRatio > 2.5 && buyToSellCount > 2) {
    return 'ACCUMULATOR';
  }

  // Distributor: Significantly more selling than buying
  if (buySellRatio < 0.4 && buyToSellCount < 0.5) {
    return 'DISTRIBUTOR';
  }

  // Balanced: Roughly equal buy/sell activity
  if (buySellRatio >= 0.7 && buySellRatio <= 1.5) {
    return 'BALANCED';
  }

  // Holder: Mostly buys, some sells
  if (buySellRatio > 1.5) {
    return 'HOLDER';
  }

  // Dumper: Mostly sells
  return 'DUMPER';
}

/**
 * Generate human-readable trading style description
 * Combines speed and behavioral pattern for comprehensive classification
 *
 * @param speedCategory - Trading speed category
 * @param behavioralPattern - Behavioral pattern
 * @param confidence - Confidence score (0-1)
 * @returns Human-readable style description
 */
export function generateTradingStyleDescription(
  speedCategory: TradingSpeedCategory,
  behavioralPattern: BehavioralPattern,
  confidence: number
): string {
  const confidenceText = confidence > 0.8 ? 'High confidence'
                       : confidence > 0.6 ? 'Medium confidence'
                       : 'Low confidence';

  // Special case: Low activity
  if (speedCategory === 'LOW_ACTIVITY') {
    return `Low Activity (${confidenceText})`;
  }

  // Combine speed and pattern for rich description
  const speedText = speedCategory.replace(/_/g, ' ').toLowerCase();
  const patternText = behavioralPattern.toLowerCase();

  return `${speedText} - ${patternText} (${confidenceText})`;
}

/**
 * Calculate confidence score for trading classification
 * Based on data quality and pattern consistency
 *
 * @param completedCycles - Number of completed trading cycles
 * @param dataQuality - Data quality score (0-1)
 * @param buySellSymmetry - Buy/sell symmetry (0-1)
 * @param sequenceConsistency - Sequence consistency (0-1)
 * @returns Confidence score (0-1)
 */
export function calculateClassificationConfidence(
  completedCycles: number,
  dataQuality: number,
  buySellSymmetry: number,
  sequenceConsistency: number
): number {
  // Base confidence from data quality
  let confidence = dataQuality * 0.4;

  // Bonus for sufficient sample size
  if (completedCycles >= DATA_QUALITY.MIN_CYCLES_FOR_HIGH_CONFIDENCE) {
    confidence += 0.3;
  } else if (completedCycles >= DATA_QUALITY.MIN_CYCLES_FOR_MEDIUM_CONFIDENCE) {
    confidence += 0.2;
  } else if (completedCycles >= DATA_QUALITY.MIN_CYCLES_FOR_LOW_CONFIDENCE) {
    confidence += 0.1;
  }

  // Bonus for pattern consistency
  confidence += (buySellSymmetry * sequenceConsistency) * 0.3;

  return Math.min(1, confidence);
}

