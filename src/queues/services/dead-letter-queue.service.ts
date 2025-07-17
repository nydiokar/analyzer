import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue, QueueEvents, Job } from 'bullmq';
import { redisConfig } from '../config/redis.config';
import { AlertingService } from './alerting.service';

export interface FailedJobMetrics {
  queueName: string;
  jobId: string;
  jobName: string;
  failedAt: Date;
  attempts: number;
  maxAttempts: number;
  error: string;
  data: any;
  processingTime?: number;
}

@Injectable()
export class DeadLetterQueueService implements OnModuleInit {
  private readonly logger = new Logger(DeadLetterQueueService.name);
  private readonly deadLetterQueue: Queue;
  private readonly queueEvents: Map<string, QueueEvents> = new Map();
  
  // Failure rate tracking (optimized)
  private readonly failureRates = new Map<string, number[]>();
  private readonly FAILURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  private readonly FAILURE_THRESHOLD = 10; // 10 failures in 5 minutes triggers alert
  private readonly MAX_FAILURE_RECORDS = 50; // Limit memory usage per queue
  private cleanupInterval?: NodeJS.Timeout;

  constructor(private readonly alertingService: AlertingService) {
    // Create dedicated dead letter queue
    this.deadLetterQueue = new Queue('failed-jobs', {
      connection: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 100, // Keep many for debugging
        removeOnFail: 500,     // Keep even more failures
        attempts: 1,           // Dead letter jobs don't retry
      },
    });

    this.logger.log('DeadLetterQueueService initialized');
  }

  async onModuleInit() {
    await this.setupQueueEventListeners();
    
    // Start periodic cleanup to prevent memory leaks
    this.cleanupInterval = setInterval(() => {
      this.cleanupFailureRates();
    }, 10 * 60 * 1000); // Cleanup every 10 minutes
    
    this.logger.log('Dead letter queue monitoring started');
  }

  /**
   * Monitor specific queue for failures
   */
  async monitorQueue(queueName: string): Promise<void> {
    if (this.queueEvents.has(queueName)) {
      this.logger.warn(`Already monitoring queue: ${queueName}`);
      return;
    }

    const queueEvents = new QueueEvents(queueName, {
      connection: redisConfig,
    });

    // Listen for failed jobs
    queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
      try {
        await this.handleFailedJob(queueName, jobId, failedReason, prev);
      } catch (error) {
        this.logger.error(`Error handling failed job ${jobId} from ${queueName}:`, error);
      }
    });

    // Listen for completed jobs to track success rates
    queueEvents.on('completed', async ({ jobId, returnvalue, prev }) => {
      try {
        await this.handleCompletedJob(queueName, jobId, returnvalue, prev);
      } catch (error) {
        this.logger.error(`Error tracking completed job ${jobId} from ${queueName}:`, error);
      }
    });

    queueEvents.on('error', (err) => {
      this.logger.error(`Queue events error for ${queueName}:`, err);
    });

    this.queueEvents.set(queueName, queueEvents);
    this.logger.log(`Started monitoring queue: ${queueName}`);
  }

  /**
   * Stop monitoring a queue
   */
  async stopMonitoring(queueName: string): Promise<void> {
    const queueEvents = this.queueEvents.get(queueName);
    if (queueEvents) {
      await queueEvents.close();
      this.queueEvents.delete(queueName);
      this.logger.log(`Stopped monitoring queue: ${queueName}`);
    }
  }

    /**
   * Handle a failed job
   */
  private async handleFailedJob(
    queueName: string,
    jobId: string,
    failedReason: string,
    prev: string
  ): Promise<void> {
    const timestamp = Date.now();

    // Track failure rate
    this.trackFailureRate(queueName, timestamp);

    // Get the failed job details if possible
    let jobDetails: any = {};
    try {
      // Parse the prev parameter which contains job state
      if (prev) {
        try {
          jobDetails = JSON.parse(prev);
        } catch {
          // If prev is not JSON, treat it as raw data
          jobDetails = { rawPrev: prev };
        }
      }

      // Try to get additional details from the queue if we have access to it
      const queueEvents = this.queueEvents.get(queueName);
      if (queueEvents) {
        // QueueEvents doesn't give us direct job access, but we have what we need from prev
        // The prev parameter contains the job's previous state including data, opts, etc.
        this.logger.debug(`Retrieved job details for failed job ${jobId} from previous state`);
      }
    } catch (error) {
      this.logger.warn(`Could not retrieve details for failed job ${jobId}:`, error);
      jobDetails = { error: 'Could not parse job details', rawPrev: prev };
    }

    // Create failed job record in dead letter queue
    const failedJobData: FailedJobMetrics = {
      queueName,
      jobId,
      jobName: jobDetails.name || 'unknown',
      failedAt: new Date(timestamp),
      attempts: 0, // Will be updated if we can get job details
      maxAttempts: 0,
      error: failedReason,
      data: jobDetails.data || {},
      processingTime: timestamp - (jobDetails.processedOn || timestamp),
    };

    // Add to dead letter queue for investigation
    await this.deadLetterQueue.add('failed-job-record', failedJobData, {
      priority: this.getFailurePriority(queueName),
    });

    // Emit metrics
    await this.alertingService.incrementCounter('job_failures_total', {
      queue: queueName,
      job_name: failedJobData.jobName,
    });

    // Check if failure rate exceeds threshold
    const recentFailures = this.getRecentFailureCount(queueName);
    if (recentFailures >= this.FAILURE_THRESHOLD) {
      await this.alertingService.sendAlert({
        severity: 'high',
        title: 'High Failure Rate Detected',
        message: `Queue ${queueName} has ${recentFailures} failures in the last 5 minutes`,
        context: {
          queueName,
          failureCount: recentFailures,
          threshold: this.FAILURE_THRESHOLD,
          recentJobId: jobId,
          error: failedReason,
        },
      });
    }

    this.logger.warn(
      `Job failed in ${queueName}: ${jobId} - ${failedReason} (${recentFailures} recent failures)`
    );
  }

  /**
   * Handle a completed job (for success rate tracking)
   */
  private async handleCompletedJob(
    queueName: string,
    jobId: string,
    returnvalue: any,
    prev: string
  ): Promise<void> {
    // Emit success metrics
    await this.alertingService.incrementCounter('job_completions_total', {
      queue: queueName,
    });

    // Could track processing time here if needed
    this.logger.debug(`Job completed in ${queueName}: ${jobId}`);
  }

  /**
   * Track failure rate for a queue (optimized)
   */
  private trackFailureRate(queueName: string, timestamp: number): void {
    if (!this.failureRates.has(queueName)) {
      this.failureRates.set(queueName, []);
    }

    const failures = this.failureRates.get(queueName)!;
    failures.push(timestamp);

    // Clean old failures outside the window and limit memory usage
    const cutoff = timestamp - this.FAILURE_WINDOW_MS;
    while (failures.length > 0 && failures[0] < cutoff) {
      failures.shift();
    }

    // Prevent memory bloat by limiting max records per queue
    if (failures.length > this.MAX_FAILURE_RECORDS) {
      failures.splice(0, failures.length - this.MAX_FAILURE_RECORDS);
    }
  }

  /**
   * Cleanup old failure rate data to prevent memory leaks
   */
  private cleanupFailureRates(): void {
    const now = Date.now();
    const cutoff = now - this.FAILURE_WINDOW_MS;

    for (const [queueName, failures] of this.failureRates) {
      // Remove old failures
      while (failures.length > 0 && failures[0] < cutoff) {
        failures.shift();
      }

      // If no recent failures, remove the queue entry
      if (failures.length === 0) {
        this.failureRates.delete(queueName);
      }
    }

    this.logger.debug(`Cleaned up failure rate tracking data for ${this.failureRates.size} queues`);
  }

  /**
   * Get recent failure count for a queue
   */
  private getRecentFailureCount(queueName: string): number {
    const failures = this.failureRates.get(queueName) || [];
    return failures.length;
  }

  /**
   * Get failure priority based on queue type
   */
  private getFailurePriority(queueName: string): number {
    switch (queueName) {
      case 'similarity-operations':
        return 8; // High priority - user-facing
      case 'analysis-operations':
        return 7; // High priority - core functionality
      case 'wallet-operations':
        return 6; // Medium-high priority - data sync
      case 'enrichment-operations':
        return 4; // Lower priority - metadata
      default:
        return 5; // Default medium priority
    }
  }

  /**
   * Setup initial queue event listeners for all known queues
   */
  private async setupQueueEventListeners(): Promise<void> {
    const knownQueues = [
      'wallet-operations',
      'analysis-operations', 
      'similarity-operations',
      'enrichment-operations',
    ];

    // Start monitoring all known queues
    for (const queueName of knownQueues) {
      try {
        await this.monitorQueue(queueName);
      } catch (error) {
        this.logger.error(`Failed to setup monitoring for queue ${queueName}:`, error);
      }
    }
  }

  /**
   * Get dead letter queue statistics
   */
  async getDeadLetterStats() {
    // BullMQ Queue doesn't have getStats(), so we need to get individual counts
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.deadLetterQueue.getWaiting(),
      this.deadLetterQueue.getActive(),
      this.deadLetterQueue.getCompleted(),
      this.deadLetterQueue.getFailed(),
      this.deadLetterQueue.getDelayed(),
    ]);

    return {
      queueName: 'failed-jobs',
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      paused: await this.deadLetterQueue.isPaused() ? 1 : 0,
      monitoredQueues: Array.from(this.queueEvents.keys()),
    };
  }

  /**
   * Get recent failed jobs
   */
  async getRecentFailedJobs(limit = 50): Promise<Job[]> {
    return this.deadLetterQueue.getJobs(['completed'], 0, limit);
  }

  /**
   * Clean up old failed job records
   */
  async cleanupOldFailures(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    // Clean jobs older than 7 days by default
    await this.deadLetterQueue.clean(olderThanMs, 100, 'completed');
    this.logger.log(`Cleaned up failed job records older than ${olderThanMs}ms`);
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy() {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all queue event listeners
    for (const [queueName, queueEvents] of this.queueEvents) {
      try {
        await queueEvents.close();
        this.logger.log(`Closed monitoring for queue: ${queueName}`);
      } catch (error) {
        this.logger.error(`Error closing queue events for ${queueName}:`, error);
      }
    }

    // Close dead letter queue
    await this.deadLetterQueue.close();
    this.logger.log('Dead letter queue service shut down');
  }
} 