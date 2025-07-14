// Default number of recent transactions to analyze per wallet
export const DEFAULT_RECENT_TRANSACTION_COUNT = 500;

// Mints to exclude from analysis (common tokens, system tokens, etc.)
export const DEFAULT_EXCLUDED_MINTS = [
  'So11111111111111111111111111111111111111112', // Wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj', // stSOL
  'rndrizKT3MK1iimdxRdWabcF7Zb7nx9Vi3CY6A5J9NK', // rndr
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
];

// Define specific program IDs
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxAPds';

// Consider if SOL_TOKEN_PROGRAM_ID is still needed or if its usages should be updated.
// For now, I'll leave it commented out or you can decide to remove it if it's fully replaced.
// export const SOL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA, TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxAPds';

export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

// Analysis configuration
export const CLUSTERING_CONFIG = {
  excludedMints: DEFAULT_EXCLUDED_MINTS,
  syncTimeWindowSeconds: 300, // 5 minutes
  minSharedNonObviousTokens: 2,
  minSyncEvents: 2,
  weightSharedNonObvious: 1.0,
  weightSyncEvents: 2.0,
  nonObviousTokenThresholdPercent: 0.2,
  minOccurrencesForPopular: 100,
  topKResults: 50, // Used for report display limit in script, bot may handle differently
  topKCorrelatedPairsToReport: 7, // Max top correlated pairs to show in bot report
  minClusterScoreThreshold: 20,
  MAX_DAILY_TOKENS_FOR_FILTER: 50 // From activityCorrelator.ts for bot filtering
} as const;

export const ANALYSIS_EXECUTION_CONFIG = {
  SIMILARITY_LAB_MAX_SIGNATURES: 200,
  DASHBOARD_MAX_SIGNATURES: 5000,
} as const;

// Database configuration
export const DB_CONFIG = {
  batchSize: 100,
  maxRetries: 3,
  retryDelayMs: 1000
} as const;

export const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Performance configuration for Helius API
export const HELIUS_CONFIG = {
  DEFAULT_RPS: 25, // Requests per second (adjust based on your Helius plan)
  INTERNAL_CONCURRENCY: 5, // Concurrent batches for transaction detail fetching (reduced from 5)
  BATCH_SIZE: 100, // Signatures per batch request
} as const;

// Queue and processing configuration
export const PROCESSING_CONFIG = {
  WALLET_SYNC_CONCURRENCY: 3, // Number of wallets that can sync simultaneously
  BATCH_PROCESSING_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
  FAILURE_THRESHOLD: 0.8, // 80% success rate required
  RETRY_ATTEMPTS: 1,
  RETRY_DELAY_MS: 2000
} as const;