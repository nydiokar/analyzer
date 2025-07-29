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

// Transaction mapping configuration
export const TRANSACTION_MAPPING_CONFIG = {
  // Jito MEV protection filtering
  ENABLE_LIQUIDITY_FILTERING: true, // Set to false to include liquidity add/remove operations in swap analysis
  JITO_PROGRAM_PREFIX: 'jitodontfront',
  
  // Bot transaction handling
  BOT_DETECTION_ENABLED: true,
  BOT_TRANSACTION_HANDLING: 'include' as 'include' | 'exclude' | 'mark', // How to handle suspected bot transactions
  
  // Dust filtering thresholds
  NATIVE_SOL_LAMPORT_THRESHOLD: 100000, // 0.0001 SOL
  SOL_DUST_TRANSFER_THRESHOLD: 0.001, // 0.001 SOL
  
  // Bot activity thresholds
  HIGH_FREQUENCY_THRESHOLD: 10, // transactions
  MICRO_TRANSACTION_SOL_THRESHOLD: 0.1, // SOL value
} as const;

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
  SIMILARITY_LAB_MAX_SIGNATURES: 500,
  DASHBOARD_MAX_SIGNATURES: 4000,
} as const;

// Database configuration
export const DB_CONFIG = {
  batchSize: 100, // General purpose batch size
  analysisBatchSize: 50, // Optimized for AnalysisResult upserts
  swapInputBatchSize: 250, // Larger batches for simple inserts
  maxRetries: 3,
  retryDelayMs: 1000,
  transactionTimeout: 30000, // 30 seconds for large transactions
  // SQLite-specific optimizations
  sqlite: {
    pragmas: {
      journal_mode: 'WAL', // Write-Ahead Logging for better concurrency
      synchronous: 'NORMAL', // Balance between safety and performance
      cache_size: 10000, // 10MB cache
      temp_store: 'MEMORY', // Store temporary data in memory
    }
  }
} as const;

export const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Performance configuration for Helius API
export const HELIUS_CONFIG = {
  DEFAULT_RPS: 25, // Reduced from 5 to 3 - extremely conservative to handle silent rate limiting
  INTERNAL_CONCURRENCY: 10, // Keep at 1 - NO concurrent requests to eliminate burst patterns
  BATCH_SIZE: 100, // Reduced from 100 to 50 - smaller batches to reduce API pressure
} as const;

// Queue and processing configuration
export const PROCESSING_CONFIG = {
  WALLET_SYNC_CONCURRENCY: 3, // Number of wallets that can sync simultaneously
  BATCH_PROCESSING_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
  FAILURE_THRESHOLD: 0.8, // 80% success rate required
  RETRY_ATTEMPTS: 1,
  RETRY_DELAY_MS: 2000
} as const;

// Dashboard Job System Configuration
export const DASHBOARD_JOB_CONFIG = {
  DEFAULT_TIMEOUT_MINUTES: 15,
  SYNC_TIMEOUT_MINUTES: 20,
  ENRICHMENT_TIMEOUT_MINUTES: 20,
  MAX_RETRIES: 3,
  PROGRESS_UPDATE_INTERVAL: 2000, // 5 seconds
  ENABLED: process.env.USE_DASHBOARD_JOB_SYSTEM === 'true' || false, // Feature flag
} as const;

// Enhanced metadata fetching configuration
export const METADATA_FETCHING_CONFIG = {
  // DexScreener API optimization
  dexscreener: {
    chunkSize: 30, // Maximum tokens per API call
    maxConcurrentRequests: 2, // Parallel requests while respecting rate limits
    baseWaitTimeMs: 800, // Reduced from 1000ms
    adaptiveRateLimiting: true, // Dynamically adjust based on response times
    maxRetries: 2,
    // Caching for metadata ONLY (not price/balance data)
    // FIXED: Use 24 hours to allow old tokens like POKE6900 to be refreshed
    cacheExpiryHours: 1, // 24 hours - allows old tokens like POKE6900 to be refreshed
    // Price data should be refreshed more frequently
    priceCacheExpiryMinutes: 1, // 5 minutes for price data
    prioritizeActiveTokens: true, // Prioritize tokens with recent trading activity
  },
  
  // Filtering strategies to reduce unnecessary API calls
  filtering: {
    enableScamTokenFilter: false, // DISABLED by default due to potential false positives
    enableActivityPrioritization: true, // Prioritize tokens with recent activity
    activityLookbackDays: 7, // Look back 7 days for activity
    // NOTE: Activity prioritization does NOT skip inactive tokens - it just processes active ones FIRST
    // This ensures faster enrichment for tokens likely to have metadata
    // Skip tokens with these patterns
    scamPatterns: [
      // REMOVED CONFUSING PATTERNS - these were based on incorrect assumptions
      // Instead, use more conservative filtering:
      
      // Skip tokens with suspicious repeated characters (likely vanity/scam addresses)
      /^(.)\1{10,}/, // Same character repeated 10+ times
      
      // Skip obvious test/demo tokens (but be conservative)
      /^[0]{20,}/, // Addresses with 20+ zeros (likely test tokens)
    ]
  },
  
  // Job cancellation and progress tracking
  cancellation: {
    checkIntervalMs: 1000, // Check for cancellation every second
    enableGracefulCancellation: true,
    batchSizeForResponsiveness: 500, // Smaller batches for better cancellation response
  },
  
  // Alternative data sources for fallback
  fallback: {
    enableJupiterApi: false, // TODO: Implement Jupiter API fallback
    enableCoinGeckoApi: false, // TODO: Implement CoinGecko fallback
    priorityOrder: ['dexscreener', 'jupiter', 'coingecko'], // Preference order
  },

  // Smart scheduling for resource management
  scheduling: {
    maxConcurrentJobs: 2, // Limit parallel enrichment jobs
    priorityThresholds: {
      highPriority: 100, // < 100 tokens = high priority
      mediumPriority: 1000, // 100-1000 tokens = medium priority
      lowPriority: Infinity, // > 1000 tokens = low priority (background)
    },
    delayBetweenLargeJobs: 30000, // 30 seconds delay between large jobs
  }
} as const;

// Known system/bot/exchange wallets that should be tagged instead of analyzed
export const KNOWN_SYSTEM_WALLETS = [
// most of these are jupiter accounts
  '2MFoS3MPtvyQ4Wh4M9pdfPjz6UhVoNbFbGJAskCPCj3h', 
  '3CgvbiM3op4vjrrjH2zcrQUwsqh5veNVRjFCB9N6sRoD',  
  '3LoAYHuSd7Gh8d7RTFnhvYtiTiefdZ5ByamU42vkzd76', 
  '4xDsmeTWPNjgSVSS1VTfzFq3iHZhp77ffPkAmkZkdu71', 
  '69yhtoJR4JYPPABZcSNkzuqbaFbwHsCkja1sP1Q2aVT5', 
  '6LXutJvKUw8Q5ue2gCgKHQdAN4suWW8awzFVC6XCguFx', 
  '6U91aKa8pmMxkJwBCfPTmUEfZi6dHe7DcFq2ALvB2tbB',  
  '7iWnBRRhBCiNXXPhqiGzvvBkKrvFSWqqmxRyu9VyYBxE', 
  '9nnLbotNTcUhvbrsA6Mdkx45Sm82G35zo28AqUvjExn8', 
  'BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV', 
  'CapuXNQoDviLvU1PxFiizLgPNQCxrsag1uMeyk6zLVps', 
  'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf', 
  'DSN3j1ykL3obAVNv7ZX49VsFCPe4LqzxHnmtLiPwY6xg', 
  'GGztQqQ6pCPaJQnNpXBgELr5cs3WwDakRbh1iEMzjgSJ', 
  'GP8StUXNYSZjPikyRsvkTbvRV1GBxMErb59cpeCJnDf1', 
  'HFqp6ErWHY6Uzhj8rFyjYuDya2mXUpYEk8VW75K9PSiY',
  'HU23r7UoZbqTUuh3vA7emAGztFtqwTeVips789vqxxBw',
  'Jx2c1k5iYrtk52KeBPSykEutbUMfS4Sjv9kmZm33LKn',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  '45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp', // jupiter partner referral fee vault
  'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC', // jupiter partner referral fee vault
  
  // Large system accounts (over 10k tokens but not necessarily Jupiter)
  '34FKjAdVcTax2DHqV2XnbXa9J3zmyKcFuFKWbcmgxjgm', // 5.5k tokens - system account
  'ZG98FUCjb8mJ824Gbs6RsgVmr1FhXb2oNiJHa2dwmPd', // 5.5k tokens - system account
  '8psNvWTrdNTiVRNzAgsou9kETXNJm2SXZyaKuJraVRtf', // 5.5k tokens - system account

  
  // Add more as they're discovered
] as const;

// Wallet classification types for database tagging
export const WALLET_CLASSIFICATIONS = {
  NORMAL: 'NORMAL',           // Regular user wallet
  SYSTEM: 'SYSTEM',           // System/protocol account  
  JUPITER: 'JUPITER',         // Jupiter aggregator account
  EXCHANGE: 'EXCHANGE',       // CEX deposit/withdrawal account
  BOT: 'BOT',                 // Trading bot account
  INVALID: 'INVALID',         // Invalid/empty wallet
  LARGE: 'LARGE',             // Large wallet (>10k tokens) but not system
} as const;