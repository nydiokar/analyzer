import { Inject, Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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
  DashboardAnalysisJobRequestDto,
  JobSubmissionResponseDto
} from '../shared/dto/job-status.dto';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';
import { RedisLockService } from '../../queues/services/redis-lock.service';
import { DatabaseService } from './database.service';
import { DashboardAnalysisScope } from '../../shared/dashboard-analysis.types';
import { DASHBOARD_ANALYSIS_SCOPE_DEFAULTS, DASHBOARD_JOB_CONFIG } from '../../config/constants';
import { JobPriority, JobTimeouts } from '../../queues/config/queue.config';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import Redis from 'ioredis';
import { getErrorMessage, getErrorDetails } from '../../core/utils/error-utils';
import {
  buildAgentHolderProfilesResult,
  buildAgentSimilarityResult,
} from '../shared/intel-agent-transforms';
import type { HolderProfilesResult } from '../../queues/jobs/types';
import type { CombinedSimilarityResult } from '../../types/similarity';


@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly walletOperationsQueue: WalletOperationsQueue,
    private readonly analysisOperationsQueue: AnalysisOperationsQueue,
    private readonly similarityOperationsQueue: SimilarityOperationsQueue,
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
    private readonly redisLockService: RedisLockService,
    private readonly databaseService: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
  ) {}

  // === DIRECT JOB SUBMISSION METHODS ===
  // 
  // ⚠️  NOTE: These methods are NOT currently used by the frontend!
  // 
  // These provide direct access to BullMQ queues for external integrations
  // and future scaling scenarios. The frontend uses business logic endpoints
  // in the /analyses module instead.

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
      includeBalances: dto.includeBalances ?? false,
      includeVectors: dto.includeVectors ?? false,
      enrichMetadata: dto.enrichMetadata ?? false,
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

  async submitDashboardAnalysisJob(dto: DashboardAnalysisJobRequestDto): Promise<JobSubmissionResponseDto> {
    this.logger.log(`Submitting dashboard analysis job for wallet: ${dto.walletAddress}`);

    // Validate wallet address
    if (!isValidSolanaAddress(dto.walletAddress)) {
      throw new BadRequestException(`Invalid Solana address: ${dto.walletAddress}`);
    }

    const requestId = `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    const scope: DashboardAnalysisScope = dto.analysisScope ?? 'deep';
    const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS[scope];
    if (!scopeDefaults) {
      throw new BadRequestException(`Unsupported analysis scope: ${scope}`);
    }

    const historyWindowDays =
      scope === 'deep' ? undefined : dto.historyWindowDays ?? scopeDefaults.historyWindowDays ?? 7;
    const targetSignatureCount =
      scope === 'deep'
        ? dto.targetSignatureCount ?? undefined
        : dto.targetSignatureCount ?? scopeDefaults.targetSignatureCount ?? undefined;

    const queueWorkingAfter = false;
    const queueDeepAfter = false;

    const timeoutMinutes =
      dto.timeoutMinutes ?? scopeDefaults.timeoutMinutes ?? DASHBOARD_JOB_CONFIG.DEFAULT_TIMEOUT_MINUTES;

    const jobData = {
      walletAddress: dto.walletAddress,
      requestId,
      analysisScope: scope,
      triggerSource: dto.triggerSource ?? 'manual',
      historyWindowDays,
      targetSignatureCount,
      forceRefresh: dto.forceRefresh ?? false,
      enrichMetadata: scope === 'deep' ? dto.enrichMetadata !== false : false,
      queueWorkingAfter,
      queueDeepAfter,
      failureThreshold: 0.8,
      timeoutMinutes,
    };

    const priority =
      scope === 'flash'
        ? JobPriority.CRITICAL
        : scope === 'working'
          ? JobPriority.HIGH
          : JobPriority.NORMAL;

    const job = await this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
      priority,
      delay: 0,
    });

    const baseTimeMinutes = scope === 'flash' ? 2 : scope === 'working' ? 5 : 8;
    const estimatedMinutes = baseTimeMinutes + (dto.forceRefresh ? 10 : 0);
    const estimatedTime = estimatedMinutes > 60 
      ? `${Math.round(estimatedMinutes / 60)} hour(s)`
      : `${estimatedMinutes} minute(s)`;

    return {
      jobId: job.id!,
      requestId,
      status: 'queued',
      queueName: 'analysis-operations',
      analysisScope: scope,
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
          const timeout = await this.getTimedOutJobOverride(job, name);
          return this.formatJobResponse(job, name, timeout);
        }
      } catch (error) {
        this.logger.warn(`Error checking job ${jobId} in queue ${name}:`, getErrorMessage(error));
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
            // Clean up Redis locks before removing job (especially for similarity jobs)
            if (name === 'similarity-operations' && job.data?.requestId) {
              const lockKey = RedisLockService.createSimilarityLockKey(job.data.requestId);
              await this.redisLockService.releaseLock(lockKey, jobId);
              this.logger.log(`Released similarity lock for job ${jobId}, requestId: ${job.data.requestId}`);
            }

            await job.remove();
            this.logger.log(`Successfully cancelled and removed job ${jobId} from queue ${name}.`);
            return { success: true, message: `Job ${jobId} was successfully cancelled.` };
          } catch (error) {
            this.logger.error(`Error cancelling job ${jobId} from queue ${name}:`, getErrorMessage(error));
            throw new Error(`Failed to cancel job ${jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        } else {
          const state = await job.getState();
          this.logger.warn(`Job ${jobId} could not be cancelled because it is already in state: ${state}.`);
          return { success: false, message: `Job ${jobId} could not be cancelled. Current status: ${state}.` };
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
      this.logger.error(`Error fetching jobs for queue ${queueName}:`, getErrorMessage(error));
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
          this.logger.warn(`Error fetching stats for queue ${queueName}:`, getErrorMessage(error));
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
          const timeout = await this.getTimedOutJobOverride(job, name);

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
            status: timeout?.status ?? state,
            progress,
          };
        }
      } catch (error) {
        this.logger.warn(`Error checking job ${jobId} in queue ${name}:`, getErrorMessage(error));
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
          const timeout = await this.getTimedOutJobOverride(job, name);

          let result = job.returnvalue;
          // Resolve Redis pointer for any job type that uses the pointer pattern
          // (similarity-operations and analysis-operations/holder-profiles).
          const pointerData = result && typeof result === 'object' && 'data' in result
            ? (result as any).data
            : null;
          const resultKey: string | undefined = pointerData?.resultKey;
          if (resultKey) {
            try {
              const cached = await this.redisClient.get(resultKey);
              if (cached) {
                result = JSON.parse(cached);
              } else {
                this.logger.warn(`Result key ${resultKey} not found in Redis for job ${jobId}`);
              }
            } catch (error) {
              this.logger.warn(`Failed to read result from Redis (${resultKey}) for job ${jobId}`, error as Error);
            }
          }

          return {
            jobId: job.id!,
            status: timeout?.status ?? state,
            result,
            error: timeout?.error ?? job.failedReason,
          };
        }
      } catch (error) {
        this.logger.warn(`Error checking job ${jobId} in queue ${name}:`, getErrorMessage(error));
      }
    }

    throw new NotFoundException(`Job with ID ${jobId} not found in any queue`);
  }

  /**
   * Fetch a job result directly from Redis by its result key.
   * Skips the BullMQ job lookup entirely — for use when the caller already has
   * the resultKey (e.g. received via WebSocket job-completed event).
   *
   * Allowed key prefixes (validated server-side to prevent arbitrary Redis reads):
   *   - similarity:result:{requestId}
   *   - similarity:agent:result:{requestId}
   *   - holder-profiles:result:{jobId}
   *   - holder-profiles:agent:result:{jobId}
   */
  async getResultByKey(key: string): Promise<unknown> {
    const allowedPrefixes = [
      'similarity:result:',
      'similarity:agent:result:',
      'holder-profiles:result:',
      'holder-profiles:agent:result:',
      'sig-buyers:result:',
    ];
    const isAllowed = allowedPrefixes.some((prefix) => key.startsWith(prefix));
    if (!isAllowed) {
      throw new BadRequestException(`Invalid result key prefix`);
    }

    let raw = await this.redisClient.get(key);
    if (!raw) {
      raw = await this.materializeAgentResultIfNeeded(key);
    }
    if (!raw) {
      throw new NotFoundException(`Result not found or expired for key: ${key}`);
    }

    try {
      return JSON.parse(raw);
    } catch {
      throw new NotFoundException(`Malformed result for key: ${key}`);
    }
  }

  private async materializeAgentResultIfNeeded(key: string): Promise<string | null> {
    if (key.startsWith('holder-profiles:agent:result:')) {
      const fullKey = key.replace('holder-profiles:agent:result:', 'holder-profiles:result:');
      return this.materializeDerivedResultKey(
        key,
        fullKey,
        (result) => buildAgentHolderProfilesResult(result as HolderProfilesResult),
      );
    }

    if (key.startsWith('similarity:agent:result:')) {
      const fullKey = key.replace('similarity:agent:result:', 'similarity:result:');
      return this.materializeDerivedResultKey(
        key,
        fullKey,
        (result) => buildAgentSimilarityResult(result as CombinedSimilarityResult),
      );
    }

    return null;
  }

  private async materializeDerivedResultKey(
    derivedKey: string,
    fullKey: string,
    buildResult: (result: unknown) => unknown,
  ): Promise<string | null> {
    const fullRaw = await this.redisClient.get(fullKey);
    if (!fullRaw) {
      return null;
    }

    const parsed = JSON.parse(fullRaw) as unknown;
    const derivedResult = buildResult(parsed);
    const ttlSeconds = await this.redisClient.ttl(fullKey);
    const effectiveTtlSeconds = ttlSeconds > 0 ? ttlSeconds : 900;

    const derivedRaw = JSON.stringify(derivedResult);
    await this.redisClient.set(derivedKey, derivedRaw, 'EX', effectiveTtlSeconds);
    return derivedRaw;
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

  private async getTimedOutJobOverride(
    job: Job,
    queueName: string,
  ): Promise<{ status: 'failed'; error: string } | undefined> {
    if (job.finishedOn || job.failedReason) {
      return undefined;
    }

    const state = await job.getState();
    if (state !== 'waiting' && state !== 'active' && state !== 'delayed') {
      return undefined;
    }

    const timeoutMs = this.getMaxExpectedJobMs(job);
    const elapsedMs = Date.now() - job.timestamp;
    if (elapsedMs <= timeoutMs) {
      return undefined;
    }

    const error = `Job exceeded max expected processing time (${Math.ceil(timeoutMs / 60000)} minutes)`;
    try {
      await job.moveToFailed(new Error(error), '', false);
      this.logger.warn(`Timed out stale ${queueName} job ${job.id}: state=${state} elapsedMs=${elapsedMs}`);
    } catch (moveError) {
      this.logger.warn(
        `Could not move stale ${queueName} job ${job.id} to failed; reporting failed to pollers: ${getErrorMessage(moveError)}`,
      );
    }

    return { status: 'failed', error };
  }

  private getMaxExpectedJobMs(job: Job): number {
    const timeoutMinutes = Number((job.data as { timeoutMinutes?: number } | undefined)?.timeoutMinutes);
    if (Number.isFinite(timeoutMinutes) && timeoutMinutes > 0) {
      return timeoutMinutes * 60 * 1000;
    }

    switch (job.name) {
      case 'sync-wallet':
        return JobTimeouts['sync-wallet'].timeout;
      case 'analyze-pnl':
        return JobTimeouts['analyze-pnl'].timeout;
      case 'analyze-behavior':
        return JobTimeouts['analyze-behavior'].timeout;
      case 'dashboard-wallet-analysis':
        return JobTimeouts['dashboard-wallet-analysis'].timeout;
      case 'similarity-analysis-flow':
        return JobTimeouts['calculate-similarity'].timeout;
      case 'enrich-token-balances':
        return JobTimeouts['enrich-token-balances'].timeout;
      case 'analyze-holder-profiles':
        return 30 * 60 * 1000;
      default:
        return 30 * 60 * 1000;
    }
  }

  private formatJobResponse(
    job: Job,
    queueName: string,
    override?: { status: 'failed'; error: string },
  ): JobStatusResponseDto {
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
      status: override?.status ?? state,
      progress,
      data: job.data,
      result: job.returnvalue,
      error: override?.error ?? job.failedReason,
      createdAt: new Date(job.timestamp),
      processedAt: job.processedOn ? new Date(job.processedOn) : undefined,
      finishedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts || 1,
      remainingTime: job.delay ? Math.max(0, job.delay - (Date.now() - job.timestamp)) : undefined,
    };
  }
} 
