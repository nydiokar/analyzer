import { Injectable, Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { SimilarityAnalysisFlowData, SimilarityFlowResult } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
import { RedisLockService } from '../services/redis-lock.service';
import { WalletOperationsQueue } from '../queues/wallet-operations.queue';
import { AnalysisOperationsQueue } from '../queues/analysis-operations.queue';
import { HeliusSyncService } from '../../core/services/helius-sync-service';
import { PnlAnalysisService } from '../../api/pnl_analysis/pnl-analysis.service';
import { BehaviorService } from '../../api/wallets/behavior/behavior.service';
import { SimilarityApiService } from '../../api/analyses/similarity/similarity.service';
import { DatabaseService } from '../../api/database/database.service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { BehaviorAnalysisConfig } from '../../types/analysis';

interface BatchJobResult {
  walletAddress: string;
  success: boolean;
  error?: string;
  jobId?: string;
}

interface WalletJobTracker {
  syncJobId?: string;
  pnlJobId?: string;
  behaviorJobId?: string;
  syncCompleted: boolean;
  pnlCompleted: boolean;
  behaviorCompleted: boolean;
  allCompleted: boolean;
}

@Injectable()
export class SimilarityOperationsProcessor {
  private readonly logger = new Logger(SimilarityOperationsProcessor.name);
  private readonly worker: Worker;

  constructor(
    private readonly redisLockService: RedisLockService,
    private readonly walletOperationsQueue: WalletOperationsQueue,
    private readonly analysisOperationsQueue: AnalysisOperationsQueue,
    private readonly heliusSyncService: HeliusSyncService,
    private readonly pnlAnalysisService: PnlAnalysisService,
    private readonly behaviorService: BehaviorService,
    private readonly similarityApiService: SimilarityApiService,
    private readonly databaseService: DatabaseService,
    private readonly heliusApiClient: HeliusApiClient
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
   * Process the complete similarity analysis flow: sync → analyze → calculate similarity
   * Implements partial failure tolerance and timeout guards as specified in the plan
   */
  async processSimilarityFlow(job: Job<SimilarityAnalysisFlowData>): Promise<SimilarityFlowResult> {
    const { walletAddresses, requestId, failureThreshold = 0.8, timeoutMinutes = 30, similarityConfig } = job.data;
    
    // Apply deduplication strategy
    const expectedJobId = generateJobId.calculateSimilarity(walletAddresses, requestId);
    if (job.id !== expectedJobId) {
      throw new Error(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
    }

    // Timeout and progress tracking
    const timeoutMs = timeoutMinutes * 60 * 1000;
    const startTime = Date.now();
    
    // Acquire similarity lock to prevent concurrent processing of same request
    const lockKey = RedisLockService.createSimilarityLockKey(requestId);
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
    
    if (!lockAcquired) {
      throw new Error(`Similarity analysis already in progress for request: ${requestId}`);
    }

    try {
      this.logger.log(`Starting similarity flow for ${walletAddresses.length} wallets, requestId: ${requestId}`);

      // Step 1: Create sync jobs with deduplication
      await job.updateProgress(10);
      this.checkTimeout(startTime, timeoutMs, 'Step 1: Sync jobs creation');
      
      const syncResults = await this.createAndWaitForSyncJobs(walletAddresses, requestId, failureThreshold, timeoutMs, startTime);
      const successfulSyncWallets = syncResults.filter(r => r.success).map(r => r.walletAddress);
      
      if (successfulSyncWallets.length < 2) {
        throw new Error(`Insufficient data: only ${successfulSyncWallets.length} wallets synced successfully`);
      }

      // Step 2: Create analysis jobs only for successful syncs
      await job.updateProgress(40);
      this.checkTimeout(startTime, timeoutMs, 'Step 2: Analysis jobs creation');
      
      const analysisResults = await this.createAndWaitForAnalysisJobs(successfulSyncWallets, requestId, failureThreshold, timeoutMs, startTime);
      const analyzedWallets = analysisResults.filter(r => r.success).map(r => r.walletAddress);

      // Step 3: Run similarity analysis using existing SimilarityApiService
      await job.updateProgress(70);
      this.checkTimeout(startTime, timeoutMs, 'Step 3: Similarity calculation');
      
      const similarityResult = await this.similarityApiService.runAnalysis({
        walletAddresses: analyzedWallets // Only use successfully analyzed wallets
      });

      await job.updateProgress(100);

      const result: SimilarityFlowResult = {
        success: true,
        data: similarityResult,
        requestId,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime,
        metadata: {
          requestedWallets: walletAddresses.length,
          processedWallets: analyzedWallets.length,
          failedWallets: walletAddresses.length - analyzedWallets.length,
          successRate: analyzedWallets.length / walletAddresses.length,
          processingTimeMs: Date.now() - startTime
        }
      };

      this.logger.log(`Similarity flow completed successfully. Processed ${analyzedWallets.length}/${walletAddresses.length} wallets`);
      return result;

    } catch (error) {
      this.logger.error(`Similarity flow failed for requestId ${requestId}:`, error);
      
      const result: SimilarityFlowResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime,
        metadata: {
          requestedWallets: walletAddresses.length,
          processedWallets: 0,
          failedWallets: walletAddresses.length,
          successRate: 0,
          processingTimeMs: Date.now() - startTime
        }
      };
      
      throw error;
    } finally {
      // Always release the similarity lock
      await this.redisLockService.releaseLock(lockKey, job.id!);
    }
  }

  /**
   * Create sync jobs for all wallets and wait for completion with tolerance
   */
  private async createAndWaitForSyncJobs(
    walletAddresses: string[], 
    requestId: string, 
    failureThreshold: number,
    timeoutMs: number,
    startTime: number
  ): Promise<BatchJobResult[]> {
    const results: BatchJobResult[] = [];
    const jobPromises: Promise<void>[] = [];

    // Create sync jobs with deduplication
    for (const walletAddress of walletAddresses) {
      const syncJobPromise = this.processSingleWalletSync(walletAddress, requestId)
        .then(() => {
          results.push({ walletAddress, success: true });
        })
        .catch((error) => {
          this.logger.warn(`Sync failed for wallet ${walletAddress}:`, error);
          results.push({ 
            walletAddress, 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          });
        });

      jobPromises.push(syncJobPromise);
    }

    // Wait for all sync jobs with timeout check
    await Promise.allSettled(jobPromises);
    this.checkTimeout(startTime, timeoutMs, 'Sync jobs completion');

    const successCount = results.filter(r => r.success).length;
    const successRate = successCount / walletAddresses.length;

    if (successRate < failureThreshold) {
      throw new Error(`Sync failure rate too high: ${successRate.toFixed(2)} < ${failureThreshold}. Only ${successCount}/${walletAddresses.length} wallets synced successfully`);
    }

    this.logger.log(`Sync phase completed: ${successCount}/${walletAddresses.length} wallets synced successfully (${(successRate * 100).toFixed(1)}%)`);
    return results;
  }

  /**
   * Create analysis jobs for wallets and wait for completion with tolerance
   */
  private async createAndWaitForAnalysisJobs(
    walletAddresses: string[], 
    requestId: string, 
    failureThreshold: number,
    timeoutMs: number,
    startTime: number
  ): Promise<BatchJobResult[]> {
    const results: BatchJobResult[] = [];
    const jobPromises: Promise<void>[] = [];

    // Create analysis jobs (both PNL and behavior) for each wallet
    for (const walletAddress of walletAddresses) {
      const analysisJobPromise = this.processSingleWalletAnalysis(walletAddress, requestId)
        .then(() => {
          results.push({ walletAddress, success: true });
        })
        .catch((error) => {
          this.logger.warn(`Analysis failed for wallet ${walletAddress}:`, error);
          results.push({ 
            walletAddress, 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          });
        });

      jobPromises.push(analysisJobPromise);
    }

    // Wait for all analysis jobs with timeout check
    await Promise.allSettled(jobPromises);
    this.checkTimeout(startTime, timeoutMs, 'Analysis jobs completion');

    const successCount = results.filter(r => r.success).length;
    const successRate = successCount / walletAddresses.length;

    if (successRate < failureThreshold) {
      throw new Error(`Analysis failure rate too high: ${successRate.toFixed(2)} < ${failureThreshold}. Only ${successCount}/${walletAddresses.length} wallets analyzed successfully`);
    }

    this.logger.log(`Analysis phase completed: ${successCount}/${walletAddresses.length} wallets analyzed successfully (${(successRate * 100).toFixed(1)}%)`);
    return results;
  }

  /**
   * Process sync for a single wallet with Redis lock-based idempotency
   */
  private async processSingleWalletSync(walletAddress: string, requestId: string): Promise<void> {
    // First check if wallet was recently synced (fast path)
    const wallet = await this.databaseService.getWallet(walletAddress);
    const lastSyncAge = Date.now() - (wallet?.lastSuccessfulFetchTimestamp?.getTime() || 0);
    
    if (lastSyncAge < 5 * 60 * 1000) { // 5 minutes
      this.logger.debug(`Wallet ${walletAddress} already synced recently (${Math.round(lastSyncAge / 1000)}s ago), skipping`);
      return;
    }

    const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'sync');
    const lockValue = generateJobId.syncWallet(walletAddress, requestId);
    const lockTtl = 10 * 60 * 1000; // 10 minutes

    const lockAcquired = await this.redisLockService.acquireLock(lockKey, lockValue, lockTtl);
    
    if (!lockAcquired) {
      // If lock failed, check again if wallet was synced while we were waiting
      const updatedWallet = await this.databaseService.getWallet(walletAddress);
      const newLastSyncAge = Date.now() - (updatedWallet?.lastSuccessfulFetchTimestamp?.getTime() || 0);
      
      if (newLastSyncAge < 5 * 60 * 1000) { // 5 minutes
        this.logger.debug(`Wallet ${walletAddress} was synced by another process while waiting, proceeding`);
        return;
      }
      
      // If still not synced, wait for the other sync to complete
      this.logger.warn(`Wallet ${walletAddress} is being synced by another process, waiting for completion...`);
      await this.waitForSyncCompletion(walletAddress, 3 * 60 * 1000); // Wait up to 3 minutes
      return;
    }

    try {
      // Check idempotency at service level
      const wallet = await this.databaseService.getWallet(walletAddress);
      const lastSyncAge = Date.now() - (wallet?.lastSuccessfulFetchTimestamp?.getTime() || 0);
      
      if (lastSyncAge < 5 * 60 * 1000) { // 5 minutes
        this.logger.debug(`Wallet ${walletAddress} already current, skipping sync`);
        return;
      }

      // Execute sync with existing optimal service
      await this.heliusSyncService.syncWalletData(walletAddress, {
        limit: 100,
        fetchAll: true,
        skipApi: false,
        fetchOlder: false,
        smartFetch: true,
        maxSignatures: 200
      });

      this.logger.debug(`Successfully synced wallet: ${walletAddress}`);
      
    } finally {
      // Always release lock
      await this.redisLockService.releaseLock(lockKey, lockValue);
    }
  }

  /**
   * Process analysis (PNL + Behavior) for a single wallet
   */
  private async processSingleWalletAnalysis(walletAddress: string, requestId: string): Promise<void> {
    // Run PNL and behavior analysis in parallel
    const [pnlResult, behaviorResult] = await Promise.allSettled([
      this.processPnlAnalysis(walletAddress),
      this.processBehaviorAnalysis(walletAddress)
    ]);

    // Check if at least one analysis succeeded
    const pnlSuccess = pnlResult.status === 'fulfilled';
    const behaviorSuccess = behaviorResult.status === 'fulfilled';

    if (!pnlSuccess && !behaviorSuccess) {
      const pnlError = pnlResult.status === 'rejected' ? pnlResult.reason : 'Unknown error';
      const behaviorError = behaviorResult.status === 'rejected' ? behaviorResult.reason : 'Unknown error';
      throw new Error(`Both analyses failed for ${walletAddress}. PNL: ${pnlError}, Behavior: ${behaviorError}`);
    }

    if (!pnlSuccess) {
      this.logger.warn(`PNL analysis failed for ${walletAddress}, but behavior analysis succeeded`);
    }
    
    if (!behaviorSuccess) {
      this.logger.warn(`Behavior analysis failed for ${walletAddress}, but PNL analysis succeeded`);
    }

    this.logger.debug(`Analysis completed for wallet: ${walletAddress} (PNL: ${pnlSuccess}, Behavior: ${behaviorSuccess})`);
  }

  /**
   * Process PNL analysis for a wallet
   */
  private async processPnlAnalysis(walletAddress: string): Promise<void> {
    const result = await this.pnlAnalysisService.analyzeWalletPnl(walletAddress);
    
    if (!result) {
      throw new Error(`PNL analysis returned no results for ${walletAddress}`);
    }
  }

  /**
   * Process behavior analysis for a wallet  
   */
  private async processBehaviorAnalysis(walletAddress: string): Promise<void> {
    const config: BehaviorAnalysisConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
    const result = await this.behaviorService.getWalletBehavior(walletAddress, config);
    
    if (!result) {
      throw new Error(`Behavior analysis returned no results for ${walletAddress}`);
    }
  }

  /**
   * Wait for another sync process to complete by polling wallet status
   */
  private async waitForSyncCompletion(walletAddress: string, timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds
    
    while (Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      const wallet = await this.databaseService.getWallet(walletAddress);
      const lastSyncAge = Date.now() - (wallet?.lastSuccessfulFetchTimestamp?.getTime() || 0);
      
      if (lastSyncAge < 30 * 1000) { // 30 seconds
        this.logger.debug(`Wallet ${walletAddress} sync completed by another process`);
        return;
      }
    }
    
    throw new Error(`Timeout waiting for wallet ${walletAddress} sync to complete`);
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