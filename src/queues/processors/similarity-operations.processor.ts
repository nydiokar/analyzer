import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Worker, QueueEvents } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { ComprehensiveSimilarityFlowData, SimilarityFlowResult } from '../jobs/types';
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
import { BalanceCacheService } from '../../api/balance-cache/balance-cache.service';
import { JobProgressGateway } from '../../api/websocket/job-progress.gateway';
import { generateJobId } from '../utils/job-id-generator';
import { WalletBalance } from '../../types/wallet';
import { Wallet } from '@prisma/client';
import { BatchProcessor } from '../utils/batch-processor';
import { ANALYSIS_EXECUTION_CONFIG, PROCESSING_CONFIG } from '../../config/constants';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { KNOWN_SYSTEM_WALLETS, WALLET_CLASSIFICATIONS } from '../../config/constants';

@Injectable()
export class SimilarityOperationsProcessor implements OnModuleDestroy {
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
    
    // RESTORED: Use proper worker architecture for production scalability
    // The worker runs the logic from a separate file in a sandboxed process.
    // We must convert the file path to a URL for ESM compatibility on Windows.
    const workerPath = join(__dirname, '..', 'workers', 'similarity.worker.js');
    const workerUrl = pathToFileURL(workerPath);

    this.worker = new Worker(
      QueueNames.SIMILARITY_OPERATIONS,
      workerUrl,
      {
        ...config.workerOptions,
        concurrency: 2, // Production concurrency
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

    // Declare enrichmentJob outside try block so it's accessible in catch block
    let enrichmentJob: Job | undefined;

    try {
      this.logger.log(`Starting ADVANCED similarity analysis for ${walletAddresses.length} wallets.`);
      await job.updateProgress(5);
      await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 5);
      this.checkTimeout(startTime, timeoutMs, 'Analysis initialization');
      
      // 🏷️ PRE-FILTER: Tag known system wallets before processing
      await this.filterAndTagSystemWallets(walletAddresses);
      
      // 🚨 CRITICAL: Filter out INVALID wallets BEFORE processing (prevents 270k+ token crashes)
      // ✅ FIXED: Use batch query instead of N+1 pattern
      const validWallets: string[] = [];
      const invalidWallets: string[] = [];
      
      try {
        // Single batch query for all wallets
        const wallets = await this.databaseService.getWallets(walletAddresses, true) as Wallet[];
        const walletMap = new Map(wallets.map(w => [w.address, w]));
        
        for (const address of walletAddresses) {
          const wallet = walletMap.get(address);
          if (wallet && wallet.classification === 'INVALID') {
            this.logger.warn(`Wallet ${address} is tagged as INVALID - skipping processing entirely`);
            invalidWallets.push(address);
          } else {
            validWallets.push(address);
          }
        }
      } catch (error) {
        this.logger.warn(`Error in batch wallet validation, including all wallets in analysis:`, error);
        // Fallback: include all wallets if batch query fails
        validWallets.push(...walletAddresses);
      }
      
      this.logger.log(`Pre-filtering complete: ${validWallets.length} valid, ${invalidWallets.length} invalid (INVALID wallets skipped)`);
      
      // If we don't have enough valid wallets, fail early
      if (validWallets.length < 2) {
        throw new Error(`Insufficient valid wallets for similarity analysis. Only ${validWallets.length} of ${walletAddresses.length} wallets are valid. Invalid wallets: ${invalidWallets.join(', ')}`);
      }
      
      // Use ONLY valid wallets for processing (no more 270k+ token crashes!)
      const walletsToAnalyze = validWallets;
      const walletsNeedingSyncFiltered = syncRequired ? walletsToAnalyze.filter(address => {
        return walletsNeedingSync.includes(address);
      }) : [];
      
      // ⚡ STEP 1: START BOTH OPERATIONS IN PARALLEL (NO BLOCKING) - ONLY FOR VALID WALLETS
      this.logger.log('🚀 Starting sync and balance fetch in TRUE PARALLEL...');
      
      // Start sync immediately (if needed) - DON'T await yet - ONLY for valid wallets
      const syncPromise = syncRequired 
        ? this._orchestrateDeepSync(walletsNeedingSyncFiltered, job)
        : Promise.resolve();

      // Start balance fetching in parallel - DON'T await yet - ONLY for valid wallets 
      const balancePromise = this.balanceCacheService.getManyBalances(walletsToAnalyze);
      
      // Log progress but don't block
      await job.updateProgress(10);
      await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 10);

      // ⚡ STEP 2: WAIT FOR BOTH TO COMPLETE
      this.logger.log('⏳ Waiting for BOTH sync and balance fetch to complete...');
      const [syncResult, balanceResult] = await Promise.allSettled([syncPromise, balancePromise]);
      
      // Handle results
      if (syncResult.status === 'rejected') {
        throw new Error(`Sync failed: ${syncResult.reason}`);
      }
      if (balanceResult.status === 'rejected') {
        throw new Error(`Balance fetch failed: ${balanceResult.reason}`);
      }
      
      const actualWalletBalances = balanceResult.value;
      this.logger.log(`✅ PARALLEL COMPLETION: Sync done, balances for ${Object.keys(actualWalletBalances).length} wallets fetched`);

      // STEP 3: Start enrichment job with pre-fetched balances (fire-and-forget)
      if (enrichMetadata && process.env.DISABLE_ENRICHMENT !== 'true') {
        this.logger.log(`Triggering background enrichment job for request: ${requestId}.`);
        try {
          enrichmentJob = await this.enrichmentOperationsQueue.addParallelEnrichmentJob({
            walletBalances: actualWalletBalances,
            requestId,
          });
          this.logger.log(`Background enrichment job queued: ${enrichmentJob?.id} for request: ${requestId}.`);
          // DON'T wait for enrichment - keep it truly parallel!
        } catch (error) {
          this.logger.warn(`Failed to queue enrichment job, continuing without enrichment:`, error);
        }
      } else if (process.env.DISABLE_ENRICHMENT === 'true') {
        this.logger.log(`Enrichment disabled by DISABLE_ENRICHMENT environment variable`);
      }

      await job.updateProgress(60);
      await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 60);
      this.checkTimeout(startTime, timeoutMs, 'Parallel operations completed');

      // STEP 3.5: Wallets already filtered - validWallets contains only valid wallets
      this.logger.log(`Using pre-filtered valid wallets for similarity calculation: ${validWallets.length} wallets`);

      // STEP 4: FINAL ANALYSIS (The service now uses the pre-fetched balances)
      this.logger.log('Starting final similarity calculation...');
      
      // Convert the balances object to a Map as expected by the service
      const balancesMap = new Map<string, WalletBalance>();
      for (const address in actualWalletBalances) {
        if (actualWalletBalances[address]) {
          balancesMap.set(address, actualWalletBalances[address] as WalletBalance);
        }
      }

      const similarityResult = await this.similarityApiService.runAnalysis(
        {
          walletAddresses: validWallets, // Use only the valid wallets
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
          processedWallets: validWallets.length,
          failedWallets: invalidWallets.length,
          invalidWallets: invalidWallets.length > 0 ? invalidWallets : undefined,
          successRate: validWallets.length / walletAddresses.length,
          processingTimeMs: Date.now() - startTime
        }
      };
      
      const mode = 'full_sync_raw_balances_with_background_enrichment';
      
      this.logger.log(`Advanced similarity analysis completed successfully in ${Date.now() - startTime}ms. Mode: ${mode}`);
      return result;

    } catch (error) {
      this.logger.error(`Similarity analysis failed for requestId ${requestId}:`, error);
      
      // Cancel any running enrichment job to prevent orphaned processes
      if (enrichmentJob) {
        try {
          this.logger.log(`Cancelling enrichment job ${enrichmentJob.id} due to similarity analysis failure`);
          await enrichmentJob.remove();
        } catch (cancelError) {
          this.logger.warn(`Failed to cancel enrichment job ${enrichmentJob.id}:`, cancelError);
        }
      }
      
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
   * Filters out and tags known system wallets from the provided list of wallet addresses.
   * This ensures that these wallets are not included in the similarity analysis.
   */
  private async filterAndTagSystemWallets(walletAddresses: string[]): Promise<void> {
    const systemWalletsArray = [...KNOWN_SYSTEM_WALLETS] as string[]; // Convert readonly to mutable array
    const systemWalletsSet = new Set(systemWalletsArray);
    const taggedWallets: string[] = [];
    const invalidWallets: string[] = [];

    for (const address of walletAddresses) {
      if (systemWalletsSet.has(address)) {
        this.logger.warn(`Wallet ${address} is a known system wallet - tagging as INVALID.`);
        // Tag as INVALID using the correct method parameters
        await this.databaseService.updateWalletClassification(address, {
          classification: WALLET_CLASSIFICATIONS.INVALID,
          classificationMethod: 'system_wallet_filter',
          classificationUpdatedAt: new Date(),
        });
        invalidWallets.push(address);
      } else {
        taggedWallets.push(address);
      }
    }

    // this.logger.log(`System wallet filtering complete: ${taggedWallets.length} valid, ${invalidWallets.length} invalid`);
  }

  /**
   * Cleanup worker when module is destroyed
   */
  async onModuleDestroy() {
    this.logger.log('Shutting down SimilarityOperationsProcessor...');
    if (this.worker) {
      await this.worker.close();
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