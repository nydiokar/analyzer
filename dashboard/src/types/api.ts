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