import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { ComprehensiveSimilarityFlowData } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';

@Injectable()
export class SimilarityOperationsQueue {
  private readonly queue: Queue;
  private readonly logger = new Logger(SimilarityOperationsQueue.name);
  private readonly PAYLOAD_WARN_BYTES = 5 * 1024 * 1024; // 5MB

  constructor() {
    const config = QueueConfigs[QueueNames.SIMILARITY_OPERATIONS];
    this.queue = new Queue(QueueNames.SIMILARITY_OPERATIONS, config.queueOptions);
  }

  /**
   * Add a similarity analysis flow job to the queue
   */
  async addSimilarityAnalysisFlow(data: ComprehensiveSimilarityFlowData, options?: { priority?: number; delay?: number }) {
    const jobId = generateJobId.calculateSimilarity(data.walletAddresses, data.requestId);
    const payloadSize = Buffer.byteLength(JSON.stringify(data), 'utf8');
    if (payloadSize > this.PAYLOAD_WARN_BYTES) {
      this.logger.warn(`Similarity job payload is large (${(payloadSize / 1024 / 1024).toFixed(2)} MB) for request ${data.requestId}`);
    }
    
    return this.queue.add('similarity-analysis-flow', data, {
      jobId,
      priority: options?.priority || 5,
      delay: options?.delay || 0,
      removeOnComplete: { count: 3, age: 600 }, // keep a tiny window to avoid Redis bloat from large payloads
      removeOnFail: 20,
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
