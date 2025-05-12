import { TokenMetrics } from './analysis';

export interface BehavioralMetrics {
  buySellRatio: number;
  buySellSymmetry: number;
  averageFlipDurationHours: number;
  medianHoldTime: number;
  sequenceConsistency: number;
  flipperScore: number;
  uniqueTokensTraded: number;
  tokensWithBothBuyAndSell: number;
  totalTradeCount: number;
  totalBuyCount: number;
  totalSellCount: number;
  completePairsCount: number;
  averageTradesPerToken: number;
  tradingTimeDistribution: {
    ultraFast: number;
    veryFast: number;
    fast: number;
    moderate: number;
    dayTrader: number;
    swing: number;
    position: number;
  };
  percentTradesUnder1Hour: number;
  percentTradesUnder4Hours: number;
  tradingStyle: string;
  confidenceScore: number;
  tradingFrequency: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  tokenPreferences: {
    mostTraded: TokenMetrics[];
    mostProfitable: TokenMetrics[];
    mostHeld: TokenMetrics[];
  };
  riskMetrics: {
    averageTransactionSize: number;
    largestTransaction: number;
    diversificationScore: number;
  };
  profitMetrics: {
    totalPnL: number;
    winRate: number;
    averageProfitPerTrade: number;
    profitConsistency: number;
  };
} 