import { Injectable, Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueNames, QueueConfigs, JobTimeouts } from '../config/queue.config';
import { AnalyzePnlJobData, AnalyzeBehaviorJobData, AnalysisResult } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
import { RedisLockService } from '../services/redis-lock.service';
import { PnlAnalysisService } from '../../api/services/pnl-analysis.service';
import { BehaviorService } from '../../api/services/behavior.service';
import { DatabaseService } from '../../api/services/database.service';
import { BehaviorAnalysisConfig } from '../../types/analysis';

@Injectable()
export class AnalysisOperationsProcessor {
  private readonly logger = new Logger(AnalysisOperationsProcessor.name);
  private readonly worker: Worker;

  constructor(
    private readonly redisLockService: RedisLockService,
    private readonly pnlAnalysisService: PnlAnalysisService,
    private readonly behaviorService: BehaviorService,
    private readonly databaseService: DatabaseService
  ) {
    const config = QueueConfigs[QueueNames.ANALYSIS_OPERATIONS];
    
    this.worker = new Worker(
      QueueNames.ANALYSIS_OPERATIONS,
      async (job: Job) => this.processJob(job),
      config.workerOptions
    );

    this.worker.on('completed', (job) => {
      this.logger.debug(`Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed:`, err);
    });

    this.worker.on('error', (err) => {
      this.logger.error('Worker error:', err);
    });

    this.logger.debug('AnalysisOperationsProcessor initialized with worker');
  }

  private async processJob(job: Job): Promise<any> {
    const jobName = job.name;
    
    this.logger.debug(`Processing ${jobName} job ${job.id}`);
    
    switch (jobName) {
      case 'analyze-pnl':
        return await this.processAnalyzePnl(job as Job<AnalyzePnlJobData>);
      case 'analyze-behavior':
        return await this.processAnalyzeBehavior(job as Job<AnalyzeBehaviorJobData>);
      default:
        throw new Error(`Unknown job type: ${jobName}`);
    }
  }

  /**
   * Process PnL analysis job using existing PnlAnalysisService
   * Implements idempotency and progress tracking as specified in the plan
   */
  async processAnalyzePnl(job: Job<AnalyzePnlJobData>): Promise<AnalysisResult> {
    const { walletAddress, forceRefresh, requestId } = job.data;
    const timeoutMs = JobTimeouts['analyze-pnl'].timeout;
    const startTime = Date.now();
    
    // Apply deduplication strategy - verify job ID matches expected
    const expectedJobId = generateJobId.analyzePnl(walletAddress, requestId);
    if (job.id !== expectedJobId) {
      throw new Error(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
    }

    // Acquire Redis lock to prevent concurrent analysis of same wallet
    const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'pnl');
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
    
    if (!lockAcquired) {
      throw new Error(`PnL analysis already in progress for wallet ${walletAddress}`);
    }

    try {
      await job.updateProgress(5);
              this.logger.debug(`Processing PnL analysis for ${walletAddress}`);

      // Check if recent analysis exists (idempotency at service level)
      if (!forceRefresh) {
        const wallet = await this.databaseService.getWallet(walletAddress);
        const lastAnalysisAge = wallet?.analyzedTimestampEnd 
          ? Date.now() - wallet.analyzedTimestampEnd * 1000  // Convert from seconds to milliseconds
          : Infinity;
        
        const shouldSkipAnalysis = lastAnalysisAge < 10 * 60 * 1000; // 10 minutes
        
        if (shouldSkipAnalysis) {
          await job.updateProgress(100);
          this.logger.debug(`PnL analysis for ${walletAddress} is already current. Skipping analysis.`);
          
          return {
            success: true,
            walletAddress,
            analysisType: 'pnl',
            timestamp: Date.now(),
            processingTimeMs: Date.now() - startTime
          };
        }
      }

      // Execute PnL analysis with existing optimal service and timeout guard
      await job.updateProgress(20);
      this.checkTimeout(startTime, timeoutMs, 'Starting PnL analysis');

      const pnlResult = await this.pnlAnalysisService.analyzeWalletPnl(walletAddress);
      
      await job.updateProgress(90);
      this.checkTimeout(startTime, timeoutMs, 'Completing PnL analysis');

      if (!pnlResult) {
        throw new Error(`PnL analysis returned no results for wallet ${walletAddress}`);
      }

      await job.updateProgress(100);

      const result: AnalysisResult = {
        success: true,
        walletAddress,
        analysisType: 'pnl',
        resultId: pnlResult.runId?.toString() || undefined,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };

      this.logger.log(`PnL analysis completed for ${walletAddress}. RunId: ${pnlResult.runId}`);
      return result;

    } catch (error) {
      this.logger.error(`PnL analysis failed for ${walletAddress}:`, error);
      
      const result: AnalysisResult = {
        success: false,
        walletAddress,
        analysisType: 'pnl',
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };
      
      throw error;
    } finally {
      // Always release lock
      await this.redisLockService.releaseLock(lockKey, job.id!);
    }
  }

  /**
   * Process behavior analysis job using existing BehaviorService
   * Implements idempotency and progress tracking as specified in the plan
   */
  async processAnalyzeBehavior(job: Job<AnalyzeBehaviorJobData>): Promise<AnalysisResult> {
    const { walletAddress, config, requestId } = job.data;
    const timeoutMs = JobTimeouts['analyze-behavior'].timeout;
    const startTime = Date.now();
    
    // Apply deduplication strategy - verify job ID matches expected
    const expectedJobId = generateJobId.analyzeBehavior(walletAddress, requestId);
    if (job.id !== expectedJobId) {
      throw new Error(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
    }

    // Acquire Redis lock to prevent concurrent analysis of same wallet
    const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'behavior');
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
    
    if (!lockAcquired) {
      throw new Error(`Behavior analysis already in progress for wallet ${walletAddress}`);
    }

    try {
      await job.updateProgress(5);
              this.logger.debug(`Processing behavior analysis for ${walletAddress}`);

      // Execute behavior analysis with existing optimal service and timeout guard
      await job.updateProgress(20);
      this.checkTimeout(startTime, timeoutMs, 'Starting behavior analysis');

      // Create behavior analysis config
      const behaviorConfig: BehaviorAnalysisConfig = config ? {
        timeRange: config.timeRange ? {
          startTs: config.timeRange.from ? Math.floor(config.timeRange.from.getTime() / 1000) : undefined,
          endTs: config.timeRange.to ? Math.floor(config.timeRange.to.getTime() / 1000) : undefined
        } : undefined,
        excludedMints: config.excludeMints || []
      } : this.behaviorService.getDefaultBehaviorAnalysisConfig();

      const timeRange = config?.timeRange ? {
        startTs: config.timeRange.from ? Math.floor(config.timeRange.from.getTime() / 1000) : undefined,
        endTs: config.timeRange.to ? Math.floor(config.timeRange.to.getTime() / 1000) : undefined
      } : undefined;

      await job.updateProgress(40);
      const behaviorResult = await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig, timeRange);
      
      await job.updateProgress(90);
      this.checkTimeout(startTime, timeoutMs, 'Completing behavior analysis');

      if (!behaviorResult) {
        throw new Error(`Behavior analysis returned no results for wallet ${walletAddress}`);
      }

      await job.updateProgress(100);

      const result: AnalysisResult = {
        success: true,
        walletAddress,
        analysisType: 'behavior',
        data: behaviorResult,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };

      this.logger.log(`Behavior analysis completed for ${walletAddress}`);
      return result;

    } catch (error) {
      this.logger.error(`Behavior analysis failed for ${walletAddress}:`, error);
      
      const result: AnalysisResult = {
        success: false,
        walletAddress,
        analysisType: 'behavior',
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };
      
      throw error;
    } finally {
      // Always release lock
      await this.redisLockService.releaseLock(lockKey, job.id!);
    }
  }

  /**
   * Check if operation has exceeded timeout
   */
  private checkTimeout(startTime: number, timeoutMs: number, operation: string): void {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`${operation} timeout after ${timeoutMs}ms`);
    }
  }

  /**
   * Shutdown the worker gracefully
   */
  async shutdown(): Promise<void> {
    this.logger.debug('Shutting down AnalysisOperationsProcessor worker...');
    await this.worker.close();
  }
} 