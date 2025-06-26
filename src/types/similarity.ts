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

// =================================================================
// === Structures for the Core Service (Single Analysis Run)
// =================================================================

export interface CorePairwiseResult {
    walletA: string;
    walletB: string;
    similarityScore: number;
    sharedTokens: { mint: string; weightA: number; weightB: number }[];
}

export interface SingleSimilarityResult {
    walletVectorsUsed: Record<string, TokenVector>;
    pairwiseSimilarities: CorePairwiseResult[];
    clusters: WalletCluster[];
    globalMetrics: {
        averageSimilarity: number;
        mostSimilarPairs: CorePairwiseResult[];
    };
    jaccardSimilarityMatrix?: Record<string, Record<string, number>>;
    sharedTokenCountsMatrix?: Record<string, Record<string, number>>;
    uniqueTokensPerWallet: Record<string, number>;
    walletBalances?: Record<string, WalletBalance>;
    vectorTypeUsed: 'capital' | 'binary';
    holdingsPresenceJaccardMatrix?: Record<string, Record<string, number>>;
    holdingsPresenceCosineMatrix?: Record<string, Record<string, number>>;
}


// =================================================================
// === Structures for the API Service (Combined Result)
// =================================================================

export interface CombinedPairwiseSimilarity {
    walletA: string;
    walletB: string;
    binaryScore: number;
    capitalScore: number;
    sharedTokens: { mint: string; weightA: number; weightB: number }[];
}

export interface CombinedSimilarityResult {
    pairwiseSimilarities: CombinedPairwiseSimilarity[];
    walletVectorsUsed: Record<string, TokenVector>;
    uniqueTokensPerWallet: Record<string, number>;
    walletBalances?: Record<string, WalletBalance>;
    vectorTypeUsed: 'combined';
} 