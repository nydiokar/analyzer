// Response types for the SolanaTracker Data API

export interface SolanaTrackerTopTrader {
  wallet: string;
  held: number;
  sold: number;
  holding: number;
  realized: number;
  unrealized: number;
  total: number;
  total_invested: number;
}

export type SolanaTrackerTopTradersResponse = SolanaTrackerTopTrader[];
