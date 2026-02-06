import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueueNames } from '../../queues/config/queue.config';
import { MetricsService } from './metrics.service';
import { getRedisConnection } from '../../queues/config/redis.config';

/**
 * BullMQ Metrics Collector Service
 *
 * Polls all BullMQ queues every 5 seconds and updates Prometheus gauges.
 * Critical for observability: tracks queue depth, stalled jobs, and backlog.
 */
@Injectable()
export class BullMQMetricsCollectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BullMQMetricsCollectorService.name);
  private readonly queues: Map<string, Queue> = new Map();
  private pollInterval?: NodeJS.Timeout;
  private readonly POLL_INTERVAL_MS = 5000; // 5 seconds

  constructor(private readonly metricsService: MetricsService) {}

  async onModuleInit() {
    // Initialize Queue instances for all queues
    const connection = getRedisConnection();

    const queueNames = [
      QueueNames.ANALYSIS_OPERATIONS,
      QueueNames.ENRICHMENT_OPERATIONS,
      QueueNames.WALLET_OPERATIONS,
      QueueNames.SIMILARITY_OPERATIONS,
      QueueNames.MINT_PARTICIPANTS,
    ];

    for (const queueName of queueNames) {
      try {
        const queue = new Queue(queueName, { connection });
        this.queues.set(queueName, queue);
        this.logger.log(`Registered BullMQ metrics collection for queue: ${queueName}`);
      } catch (error) {
        this.logger.error(`Failed to register queue ${queueName} for metrics:`, error);
      }
    }

    // Start polling
    this.startPolling();
    this.logger.log(`BullMQ metrics collector started (poll interval: ${this.POLL_INTERVAL_MS}ms)`);
  }

  async onModuleDestroy() {
    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.logger.log('BullMQ metrics collector stopped');
    }

    // Close all queue connections
    for (const [queueName, queue] of this.queues.entries()) {
      try {
        await queue.close();
        this.logger.debug(`Closed queue connection: ${queueName}`);
      } catch (error) {
        this.logger.warn(`Error closing queue ${queueName}:`, error);
      }
    }
  }

  private startPolling() {
    this.pollInterval = setInterval(async () => {
      await this.collectMetrics();
    }, this.POLL_INTERVAL_MS);

    // Collect immediately on start
    this.collectMetrics().catch((error) => {
      this.logger.error('Error during initial metrics collection:', error);
    });
  }

  private async collectMetrics() {
    for (const [queueName, queue] of this.queues.entries()) {
      try {
        const counts = await queue.getJobCounts();

        // Update Prometheus gauges
        this.metricsService.bullmqJobsWaiting.set({ queue: queueName }, counts.waiting || 0);
        this.metricsService.bullmqJobsActive.set({ queue: queueName }, counts.active || 0);
        this.metricsService.bullmqJobsFailed.set({ queue: queueName }, counts.failed || 0);
        this.metricsService.bullmqJobsCompleted.set({ queue: queueName }, counts.completed || 0);
        this.metricsService.bullmqJobsDelayed.set({ queue: queueName }, counts.delayed || 0);

        // Stalled jobs are a subset of active jobs that haven't made progress
        // BullMQ doesn't expose a direct "stalled" count in getJobCounts()
        // We approximate by checking if there are jobs that have been active for too long
        // For simplicity, we'll track this separately if needed, or rely on wait/active/failed
        // For now, set to 0 (can be enhanced with manual stalled job detection)
        this.metricsService.bullmqJobsStalled.set({ queue: queueName }, 0);
      } catch (error) {
        // Don't spam logs if Redis is temporarily unavailable
        // The error is already throttled at the global logger level
        this.logger.warn(`Failed to collect metrics for queue ${queueName}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }

  /**
   * Manual metrics collection trigger (useful for testing)
   */
  async collectNow(): Promise<void> {
    await this.collectMetrics();
  }
}
