import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { WalletOperationsQueue } from '../../queues/queues/wallet-operations.queue';
import { AnalysisOperationsQueue } from '../../queues/queues/analysis-operations.queue';
import { SimilarityOperationsQueue } from '../../queues/queues/similarity-operations.queue';
import { EnrichmentOperationsQueue } from '../../queues/queues/enrichment-operations.queue';
import { Job, JobState } from 'bullmq';
import { 
  JobStatusResponseDto, 
  QueueStatsResponseDto, 
  AllQueueStatsResponseDto, 
  JobListResponseDto 
} from './dto/job-status.dto';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly walletOperationsQueue: WalletOperationsQueue,
    private readonly analysisOperationsQueue: AnalysisOperationsQueue,
    private readonly similarityOperationsQueue: SimilarityOperationsQueue,
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
  ) {}

  async getJobStatus(jobId: string): Promise<JobStatusResponseDto> {
    this.logger.log(`Fetching status for job: ${jobId}`);

    // Search across all queues for the job
    const queues = [
      { name: 'wallet-operations', queue: this.walletOperationsQueue },
      { name: 'analysis-operations', queue: this.analysisOperationsQueue },
      { name: 'similarity-operations', queue: this.similarityOperationsQueue },
      { name: 'enrichment-operations', queue: this.enrichmentOperationsQueue },
    ];

    for (const { name, queue } of queues) {
      try {
        const job = await queue.getJob(jobId);
        if (job) {
          return this.formatJobResponse(job, name);
        }
      } catch (error) {
        this.logger.warn(`Error checking job ${jobId} in queue ${name}:`, error);
      }
    }

    throw new NotFoundException(`Job with ID ${jobId} not found in any queue`);
  }

  async getQueueStats(queueName: string): Promise<QueueStatsResponseDto> {
    this.logger.log(`Fetching stats for queue: ${queueName}`);

    const queue = this.getQueueByName(queueName);
    if (!queue) {
      throw new BadRequestException(`Invalid queue name: ${queueName}`);
    }

    const stats = await queue.getStats();
    
    return {
      queueName,
      waiting: stats.waiting,
      active: stats.active,
      completed: stats.completed,
      failed: stats.failed,
      delayed: 0, // BullMQ doesn't provide delayed in getStats, would need separate call
      paused: 0,  // BullMQ doesn't provide paused in getStats, would need separate call
    };
  }

  async getQueueJobs(
    queueName: string,
    status?: JobState,
    limit?: number,
    offset?: number,
  ): Promise<JobListResponseDto> {
    this.logger.log(`Fetching jobs for queue: ${queueName}, status: ${status}, limit: ${limit}, offset: ${offset}`);

    const queue = this.getQueueByName(queueName);
    if (!queue) {
      throw new BadRequestException(`Invalid queue name: ${queueName}`);
    }

    const finalLimit = Math.min(limit || 10, 100); // Cap at 100
    const finalOffset = offset || 0;

    let jobs: Job[] = [];
    
    try {
      // Get jobs based on status
      const bullQueue = queue.getQueue();
      
      if (status) {
        // Get jobs by specific status
        switch (status) {
          case 'waiting':
            jobs = await bullQueue.getWaiting(finalOffset, finalOffset + finalLimit - 1);
            break;
          case 'active':
            jobs = await bullQueue.getActive(finalOffset, finalOffset + finalLimit - 1);
            break;
          case 'completed':
            jobs = await bullQueue.getCompleted(finalOffset, finalOffset + finalLimit - 1);
            break;
          case 'failed':
            jobs = await bullQueue.getFailed(finalOffset, finalOffset + finalLimit - 1);
            break;
          case 'delayed':
            jobs = await bullQueue.getDelayed(finalOffset, finalOffset + finalLimit - 1);
            break;
          default:
            throw new BadRequestException(`Invalid status: ${status}`);
        }
      } else {
        // Get all jobs (mixed statuses) - BullMQ doesn't have a direct method, so we'll get waiting + active
        const [waitingJobs, activeJobs] = await Promise.all([
          bullQueue.getWaiting(0, finalLimit / 2),
          bullQueue.getActive(0, finalLimit / 2),
        ]);
        jobs = [...waitingJobs, ...activeJobs].slice(finalOffset, finalOffset + finalLimit);
      }

      const formattedJobs = jobs.map(job => this.formatJobResponse(job, queueName));
      
      return {
        jobs: formattedJobs,
        total: jobs.length, // Note: This is not the total count in queue, just returned count
        limit: finalLimit,
        offset: finalOffset,
      };

    } catch (error) {
      this.logger.error(`Error fetching jobs for queue ${queueName}:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Error fetching jobs: ${errorMessage}`);
    }
  }

  async getAllQueueStats(): Promise<AllQueueStatsResponseDto> {
    this.logger.log('Fetching stats for all queues');

    const queueNames = ['wallet-operations', 'analysis-operations', 'similarity-operations', 'enrichment-operations'];
    const stats = await Promise.all(
      queueNames.map(async (queueName) => {
        try {
          return await this.getQueueStats(queueName);
        } catch (error) {
          this.logger.warn(`Error fetching stats for queue ${queueName}:`, error);
          return null;
        }
      })
    );

    const validStats = stats.filter(stat => stat !== null) as QueueStatsResponseDto[];
    const totalJobs = validStats.reduce((sum, stat) => sum + stat.waiting + stat.active + stat.completed + stat.failed, 0);

    return {
      queues: validStats,
      totalJobs,
      timestamp: new Date().toISOString(),
    };
  }

  private getQueueByName(queueName: string) {
    switch (queueName) {
      case 'wallet-operations':
        return this.walletOperationsQueue;
      case 'analysis-operations':
        return this.analysisOperationsQueue;
      case 'similarity-operations':
        return this.similarityOperationsQueue;
      case 'enrichment-operations':
        return this.enrichmentOperationsQueue;
      default:
        return null;
    }
  }

  private formatJobResponse(job: Job, queueName: string): JobStatusResponseDto {
    const state = job.finishedOn ? (job.failedReason ? 'failed' : 'completed') : 
                  job.processedOn ? 'active' : 'waiting';

    // Handle progress type - BullMQ can return string, number, or object
    let progress: number | object = 0;
    if (typeof job.progress === 'number') {
      progress = job.progress;
    } else if (typeof job.progress === 'object' && job.progress !== null) {
      progress = job.progress;
    } else if (typeof job.progress === 'string') {
      // Try to parse string as number, fallback to object
      const numProgress = parseInt(job.progress, 10);
      progress = isNaN(numProgress) ? { message: job.progress } : numProgress;
    }

    return {
      id: job.id!,
      name: job.name,
      queue: queueName,
      status: state,
      progress,
      data: job.data,
      result: job.returnvalue,
      error: job.failedReason,
      createdAt: new Date(job.timestamp),
      processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts || 1,
      remainingTime: job.delay ? Math.max(0, job.delay - (Date.now() - job.timestamp)) : undefined,
    };
  }
} 