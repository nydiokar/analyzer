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

export interface BehavioralMetrics {
  buySellRatio: number;
  buySellSymmetry: number;
  averageFlipDurationHours: number;
  medianHoldTime: number;
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
} 