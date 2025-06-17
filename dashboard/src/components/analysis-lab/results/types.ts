// This file will hold the frontend-specific types for the similarity analysis results.
// It adapts the backend types for easier use in React components.

// Based on src/types/similarity.ts and src/core/analysis/similarity/similarity-service.ts

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

export interface WalletCluster {
  clusterId: number;
  wallets: string[];
}

export interface SimilarityMetrics {
  pairwiseSimilarities: WalletSimilarity[];
  clusters: WalletCluster[];
  globalMetrics: {
    averageSimilarity: number;
    mostSimilarPairs: WalletSimilarity[];
  };
}

export interface TokenVector {
  [mint: string]: number;
}

export interface ComprehensiveSimilarityResult {
  pairwiseSimilarities: WalletSimilarity[];
  clusters: WalletCluster[];
  globalMetrics: {
    averageSimilarity: number;
    mostSimilarPairs: WalletSimilarity[];
  };
  sharedTokenCountsMatrix: Record<string, Record<string, number>>;
  jaccardSimilarityMatrix: Record<string, Record<string, number>>;
  fullSharedTokenList: { mint: string; sharedByWallets: string[]; count: number }[];
  walletVectorsUsed: Record<string, TokenVector>;
  vectorTypeUsed: 'capital' | 'binary';
  holdingsPresenceJaccardMatrix?: Record<string, Record<string, number>>;
  holdingsPresenceCosineMatrix?: Record<string, Record<string, number>>;
  uniqueTokensPerWallet: Record<string, number>;
} 