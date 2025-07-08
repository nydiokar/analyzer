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

// Similarity Operations Job Data
export interface SimilarityAnalysisFlowData {
  walletAddresses: string[];
  requestId: string;
  failureThreshold?: number;    // Partial failure tolerance (default 0.8)
  timeoutMinutes?: number;      // Job-level timeout (default 30)
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

// Balance Fetching + Enrichment Job Data
export interface BalanceEnrichmentFlowData {
  walletAddresses: string[];
  requestId: string;
  enrichMetadata?: boolean;     // Whether to enrich metadata (default true)
  timeoutMinutes?: number;      // Job-level timeout (default 20)
}

// Enrichment Operations Job Data
export interface EnrichMetadataJobData {
  tokenAddresses: string[];
  priority?: number;
  requestId?: string;
}

export interface EnrichTokenBalancesJobData {
  walletBalances: Record<string, { tokenBalances: { mint: string, uiBalance: number }[] }>;
  requestId: string;
  priority?: number;
  optimizationHint?: 'small' | 'large' | 'massive'; // For smart batching
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
  metadata: {
    requestedWallets: number;
    processedWallets: number;
    failedWallets: number;
    successRate: number;
    processingTimeMs: number;
  };
  similarityResultId?: string; // Reference to stored similarity result
}

export interface MetadataEnrichmentResult extends JobResult {
  tokenAddress: string;
  status: 'enriched' | 'already-current' | 'failed';
  lastUpdated?: Date;
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