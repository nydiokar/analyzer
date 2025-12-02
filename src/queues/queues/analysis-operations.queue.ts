import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { AnalyzePnlJobData, AnalyzeBehaviorJobData, DashboardWalletAnalysisJobData, AnalyzeHolderProfilesJobData } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
import { buildHolderProfilesJobId } from '../utils/holder-profiles-job-id';

@Injectable()
export class AnalysisOperationsQueue {
  private readonly queue: Queue;

  constructor() {
    const config = QueueConfigs[QueueNames.ANALYSIS_OPERATIONS];
    this.queue = new Queue(QueueNames.ANALYSIS_OPERATIONS, config.queueOptions);
  }

  /**
   * Add a PNL analysis job to the queue
   */
  async addPnlAnalysisJob(data: AnalyzePnlJobData, options?: { priority?: number; delay?: number }) {
    const jobId = generateJobId.analyzePnl(data.walletAddress, data.requestId);
    
    return this.queue.add('analyze-pnl', data, {
      jobId,
      priority: options?.priority || 5,
      delay: options?.delay || 0,
    });
  }

  /**
   * Add a behavior analysis job to the queue
   */
  async addBehaviorAnalysisJob(data: AnalyzeBehaviorJobData, options?: { priority?: number; delay?: number }) {
    const jobId = generateJobId.analyzeBehavior(data.walletAddress, data.requestId);
    
    return this.queue.add('analyze-behavior', data, {
      jobId,
      priority: options?.priority || 5,
      delay: options?.delay || 0,
    });
  }

  /**
   * Add a dashboard wallet analysis job to the queue
   */
  async addDashboardWalletAnalysisJob(data: DashboardWalletAnalysisJobData, options?: { priority?: number; delay?: number }) {
    const jobId = generateJobId.dashboardWalletAnalysis(data.walletAddress, data.requestId);

    return this.queue.add('dashboard-wallet-analysis', data, {
      jobId,
      priority: options?.priority || 10, // High priority for user-initiated requests
      delay: options?.delay || 0,
    });
  }

  /**
   * Add a holder profiles analysis job to the queue
   */
  async addHolderProfilesJob(data: AnalyzeHolderProfilesJobData, options?: { priority?: number; delay?: number }) {
    const jobId = buildHolderProfilesJobId(data);

    return this.queue.add('analyze-holder-profiles', data, {
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
