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
    sharedTokenCount: number;
    uniqueTokenCountA: number;
    uniqueTokenCountB: number;
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
    walletVectorsUsed: Record<string, TokenVector>;
    uniqueTokensPerWallet: Record<string, { binary: number; capital: number }>;
    walletBalances?: Record<string, WalletBalance>;
    vectorTypeUsed: 'combined';
} 