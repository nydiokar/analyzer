// This file will hold the frontend-specific types for the similarity analysis results.
// It adapts the backend types for easier use in React components.

// Based on src/types/similarity.ts and src/core/analysis/similarity/similarity-service.ts

export type SimilarityVectorType = 'capital' | 'binary';

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

// --- START: Types for the new Similarity Report Parser output ---

export enum InsightType {
  SustainedAlignment = 'Sustained Alignment',
  RecentDivergence = 'Recent Divergence',
  RecentConvergence = 'Recent Convergence',
  SignificantAsymmetry = 'Significant Asymmetry',
  FocusedInvestment = 'Focused Investment Pattern',
  VeryHighSimilarity = 'Very High Similarity',
  HighHoldingsOverlap = 'High Current Holdings Overlap',
  HighHoldingsSimilarity = 'High Current Holdings Similarity',
}

export interface KeyInsight {
  type: InsightType;
  wallets: [string, string];
  text: string;
  score: number;
  data: Record<string, any>;
}

export enum ConnectionStrength {
  Strongly = 'Strongly Connected',
  Mildly = 'Mildly Connected',
  Barely = 'Barely Connected',
  None = 'Not Connected',
}

export interface ConnectionDetails {
  strength: ConnectionStrength;
  score: number;
  description: string;
  uniqueA: number;
  uniqueB: number;
}

export interface SimilarityPair extends WalletSimilarity {
  connection: ConnectionDetails;
}

export interface MostCommonToken {
  mint: string;
  count: number;
  wallets: string[];
}

export interface SimilarityReport {
  keyInsights: KeyInsight[];
  topSimilarPairs: SimilarityPair[];
  allPairs: SimilarityPair[];
  mostCommonTokens: MostCommonToken[];
  globalMetrics: {
    averageSimilarity: number;
  };
  vectorTypeUsed: 'capital' | 'binary';
}

export interface TokenInfo {
  name: string;
  symbol: string;
}

// --- END: Types for the new Similarity Report Parser output ---

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
  walletBalances?: Record<string, { tokenBalances: { uiBalance?: number | null }[] }>;
} 