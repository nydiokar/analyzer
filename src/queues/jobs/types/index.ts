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

// Dashboard Wallet Analysis Job Data
export interface DashboardWalletAnalysisJobData {
  walletAddress: string;
  requestId: string;
  forceRefresh?: boolean;
  enrichMetadata?: boolean;
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