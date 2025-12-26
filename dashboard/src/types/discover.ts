import { SpeedCategory, FlowPattern, StrategyType } from './api';

export interface DiscoverWalletMetrics {
  realizedPnl?: number | null;
  unrealizedPnl?: number | null;
  winRatePercent?: number | null;
  totalTrades?: number | null;
  totalBuys?: number | null;
  totalSells?: number | null;
  totalExecutedSwaps?: number | null;
  averageHoldHours?: number | null;
  medianHoldHours?: number | null;
  uniqueTokensTraded?: number | null;
  tradingStyle?: string | null;

  // NEW: Classification system fields (2025-12-25)
  speedCategory?: SpeedCategory | null;
  flowPattern?: FlowPattern | null;
  strategyType?: StrategyType | null;

  // NEW: Behavioral detail metrics for data-driven storytelling (2025-12-26)
  buySellRatio?: number | null;
  percentageOfUnpairedTokens?: number | null;
  buySellSymmetry?: number | null;
  sequenceConsistency?: number | null;
  exitPattern?: string | null;
  percentOfValueInCurrentHoldings?: number | null;
  medianCurrentHoldingDurationHours?: number | null;

  lastActiveAt?: string | null;
  pnlUpdatedAt?: string | null;
  behaviorUpdatedAt?: string | null;
  stalenessMinutes?: number | null;
}

export interface DiscoverWallet {
  walletAddress: string;
  reason: string;
  reasonCode: string;
  lastUpdatedAt?: string | null;
  metrics: DiscoverWalletMetrics;
}

export interface DiscoverWalletsResponse {
  items: DiscoverWallet[];
  page: number;
  pageSize: number;
  total: number;
  sort: string;
  timeframe?: string;
}
