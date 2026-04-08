// Based on docs/1. scaling_plan.md section 4.3.1
// GET /wallets/{walletAddress}/summary

/** Known wallet types from the backend registry */
export type KnownWalletType =
  | 'BURN'
  | 'LP'
  | 'PROTOCOL'
  | 'EXCHANGE'
  | 'SYSTEM'
  | 'KOL';

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
  knownType?: string | null; // Backend sends as string, WalletBadge accepts string | KnownWalletType
  knownLabel?: string | null;
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
  behaviorClassification: string | null; // DEPRECATED: Legacy field, use strategyType instead
  // NEW: Classification system fields (2025-12-25)
  strategyType?: StrategyType | null; // Primary strategy: FAST_TRADER, DAY_TRADER, SWING_TRADER, etc.
  speedCategory?: SpeedCategory | null; // Speed classification: SNIPER, SCALPER, MOMENTUM, etc.
  flowPattern?: FlowPattern | null; // Flow pattern: ACCUMULATOR, DISTRIBUTOR, BALANCED, etc.
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

// ============================================================================
// NEW CLASSIFICATION SYSTEM (2025-12-25)
// Matches backend enums from src/types/behavior.ts
// ============================================================================

/**
 * Speed Category - How fast does this wallet exit positions?
 * Based on median hold time of COMPLETED cycles only.
 * Null if wallet has no completed exit cycles.
 */
export type SpeedCategory =
  | 'SNIPER'      // < 1 min
  | 'SCALPER'     // 1-5 min
  | 'MOMENTUM'    // 5-30 min
  | 'INTRADAY'    // 30min-4h
  | 'DAY_TRADER'  // 4-24h
  | 'SWING'       // 1-7 days
  | 'POSITION'    // 7-30 days
  | 'HODLER';     // 30+ days (crypto spelling for long-term exited positions)

/**
 * Flow Pattern - What's the directional flow of trading activity?
 * Based on buy/sell ratio and counts.
 */
export type FlowPattern =
  | 'BUY_ONLY'      // No sells, only buys (pure accumulation)
  | 'SELL_ONLY'     // No buys, only sells (pure distribution)
  | 'ACCUMULATOR'   // Heavy buy bias (ratio > 2.0)
  | 'DISTRIBUTOR'   // Heavy sell bias (ratio < 0.5)
  | 'BALANCED'      // Symmetric buy/sell (0.5 < ratio < 2.0)
  | 'MIXED';        // No clear pattern

/**
 * Strategy Type - Canonical filter for UI/API
 * Combines speed + flow + holder signals into single enum.
 * This is THE field to filter on in Discover page.
 */
export type StrategyType =
  | 'FAST_TRADER'       // SNIPER, SCALPER, or MOMENTUM speed
  | 'DAY_TRADER'        // INTRADAY or DAY_TRADER speed
  | 'SWING_TRADER'      // SWING speed
  | 'POSITION_TRADER'   // POSITION or HODLER speed (with exits)
  | 'PURE_HOLDER'       // BUY_ONLY flow (no exits yet)
  | 'ACCUMULATOR'       // ACCUMULATOR flow (any speed)
  | 'DISTRIBUTOR'       // DISTRIBUTOR or SELL_ONLY flow
  | 'BALANCED_TRADER'   // BALANCED flow
  | 'LOW_ACTIVITY';     // Insufficient data (< 5 trades, < 2 tokens)

// Legacy trading interpretation system (2025-11-17) - kept for backward compatibility
export interface TradingInterpretation {
  // Speed classification (based on median - outlier robust)
  speedCategory: 'ULTRA_FLIPPER' | 'FLIPPER' | 'FAST_TRADER' | 'DAY_TRADER' | 'SWING_TRADER' | 'POSITION_TRADER';
  typicalHoldTimeHours: number;       // What they USUALLY do (median)

  // Economic analysis (based on weighted average - position size matters)
  economicHoldTimeHours: number;      // Where the MONEY goes
  economicRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

  // Behavioral pattern
  behavioralPattern: 'BALANCED' | 'ACCUMULATOR' | 'DISTRIBUTOR' | 'HOLDER' | 'DUMPER' | 'MIXED';

  // Human-readable interpretation
  interpretation: string;
}

// Historical pattern from completed positions only
export interface HistoricalPattern {
  medianCompletedHoldTimeHours: number;        // Median (outlier-robust)
  historicalAverageHoldTimeHours: number;      // Weighted average (economic impact)
  completedCycleCount: number;                 // Sample size
  behaviorType: 'SNIPER' | 'SCALPER' | 'MOMENTUM' | 'INTRADAY' | 'DAY_TRADER' | 'SWING' | 'POSITION' | 'HODLER';
  exitPattern: 'GRADUAL' | 'ALL AT ONCE';
  dataQuality: number;                         // 0-1 confidence score
  observationPeriodDays: number;
  holdTimeTokenMap?: {
    instant: string[];
    ultraFast: string[];
    fast: string[];
    momentum: string[];
    intraday: string[];
    day: string[];
    swing: string[];
    position: string[];
  };
}

// More complete BehaviorAnalysisResponseDto
export interface BehaviorAnalysisResponseDto {
  walletAddress?: string;
  tradingStyle?: string | null;

  // NEW: Classification system fields (2025-12-25)
  speedCategory?: SpeedCategory | null;      // Speed from completed cycles
  flowPattern?: FlowPattern | null;          // Buy/sell directional flow
  strategyType?: StrategyType;               // Canonical filter (use this!)
  velocityScore?: number;                     // 0-100 velocity score
  medianActiveHoldingHours?: number;          // Median of current holdings

  confidenceScore?: number | null;
  primaryBehavior?: string | null;
  secondaryBehavior?: string | null;
  buySellRatio?: number | null;
  buySellSymmetry?: number | null;

  // ⚠️ DEPRECATED: Use historicalPattern.historicalAverageHoldTimeHours instead
  averageFlipDurationHours?: number | null;
  // ⚠️ DEPRECATED: Use historicalPattern.medianCompletedHoldTimeHours instead
  medianHoldTime?: number | null;
  // ⚠️ DEPRECATED: Use historicalPattern.historicalAverageHoldTimeHours instead
  weightedAverageHoldingDurationHours?: number | null;

  // ✅ NEW: Rich interpretation (use these instead of deprecated metrics)
  tradingInterpretation?: TradingInterpretation | null;
  historicalPattern?: HistoricalPattern | null;

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

  // ✅ CURRENT HOLDINGS METRICS: Separate system for analyzing currently held positions
  // These complement historicalPattern (exited positions) by showing what's still held
  averageCurrentHoldingDurationHours?: number | null;
  medianCurrentHoldingDurationHours?: number | null;
  percentOfValueInCurrentHoldings?: number | null;

  additionalMetrics?: Record<string, unknown>;
  rawMetrics?: Record<string, unknown>;

  // Market cap profile
  avgEntryMcap?: number;
  typicalEntryMcapUsd?: number;
  entryMcapP25Usd?: number;
  entryMcapP75Usd?: number;
  dominantEntryMcapBucket?: string;
  dominantEntryMcapBucketShare?: number;
  mcapDistribution?: Record<string, number>;
  mcapBucketPnl?: Record<string, { realizedPnlSol: number; tradeCount: number; winRate: number }>;
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
  hasIncompleteHistory?: boolean | null;
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
  currentHoldingsCostBasisSol?: number | null;

  // Enriched data from TokenInfo (DexScreener)
  name?: string | null;
  symbol?: string | null;
  imageUrl?: string | null;
  websiteUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;

  // Onchain metadata (IPFS/arweave - primary source for display)
  onchainName?: string | null;
  onchainSymbol?: string | null;
  onchainImageUrl?: string | null;
  onchainDescription?: string | null;
  onchainWebsiteUrl?: string | null;
  onchainTwitterUrl?: string | null;
  onchainTelegramUrl?: string | null;
  onchainDiscordUrl?: string | null;
  onchainCreator?: string | null;
  metadataSource?: string | null;

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

  // Server-provided spam risk analysis (precomputed to avoid heavy client work)
  spamRiskLevel?: 'safe' | 'high-risk' | null;
  spamRiskScore?: number | null;
  spamRiskReasons?: string[] | null;
  spamPrimaryReason?: string | null;

  // Activity in filtered time period
  hasActivityInPeriod?: boolean | null;
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

// --- Daily PnL Types ---
export interface WalletDailyPnlRow {
  date: string;               // "YYYY-MM-DD"
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  volumeSol: number;
  feesSol: number;
  realizedPnlSol: number;
  profitableSellsCount: number;
  totalSellsCount: number;
  winRate: number;            // derived: profitableSellsCount / totalSellsCount
  uniqueMintsTradedCount: number;
  volumeUsd: number | null;
  realizedPnlUsd: number | null;
  hasIncompleteEnrichment: boolean;
  hasIncompleteHistory: boolean;
}

export interface WalletDailyPnlSummary {
  totalRealizedPnlSol: number;
  totalTradeCount: number;
  totalVolumeSol: number;
  winRate: number;
  periodStart: string;
  periodEnd: string;
}

export interface WalletDailyPnlResponse {
  attributionMethod: 'sell_date';
  data: WalletDailyPnlRow[];
  summary: WalletDailyPnlSummary;
}

// Simple structure for favorite wallet entries with JSON-based tags/collections
export interface FavoriteWallet {
  walletAddress: string;
  knownType?: string; // Backend sends as string, WalletBadge accepts string | KnownWalletType
  knownLabel?: string;
  nickname?: string;
  collections?: string[];
  metadata?: any;
  favoritedAt: string; // When wallet was added to favorites
  lastViewedAt?: string;
  // Performance metrics (optional)
  pnl?: number;
  winRate?: number;
  currentSolBalance?: number;
  lastActiveTimestamp?: number;
}

// DTOs for creating favorite wallets
export interface AddFavoriteWalletRequest {
  walletAddress: string;
  nickname?: string;
  collections?: string[];
}

// DTOs for updating favorite wallets
export interface UpdateFavoriteWalletRequest {
  nickname?: string;
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
  status: 'queued' | 'running';
  queueName: string;
  analysisScope: DashboardAnalysisScope;
  estimatedProcessingTime: string;
  monitoringUrl: string;
  skipped?: boolean;
  skipReason?: string;
  queuedFollowUpScopes?: DashboardAnalysisScope[];
  alreadyRunning?: boolean;
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
  knownType?: string; // Backend sends as string, WalletBadge accepts string | KnownWalletType
  knownLabel?: string;
}

export interface TopHoldersResponse {
  mint: string;
  context: { slot: number; apiVersion?: string };
  holders: TopHolderItem[];
  supply?: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}

// --- Exit Timing Tokens Response ---
export type TimeBucket = 'instant' | 'ultraFast' | 'fast' | 'momentum' | 'intraday' | 'day' | 'swing' | 'position';

export interface ExitTimingTokensResponse {
  walletAddress: string;
  timeBucket: TimeBucket;
  tokens: string[];
  count: number;
}

// --- Wallet HUD (Heads-Up Display) Types ---

/**
 * Data quality tier classification based on data completeness and activity
 */
export enum DataQualityTier {
  GOLD = 'GOLD',           // Complete data, significant activity (50+ trades, 7+ days)
  SILVER = 'SILVER',       // Good data, moderate activity (20+ trades, 3+ days)
  BRONZE = 'BRONZE',       // Basic data, some activity (5+ trades)
  INSUFFICIENT = 'INSUFFICIENT', // Too little data for reliable metrics
}

/**
 * Behavior category mapping to single-letter codes
 * Maps speedCategory/strategyType enums to compact display codes
 */
export const BEHAVIOR_CODES: Record<string, string> = {
  // Speed categories
  SNIPER: 'S',
  SCALPER: 'R',
  MOMENTUM: 'M',
  INTRADAY: 'I',
  DAY_TRADER: 'D',
  SWING: 'W',
  POSITION: 'P',
  HODLER: 'H',

  // Strategy types
  FAST_TRADER: 'F',
  SWING_TRADER: 'W',
  POSITION_TRADER: 'P',
  PURE_HOLDER: 'H',
  ACCUMULATOR: 'A',
  DISTRIBUTOR: 'T',
  BALANCED_TRADER: 'B',
  LOW_ACTIVITY: 'L',

  // Fallback
  UNKNOWN: '?',
  UNCLASSIFIED: '?',
};

/**
 * Wallet HUD (Heads-Up Display) - High-signal metrics for at-a-glance evaluation
 *
 * Philosophy: Like a poker HUD, show only the most critical signals for instant comprehension.
 * 6 core metrics + 2 conditional badges.
 */
export interface WalletHudDto {
  walletAddress: string;
  signalType: string;

  // ===== CORE METRICS (Always visible) =====
  trimmedMeanPnl: number;        // Trimmed mean PNL per token (outliers removed) in SOL
  avgTxValueSol: number;         // Average transaction value in SOL (total SOL volume / total trades)
  behaviorCategory?: string;     // Full behavior category name (e.g., 'MOMENTUM_TRADER')
  behaviorCode: string;          // Single-letter behavior code (M/F/H/A/I/S/?)
  medianHoldTimeHours?: number;  // Median hold time for completed trades in hours (more precise than category)
  avgTradesPerDay: number;       // Average number of trades per day
  winRate: number;               // Win rate as decimal (0-1, where 0.68 = 68%)
  dataQualityTier: DataQualityTier; // Data quality tier classification

  // ===== CONDITIONAL BADGES (Only when applicable) =====
  isBot: boolean;                // Bot detection flag (true if uniqueTokensPerDay > 60)
  isWhale: boolean;              // Whale detection flag (true if holdings > 200 SOL OR > $20k USD)

  // ===== SUPPORTING DATA =====
  uniqueTokensPerDay: number;    // Average unique tokens traded per day (for bot detection)
  currentHoldingsSol: number;    // Total portfolio value in SOL (sum of all current token holdings)
  currentHoldingsUsd?: number;   // Total portfolio value in USD (sum of all current token holdings)
  typicalEntryMcapUsd?: number;  // Weighted median market cap at entry across eligible buy trades (USD)
  dominantEntryMcapBucket?: string; // Bucket with highest buy-side USD share

  // ===== METADATA =====
  calculatedAt: string;          // ISO timestamp when HUD data was calculated
  provenance?: {
    provider: string;
    nodeId?: string;
    schemaVersion: string;
    generatedAt: string;
    dataRange?: {
      from: string;
      to: string;
    };
    source?: 'onchain' | 'indexed_db' | 'hybrid';
  };
}

/**
 * Batch response for multiple wallet HUDs
 * Returns a map indexed by wallet address for O(1) lookup
 */
export interface BatchWalletHudResponse {
  huds: Record<string, WalletHudDto>;
  notFound: string[];
  calculatedAt: string;
}

// ── Wallet Hunt ────────────────────────────────────────────────

export interface HuntListItem {
  id: string;
  name: string;
  snapshotCount: number;
  createdAt: string;
  lastVisitedAt: string;
}

export interface HuntSnapshot {
  id: string;
  tokenMint: string;
  sourceType: string;
  capturedAt: string;
  holderCount: number;
  note?: string;
}

export interface HuntCandidate {
  walletAddress: string;
  appearanceCount: number;
  confidence: number;
  tokenMints: string[];
  sources: string[];
}

export interface HuntDetail {
  hunt: { id: string; name: string; createdAt: string; lastVisitedAt: string };
  snapshots: HuntSnapshot[];
  candidates: HuntCandidate[];
}

export interface AddSnapshotResponse {
  snapshot: HuntSnapshot;
  candidates: HuntCandidate[];
}

// ─── Payment / Credits ────────────────────────────────────────────────────────

export interface CreditPack {
  id: string;
  name: string;
  priceUsdc: number;
  credits: number;
}

/** Returned by POST /payments/checkout */
export interface CheckoutResponse {
  id: string;
  solanaPayUrl: string;
  qrCodeDataUrl: string;
  expiresAt: string;
  amountUsdc: number;
  credits: number;
}

/** Returned by GET /payments/:id/status */
export interface PaymentStatus {
  status: 'pending' | 'confirmed' | 'expired';
  phase: 'waiting' | 'confirmed' | 'expired';
  message: string;
  confirmedAt?: string;
  txSignature?: string;
}

/** Single row from the append-only credit ledger */
export interface CreditTransaction {
  id: string;
  /** Positive = credits added, negative = credits spent */
  delta: number;
  /** Free-text reason, e.g. "purchase", "signup_bonus", "endpoint:/wallets/.../behavior-analysis" */
  reason: string;
  refId: string | null;
  balanceAfter: number;
  createdAt: string;
}

/** Returned by GET /users/me/credits */
export interface CreditsBalance {
  balance: number;
  updatedAt: string;
  transactions: CreditTransaction[];
}
