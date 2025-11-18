import { TokenMetrics } from './analysis';

export interface IdentifiedTradingWindow {
  startTimeUTC: number; // Start hour of the window (0-23)
  endTimeUTC: number;   // End hour of the window (0-23), inclusive
  durationHours: number; // Duration of the window
  tradeCountInWindow: number; // Total trades within this window
  percentageOfTotalTrades: number; // Percentage of the user's total trades that fall into this window
  avgTradesPerHourInWindow: number; // tradeCountInWindow / durationHours
}

export interface ActiveTradingPeriods {
  hourlyTradeCounts: Record<number, number>; // Raw trade counts for each UTC hour (0-23)
  identifiedWindows: IdentifiedTradingWindow[]; // Array of dynamically identified significant trading windows
  activityFocusScore: number; // Metric (e.g., 0-1) indicating how concentrated trades are
}

// --- New Types for Holder Risk Analysis ---

/**
 * Per-token position lifecycle tracking
 */
export interface TokenPositionLifecycle {
  mint: string;
  entryTimestamp: number;           // First buy timestamp
  exitTimestamp: number | null;     // When crossed exit threshold (or null if active)
  peakPosition: number;             // Max tokens ever held
  currentPosition: number;          // Current balance (via FIFO)
  percentOfPeakRemaining: number;   // current / peak

  positionStatus: 'ACTIVE' | 'EXITED' | 'DUST';
  behaviorType: 'FULL_HOLDER' | 'PROFIT_TAKER' | 'MOSTLY_EXITED' | null;

  // Weighted average for THIS token only
  weightedHoldingTimeHours: number; // For completed: actual, for active: partial

  // Trade metadata
  totalBought: number;
  totalSold: number;
  buyCount: number;
  sellCount: number;
}

/**
 * Wallet's historical pattern (aggregated across completed tokens)
 */
export interface WalletHistoricalPattern {
  walletAddress: string;

  // Aggregate metrics from COMPLETED positions only
  historicalAverageHoldTimeHours: number;  // Weighted avg across completed tokens
  completedCycleCount: number;             // Number of fully exited tokens
  medianCompletedHoldTimeHours: number;    // Median of completed cycles

  // Behavioral classification (granular memecoin trading patterns)
  behaviorType: 'SNIPER' | 'SCALPER' | 'MOMENTUM' | 'INTRADAY' | 'DAY_TRADER' | 'SWING' | 'POSITION' | 'HOLDER';
  exitPattern: 'GRADUAL' | 'ALL_AT_ONCE';  // Based on sell distribution

  // Confidence metrics
  dataQuality: number;                     // 0-1, based on sample size
  observationPeriodDays: number;           // Time span of historical data

  // Hold time distribution breakdown
  holdTimeDistribution?: {
    instant: number;      // <0.36s (same tx)
    ultraFast: number;    // <1min
    fast: number;         // 1-5min
    momentum: number;     // 5-30min
    intraday: number;     // 30min-4h
    day: number;          // 4-24h
    swing: number;        // 1-7d
    position: number;     // 7+d
  };
}

/**
 * Wallet's predicted exit time for a specific token
 */
export interface WalletTokenPrediction {
  // Identity
  walletAddress: string;
  tokenMint: string;
  predictedAt: number;                      // When prediction was made (unix timestamp)

  // Historical context (from OTHER completed tokens)
  historicalMedianHoldHours: number;        // Wallet's typical median hold time
  historicalSampleSize: number;             // Number of completed cycles
  behaviorType: 'SNIPER' | 'SCALPER' | 'MOMENTUM' | 'INTRADAY' | 'DAY_TRADER' | 'SWING' | 'POSITION' | 'HOLDER';
  exitPattern: 'GRADUAL' | 'ALL_AT_ONCE';

  // Current position (for THIS specific token)
  entryTimestamp: number;                   // When they bought THIS token
  currentPositionAgeHours: number;          // How long they've held it
  percentAlreadySold: number;               // 0-100%
  positionStatus: 'ACTIVE' | 'EXITED';

  // THE PREDICTION
  estimatedExitHours: number;               // Hours from now until exit
  estimatedExitTimestamp: number;           // Absolute unix timestamp
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

  // Confidence
  predictionConfidence: number;             // 0-1 based on data quality
}

/**
 * Trading speed and behavioral pattern interpretation
 * Separates SPEED (how fast) from PATTERN (what they do)
 */
export interface TradingInterpretation {
  // Speed classification (based on median hold time - outlier robust)
  speedCategory: 'ULTRA_FLIPPER' | 'FLIPPER' | 'FAST_TRADER' | 'DAY_TRADER' | 'SWING_TRADER' | 'POSITION_TRADER';
  typicalHoldTimeHours: number;       // Median (what they usually do)

  // Economic analysis (based on weighted average - position size matters)
  economicHoldTimeHours: number;      // Weighted average (where the money goes)
  economicRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

  // Behavioral pattern (buy/sell characteristics)
  behavioralPattern: 'BALANCED' | 'ACCUMULATOR' | 'DISTRIBUTOR' | 'HOLDER' | 'DUMPER' | 'MIXED';

  // Combined interpretation
  interpretation: string;              // Human-readable: "FLIPPER (ACCUMULATOR): Fast trading with accumulation bias"
}

export interface BehavioralMetrics {
  buySellRatio: number;
  buySellSymmetry: number;
  /**
   * @deprecated Use historicalPattern.historicalAverageHoldTimeHours instead.
   * This metric uses unweighted average which is less accurate than the weighted version.
   */
  averageFlipDurationHours: number;
  /**
   * @deprecated Use historicalPattern.medianCompletedHoldTimeHours instead.
   * Should only use completed positions for accurate classification.
   */
  medianHoldTime: number;
  averageCurrentHoldingDurationHours: number;
  medianCurrentHoldingDurationHours: number;
  /**
   * @deprecated Use historicalPattern.historicalAverageHoldTimeHours for predictions.
   * This metric mixes completed + active positions which is conceptually flawed for prediction.
   */
  weightedAverageHoldingDurationHours: number;
  percentOfValueInCurrentHoldings: number; // Based on historical cost basis
  // Unrealized P&L metrics (requires current prices from TokenInfo/DexScreener)
  currentHoldingsValueUsd?: number; // Current USD value of all holdings
  unrealizedPnlUsd?: number; // Current value - historical cost basis in USD
  unrealizedPnlSol?: number; // Current value - historical cost basis in SOL
  percentOfCurrentPortfolioValue?: number; // % of current portfolio vs historical trades
  sequenceConsistency: number;
  flipperScore: number;
  uniqueTokensTraded: number;
  tokensWithBothBuyAndSell: number;
  tokensWithOnlyBuys: number;
  tokensWithOnlySells: number;
  totalTradeCount: number;
  totalBuyCount: number;
  totalSellCount: number;
  completePairsCount: number;
  averageTradesPerToken: number;
  tradingTimeDistribution: {
    ultraFast: number;
    veryFast: number;
    fast: number;
    moderate: number;
    dayTrader: number;
    swing: number;
    position: number;
  };
  percentTradesUnder1Hour: number;
  percentTradesUnder4Hours: number;
  tradingStyle: string;
  confidenceScore: number;
  tradingFrequency: {
    tradesPerDay: number;
    tradesPerWeek: number;
    tradesPerMonth: number;
  };
  tokenPreferences: {
    mostTradedTokens: TokenMetrics[];
    mostHeld: TokenMetrics[];
  };
  riskMetrics: {
    averageTransactionValueSol: number;
    largestTransactionValueSol: number;
  };
  reentryRate: number;
  percentageOfUnpairedTokens: number;
  sessionCount: number;
  avgTradesPerSession: number;
  activeTradingPeriods: ActiveTradingPeriods; // Replaces activeHoursDistribution
  averageSessionStartHour: number;
  averageSessionDurationMinutes: number;
  firstTransactionTimestamp?: number;
  lastTransactionTimestamp?: number;

  // New: Historical pattern (optional, non-breaking addition)
  historicalPattern?: WalletHistoricalPattern;

  // New: Trading interpretation (optional, provides clear speed vs economic analysis)
  tradingInterpretation?: TradingInterpretation;
} 