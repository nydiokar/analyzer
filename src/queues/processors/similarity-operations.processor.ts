import { Injectable, Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { SimilarityAnalysisFlowData, SimilarityFlowResult } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
import { RedisLockService } from '../services/redis-lock.service';
import { SimilarityApiService } from '../../api/analyses/similarity/similarity.service';
import { DatabaseService } from '../../api/database/database.service';

@Injectable()
export class SimilarityOperationsProcessor {
  private readonly logger = new Logger(SimilarityOperationsProcessor.name);
  private readonly worker: Worker;

  constructor(
    private readonly redisLockService: RedisLockService,
    private readonly similarityApiService: SimilarityApiService,
    private readonly databaseService: DatabaseService
  ) {
    const config = QueueConfigs[QueueNames.SIMILARITY_OPERATIONS];
    
    this.worker = new Worker(
      QueueNames.SIMILARITY_OPERATIONS,
      async (job: Job) => this.processJob(job),
      config.workerOptions
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed:`, err);
    });

    this.worker.on('error', (err) => {
      this.logger.error('Worker error:', err);
    });
  }

  private async processJob(job: Job): Promise<SimilarityFlowResult> {
    const jobName = job.name;
    
    switch (jobName) {
      case 'similarity-analysis-flow':
        return this.processSimilarityFlow(job as Job<SimilarityAnalysisFlowData>);
      default:
        throw new Error(`Unknown job type: ${jobName}`);
    }
  }

  /**
   * Process the similarity analysis flow: just calculate similarity on existing data (like quick analysis)
   * Implements job orchestration for reliability without changing the operational logic
   */
  async processSimilarityFlow(job: Job<SimilarityAnalysisFlowData>): Promise<SimilarityFlowResult> {
    const { walletAddresses, requestId, failureThreshold = 0.8, timeoutMinutes = 30, similarityConfig } = job.data;
    
    // Apply deduplication strategy
    const expectedJobId = generateJobId.calculateSimilarity(walletAddresses, requestId);
    if (job.id !== expectedJobId) {
      throw new Error(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
    }

    const timeoutMs = timeoutMinutes * 60 * 1000;
    const startTime = Date.now();

    // Acquire similarity lock to prevent concurrent processing of same request
    const lockKey = RedisLockService.createSimilarityLockKey(requestId);
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
    
    if (!lockAcquired) {
      throw new Error(`Similarity analysis already in progress for request: ${requestId}`);
    }

    try {
      this.logger.log(`Starting similarity analysis for ${walletAddresses.length} wallets, requestId: ${requestId}`);
     // this.logger.log(`Following SAME logic as quick analysis - using existing data only`);

      // Progress update: Starting analysis
      await job.updateProgress(20);
      this.checkTimeout(startTime, timeoutMs, 'Analysis initialization');

      // SAME LOGIC AS Legacy Similarity ANALYSIS: Use SimilarityApiService directly on existing data
      // This will:
      // 1. Fetch current SPL balances (live data)
      // TODO: this logic of first getting the SPL balances will allow for fetching metadata for the SPL tokens via DEXSCREENER while the main
      // transactions details is being fetched from HELIUS. (could it happen in parallel with the transactions details?) 2 queues? 

      // 2. Use existing transaction data from database  
      // 3. Calculate similarity matrices
      // 4. Return combined results
      await job.updateProgress(50);
      this.logger.log(`Running similarity analysis using existing data (no sync, no re-analysis)`);
      
      const similarityResult = await this.similarityApiService.runAnalysis({
        walletAddresses: walletAddresses,
        vectorType: similarityConfig?.vectorType || 'capital'
      });

      // Progress update: Analysis complete
      await job.updateProgress(100);
      this.checkTimeout(startTime, timeoutMs, 'Similarity calculation completed');

      // Create result with metadata (following the exact type definition)
      const result: SimilarityFlowResult = {
        success: true,
        data: similarityResult,
        requestId: requestId,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime,
        metadata: {
          requestedWallets: walletAddresses.length,
          processedWallets: walletAddresses.length, // All wallets processed (using existing data)
          failedWallets: 0, // No failures when using existing data
          successRate: 1.0, // 100% success rate
          processingTimeMs: Date.now() - startTime
        }
      };

      this.logger.log(`Similarity analysis completed successfully in ${Date.now() - startTime}ms. Mode: existing_data_only`);
      return result;

    } catch (error) {
      this.logger.error(`Similarity analysis failed for requestId ${requestId}:`, error);
      throw error;
    } finally {
      // Always release the Redis lock
      const lockKey = RedisLockService.createSimilarityLockKey(requestId);
      try {
        await this.redisLockService.releaseLock(lockKey, job.id!);
        this.logger.debug(`Lock released: ${lockKey} with value: ${job.id}`);
      } catch (lockError) {
        this.logger.warn(`Failed to release lock ${lockKey}:`, lockError);
      }
    }
  }

  /**
   * Check if operation has timed out and throw error if so
   */
  private checkTimeout(startTime: number, timeoutMs: number, operation: string): void {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`${operation} timeout after ${timeoutMs / 1000}s`);
    }
  }

  /**
   * Shutdown the worker gracefully
   */
  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Shutting down SimilarityOperationsProcessor...');
    await this.worker.close();
  }
} 