import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { SimilarityAnalysisFlowData } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';

@Injectable()
export class SimilarityOperationsQueue {
  private readonly queue: Queue;

  constructor() {
    const config = QueueConfigs[QueueNames.SIMILARITY_OPERATIONS];
    this.queue = new Queue(QueueNames.SIMILARITY_OPERATIONS, config.queueOptions);
  }

  /**
   * Add a similarity analysis flow job to the queue
   */
  async addSimilarityAnalysisFlow(data: SimilarityAnalysisFlowData, options?: { priority?: number; delay?: number }) {
    const jobId = generateJobId.calculateSimilarity(data.walletAddresses, data.requestId);
    
    return this.queue.add('similarity-analysis-flow', data, {
      jobId,
      priority: options?.priority || 5,
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