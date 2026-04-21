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
  // 30+ days = HODLER
} as const;

export const HOLDER_BEHAVIOR_THRESHOLDS_HOURS = {
  SNIPER: 1 / 60,   // 0.0167 hours (1 minute)
  SCALPER: 5 / 60,  // 0.0833 hours (5 minutes)
  MOMENTUM: 0.5,    // 30 minutes
  INTRADAY: 4,      // 4 hours
  DAY_TRADER: 24,   // 24 hours
  SWING: 168,       // 7 days
  POSITION: 720,    // 30 days
  // 30+ days = HODLER
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
  | 'HODLER';

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
  MIN_CYCLES_FOR_HIGH_CONFIDENCE: 20,
  MIN_CYCLES_FOR_MEDIUM_CONFIDENCE: 10,
  MIN_CYCLES_FOR_LOW_CONFIDENCE: 5,

  // Minimum trades for classification
  MIN_TRADES_FOR_CLASSIFICATION: 10,
  MIN_TOKENS_FOR_CLASSIFICATION: 5,
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
    return 'HODLER';  // 30+ days - crypto spelling for long-term exits
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

// ============================================================================
// NEW: Centralized Classification Thresholds (Refactor 2025-12-25)
// ============================================================================

/**
 * Speed Category Thresholds (from completed cycles only)
 * These are the canonical thresholds for speedCategory classification
 */
export const SPEED_THRESHOLDS = {
  SNIPER: 1 / 60,      // < 1 min (0.0167 hours)
  SCALPER: 5 / 60,     // 1-5 min (0.0833 hours)
  MOMENTUM: 0.5,       // 5-30 min
  INTRADAY: 4,         // 30min-4h
  DAY_TRADER: 24,      // 4-24h
  SWING: 168,          // 1-7 days (168 hours)
  POSITION: 720,       // 7-30 days (720 hours)
  // 30+ days = HODLER
} as const;

/**
 * Flow Pattern Thresholds (buy/sell ratio analysis)
 */
export const FLOW_THRESHOLDS = {
  STRONG_BUY_RATIO: 2.0,     // ratio >= 2.0 → ACCUMULATOR
  STRONG_SELL_RATIO: 0.5,    // ratio <= 0.5 → DISTRIBUTOR
  // Between 0.5 and 2.0 = BALANCED (if symmetric)
} as const;

/**
 * Minimum Data Requirements (activity gate)
 */
export const MINIMUM_DATA = {
  trades: 10,                         // Minimum total trades
  tokensWithCompletedCycles: 5,       // Minimum tokens with both buy+sell
} as const;

/**
 * Holder Bypass Criteria (for wallets without completed cycles)
 * Allows pure holders to bypass the minimum data gate
 */
export const HOLDER_BYPASS = {
  multiToken: {
    minTokens: 2,           // Minimum active holdings (2+ tokens = meaningful portfolio start)
    minHoldHours: 24,       // Minimum median hold duration (1 day shows intent, not dust)
  },
  singleToken: {
    minPositionSol: 5,     // Significant position threshold in SOL (~$500-1000 USD, adjustable)
  },
} as const;

/**
 * Velocity Score Formula Parameters
 * Maps median hold time to 0-100 score (logarithmic scale)
 */
export const VELOCITY_SCORE = {
  MAX_HOLD_HOURS: 720,  // 30 days = 0 velocity
  LOG_BASE: 10,
} as const;

// =============================================================================
// BEHAVIORAL ANALYSIS CONFIGURATION (Migrated from config/constants.ts)
// Single source of truth for ALL behavior analysis thresholds
// =============================================================================

export const BEHAVIOR_ANALYSIS_CONFIG = {
  // Token lifecycle completion criteria
  HISTORICAL_PATTERN: {
    MINIMUM_COMPLETED_CYCLES: 5,        // Minimum exits for reliable speed classification (matches MINIMUM_DATA.tokensWithCompletedCycles)
    MAXIMUM_DATA_AGE_DAYS: 10000,       // Include all historical data, no time limit
    MIN_VALID_HOLD_HOURS: 0.0001,       // ~0.36 seconds minimum (prevents true zero/corruption)
    MAX_VALID_HOLD_HOURS: 18760,        // 1 year maximum
  },

  // Position exit detection thresholds
  HOLDING_THRESHOLDS: {
    EXIT_THRESHOLD: 0.80,               // Position considered "exited" when <=80% of peak remains
    MINIMUM_SOL_VALUE: 0.001,           // Minimum SOL value for dust filtering
    MINIMUM_PERCENTAGE_REMAINING: 0.05, // Minimum % of original for dust filtering
    MINIMUM_HOLDING_TIME_SECONDS: 60,   // Minimum time held for dust filtering
  },

  // Scam token filtering
  SCAM_FILTERING: {
    ENABLED: true,                      // Enable scam token filtering
    LOG_FILTERED_TOKENS: false,         // Log details about filtered tokens
    STRICT_MODE: false,                 // Use stricter thresholds
    THRESHOLDS: {
      MIN_TRADE_COUNT: 100,             // Minimum trade count for scam detection
      MIN_TOTAL_VALUE: 0.001,           // Minimum total SOL value
      MIN_TOTAL_USDC_VALUE: 5,          // Minimum total USDC value
    },
  },

  // Session analysis parameters
  SESSION_ANALYSIS: {
    SESSION_GAP_THRESHOLD_HOURS: 2,     // Gap > 2 hours creates new session
  },

  // Trading analysis thresholds (UPDATED to match MINIMUM_DATA above)
  TRADING_ANALYSIS: {
    MIN_TRADES_FOR_ANALYSIS: 10,        // Minimum trades for reliable analysis
    MIN_TOKENS_WITH_TRADES: 5,          // Minimum tokens with both buys/sells
  },

  // Time-based bucket boundaries (in hours) - shared between different analyses
  TIME_BUCKETS: {
    INSTANT: 0.0001,     // < 0.36 seconds (same transaction)
    ULTRA_FAST: 1/60,    // < 1 minute
    VERY_FAST: 1/60,     // < 1 minute (alias for consistency)
    FAST: 5/60,          // 1-5 minutes
    MOMENTUM: 0.5,       // 5-30 minutes
    MODERATE: 1,         // 30-60 min / 1 hour
    INTRADAY: 4,         // 1-4 hours
    DAY_TRADER: 8,       // 4-8 hours (legacy - not used by new classification)
    DAY: 24,             // 8-24 hours
    SWING: 168,          // 1-7 days (24*7)
    // POSITION: > 168 hours (7+ days)
  },

  // Behavior classification thresholds (UPDATED to match new FLOW_THRESHOLDS)
  BEHAVIOR_CLASSIFICATION: {
    FULL_HOLDER_THRESHOLD: 0.75,  // Position >75% remaining = FULL_HOLDER
    BALANCED_SYMMETRY_MIN: 0.7,   // Min symmetry for BALANCED classification
    BALANCED_CONSISTENCY_MIN: 0.7, // Min consistency for BALANCED classification
    ACCUMULATOR_RATIO_MIN: 2.0,    // ✅ UPDATED: Buy/sell ratio >= 2.0 = ACCUMULATOR (was 2.5)
    DISTRIBUTOR_RATIO_MAX: 0.5,    // ✅ UPDATED: Buy/sell ratio <= 0.5 = DISTRIBUTOR (was 0.4)
    HOLDER_RATIO_MIN: 1.5,         // Buy/sell ratio >1.5 = HOLDER (legacy)
  },

  // Flipper score calculation weights
  FLIPPER_SCORE: {
    ULTRA_FAST_WEIGHT: 0.85,    // Weight for ultra-fast trading
    VERY_FAST_WEIGHT: 0.10,     // Weight for very fast trading
    FAST_WEIGHT: 0.05,          // Weight for fast trading
    SPEED_WEIGHT: 0.7,          // Overall speed weight in final score
    BALANCE_WEIGHT: 0.3,        // Balance weight in final score
    ULTRA_FAST_DOMINANCE_MIN: 0.5, // Min ultra-fast % to trigger bonus
    DOMINANCE_BONUS: 0.2,       // Bonus added when ultra-fast dominates
  },

  // Confidence score calculation weights
  CONFIDENCE_SCORE: {
    DATA_QUALITY_WEIGHT: 0.4,   // Weight for data quality in confidence
    DEFAULT_DATA_QUALITY: 0.5,  // Default data quality when not available
    SAMPLE_SIZE_BONUS_10: 0.3,  // Bonus for 10+ completed cycles
    SAMPLE_SIZE_BONUS_5: 0.2,   // Bonus for 5+ completed cycles
    SAMPLE_SIZE_BONUS_3: 0.1,   // Bonus for 3+ completed cycles
    BALANCE_WEIGHT: 0.3,        // Weight for balance consistency
    MAX_CONFIDENCE: 1.0,        // Maximum confidence score
  },
} as const;

