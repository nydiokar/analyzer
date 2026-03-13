import type { DashboardAnalysisScope, DashboardAnalysisTriggerSource } from '../../../shared/dashboard-analysis.types';

// Wallet Operations Job Data
export interface SyncWalletJobData {
  walletAddress: string;
  userId?: string;           // User who triggered the job (for room-based WebSocket)
  syncOptions: {
    fetchAll?: boolean;
    forceRefresh?: boolean;
    fetchOlder?: boolean;
  };
  priority?: number;
  requestId?: string;        // For tracking/correlation
}

export interface FetchBalanceJobData {
  walletAddress: string;
  userId?: string;           // User who triggered the job (for room-based WebSocket)
  requestId?: string;
}

// Analysis Operations Job Data
export interface AnalyzePnlJobData {
  walletAddress: string;
  userId?: string;           // User who triggered the job (for room-based WebSocket)
  dependsOnSyncJob?: string; // Job ID dependency
  forceRefresh?: boolean;
  requestId?: string;
}

export interface AnalyzeBehaviorJobData {
  walletAddress: string;
  userId?: string;           // User who triggered the job (for room-based WebSocket)
  dependsOnSyncJob?: string; // Job ID dependency
  config?: {
    timeRange?: {
      from?: Date;
      to?: Date;
    };
    excludeMints?: string[];
    minTradingVolume?: number;
  };
  requestId?: string;
}

export interface AnalyzeHolderProfilesJobData {
  mode: 'token' | 'wallet';
  userId?: string;           // User who triggered the job (for room-based WebSocket)
  tokenMint?: string;
  topN?: number;              // Number of top holders to analyze (default: 10) when token mode
  walletAddress?: string;     // Specific wallet to analyze when wallet mode
  requestId: string;
  debugFailAfterProfiles?: number; // Dev-only: force failure after streaming N profiles
  _holderContext?: {
    rank: number;
    supplyPercent: number;
    systemWalletDetection?: {
      isSystemWallet: boolean;      // True if wallet has knownType (should skip analysis)
      knownType?: string;            // KnownWalletType if detected
      knownLabel?: string;           // Display label for UI
      reason?: string;               // Detection reason
    };
  };
}

// Dashboard Wallet Analysis Job Data
export interface DashboardWalletAnalysisJobData {
  walletAddress: string;
  userId?: string;           // User who triggered the job (for room-based WebSocket)
  requestId: string;
  analysisScope: DashboardAnalysisScope;
  triggerSource: DashboardAnalysisTriggerSource;
  historyWindowDays?: number;
  targetSignatureCount?: number;
  forceRefresh?: boolean;
  enrichMetadata?: boolean;
  queueWorkingAfter?: boolean;
  queueDeepAfter?: boolean;
  failureThreshold?: number;    // Partial failure tolerance (default 0.8)
  timeoutMinutes?: number;
}



// Comprehensive Similarity Flow with Dual Queues
export interface ComprehensiveSimilarityFlowData {
  walletAddresses: string[];
  userId?: string;              // User who triggered the job (for room-based WebSocket)
  requestId: string;
  walletsNeedingSync?: string[]; // Specific wallets that need sync (empty array = no sync needed)
  enrichMetadata?: boolean;     // Whether to enrich token metadata (default true)
  includeBalances?: boolean;    // Include wallet balances in result payload (default false)
  includeVectors?: boolean;     // Include wallet vectors in result payload (default false)
  failureThreshold?: number;    // Partial failure tolerance (default 0.8)
  timeoutMinutes?: number;      // Job-level timeout (default 45)
  skipSystemWalletDetection?: boolean; // Skip system wallet filtering (default false) - for pure similarity analysis
  similarityConfig?: {
    vectorType?: 'capital' | 'binary';
    minSharedTokens?: number;
    timeRange?: {
      from?: Date;
      to?: Date;
    };
    excludeMints?: string[];
  };
}



// Significant Buyers Job Data
export interface SigBuyersJobData {
  mint: string;
  startTime: number;
  endTime: number;
  minSolSpent: number;
  maxTransactions: number;
  userId?: string;
  requestId: string;
}

// Enrichment Operations Job Data
export interface EnrichTokenBalancesJobData {
  walletBalances?: Record<string, { tokenBalances: { mint: string, uiBalance: number }[] }>;
  balancesKey?: string;
  walletAddresses?: string[];
  userId?: string;              // User who triggered the job (for room-based WebSocket)
  requestId: string;
  priority?: number;
  optimizationHint?: 'small' | 'large' | 'massive'; // For smart batching
  enrichmentContext?: 'dashboard-analysis' | 'similarity-analysis' | 'manual'; // Context for filtering decisions
}

export interface ParallelEnrichmentJobData {
  requestId: string;
  userId?: string;
  walletBalances?: Record<string, any>;
  balancesKey?: string;
  walletAddresses?: string[];
}


// Common Job Result Types
export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: number;
  processingTimeMs?: number;
}

export interface WalletSyncResult extends JobResult {
  walletAddress: string;
  status: 'synced' | 'already-current' | 'failed';
  lastSync?: Date;
}

export interface AnalysisResult extends JobResult {
  walletAddress: string;
  analysisType: 'pnl' | 'behavior';
  resultId?: string; // Reference to stored analysis result
  analysisSkipped?: boolean; // True if analysis was skipped (e.g., system wallet)
  skipReason?: string; // Reason for skipping
  knownType?: string; // Wallet type if detected (e.g., 'SYSTEM', 'BURN')
  knownLabel?: string; // Display label for known wallet type
}

export interface SimilarityFlowResult extends JobResult {
  requestId: string;
  enrichmentJobId?: string; // Job ID for background enrichment subscription
  metadata: {
    requestedWallets: number;
    processedWallets: number;
    failedWallets: number;
    invalidWallets?: string[]; // List of wallet addresses that were marked as invalid
    systemWallets?: string[]; // List of system wallet addresses that were filtered out
    systemWalletDetails?: Array<{ address: string; tokenCount: number; reason: string }>; // Details about filtered system wallets
    successRate: number;
    processingTimeMs: number;
  };
  similarityResultId?: string; // Reference to stored similarity result
}



export interface EnrichTokenBalancesResult extends JobResult {
  enrichedBalances: Record<string, any>;
  metadata: {
    totalTokens: number;
    enrichedTokens: number;
    backgroundProcessedTokens: number;
    processingStrategy: 'sync' | 'background' | 'hybrid';
  };
}

// Holder Profiles Types
export type DataQualityTier = 'GOLD' | 'SILVER' | 'BRONZE' | 'INSUFFICIENT';
export type HoldTimeSource = 'CURRENT' | 'EXITED' | 'MIXED';

export interface HoldTimeDistribution {
  instant: number;
  ultraFast: number;
  fast: number;
  momentum: number;
  intraday: number;
  day: number;
  swing: number;
  position: number;
}

export interface EnrichedHoldTimeBucket {
  count: number;
  winRate: number;         // Percentage of profitable tokens (0-100)
  totalPnlSol: number;     // Aggregate PnL in SOL for the bucket
  avgPnlSol: number;       // Average PnL per token in the bucket
  roiPercent: number;      // ROI percentage for the bucket
  totalCapitalSol: number; // Total capital deployed in SOL for the bucket
}

export interface EnrichedHoldTimeDistribution {
  instant: EnrichedHoldTimeBucket;
  ultraFast: EnrichedHoldTimeBucket;
  fast: EnrichedHoldTimeBucket;
  momentum: EnrichedHoldTimeBucket;
  intraday: EnrichedHoldTimeBucket;
  day: EnrichedHoldTimeBucket;
  swing: EnrichedHoldTimeBucket;
  position: EnrichedHoldTimeBucket;
}

export interface HolderProfile {
  walletAddress: string;
  rank: number;
  supplyPercent: number;
  tokenHoldingValueSol?: number | null;
  // Known wallet registry info (when analysisSkipped=true)
  knownType?: string;                   // BURN, LP, JUPITER, RAYDIUM, etc.
  knownLabel?: string;                  // Display label (e.g., "🔥 Burn Address")
  analysisSkipped?: boolean;            // true when wallet is known non-trader
  // Smart fallback metrics (typical → realized → current) - NOT deprecated
  medianHoldTimeHours: number | null;
  avgHoldTimeHours: number | null;
  dailyFlipRatio: number | null;        // Percentage of completed positions held <5min
  dailyFlipRatioConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';  // Based on sample size
  behaviorType: string | null;          // SNIPER, SCALPER, MOMENTUM, INTRADAY, DAY_TRADER, SWING, POSITION, HOLDER
  exitPattern: string | null;           // GRADUAL, ALL AT ONCE
  dataQualityTier: DataQualityTier;
  completedCycleCount: number;
  confidence: number;
  insufficientDataReason?: string;
  processingTimeMs: number;
  holdTimeDistribution?: HoldTimeDistribution;
  enrichedHoldTimeDistribution?: EnrichedHoldTimeDistribution;
  includesCurrentHoldings?: boolean;
  exitRate?: number | null;
  totalTokensTraded?: number;
  typicalHoldTimeHours?: number | null;
  typicalHoldTimeSource?: HoldTimeSource;
  realizedMedianHoldTimeHours?: number | null;
  realizedAverageHoldTimeHours?: number | null;
  currentHoldMedianHours?: number | null;
  currentHoldAverageHours?: number | null;
  percentValueInCurrentHoldings?: number | null;
  currentHoldingsCount?: number | null;
  currentHoldings?: Array<{
    tokenAddress: string;
    uiBalance: number | null;
    decimals: number | null;
    valueSol?: number | null;
    valueUsd?: number | null;
  }>;
  unresolvedTokensCount?: number | null;
  activeHoldingsFilteredOut?: number | null;
  heldValueThresholdSol?: number | null;
  walletPnlSol?: number | null;
  walletPnlUsd?: number | null;
  walletRealizedPnlSol?: number | null;
  walletRealizedPnlUsd?: number | null;
  solBalance?: number | null;
  oldestTransactionTimestamp?: number;
  newestTransactionTimestamp?: number;
}

export interface HolderProfilesResult extends JobResult {
  mode: 'token' | 'wallet';
  tokenMint?: string;
  targetWallet?: string;
  profiles: HolderProfile[];
  metadata: {
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
    totalProcessingTimeMs: number;
    avgProcessingTimePerWalletMs: number;
    failedHolders?: number;
    cacheOnly?: boolean;
  };
}
