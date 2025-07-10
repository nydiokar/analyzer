import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { EnrichTokenBalancesJobData } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';

@Injectable()
export class EnrichmentOperationsQueue {
  private readonly queue: Queue;

  constructor() {
    const config = QueueConfigs[QueueNames.ENRICHMENT_OPERATIONS];
    this.queue = new Queue(QueueNames.ENRICHMENT_OPERATIONS, config.queueOptions);
  }

  /**
   * Add a token balance enrichment job to the queue (new sophisticated enrichment)
   */
  async addEnrichTokenBalances(data: EnrichTokenBalancesJobData, options?: { priority?: number; delay?: number }) {
    // Generate job ID based on all tokens in the wallet balances
    const allTokens = Object.values(data.walletBalances).flatMap(b => b.tokenBalances.map(t => t.mint));
    const sortedTokens = [...new Set(allTokens)].sort().join('-');
    const jobId = generateJobId.enrichMetadata(sortedTokens, data.requestId);
    
    return this.queue.add('enrich-token-balances', data, {
      jobId,
      priority: options?.priority || data.priority || 3,
      delay: options?.delay || 0,
    });
  }

  /**
   * Add a parallel enrichment job to the queue, triggered by the main similarity flow
   */
  async addParallelEnrichmentJob(data: { walletAddresses: string[], requestId: string }, options?: { priority?: number; delay?: number }) {
    const jobId = generateJobId.enrichParallel(data.requestId);
    
    return this.queue.add('parallel-enrichment', data, {
      jobId,
      priority: options?.priority || 7, // Lower priority than core analysis
      delay: options?.delay || 0,
    });
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