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
  status?: 'ok' | 'unanalyzed' | 'restricted';
  walletAddress: string;
  isFavorite: boolean;
  totalPnl: number;
  winRate: number;
  totalVolume: number;
  lastAnalyzedAt?: string | null;
  lastActiveTimestamp: number | null; // Unix timestamp in seconds or null
  daysActive: number | string | null; // Backend seems to send string or number
  latestPnl?: number | null; // Realized PNL only for summary display
  latestPnlUsd?: number | null; // USD equivalent of realized PNL
  realizedPnl?: number | null; // Realized PNL (completed trades only)
  unrealizedPnl?: number | null; // Unrealized PNL (current holdings value)
  netPnl?: number | null; // Total portfolio value (realized + unrealized)
  tokenWinRate?: number | null; // Trade-level win rate
  behaviorClassification: string | null; // High-level classification from BehaviorService
  classification?: string | null; // Wallet classification: 'normal', 'high_frequency', 'unknown'
  rawAdvancedStats?: AdvancedStatsResult; // Full raw object for more detail if needed by client
  rawBehaviorMetrics?: BehaviorMetrics; // Full raw object for more detail if needed by client
  currentSolBalance?: number | null;
  currentSolBalanceUsd?: number | null; // New USD field
  profitableTradesCount?: number | null;
  totalTradesCount?: number | null;
}

export interface WalletSummaryError {
  message: string;
  statusCode?: number;
  isNetworkError?: boolean;
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
  averageCurrentHoldingDurationHours?: number | null;
  medianCurrentHoldingDurationHours?: number | null;
  weightedAverageHoldingDurationHours?: number | null;
  percentOfValueInCurrentHoldings?: number | null;
  additionalMetrics?: Record<string, unknown>;
  rawMetrics?: Record<string, unknown>;
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

  // Added fields for current balance
  currentRawBalance?: string | null;
  currentUiBalance?: number | null;
  currentUiBalanceString?: string | null;
  balanceDecimals?: number | null;
  balanceFetchedAt?: string | null; // ISO String

  // Enriched data from TokenInfo
  name?: string | null;
  symbol?: string | null;
  imageUrl?: string | null;
  websiteUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;

  // DexScreener market data
  marketCapUsd?: number | null;
  liquidityUsd?: number | null;
  pairCreatedAt?: number | null;
  fdv?: number | null;
  volume24h?: number | null;
  priceUsd?: string | null;
  dexscreenerUpdatedAt?: string | null;

  // Unrealized P&L calculations for current holdings
  currentHoldingsValueUsd?: number | null;
  currentHoldingsValueSol?: number | null;
  unrealizedPnlUsd?: number | null;
  unrealizedPnlSol?: number | null;
  totalPnlSol?: number | null;

  // PNL breakdown and percentage indicators
  realizedPnlSol?: number | null;
  realizedPnlPercentage?: number | null;
  unrealizedPnlPercentage?: number | null;
}

// Based on src/api/wallets/token_performance/token-performance.service.ts
export interface PaginatedTokenPerformanceResponse {
  data: TokenPerformanceDataDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// --- PNL Overview Types ---
// Based on src/api/wallets/pnl_overview/pnl-overview.service.ts

export interface PnlOverviewResponseData {
  dataFrom?: string;
  realizedPnl: number;
  unrealizedPnl?: number; // Add unrealized PnL field
  swapWinRate?: number;
  winLossCount?: string; 
  avgPLTrade?: number;
  totalVolume?: number;
  totalSolSpent: number; 
  totalSolReceived: number;
  medianPLToken?: number; 
  trimmedMeanPnlPerToken?: number; 
  tokenWinRate?: number; 
  standardDeviationPnl?: number; 
  medianPnlToVolatilityRatio?: number; 
  weightedEfficiencyScore?: number; 
  averagePnlPerDayActiveApprox?: number;
  profitableTokensCount?: number;
  unprofitableTokensCount?: number;
}

export interface PnlOverviewResponse {
  periodData: PnlOverviewResponseData | null;
  allTimeData: PnlOverviewResponseData;
}

// Simple structure for favorite wallet entries with JSON-based tags/collections
export interface FavoriteWallet {
  walletAddress: string;
  nickname?: string;
  tags?: string[];
  collections?: string[];
  metadata?: any;
  createdAt: string;
  lastViewedAt?: string;
  // Performance metrics (optional)
  pnl?: number;
  winRate?: number;
}

// DTOs for creating favorite wallets
export interface AddFavoriteWalletRequest {
  walletAddress: string;
  nickname?: string;
  tags?: string[];
  collections?: string[];
}

// DTOs for updating favorite wallets
export interface UpdateFavoriteWalletRequest {
  nickname?: string;
  tags?: string[];
  collections?: string[];
  metadata?: any;
}

// --- Job Status Types ---
// Based on src/api/jobs/dto/job-status.dto.ts
export interface JobStatusResponseDto {
  id: string;
  name: string;
  queue: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';
  progress: number | object;
  data: any;
  result?: any;
  error?: string;
  createdAt: string; // ISO Date string
  processedAt?: string; // ISO Date string
  finishedAt?: string; // ISO Date string
  attempts: number;
  maxAttempts: number;
  remainingTime?: number;
}

// Dashboard Analysis Types
export type DashboardAnalysisScope = 'flash' | 'working' | 'deep';
export type DashboardAnalysisTriggerSource = 'auto' | 'manual' | 'system';

export interface DashboardAnalysisRequest {
  walletAddress: string;
  forceRefresh?: boolean;
  enrichMetadata?: boolean;
  analysisScope?: DashboardAnalysisScope;
  historyWindowDays?: number;
  targetSignatureCount?: number;
  triggerSource?: DashboardAnalysisTriggerSource;
  queueWorkingAfter?: boolean;
  queueDeepAfter?: boolean;
  timeoutMinutes?: number;
}

export interface DashboardAnalysisResponse {
  jobId: string | null;
  requestId: string;
  status: string;
  queueName: string;
  analysisScope: DashboardAnalysisScope;
  estimatedProcessingTime: string;
  monitoringUrl: string;
  skipped?: boolean;
  skipReason?: string;
  queuedFollowUpScopes?: DashboardAnalysisScope[];
}

// Note: JobProgressEvent, JobCompletedEvent, and JobFailedEvent are now imported from websockets.ts
// to maintain consistency with the existing useJobProgress hook

// --- Top Holders Types ---
export interface TopHolderItem {
  tokenAccount: string;
  ownerAccount?: string;
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString: string;
  rank: number;
}

export interface TopHoldersResponse {
  mint: string;
  context: { slot: number; apiVersion?: string };
  holders: TopHolderItem[];
}
