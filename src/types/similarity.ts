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
    globalMetrics: GlobalMetrics;
    jaccardSimilarityMatrix?: Record<string, Record<string, number>>;
    sharedTokenCountsMatrix?: Record<string, Record<string, number>>;
    uniqueTokensPerWallet: Record<string, number>;
    walletBalances?: Record<string, WalletBalance>;
    vectorTypeUsed: 'capital' | 'binary';
    holdingsPresenceJaccardMatrix?: Record<string, Record<string, number>>;
    holdingsPresenceCosineMatrix?: Record<string, Record<string, number>>;
}

export interface GlobalMetrics {
    averageSimilarity: number;
    mostSimilarPairs: CorePairwiseResult[];
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
    globalMetrics: GlobalMetrics;
    walletVectorsUsed: Record<string, TokenVector>;
    uniqueTokensPerWallet: Record<string, { binary: number; capital: number }>;
    walletBalances?: Record<string, WalletBalance>;
    vectorTypeUsed: 'combined';
    sharedTokenCountsMatrix?: Record<string, Record<string, number>>;
    jaccardSimilarityMatrix?: Record<string, Record<string, number>>;
    holdingsPresenceJaccardMatrix?: Record<string, Record<string, number>>;
    holdingsPresenceCosineMatrix?: Record<string, Record<string, number>>;
    // Additional field for the original all-tokens holdings matrix (for transparency/debugging)
    holdingsPresenceJaccardMatrixAllTokens?: Record<string, Record<string, number>>;
} 