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
    timeout: 20 * 60 * 1000,        // 20 minutes max (reasonable for enrichment)
    staleAfter: 30 * 60 * 1000,     // 30 minutes = stale
    retryBackoff: 'fixed' as const
  },
  'dashboard-wallet-analysis': {
    timeout: 15 * 60 * 1000,        // 15 minutes max
    staleAfter: 20 * 60 * 1000,     // 20 minutes = stale
    retryBackoff: 'exponential' as const
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
      concurrency: 3,              // Restored from 1 to 3 - original working setting
    }
  },
  [QueueNames.ANALYSIS_OPERATIONS]: {
    queueOptions: {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 3,
        backoff: {
          type: JobTimeouts['analyze-behavior'].retryBackoff,
          delay: 5000
        }
      }
    },
    workerOptions: {
      connection: redisConnection,
      concurrency: 5,              // Restored from 1 to 5 - original working setting
    }
  },
  [QueueNames.SIMILARITY_OPERATIONS]: {
    queueOptions: {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 3,
        backoff: {
          type: JobTimeouts['calculate-similarity'].retryBackoff,
          delay: 3000
        }
      }
    },
    workerOptions: {
      connection: redisConnection,
      concurrency: 2,              // Restored from 1 to 2 - original working setting
    }
  },
  [QueueNames.ENRICHMENT_OPERATIONS]: {
    queueOptions: {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 3,
        backoff: {
          type: JobTimeouts['enrich-token-balances'].retryBackoff,
          delay: 2000
        }
      }
    },
    workerOptions: {
      connection: redisConnection,
      concurrency: 3,              // Restored from 1 to 3 - original working setting
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