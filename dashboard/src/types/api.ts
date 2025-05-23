// Based on docs/1. scaling_plan.md section 4.3.1
// GET /wallets/{walletAddress}/summary

// Minimal AdvancedStatsResult structure for the card
export interface AdvancedStatsResult {
  latestPnl: number | null;
  tokenWinRate: number | null;
  // Add other fields from AdvancedStatsResult if they become necessary for the card
}

// Minimal BehaviorMetrics structure for the card
export interface BehaviorMetrics {
  // Add fields if necessary, e.g., a primary classification string
  classification?: string;
}

export interface WalletSummaryData {
  walletAddress: string;
  lastActiveTimestamp: number | null; // Unix timestamp in seconds or null
  daysActive: number | string | null; // Backend seems to send string or number
  latestPnl?: number | null; // Moved from keyPerformanceIndicators
  tokenWinRate?: number | null; // Moved from keyPerformanceIndicators
  behaviorClassification: string | null; // High-level classification from BehaviorService
  rawAdvancedStats?: AdvancedStatsResult; // Full raw object for more detail if needed by client
  rawBehaviorMetrics?: BehaviorMetrics; // Full raw object for more detail if needed by client
}

export interface WalletSummaryError {
  message: string;
  statusCode?: number;
}

// Based on the data structure observed for behavior analysis
export interface TradingTimeDistribution {
  ultraFast?: number;
  veryFast?: number;
  fast?: number;
  moderate?: number;
  dayTrader?: number;
  swing?: number;
  position?: number;
  longPosition?: number;
  other?: number;
}

export interface TemporalBehavior {
  // Define based on actual structure, e.g., activityByHour, activityByDayOfWeek
  [key: string]: any; // Placeholder
}

// Define sub-structures for tradingFrequency, tokenPreferences, riskMetrics
export interface TradingFrequency {
  tradesPerDay?: number | null;
  tradesPerWeek?: number | null;
  tradesPerMonth?: number | null;
}

export interface TokenPreferenceToken {
  mint: string;
  count: number;
  totalValue: number;
  firstSeen: number;
  lastSeen: number;
}

export interface TokenPreferences {
  mostTradedTokens?: TokenPreferenceToken[] | null;
  mostHeld?: TokenPreferenceToken[] | null; // Assuming similar structure
}

export interface RiskMetrics {
  averageTransactionValueSol?: number | null;
  largestTransactionValueSol?: number | null;
}

// More complete BehaviorAnalysisResponseDto
export interface BehaviorAnalysisResponseDto {
  walletAddress: string;
  tradingStyle?: string | null;
  confidenceScore?: number | null;
  primaryBehavior?: string | null;
  secondaryBehavior?: string | null;
  buySellRatio?: number | null;
  buySellSymmetry?: number | null;
  averageFlipDurationHours?: number | null;
  medianHoldTime?: number | null;
  sequenceConsistency?: number | null;
  flipperScore?: number | null;
  uniqueTokensTraded?: number | null;
  tokensWithBothBuyAndSell?: number | null;
  tokensWithOnlyBuys?: number | null;
  tokensWithOnlySells?: number | null;
  totalTradeCount?: number | null;
  totalBuyCount?: number | null;
  totalSellCount?: number | null;
  completePairsCount?: number | null;
  averageTradesPerToken?: number | null;
  tradingTimeDistribution?: TradingTimeDistribution | null;
  percentTradesUnder1Hour?: number | null;
  percentTradesUnder4Hours?: number | null;
  tradingFrequency?: TradingFrequency | null;
  tokenPreferences?: TokenPreferences | null;
  riskMetrics?: RiskMetrics | null;
  reentryRate?: number | null;
  percentageOfUnpairedTokens?: number | null;
  sessionCount?: number | null;
  avgTradesPerSession?: number | null;
  activeTradingPeriods?: TemporalBehavior | null;
  averageSessionStartHour?: number | null;
  averageSessionDurationMinutes?: number | null;
  firstTransactionTimestamp?: number | null;
  lastTransactionTimestamp?: number | null;
  additionalMetrics?: Record<string, any>;
  rawMetrics?: Record<string, any>;
}

// --- Token Performance Types ---
// Based on src/api/wallets/token_performance/token-performance-data.dto.ts
export interface TokenPerformanceDataDto {
  walletAddress: string;
  tokenAddress: string;
  totalAmountIn: number;
  totalAmountOut: number;
  netAmountChange: number;
  totalSolSpent: number;
  totalSolReceived: number;
  totalFeesPaidInSol?: number | null;
  netSolProfitLoss: number;
  transferCountIn: number;
  transferCountOut: number;
  firstTransferTimestamp?: number | null; // Unix timestamp (seconds)
  lastTransferTimestamp?: number | null;  // Unix timestamp (seconds)
}

// Based on src/api/wallets/token_performance/token-performance.service.ts
export interface PaginatedTokenPerformanceResponse {
  data: TokenPerformanceDataDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} 