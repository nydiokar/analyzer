import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { QueueEvents } from 'bullmq';
import { QueueNames } from '../config/queue.config';
import { redisConfig } from '../config/redis.config';
import { JobProgressGateway } from '../../api/websocket/job-progress.gateway';

@Injectable()
export class JobEventsBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobEventsBridgeService.name);
  private readonly queueEvents: Map<string, QueueEvents> = new Map();

  constructor(private readonly jobProgressGateway: JobProgressGateway) {}

  async onModuleInit() {
    this.logger.log('Initializing Job Events Bridge...');
    
    // Set up event listeners for all queues
    const queues = Object.values(QueueNames);
    
    for (const queueName of queues) {
      await this.setupQueueEvents(queueName);
    }
    
    this.logger.log(`Job Events Bridge active for ${queues.length} queues`);
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down Job Events Bridge...');
    
    for (const [queueName, queueEvents] of this.queueEvents) {
      try {
        await queueEvents.close();
        this.logger.log(`Closed queue events for: ${queueName}`);
      } catch (error) {
        this.logger.error(`Error closing queue events for ${queueName}:`, error);
      }
    }
    
    this.queueEvents.clear();
  }

  private async setupQueueEvents(queueName: string) {
    if (this.queueEvents.has(queueName)) {
      this.logger.warn(`Queue events already set up for: ${queueName}`);
      return;
    }

    const queueEvents = new QueueEvents(queueName, {
      connection: redisConfig,
    });

    // Bridge progress events
    queueEvents.on('progress', async ({ jobId, data }) => {
      try {
        // Only log significant progress milestones to reduce log spam
        if (typeof data === 'number' && (data === 100 || data % 25 === 0)) {
          this.logger.log(`Job ${jobId} progress: ${data}% (${queueName})`);
        }
        
        // Handle different data types that BullMQ can provide
        let progressData: number | object;
        if (typeof data === 'number') {
          progressData = data;
        } else if (typeof data === 'object' && data !== null) {
          progressData = data;
        } else if (typeof data === 'string') {
          // Try to parse as number, fallback to object
          const numProgress = parseInt(data, 10);
          progressData = isNaN(numProgress) ? { message: data } : numProgress;
        } else {
          progressData = { message: String(data) };
        }
        
        await this.jobProgressGateway.publishProgressEvent(jobId, queueName, progressData);
      } catch (error) {
        this.logger.error(`Error publishing progress event for job ${jobId}:`, error);
      }
    });

    // Bridge completion events
    queueEvents.on('completed', async ({ jobId, returnvalue, prev }) => {
      try {
        // prev is typically a timestamp string or state info, not an object
        let processingTime = 0;
        if (prev && typeof prev === 'string') {
          const prevTime = parseInt(prev, 10);
          if (!isNaN(prevTime)) {
            processingTime = Date.now() - prevTime;
          }
        }
        
        this.logger.log(`Job completed: ${jobId}`);
        await this.jobProgressGateway.publishCompletedEvent(jobId, queueName, returnvalue, processingTime);
      } catch (error) {
        this.logger.error(`Error publishing completed event for job ${jobId}:`, error);
      }
    });

    // Bridge failure events
    queueEvents.on('failed', async ({ jobId, failedReason, prev }) => {
      try {
        this.logger.warn(`Job failed: ${jobId} - ${failedReason}`);
        
        // QueueEvents doesn't provide detailed job info, use defaults
        // In a production system, you might fetch the job to get actual attempt counts
        const attempts = 1; // Default attempt count
        const maxAttempts = 3; // Default max attempts from queue config
        
        await this.jobProgressGateway.publishFailedEvent(
          jobId, 
          queueName, 
          failedReason || 'Unknown error', 
          attempts, 
          maxAttempts
        );
      } catch (error) {
        this.logger.error(`Error publishing failed event for job ${jobId}:`, error);
      }
    });

    // Error handling
    queueEvents.on('error', (err) => {
      this.logger.error(`Queue events error for ${queueName}:`, err);
    });

    this.queueEvents.set(queueName, queueEvents);
    this.logger.log(`Set up queue events for: ${queueName}`);
  }

  /**
   * Get status of all monitored queues
   */
  getMonitoredQueues(): string[] {
    return Array.from(this.queueEvents.keys());
  }

  /**
   * Check if bridge is monitoring a specific queue
   */
  isMonitoring(queueName: string): boolean {
    return this.queueEvents.has(queueName);
  }
} 