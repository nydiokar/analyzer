import { Injectable, Logger } from '@nestjs/common';
import { Job, Worker, QueueEvents } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { ComprehensiveSimilarityFlowData, SimilarityFlowResult } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
import { RedisLockService } from '../services/redis-lock.service';
import { SimilarityApiService } from '../../api/analyses/similarity/similarity.service';
import { DatabaseService } from '../../api/database/database.service';
import { WalletBalanceService } from '../../core/services/wallet-balance-service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { TokenInfoService } from '../../api/token-info/token-info.service';
import { HeliusSyncService, SyncOptions } from '../../core/services/helius-sync-service';
import { PnlAnalysisService } from '../../api/pnl_analysis/pnl-analysis.service';
import { BehaviorService } from '../../api/wallets/behavior/behavior.service';
import { EnrichmentOperationsQueue } from '../queues/enrichment-operations.queue';
import { JobProgressGateway } from '../../api/websocket/job-progress.gateway';
import { BalanceCacheService } from '../../api/balance-cache/balance-cache.service';
import { ANALYSIS_EXECUTION_CONFIG, PROCESSING_CONFIG } from '../../config/constants';
import { BatchProcessor } from '../utils/batch-processor';
import { WalletBalance } from '../../types/wallet';
import { join } from 'path';
import { pathToFileURL } from 'url';

@Injectable()
export class SimilarityOperationsProcessor {
  private readonly logger = new Logger(SimilarityOperationsProcessor.name);
  private readonly worker: Worker;
  private readonly walletBalanceService: WalletBalanceService;

  constructor(
    private readonly redisLockService: RedisLockService,
    private readonly similarityApiService: SimilarityApiService,
    private readonly databaseService: DatabaseService,
    private readonly heliusApiClient: HeliusApiClient,
    private readonly tokenInfoService: TokenInfoService,
    private readonly heliusSyncService: HeliusSyncService,
    private readonly pnlAnalysisService: PnlAnalysisService,
    private readonly behaviorService: BehaviorService,
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
    private readonly balanceCacheService: BalanceCacheService,
    private readonly websocketGateway: JobProgressGateway,
  ) {
    // Initialize WalletBalanceService
    this.walletBalanceService = new WalletBalanceService(this.heliusApiClient);
    const config = QueueConfigs[QueueNames.SIMILARITY_OPERATIONS];
    
    // The worker now runs the logic from a separate file in a sandboxed process.
    // We must convert the file path to a URL for ESM compatibility on Windows.
    const workerPath = join(__dirname, '..', 'workers', 'similarity.worker.js');
    const workerUrl = pathToFileURL(workerPath);

    this.worker = new Worker(
      QueueNames.SIMILARITY_OPERATIONS,
      workerUrl,
      {
        ...config.workerOptions,
        concurrency: 2, // Example: align with resource allocation plan
      }
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

  /**
   * This method is now public so it can be called by the sandboxed worker process.
   * It contains the core logic for the similarity analysis flow.
   */
  public async processSimilarityFlow(job: Job<ComprehensiveSimilarityFlowData>): Promise<SimilarityFlowResult> {
    const { walletAddresses, requestId, walletsNeedingSync = [], enrichMetadata = true, failureThreshold = 0.8, timeoutMinutes = 45, similarityConfig } = job.data;
    
    // Determine if sync is needed based on the wallets list (no redundant boolean needed)
    const syncRequired = walletsNeedingSync.length > 0;

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
      this.logger.log(`Starting ADVANCED similarity analysis for ${walletAddresses.length} wallets.`);
      await job.updateProgress(5);
      await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 5);
      this.checkTimeout(startTime, timeoutMs, 'Analysis initialization');
      
      // Use all wallets initially - filtering for INVALID wallets happens after sync
      const walletsToAnalyze = walletAddresses;
      const walletsNeedingSyncFiltered = syncRequired ? walletsToAnalyze.filter(address => {
        return walletsNeedingSync.includes(address);
      }) : [];
      
      // Fetch all balances ONCE using the new efficient batch method.
      const walletBalances = await this.balanceCacheService.getManyBalances(walletsToAnalyze);
      this.logger.log(`Fetched initial balances for ${Object.keys(walletBalances).length} wallets.`);

      // STEP 1: PARALLEL KICK-OFF OF LONG & SHORT TASKS
      this.logger.log('Kicking off deep sync and balance fetch in parallel.');
      
      const syncPromise = syncRequired 
        ? this._orchestrateDeepSync(walletsNeedingSyncFiltered, job)
        : Promise.resolve();

      // STEP 2: Let enrichment job start if needed. Balances will be fetched inside the service.
      let enrichmentJob: Job | undefined;
      if (enrichMetadata) {
        this.logger.log(`Triggering parallel enrichment job for request: ${requestId}.`);
        enrichmentJob = await this.enrichmentOperationsQueue.addParallelEnrichmentJob({
          walletBalances,
          requestId,
        });
        this.logger.log(`Parallel enrichment job has been queued for request: ${requestId}.`);
      }

      // STEP 3: AWAIT DEEP SYNC COMPLETION (if needed)
      if (syncRequired) {
        this.logger.log('Awaiting deep sync and analysis to complete...');
        await syncPromise;
        await job.updateProgress(60);
        await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 60);
        this.checkTimeout(startTime, timeoutMs, 'Data sync and balance fetch');
      }

      // STEP 4: FINAL ANALYSIS (The service now uses the pre-fetched balances)
      this.logger.log('Starting final similarity calculation...');
      
      // Convert the balances object to a Map as expected by the service
      const balancesMap = new Map<string, WalletBalance>();
      for (const address in walletBalances) {
        if (walletBalances[address]) {
          balancesMap.set(address, walletBalances[address] as WalletBalance);
        }
      }

      const similarityResult = await this.similarityApiService.runAnalysis(
        {
          walletAddresses: walletAddresses,
          vectorType: similarityConfig?.vectorType || 'capital',
        },
        balancesMap,
      );
      
      await job.updateProgress(90);
      await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 90);
      this.checkTimeout(startTime, timeoutMs, 'Final analysis');

      // STEP 5: PREPARE RESULTS (The result from the service is now complete)
      this.logger.log('Similarity analysis completed successfully.');

      await job.updateProgress(100);
      await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 100);
      this.checkTimeout(startTime, timeoutMs, 'Final result preparation');

      const result: SimilarityFlowResult = {
        success: true,
        data: similarityResult,
        requestId: requestId,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime,
        enrichmentJobId: enrichmentJob?.id, // Include enrichment job ID for frontend subscription
        metadata: {
          requestedWallets: walletAddresses.length,
          processedWallets: walletAddresses.length,
          failedWallets: 0,
          successRate: walletAddresses.length / walletAddresses.length,
          processingTimeMs: Date.now() - startTime
        }
      };
      
      const mode = 'full_sync_raw_balances_with_background_enrichment';
      
      this.logger.log(`Advanced similarity analysis completed successfully in ${Date.now() - startTime}ms. Mode: ${mode}`);
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
   * Orchestrates the full data synchronization and analysis pipeline for a list of wallets.
   * This includes fetching all transactions and running PNL and behavior analysis.
   * Uses concurrency control to prevent overwhelming the Helius API.
   */
  private async _orchestrateDeepSync(walletAddresses: string[], job: Job): Promise<void> {
    if (walletAddresses.length === 0) {
      this.logger.log('No wallets need sync - skipping deep sync operation.');
      return;
    }
    
    this.logger.log(`Orchestrating deep sync for ${walletAddresses.length} wallets with concurrency limit of ${PROCESSING_CONFIG.WALLET_SYNC_CONCURRENCY}...`);
    // This part of the flow will account for up to 55% of the progress bar (5% to 60%).
    const progressStep = 55 / walletAddresses.length;
    let currentProgress = 5;

    // Process wallets with concurrency control to prevent API rate limiting
    const batchProcessor = new BatchProcessor();
    
    const syncSummary = await batchProcessor.processBatch(
      walletAddresses,
      async (walletAddress: string, index: number) => {
        try {
          const syncOptions: SyncOptions = { 
            fetchAll: true, 
            smartFetch: true, 
            maxSignatures: ANALYSIS_EXECUTION_CONFIG.SIMILARITY_LAB_MAX_SIGNATURES,
            limit: 100, // Respect Helius API's 100 transaction limit per request
            skipApi: false,
            fetchOlder: true,
          };
          await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);

          const behaviorConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
          // These can also run in parallel as they depend only on the sync having completed.
          await Promise.all([
              this.pnlAnalysisService.analyzeWalletPnl(walletAddress),
              this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig),
          ]);

          // Increment progress safely after each wallet is fully processed.
          currentProgress += progressStep;
          const progress = Math.floor(currentProgress);
          await job.updateProgress(progress);
          await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, progress);

          return { walletAddress, status: 'completed' };

        } catch (error) {
          this.logger.error(`Deep sync failed for wallet ${walletAddress}`, error);
          // Throw to ensure the entire job fails if one wallet cannot be synced,
          // guaranteeing data integrity for the final similarity analysis.
          throw new Error(`Failed to sync and analyze wallet: ${walletAddress}`);
        }
      },
      (walletAddress: string, index: number) => walletAddress,
      {
        maxConcurrency: PROCESSING_CONFIG.WALLET_SYNC_CONCURRENCY,
        failureThreshold: PROCESSING_CONFIG.FAILURE_THRESHOLD,
        timeoutMs: PROCESSING_CONFIG.BATCH_PROCESSING_TIMEOUT_MS,
        retryAttempts: PROCESSING_CONFIG.RETRY_ATTEMPTS,
        retryDelayMs: PROCESSING_CONFIG.RETRY_DELAY_MS
      }
    );

    this.logger.log(`Deep sync completed: ${syncSummary.successfulItems}/${syncSummary.totalItems} wallets successful (${(syncSummary.successRate * 100).toFixed(1)}%)`);
    
    if (syncSummary.failedItems > 0) {
      const failedWallets = syncSummary.results
        .filter(r => !r.success)
        .map(r => r.itemId);
      this.logger.warn(`Failed to sync ${syncSummary.failedItems} wallets: ${failedWallets.join(', ')}`);
    }
  }



  /**
   * Determine optimization hint based on wallet balances
   */
  private determineOptimizationHint(walletBalances: Record<string, any>): 'small' | 'large' | 'massive' {
    const totalTokens = Object.values(walletBalances).reduce((count: number, wallet: any) => {
      return count + (wallet.tokenBalances?.length || 0);
    }, 0);

    if (totalTokens > 10000) return 'massive';
    if (totalTokens > 1000) return 'large';
    return 'small';
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