import type { DashboardAnalysisScope, DashboardAnalysisTriggerSource } from '../../../shared/dashboard-analysis.types';

// Wallet Operations Job Data
export interface SyncWalletJobData {
  walletAddress: string;
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
  requestId?: string;
}

// Analysis Operations Job Data
export interface AnalyzePnlJobData {
  walletAddress: string;
  dependsOnSyncJob?: string; // Job ID dependency
  forceRefresh?: boolean;
  requestId?: string;
}

export interface AnalyzeBehaviorJobData {
  walletAddress: string;
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
  tokenMint?: string;
  topN?: number;              // Number of top holders to analyze (default: 10) when token mode
  walletAddress?: string;     // Specific wallet to analyze when wallet mode
  requestId: string;
}

// Dashboard Wallet Analysis Job Data
export interface DashboardWalletAnalysisJobData {
  walletAddress: string;
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
  requestId: string;
  walletsNeedingSync?: string[]; // Specific wallets that need sync (empty array = no sync needed)
  enrichMetadata?: boolean;     // Whether to enrich token metadata (default true)
  failureThreshold?: number;    // Partial failure tolerance (default 0.8)
  timeoutMinutes?: number;      // Job-level timeout (default 45)
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



// Enrichment Operations Job Data
export interface EnrichTokenBalancesJobData {
  walletBalances: Record<string, { tokenBalances: { mint: string, uiBalance: number }[] }>;
  requestId: string;
  priority?: number;
  optimizationHint?: 'small' | 'large' | 'massive'; // For smart batching
  enrichmentContext?: 'dashboard-analysis' | 'similarity-analysis' | 'manual'; // Context for filtering decisions
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
export type DataQualityTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
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
  // Smart fallback metrics (typical → realized → current) - NOT deprecated
  medianHoldTimeHours: number | null;
  avgHoldTimeHours: number | null;
  dailyFlipRatio: number | null;        // Percentage of completed positions held <5min
  dailyFlipRatioConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';  // Based on sample size
  behaviorType: string | null;          // SNIPER, SCALPER, MOMENTUM, INTRADAY, DAY_TRADER, SWING, POSITION, HOLDER
  exitPattern: string | null;           // GRADUAL, ALL_AT_ONCE
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
  };
}
