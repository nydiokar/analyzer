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
  JobListResponseDto,
  SyncWalletJobRequestDto,
  AnalyzeWalletJobRequestDto,
  SimilarityAnalysisJobRequestDto,
  JobSubmissionResponseDto
} from './dto/job-status.dto';
import { generateJobId } from '../../queues/utils/job-id-generator';
import { isValidSolanaAddress } from '../pipes/solana-address.pipe';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly walletOperationsQueue: WalletOperationsQueue,
    private readonly analysisOperationsQueue: AnalysisOperationsQueue,
    private readonly similarityOperationsQueue: SimilarityOperationsQueue,
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
  ) {}

  // === C2 Task: Job Submission Methods ===

  async submitSyncWalletJob(dto: SyncWalletJobRequestDto): Promise<JobSubmissionResponseDto> {
    this.logger.log(`Submitting sync job for wallet: ${dto.walletAddress}`);

    // Validate wallet address
    if (!isValidSolanaAddress(dto.walletAddress)) {
      throw new BadRequestException(`Invalid Solana address: ${dto.walletAddress}`);
    }

    // Generate request ID
    const requestId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    // Prepare job data
    const jobData = {
      walletAddress: dto.walletAddress,
      requestId,
      syncOptions: {
        limit: 100,
        fetchAll: dto.fetchAll ?? true,
        skipApi: false,
        fetchOlder: dto.fetchOlder ?? false,
        maxSignatures: 200,
        smartFetch: true,
        forceRefresh: dto.forceRefresh ?? false,
      }
    };

    // Add job to queue
    const job = await this.walletOperationsQueue.addSyncWalletJob(jobData);

    return {
      jobId: job.id!,
      requestId,
      status: 'queued',
      queueName: 'wallet-operations',
      estimatedProcessingTime: '5-10 minutes',
      monitoringUrl: `/jobs/${job.id}`,
    };
  }

  async submitAnalyzeWalletJob(dto: AnalyzeWalletJobRequestDto): Promise<JobSubmissionResponseDto> {
    this.logger.log(`Submitting analysis job for wallet: ${dto.walletAddress}, types: ${dto.analysisTypes.join(', ')}`);

    // Validate wallet address
    if (!isValidSolanaAddress(dto.walletAddress)) {
      throw new BadRequestException(`Invalid Solana address: ${dto.walletAddress}`);
    }

    // Validate analysis types
    if (!dto.analysisTypes || dto.analysisTypes.length === 0) {
      throw new BadRequestException('At least one analysis type must be specified');
    }

    // Generate request ID  
    const requestId = `analyze-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    // Submit jobs for each analysis type
    const jobs = [];
    for (const analysisType of dto.analysisTypes) {
      if (analysisType === 'pnl') {
        const jobData = {
          walletAddress: dto.walletAddress,
          requestId,
          forceRefresh: dto.forceRefresh ?? false,
        };
        const job = await this.analysisOperationsQueue.addPnlAnalysisJob(jobData);
        jobs.push(job);
      } else if (analysisType === 'behavior') {
        const jobData = {
          walletAddress: dto.walletAddress,
          requestId,
          config: undefined, // Use default behavior config
        };
        const job = await this.analysisOperationsQueue.addBehaviorAnalysisJob(jobData);
        jobs.push(job);
      }
    }

    // Return info for the first job (they share the same requestId for tracking)
    const firstJob = jobs[0];
    const estimatedMinutes = dto.analysisTypes.length * 3; // 3 minutes per analysis type
    const estimatedTime = estimatedMinutes > 60 
      ? `${Math.round(estimatedMinutes / 60)} hour(s)`
      : `${estimatedMinutes} minute(s)`;

    return {
      jobId: firstJob.id!,
      requestId,
      status: 'queued',
      queueName: 'analysis-operations',
      estimatedProcessingTime: estimatedTime,
      monitoringUrl: `/jobs/${firstJob.id}`,
    };
  }

  async submitSimilarityAnalysisJob(dto: SimilarityAnalysisJobRequestDto): Promise<JobSubmissionResponseDto> {
    this.logger.log(`Submitting similarity analysis job for ${dto.walletAddresses.length} wallets`);

    // Validate input
    if (!dto.walletAddresses || dto.walletAddresses.length < 2) {
      throw new BadRequestException('At least two wallet addresses are required for similarity analysis');
    }

    // Validate wallet addresses
    const invalidWallets = dto.walletAddresses.filter(w => !isValidSolanaAddress(w));
    if (invalidWallets.length > 0) {
      throw new BadRequestException(`Invalid Solana address(es): ${invalidWallets.join(', ')}`);
    }

    // Generate request ID  
    const requestId = `similarity-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    // Prepare job data
    const jobData = {
      walletAddresses: dto.walletAddresses,
      requestId,
      failureThreshold: dto.failureThreshold ?? 0.8,
      timeoutMinutes: dto.timeoutMinutes ?? 30,
      similarityConfig: {
        vectorType: dto.vectorType || 'capital',
        excludeMints: [],
        timeRange: {
          from: undefined,
          to: undefined
        }
      }
    };

    // Add job to similarity operations queue
    const job = await this.similarityOperationsQueue.addSimilarityAnalysisFlow(jobData);

    // Calculate estimated processing time
    const baseTimeMinutes = 5;
    const timePerWallet = 2;
    const estimatedMinutes = baseTimeMinutes + (dto.walletAddresses.length * timePerWallet);
    const estimatedTime = estimatedMinutes > 60 
      ? `${Math.round(estimatedMinutes / 60)} hour(s)`
      : `${estimatedMinutes} minute(s)`;

    return {
      jobId: job.id!,
      requestId,
      status: 'queued',
      queueName: 'similarity-operations',
      estimatedProcessingTime: estimatedTime,
      monitoringUrl: `/jobs/${job.id}`,
    };
  }

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

  async cancelJob(jobId: string): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Received request to cancel job: ${jobId}`);

    const queues = [
      { name: 'wallet-operations', queue: this.walletOperationsQueue },
      { name: 'analysis-operations', queue: this.analysisOperationsQueue },
      { name: 'similarity-operations', queue: this.similarityOperationsQueue },
      { name: 'enrichment-operations', queue: this.enrichmentOperationsQueue },
    ];

    for (const { name, queue } of queues) {
      const job = await queue.getJob(jobId);
      if (job) {
        if (await job.isWaiting() || await job.isActive()) {
          try {
            await job.remove();
            this.logger.log(`Successfully removed job ${jobId} from queue ${name}.`);
            return { success: true, message: `Job ${jobId} was successfully cancelled.` };
          } catch (error) {
            this.logger.error(`Error removing job ${jobId} from queue ${name}:`, error);
            throw new Error(`Failed to cancel job ${jobId}.`);
          }
        } else {
          const state = await job.getState();
          this.logger.warn(`Job ${jobId} could not be cancelled because it is already in state: ${state}.`);
          return { success: false, message: `Job ${jobId} could not be cancelled. Status: ${state}.` };
        }
      }
    }

    throw new NotFoundException(`Job with ID ${jobId} not found for cancellation.`);
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

  /**
   * Get job progress by ID (C1 task requirement)
   */
  async getJobProgress(jobId: string): Promise<{ jobId: string; status: string; progress: number | object }> {
    this.logger.log(`Fetching progress for job: ${jobId}`);

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
          const state = job.finishedOn ? (job.failedReason ? 'failed' : 'completed') : 
                        job.processedOn ? 'active' : 'waiting';

          // Handle progress type - BullMQ can return string, number, or object
          let progress: number | object = 0;
          if (typeof job.progress === 'number') {
            progress = job.progress;
          } else if (typeof job.progress === 'object' && job.progress !== null) {
            progress = job.progress;
          } else if (typeof job.progress === 'string') {
            const numProgress = parseInt(job.progress, 10);
            progress = isNaN(numProgress) ? { message: job.progress } : numProgress;
          }

          return {
            jobId: job.id!,
            status: state,
            progress,
          };
        }
      } catch (error) {
        this.logger.warn(`Error checking job ${jobId} in queue ${name}:`, error);
      }
    }

    throw new NotFoundException(`Job with ID ${jobId} not found in any queue`);
  }

  /**
   * Get job result by ID (C1 task requirement)
   */
  async getJobResult(jobId: string): Promise<{ jobId: string; status: string; result?: any; error?: string }> {
    this.logger.log(`Fetching result for job: ${jobId}`);

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
          const state = job.finishedOn ? (job.failedReason ? 'failed' : 'completed') : 
                        job.processedOn ? 'active' : 'waiting';

          return {
            jobId: job.id!,
            status: state,
            result: job.returnvalue,
            error: job.failedReason,
          };
        }
      } catch (error) {
        this.logger.warn(`Error checking job ${jobId} in queue ${name}:`, error);
      }
    }

    throw new NotFoundException(`Job with ID ${jobId} not found in any queue`);
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