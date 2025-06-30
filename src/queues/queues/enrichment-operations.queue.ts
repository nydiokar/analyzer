import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { EnrichMetadataJobData, FetchDexScreenerJobData } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';

@Injectable()
export class EnrichmentOperationsQueue {
  private readonly queue: Queue;

  constructor() {
    const config = QueueConfigs[QueueNames.ENRICHMENT_OPERATIONS];
    this.queue = new Queue(QueueNames.ENRICHMENT_OPERATIONS, config.queueOptions);
  }

  /**
   * Add a metadata enrichment job to the queue
   */
  async addEnrichMetadataJob(data: EnrichMetadataJobData, options?: { priority?: number; delay?: number }) {
    const tokenAddress = data.tokenAddresses[0]; // Use first token for job ID
    const jobId = generateJobId.enrichMetadata(tokenAddress, data.requestId);
    
    return this.queue.add('enrich-metadata', data, {
      jobId,
      priority: options?.priority || data.priority || 3,
      delay: options?.delay || 0,
    });
  }

  /**
   * Add a DexScreener data fetch job to the queue
   */
  async addFetchDexScreenerJob(data: FetchDexScreenerJobData, options?: { priority?: number; delay?: number }) {
    const jobId = generateJobId.fetchDexScreener(data.tokenAddress, data.requestId);
    
    return this.queue.add('fetch-dexscreener', data, {
      jobId,
      priority: options?.priority || data.priority || 3,
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