import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { QueueNames } from '../config/queue.config';
import { redisConfig } from '../config/redis.config';
import { JobProgressGateway } from '../../api/shared/job-progress.gateway';
import { RedisLockService } from './redis-lock.service';
import { REDIS_CLIENT } from '../config/redis.provider';
import { Redis } from 'ioredis';
import { sanitizeErrorMessage } from '../utils/error-sanitizer';

@Injectable()
export class JobEventsBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobEventsBridgeService.name);
  private readonly queueEventsMap: Map<string, QueueEvents> = new Map();
  private readonly queueMap: Map<string, Queue<any>> = new Map();

  constructor(
    private readonly jobProgressGateway: JobProgressGateway,
    private readonly redisLockService: RedisLockService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing Job Events Bridge...');
    
    for (const queueName of Object.values(QueueNames)) {
        this.queueMap.set(queueName, new Queue(queueName, { connection: redisConfig }));
        await this.setupQueueEvents(queueName);
    }
    
    this.logger.log(`Job Events Bridge active for ${Object.keys(QueueNames).length} queues`);
    
    // 🧹 TARGETED FIX: Cleanup orphaned locks from previous restart
    // Attempt cleanup after a longer delay to let Redis fully initialize
    setTimeout(async () => {
      try {
        const orphanedLocks = await this.redisLockService.cleanupOrphanedLocksOnStartup();
        if (orphanedLocks > 0) {
          this.logger.log(`🧹 Startup cleanup: Removed ${orphanedLocks} orphaned locks from previous restart`);
        } else {
          this.logger.log('🧹 Startup cleanup: No orphaned locks found');
        }
      } catch (error) {
        const errorMessage = (error as Error).message || 'Unknown error';
        if (errorMessage.includes('Redis not connected') ||
            errorMessage.includes('enableOfflineQueue') ||
            errorMessage.includes('writeable')) {
          this.logger.warn('⚠️  Redis not ready for cleanup - skipping. Make sure Redis is running for lock management.');
        } else {
          this.logger.error('Error during startup lock cleanup:', error);
        }
      }
    }, 10000); // Wait 10 seconds for Redis to be fully ready
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down Job Events Bridge...');
    for (const queueEvents of this.queueEventsMap.values()) {
      await queueEvents.close();
    }
    for (const queue of this.queueMap.values()) {
      try {
        await queue.close();
      } catch (error) {
        this.logger.warn(`Error closing queue ${queue.name} during shutdown`, error as Error);
      }
    }
    this.queueEventsMap.clear();
    this.queueMap.clear();
  }

  private async setupQueueEvents(queueName: string) {
    const queueEvents = new QueueEvents(queueName, { connection: redisConfig });

    queueEvents.on('progress', async ({ jobId, data }) => {
      // Extract userId from job data for room-based broadcasting
      const job = await this.queueMap.get(queueName)?.getJob(jobId);
      const userId = await this.resolveUserId(job, jobId);

      let progressData: number | object;
      if (typeof data === 'string') {
        const num = parseInt(data, 10);
        progressData = isNaN(num) ? { status: data } : num;
      } else if (typeof data === 'boolean') {
        progressData = { status: data ? 'active' : 'inactive' };
      }
      else {
        progressData = data;
      }
      await this.jobProgressGateway.publishProgressEvent(jobId, queueName, progressData, undefined, userId);
    });

    // Track when job starts processing (queue-to-start time)
    queueEvents.on('active', async ({ jobId }) => {
      const job = await this.queueMap.get(queueName)?.getJob(jobId);
      if (job && job.processedOn && job.timestamp) {
        const queueToStartTime = job.processedOn - job.timestamp;
        const userId = await this.resolveUserId(job, jobId);

        this.logger.log(`Job started processing: ${jobId} after ${queueToStartTime}ms in queue`);

        // Publish queue-to-start timing event with userId for room-based broadcasting
        await this.jobProgressGateway.publishQueueToStartEvent(jobId, queueName, queueToStartTime, userId);
      }
    });

    queueEvents.on('completed', async ({ jobId, returnvalue }) => {
      const job = await this.queueMap.get(queueName)?.getJob(jobId);
      const userId = await this.resolveUserId(job, jobId);

      // Use manual processing time from job result if available, otherwise fallback to BullMQ timing
      let processingTime = 0;
      const result = returnvalue as any;
      if (result && typeof result === 'object' && 'processingTimeMs' in result) {
        processingTime = result.processingTimeMs;
      } else if (job && job.finishedOn && job.processedOn) {
        // Fallback: use actual finish time - start time (not queue time)
        processingTime = job.finishedOn - job.processedOn;
      }

      // Calculate total time (queue to completion)
      let totalTime = 0;
      if (job && job.finishedOn && job.timestamp) {
        totalTime = job.finishedOn - job.timestamp;
      }

      this.logger.log(`Job completed: ${jobId} - Processing: ${processingTime}ms, Total: ${totalTime}ms`);
      await this.jobProgressGateway.publishCompletedEvent(jobId, queueName, result || {}, processingTime, totalTime, userId);
      await this.cleanupUserMapping(jobId);
    });

    queueEvents.on('failed', async ({ jobId, failedReason }) => {
      const job = await this.queueMap.get(queueName)?.getJob(jobId);
      const userId = await this.resolveUserId(job, jobId);

      // Log the full error for debugging
      this.logger.warn(`Job failed: ${jobId} - ${failedReason}`);

      // Sanitize error message for user-friendly display
      const sanitizedError = sanitizeErrorMessage(failedReason);

      await this.jobProgressGateway.publishFailedEvent(jobId, queueName, sanitizedError, job?.attemptsMade ?? 0, job?.opts.attempts ?? 0, userId);
      await this.cleanupUserMapping(jobId);
    });

    queueEvents.on('error', (err) => {
      this.logger.error(`Queue events error for ${queueName}:`, err);
    });

    this.queueEventsMap.set(queueName, queueEvents);
    this.logger.log(`Set up queue events for: ${queueName}`);
  }

  private async resolveUserId(job: any, jobId: string): Promise<string | undefined> {
    const fromData = (job?.data as any)?.userId;
    if (fromData) {
      return fromData;
    }
    try {
      const cached = await this.redisClient.get(`job:user:${jobId}`);
      return cached || undefined;
    } catch (error) {
      this.logger.warn(`Failed to resolve userId for job ${jobId}:`, error as Error);
      return undefined;
    }
  }

  private async cleanupUserMapping(jobId: string) {
    try {
      await this.redisClient.del(`job:user:${jobId}`);
    } catch (error) {
      this.logger.warn(`Failed to clean user mapping for job ${jobId}:`, error as Error);
    }
  }
}
