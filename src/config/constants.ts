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

// Database configuration
export const DB_CONFIG = {
  batchSize: 100,
  maxRetries: 3,
  retryDelayMs: 1000
} as const; 