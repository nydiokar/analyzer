import { QueueOptions, WorkerOptions } from 'bullmq';
import { redisConnection } from './redis.config';

// Four specialized queues for optimal control and clear separation
export enum QueueNames {
  WALLET_OPERATIONS = 'wallet-operations',      // Sync, balance fetching
  ANALYSIS_OPERATIONS = 'analysis-operations',  // PNL, behavior analysis  
  SIMILARITY_OPERATIONS = 'similarity-operations', // Multi-wallet similarity analysis
  ENRICHMENT_OPERATIONS = 'enrichment-operations'  // Token metadata, DexScreener data
}

// Job-specific timeout configurations (for processor implementation, not BullMQ config)
export const JobTimeouts = {
  'sync-wallet': {
    timeout: 10 * 60 * 1000,        // 10 minutes max
    staleAfter: 15 * 60 * 1000,     // 15 minutes = stale
    retryBackoff: 'exponential' as const
  },
  'analyze-pnl': {
    timeout: 5 * 60 * 1000,         // 5 minutes max
    staleAfter: 8 * 60 * 1000,      // 8 minutes = stale
    retryBackoff: 'fixed' as const
  },
  'analyze-behavior': {
    timeout: 5 * 60 * 1000,         // 5 minutes max
    staleAfter: 8 * 60 * 1000,      // 8 minutes = stale
    retryBackoff: 'fixed' as const
  },
  'calculate-similarity': {
    timeout: 30 * 60 * 1000,        // 30 minutes max (multi-wallet)
    staleAfter: 45 * 60 * 1000,     // 45 minutes = stale
    retryBackoff: 'exponential' as const
  },

  'enrich-token-balances': {
    timeout: 10 * 60 * 1000,        // 10 minutes max (sophisticated enrichment)
    staleAfter: 15 * 60 * 1000,     // 15 minutes = stale
    retryBackoff: 'fixed' as const
  }
};

// Optimized queue configurations for our current service performance characteristics
export const QueueConfigs: Record<QueueNames, { queueOptions: QueueOptions; workerOptions: WorkerOptions }> = {
  [QueueNames.WALLET_OPERATIONS]: {
    queueOptions: {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 50,      // Keep recent successes
        removeOnFail: 100,         // Keep failures for debugging
        attempts: 3,               // Retry failed API calls
        backoff: {
          type: JobTimeouts['sync-wallet'].retryBackoff,
          delay: 2000
        }
      }
    },
    workerOptions: {
      connection: redisConnection,
      concurrency: 3,              // Helius API rate limits (10 RPS)
    }
  },
  
  [QueueNames.ANALYSIS_OPERATIONS]: {
    queueOptions: {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 20,
        removeOnFail: 50, 
        attempts: 2,               // Analysis failures usually aren't transient
        backoff: {
          type: JobTimeouts['analyze-pnl'].retryBackoff,
          delay: 1000
        }
      }
    },
    workerOptions: {
      connection: redisConnection,
      concurrency: 5,              // CPU-bound, can parallelize
    }
  },
  
  [QueueNames.SIMILARITY_OPERATIONS]: {
    queueOptions: {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 25,
        attempts: 2,               // Similarity failures need investigation
        backoff: {
          type: JobTimeouts['calculate-similarity'].retryBackoff, 
          delay: 5000
        }
      }
    },
    workerOptions: {
      connection: redisConnection,
      concurrency: 1,              // Memory intensive, complex multi-wallet operations
    }
  },
  
  [QueueNames.ENRICHMENT_OPERATIONS]: {
    queueOptions: {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 25,
        attempts: 3,               // External API calls need retries
        backoff: {
          type: JobTimeouts['enrich-token-balances'].retryBackoff, 
          delay: 3000
        }
      }
    },
    workerOptions: {
      connection: redisConnection,
      concurrency: 3,              // I/O bound (external APIs), moderate parallelism
    }
  }
};

// Job priority system
export enum JobPriority {
  CRITICAL = 10,      // User-initiated dashboard requests
  HIGH = 7,           // Similarity analysis for active users
  NORMAL = 5,         // Regular analysis requests  
  LOW = 3,            // Background metadata enrichment
  MAINTENANCE = 1     // Cleanup, batch processing
} 