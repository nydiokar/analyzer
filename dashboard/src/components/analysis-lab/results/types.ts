// This file holds the frontend-specific types for the similarity analysis results.
// It adapts the backend types for easier use in React components.

// Based on src/types/similarity.ts and src/core/analysis/similarity/similarity-service.ts

export type SimilarityVectorType = 'capital' | 'binary';

export interface CorePairwiseResult {
  walletA: string;
  walletB: string;
  similarityScore: number;
  sharedTokens: { mint: string; weightA: number; weightB: number }[];
}

export interface GlobalMetrics {
  averageSimilarity: number;
  mostSimilarPairs: CorePairwiseResult[];
}

export interface SingleSimilarityResult {
  pairwiseSimilarities: CorePairwiseResult[];
  clusters: any[]; // Use a more specific type if cluster structure is known
  globalMetrics: GlobalMetrics;
  walletVectorsUsed: Record<string, Record<string, number>>;
  uniqueTokensPerWallet: Record<string, number>;
  vectorTypeUsed: SimilarityVectorType;
}

export interface TokenVector {
  [mint: string]: number;
}

export enum InsightType {
  BehavioralMirror = 'Behavioral Mirror',
  CapitalDivergence = 'Capital Divergence',
  SustainedAlignment = 'Sustained Alignment',
  SignificantAsymmetry = 'Significant Asymmetry',
  VeryHighSimilarity = 'Very High Similarity',
  SharedZeroHoldings = 'Shared Zero Holdings',
}

export interface KeyInsight {
  type: InsightType;
  wallets: [string, string];
  text: string;
  score: number; // A representative score for sorting
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

export interface MostCommonToken {
  mint: string;
  count: number;
  wallets: string[];
}

export interface TokenInfo {
  name: string;
  symbol: string;
}

export interface CombinedPairwiseSimilarity {
  walletA: string;
  walletB: string;
  binaryScore: number;
  capitalScore: number;
  sharedTokens: { mint: string }[];
  capitalAllocation: Record<string, { weightA: number; weightB: number }>;
  
  // Explicit counts from the binary analysis
  binarySharedTokenCount: number;
  binaryUniqueTokenCountA: number;
  binaryUniqueTokenCountB: number;

  // Explicit counts from the capital analysis
  capitalSharedTokenCount: number;
  capitalUniqueTokenCountA: number;
  capitalUniqueTokenCountB: number;
}

export interface CombinedSimilarityResult {
  pairwiseSimilarities: CombinedPairwiseSimilarity[];
  walletVectorsUsed: Record<string, Record<string, number>>;
  uniqueTokensPerWallet: Record<string, { binary: number; capital: number }>;
  walletBalances?: Record<string, { tokenBalances: { mint: string }[] }>;
  vectorTypeUsed: 'combined';
}

// --- END: Types for the new Similarity Report Parser output --- 