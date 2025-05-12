import { WalletCluster } from './wallet';

export interface TransactionData {
  mint: string;
  timestamp: number;
  direction: 'in' | 'out';
  amount: number;
  associatedSolValue: number;
}

export interface CorrelatedPairData {
  walletA_address: string;
  walletB_address: string;
  score: number;
  sharedNonObviousTokens: {
    mint: string;
    countA: number;
    countB: number;
  }[];
  synchronizedEvents: {
    mint: string;
    direction: 'in' | 'out';
    timestampA: number;
    timestampB: number;
    timeDiffSeconds: number;
  }[];
}

export interface CorrelationMetrics {
  pairs: CorrelatedPairData[];
  clusters: WalletCluster[];
  globalTokenStats: {
    totalUniqueTokens: number;
    totalPopularTokens: number;
    totalNonObviousTokens: number;
  };
} 