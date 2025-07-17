import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { QueueNames } from '../config/queue.config';
import { redisConfig } from '../config/redis.config';
import { JobProgressGateway } from '../../api/websocket/job-progress.gateway';

@Injectable()
export class JobEventsBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobEventsBridgeService.name);
  private readonly queueEventsMap: Map<string, QueueEvents> = new Map();
  private readonly queueMap: Map<string, Queue<any>> = new Map();

  constructor(private readonly jobProgressGateway: JobProgressGateway) {}

  async onModuleInit() {
    this.logger.log('Initializing Job Events Bridge...');
    
    for (const queueName of Object.values(QueueNames)) {
        this.queueMap.set(queueName, new Queue(queueName, { connection: redisConfig }));
        await this.setupQueueEvents(queueName);
    }
    
    this.logger.log(`Job Events Bridge active for ${Object.keys(QueueNames).length} queues`);
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down Job Events Bridge...');
    for (const queueEvents of this.queueEventsMap.values()) {
      await queueEvents.close();
    }
    this.queueEventsMap.clear();
  }

  private async setupQueueEvents(queueName: string) {
    const queueEvents = new QueueEvents(queueName, { connection: redisConfig });

    queueEvents.on('progress', async ({ jobId, data }) => {
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
      await this.jobProgressGateway.publishProgressEvent(jobId, queueName, progressData);
    });

    queueEvents.on('completed', async ({ jobId, returnvalue }) => {
      const job = await this.queueMap.get(queueName)?.getJob(jobId);
      const processingTime = job ? job.processedOn - job.timestamp : 0;
      this.logger.log(`Job completed: ${jobId} in ${processingTime}ms`);
      await this.jobProgressGateway.publishCompletedEvent(jobId, queueName, returnvalue, processingTime);
    });

    queueEvents.on('failed', async ({ jobId, failedReason }) => {
      const job = await this.queueMap.get(queueName)?.getJob(jobId);
      this.logger.warn(`Job failed: ${jobId} - ${failedReason}`);
      await this.jobProgressGateway.publishFailedEvent(jobId, queueName, failedReason, job?.attemptsMade ?? 0, job?.opts.attempts ?? 0);
    });

    queueEvents.on('error', (err) => {
      this.logger.error(`Queue events error for ${queueName}:`, err);
    });

    this.queueEventsMap.set(queueName, queueEvents);
    this.logger.log(`Set up queue events for: ${queueName}`);
  }
}