import { CLUSTERING_CONFIG } from '../config/constants';

// Re-export other types if needed
export * from './wallet'; // Example

// --- Base Configuration --- 
export interface BaseAnalysisConfig {
  timeRange?: { startTs?: number; endTs?: number };
  excludedMints?: string[];
}

// --- Specific Configuration Interfaces --- 

// Configuration specific to Behavior Analysis
export interface BehaviorAnalysisConfig extends BaseAnalysisConfig {
  // Add behavior-specific config options here in the future if needed
  sessionGapThresholdHours?: number; // Added for session calculation
  activityWindowThresholdMultiplier?: number; // For identifying active trading windows
  // Thresholds for determining "significant holdings" vs dust
  holdingThresholds?: {
    minimumSolValue?: number;      // Minimum SOL value to consider (default: 0.001)
    minimumPercentageRemaining?: number; // Minimum % of original position (default: 0.05 = 5%)
    minimumHoldingTimeSeconds?: number;  // Minimum time held to count (default: 300 = 5 minutes)
  };
}

// Configuration specific to Correlation Analysis
// Assuming CLUSTERING_CONFIG is defined elsewhere (e.g., constants or correlation types) and imported
export interface CorrelationAnalysisConfig extends BaseAnalysisConfig {
  thresholds?: typeof CLUSTERING_CONFIG;
  // Add other correlation-specific config options here
}

// Configuration specific to Similarity Analysis
export interface SimilarityAnalysisConfig extends BaseAnalysisConfig {
  // Add similarity-specific config options here
}

// --- Original combined interface (removed) ---
// export interface AnalysisConfig { ... }

// --- CLUSTERING_CONFIG (Should be moved, but kept for now if defined here) ---
// IMPORTANT: If CLUSTERING_CONFIG is defined below, it needs to be moved to
// src/types/correlation.ts or a dedicated constants file for the import above to work correctly.

/*
export const CLUSTERING_CONFIG = { ... } // Example placeholder
*/

// --- Re-exports (Keep existing ones) ---

// Re-export existing types from Helius API (example, adjust as needed)
export type {
    OnChainAnalysisResult, // Keep existing re-exports
    AdvancedTradeStats, 
    SwapAnalysisSummary 
} from './helius-api';

// Re-export existing types from Wallet (example, adjust as needed)
export type { 
    WalletInfo, 
    WalletTransaction, 
    WalletCluster 
} from './wallet';

// Analysis result wrapper
export interface AnalysisResult<T> {
  data: T;
  metadata: {
    timestamp: number;
    processingTime: number;
    error?: string;
  };
}

// Common interfaces for analysis
export interface TokenMetrics {
  mint: string;
  count: number;
  totalValue?: number;
  firstSeen?: number;
  lastSeen?: number;
}

export interface WalletMetrics {
  address: string;
  totalTransactions: number;
  uniqueTokens: number;
  totalValue: number;
  firstActivity: number;
  lastActivity: number;
} 


