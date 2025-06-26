import { WalletBalance, WalletCluster } from './wallet';

export interface CommonToken {
    mint: string;
    wallets: string[];
    count: number;
    name?: string;
    symbol?: string;
    imageUrl?: string;
}

export interface TokenVector {
    [mint: string]: number;
}

export interface WalletSimilarity {
    walletA: string;
    walletB: string;
    similarityScore: number;
    sharedTokens: { mint: string; weightA: number; weightB: number }[];
}

export interface SimilarityMetrics {
    walletVectorsUsed: Record<string, TokenVector>;
    pairwiseSimilarities: WalletSimilarity[];
    clusters: WalletCluster[];
    globalMetrics: {
        averageSimilarity: number;
        mostSimilarPairs: WalletSimilarity[];
    };
    // The following are calculated in the service, not the core analyzer
    jaccardSimilarityMatrix?: Record<string, Record<string, number>>;
    sharedTokenCountsMatrix?: Record<string, Record<string, number>>;
    uniqueTokensPerWallet: Record<string, number>;
    walletBalances?: Record<string, WalletBalance>;
    vectorTypeUsed: 'capital' | 'binary';
}

export interface ComprehensiveSimilarityResult {
  holdingsPresenceJaccardMatrix?: Record<string, Record<string, number>>;
  holdingsPresenceCosineMatrix?: Record<string, Record<string, number>>;
  uniqueTokensPerWallet: Record<string, number>;
  walletBalances?: Record<string, WalletBalance>;
} 