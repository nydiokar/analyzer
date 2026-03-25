import { Injectable, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { EnrichTokenBalancesJobData, ParallelEnrichmentJobData, ProcessMarketContextJobData } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
import { Job } from 'bullmq';
import { REDIS_CLIENT } from '../config/redis.provider';
import { Redis } from 'ioredis';

@Injectable()
export class EnrichmentOperationsQueue {
  private readonly queue: Queue;

  constructor(@Inject(REDIS_CLIENT) private readonly redisClient: Redis) {
    const config = QueueConfigs[QueueNames.ENRICHMENT_OPERATIONS];
    this.queue = new Queue(QueueNames.ENRICHMENT_OPERATIONS, config.queueOptions);
  }

  /**
   * Add a token balance enrichment job to the queue (new sophisticated enrichment)
   */
  async addEnrichTokenBalances(
    data: EnrichTokenBalancesJobData,
    options?: { priority?: number; delay?: number; jobId?: string }
  ) {
    let jobId = options?.jobId;
    if (!jobId) {
      if (!data.walletBalances) {
        throw new Error('walletBalances or jobId is required to enqueue enrichment job');
      }
      // Generate job ID based on all tokens in the wallet balances
      const allTokens = Object.values(data.walletBalances).flatMap(b => b.tokenBalances.map(t => t.mint));
      const sortedTokens = [...new Set(allTokens)].sort().join('-');
      jobId = generateJobId.enrichMetadata(sortedTokens, data.requestId);
    }
    
    const job = await this.queue.add('enrich-token-balances', data, {
      jobId,
      priority: options?.priority || data.priority || 3,
      delay: options?.delay || 0,
      removeOnComplete: { count: 3, age: 600 },
      removeOnFail: 20,
    });

    if (data.userId) {
      const key = `job:user:${jobId}`;
      // Persist routing metadata for room-based websocket delivery (24h TTL)
      await this.redisClient.set(key, data.userId, 'EX', 24 * 60 * 60);
    }

    return job;
  }

  /**
   * Add a market context processing job for a wallet.
   * Dispatched after sync completes — fills solPriceUsd, tokenPriceUsd, marketCapUsd, mcapBucket
   * on all un-processed SwapAnalysisInput rows for this wallet.
   * Uses deduplication: if the same wallet is already queued, the job is skipped.
   */
  async addProcessMarketContext(data: ProcessMarketContextJobData): Promise<Job> {
    const jobId = generateJobId.processMarketContext(data.walletAddress);

    const job = await this.queue.add('process-market-context', data, {
      jobId,
      priority: 9, // Lower than token balance enrichment — background, non-urgent
      removeOnComplete: { count: 3, age: 600 },
      removeOnFail: 10,
    });

    return job;
  }

  /**
   * Add parallel enrichment job to the queue
   * This is a simplified version for the new parallel architecture
   */
  async addParallelEnrichmentJob(data: ParallelEnrichmentJobData, options?: { priority?: number, delay?: number }): Promise<Job> {
    const jobId = generateJobId.enrichParallel(data.requestId);

    const job = await this.queue.add('parallel-enrichment', data, {
      jobId,
      priority: options?.priority || 7, // Lower priority than core analysis
      delay: options?.delay || 0,
      removeOnComplete: { count: 3, age: 600 },
      removeOnFail: 20,
    });

    const userId = data.userId;
    if (userId) {
      const key = `job:user:${jobId}`;
      // Persist routing metadata for room-based websocket delivery (24h TTL)
      await this.redisClient.set(key, userId, 'EX', 24 * 60 * 60);
    }

    return job;
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string) {
    return this.queue.getJob(jobId);
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    const waiting = await this.queue.getWaiting();
    const active = await this.queue.getActive();
    const completed = await this.queue.getCompleted();
    const failed = await this.queue.getFailed();

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    };
  }

  /**
   * Clean up old jobs
   */
  async clean(grace: number = 24 * 60 * 60 * 1000) { // 24 hours
    await this.queue.clean(grace, 10, 'completed');
    await this.queue.clean(grace, 10, 'failed');
  }

  /**
   * Get the underlying BullMQ queue instance
   */
  getQueue(): Queue {
    return this.queue;
  }
} 
