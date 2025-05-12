import { WalletCluster } from './wallet';

export interface TokenVector {
  [token: string]: number;
}

export interface WalletSimilarity {
  walletA: string;
  walletB: string;
  similarityScore: number;
  sharedTokens: {
    mint: string;
    weightA: number;
    weightB: number;
  }[];
}

export interface SimilarityMetrics {
  pairwiseSimilarities: WalletSimilarity[];
  clusters: WalletCluster[];
  globalMetrics: {
    averageSimilarity: number;
    mostSimilarPairs: WalletSimilarity[];
  };
} 