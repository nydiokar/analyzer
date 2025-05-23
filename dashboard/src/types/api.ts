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
  lastActiveTimestamp: string | null; // ISO date string or null
  daysActive: number | null;
  keyPerformanceIndicators: {
    latestPnl: number | null;
    tokenWinRate: number | null;
    // Potentially more KPIs from AdvancedStatsResult
  };
  behaviorClassification: string | null; // High-level classification from BehaviorService
  rawAdvancedStats?: AdvancedStatsResult; // Full raw object for more detail if needed by client
  rawBehaviorMetrics?: BehaviorMetrics; // Full raw object for more detail if needed by client
  receivedStartDate?: string | null; // For verification, added by mock API
  receivedEndDate?: string | null;   // For verification, added by mock API
}

export interface WalletSummaryError {
  message: string;
  statusCode?: number;
} 