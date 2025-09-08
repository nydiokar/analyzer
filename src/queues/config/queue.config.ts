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
const getEnvNumber = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

export const JobTimeouts = {
  'sync-wallet': {
    timeout: getEnvNumber('SYNC_WALLET_TIMEOUT_MS', 10 * 60 * 1000),        // 10 minutes max
    staleAfter: 15 * 60 * 1000,     // 15 minutes = stale
    retryBackoff: 'exponential' as const
  },
  'analyze-pnl': {
    timeout: getEnvNumber('ANALYZE_PNL_TIMEOUT_MS', 5 * 60 * 1000),         // 5 minutes max
    staleAfter: 8 * 60 * 1000,      // 8 minutes = stale
    retryBackoff: 'fixed' as const
  },
  'analyze-behavior': {
    timeout: getEnvNumber('ANALYZE_BEHAVIOR_TIMEOUT_MS', 5 * 60 * 1000),         // 5 minutes max
    staleAfter: 8 * 60 * 1000,      // 8 minutes = stale
    retryBackoff: 'fixed' as const
  },
  'calculate-similarity': {
    timeout: getEnvNumber('CALCULATE_SIMILARITY_TIMEOUT_MS', 30 * 60 * 1000),        // 30 minutes max (multi-wallet)
    staleAfter: 45 * 60 * 1000,     // 45 minutes = stale
    retryBackoff: 'exponential' as const
  },
  'enrich-token-balances': {
    timeout: getEnvNumber('ENRICH_TOKEN_BALANCES_TIMEOUT_MS', 20 * 60 * 1000),        // 20 minutes max (reasonable for enrichment)
    staleAfter: 30 * 60 * 1000,     // 30 minutes = stale
    retryBackoff: 'fixed' as const
  },
  'dashboard-wallet-analysis': {
    timeout: getEnvNumber('DASHBOARD_WALLET_ANALYSIS_TIMEOUT_MS', 15 * 60 * 1000),        // 15 minutes max
    staleAfter: 20 * 60 * 1000,     // 20 minutes = stale
    retryBackoff: 'exponential' as const
  }
};

// Optimized queue configurations for production scaling and performance
// Analysis Operations: Increased concurrency (8) and better stall detection for dashboard jobs
// Retry Strategy: Exponential backoff for better failure handling during high load
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
        removeOnComplete: 100,        // Increased for better scaling (more completed jobs kept for debugging)
        removeOnFail: 200,            // Increased for better error analysis during high load
        attempts: 3,
        backoff: {
          type: 'exponential' as const, // Better for dashboard jobs than fixed delay
          delay: 3000                   // Reduced from 5000ms for faster retries
        }
      }
    },
    workerOptions: {
      connection: redisConnection,
      concurrency: 10,              // Bump to 10 to meet sub-30s SLA for webhook-triggered jobs
      maxStalledCount: 3,           // Prevent stuck jobs during scaling
      stalledInterval: 30000,       // 30 seconds check for stalled jobs
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