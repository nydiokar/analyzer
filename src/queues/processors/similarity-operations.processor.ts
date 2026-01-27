import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Worker, UnrecoverableError } from 'bullmq';
import { QueueNames, QueueConfigs } from '../config/queue.config';
import { ComprehensiveSimilarityFlowData, SimilarityFlowResult } from '../jobs/types';
import { RedisLockService } from '../services/redis-lock.service';
import { SimilarityApiService } from '../../api/services/similarity.service';
import { DatabaseService } from '../../api/services/database.service';
import { WalletBalanceService } from '../../core/services/wallet-balance-service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { TokenInfoService } from '../../api/services/token-info.service';
import { HeliusSyncService, SyncOptions } from '../../core/services/helius-sync-service';
import { PnlAnalysisService } from '../../api/services/pnl-analysis.service';
import { BehaviorService } from '../../api/services/behavior.service';
import { EnrichmentOperationsQueue } from '../queues/enrichment-operations.queue';
import { BalanceCacheService } from '../../api/services/balance-cache.service';
import { JobPayloadCacheService } from '../../api/services/job-payload-cache.service';
import { SystemWalletDetectionService } from '../../api/services/system-wallet-detection.service';
import { generateJobId } from '../utils/job-id-generator';
import { WalletBalance } from '../../types/wallet';
import { Wallet } from '@prisma/client';
import { BatchProcessor } from '../utils/batch-processor';
import { ANALYSIS_EXECUTION_CONFIG, PROCESSING_CONFIG } from '../../config/constants';
import { SPL_TOKEN_PROGRAM_ID } from '../../config/constants';
import { REDIS_CLIENT } from '../config/redis.provider';
import Redis from 'ioredis';
import { EXCLUDE_FROM_SIMILARITY, getKnownWallet } from '../../config/known-wallets';
import { getErrorMessage } from 'core/utils/error-utils';

@Injectable()
export class SimilarityOperationsProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(SimilarityOperationsProcessor.name);
  private readonly worker: Worker;
  private readonly walletBalanceService: WalletBalanceService;
  private readonly resultTtlSeconds = 15 * 60; // 15 minutes for clients to fetch results
  private readonly PAYLOAD_WARN_BYTES = 5 * 1024 * 1024; // 5MB threshold

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
    private readonly jobPayloadCache: JobPayloadCacheService,
    private readonly systemWalletDetection: SystemWalletDetectionService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis, // For locks, result caching, etc.
  ) {
    // Note: In a proper NestJS setup, WalletBalanceService would be injected via constructor
    // For now, we'll keep the manual instantiation for the processor
    this.walletBalanceService = new WalletBalanceService(this.heliusApiClient, this.databaseService);
    const config = QueueConfigs[QueueNames.SIMILARITY_OPERATIONS];

    // FIXED: Run processor in main process instead of sandboxed worker
    // This eliminates massive memory overhead from bootstrapping full NestJS app per job
    // The sandboxed architecture was causing 500MB+ memory per job + 5 second cleanup delays
    // Running in main process is standard BullMQ pattern and perfectly safe for I/O-bound work
    this.worker = new Worker(
      QueueNames.SIMILARITY_OPERATIONS,
      async (job: Job<ComprehensiveSimilarityFlowData>) => {
        return await this.processSimilarityFlow(job);
      },
      {
        ...config.workerOptions,
        concurrency: 5, // Increased from 2 - inline processing eliminates 500MB overhead per job
      }
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${getErrorMessage(err)}`);
    });

    this.worker.on('error', (err) => {
      this.logger.error(`Worker error: ${getErrorMessage(err)}`);
    });
  }

  /**
   * Core logic for the similarity analysis flow.
   * Runs directly in the main process for optimal memory efficiency.
   */
  public async processSimilarityFlow(job: Job<ComprehensiveSimilarityFlowData>): Promise<SimilarityFlowResult> {
    const {
      walletAddresses,
      requestId,
      walletsNeedingSync = [],
      enrichMetadata = true,
      includeBalances = false,
      includeVectors = false,
      failureThreshold = 0.8,
      timeoutMinutes = 45,
      similarityConfig,
    } = job.data;
    
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
      // 🚨 FAIL FAST: Prevent retry storms
      const lockOwner = await this.redisLockService.getLockValue(lockKey);
      const ttl = await this.redisLockService.getLockTTL(lockKey);
      this.logger.warn(
        `❌ Cannot acquire lock for similarity analysis (request: ${requestId}). ` +
        `Locked by: ${lockOwner}, TTL: ${Math.max(0, ttl)}ms. Job ${job.id} FAILED (no retry).`
      );
      throw new UnrecoverableError(
        `Similarity analysis already in progress for request: ${requestId} (locked by: ${lockOwner})`
      );
    }

    // Declare enrichmentJob outside try block so it's accessible in catch block
    let enrichmentJob: Job | undefined;

    try {
      this.logger.log(`Starting ADVANCED similarity analysis for ${walletAddresses.length} wallets.`);
      await job.updateProgress(5);
      // Publish progress via bridge (centralized userId extraction)
      // BullMQ handles progress - bridge picks it up automatically
      this.checkTimeout(startTime, timeoutMs, 'Analysis initialization');

      // 🔍 SYSTEM WALLET DETECTION: Use centralized service for all wallets
      // The service handles 3-tier caching (memory → Redis → database) and RPC detection
      // Thresholds: 15k tokens = LARGE (process with warning), 70k+ tokens = SYSTEM (skip)
      this.logger.log(`Running system wallet detection for ${walletAddresses.length} wallets...`);

      const detectionResult = await this.detectSystemWalletsEarly(walletAddresses);
      const validWallets = detectionResult.validWallets;
      const invalidWallets = detectionResult.systemWallets;
      const tokenCounts = detectionResult.tokenCounts; // this is not used, it was meant for smart "classification" of whales but keep it for now

      this.logger.log(`System wallet detection complete: ${validWallets.length} valid, ${invalidWallets.length} invalid (system wallets)`);

      // If we don't have enough valid wallets, fail early
      if (validWallets.length < 2) {
        throw new Error(`Insufficient valid wallets for similarity analysis. Only ${validWallets.length} of ${walletAddresses.length} wallets are valid. Invalid wallets: ${invalidWallets.join(', ')}`);
      }

      // Use ONLY valid wallets for processing (no more 270k+ token crashes!)
      const walletsToAnalyze = validWallets;
      const walletsNeedingSyncFiltered = syncRequired ? walletsToAnalyze.filter(address => {
        return walletsNeedingSync.includes(address);
      }) : [];
      
      // ⚡ STEP 1: START BOTH OPERATIONS IN PARALLEL (NO BLOCKING)
      this.logger.log('🚀 Starting sync and balance fetch in TRUE PARALLEL...');
      
      // Start sync immediately (if needed) - DON'T await yet
      const syncPromise = syncRequired 
        ? this._orchestrateDeepSync(walletsNeedingSyncFiltered, job)
        : Promise.resolve();

      // Start balance fetching in parallel - DON'T await yet
      // 🎯 CRITICAL FIX: Pass token counts to balance fetcher to enable whale protection
      // Fetch balances for all valid wallets (uses cache internally)
      const balancePromise = this.balanceCacheService.getManyBalances(validWallets, tokenCounts);
      
      // Log progress but don't block
      await job.updateProgress(10);
      // BullMQ handles progress - bridge picks it up automatically
      
      // ⚡ STEP 2: WAIT FOR BOTH TO COMPLETE
      this.logger.log('⏳ Waiting for BOTH sync and balance fetch to complete...');
      const [syncResult, balanceResult] = await Promise.allSettled([syncPromise, balancePromise]);
      
      // Handle results
      if (syncResult.status === 'rejected') {
        throw new Error(`Sync failed: ${syncResult.reason}`);
      }
      
      let actualWalletBalances: Record<string, WalletBalance>;
      if (balanceResult.status === 'rejected') {
        // Check if this is due to system wallet detection - if so, we might still have valid wallets
        this.logger.warn(`Balance fetch failed, but this might be due to system wallet detection: ${balanceResult.reason}`);
        
        // Try to get any valid wallets that were processed before the error
        // This is a fallback for when balance fetch fails
        try {
          const fallbackBalances = await this.balanceCacheService.getManyBalances(validWallets, tokenCounts);

          if (Object.keys(fallbackBalances).length >= 2) {
            this.logger.log(`✅ Recovered ${Object.keys(fallbackBalances).length} valid wallets after balance fetch error`);
            actualWalletBalances = fallbackBalances;
          } else {
            throw new Error(`Balance fetch failed and insufficient valid wallets recovered: ${balanceResult.reason}`);
          }
        } catch (fallbackError: any) {
          throw new Error(`Balance fetch failed and recovery failed: ${balanceResult.reason}. Recovery error: ${fallbackError.message || 'Unknown error'}`);
        }
      } else {
        actualWalletBalances = balanceResult.value;
      }
      this.logger.log(`✅ PARALLEL COMPLETION: Sync done, balances for ${Object.keys(actualWalletBalances).length} wallets fetched`);

      // Use all wallets for analysis (system wallet detection removed as it was ineffective)
      const finalWalletsToAnalyze = validWallets;

      // STEP 3: Start enrichment job with pre-fetched balances (fire-and-forget) - ONLY for valid wallets
      if (enrichMetadata && process.env.DISABLE_ENRICHMENT !== 'true') {
        this.logger.log(`Triggering background enrichment job for request: ${requestId}.`);
        try {
          const enrichmentLockKey = `enrich:scheduled:${requestId}`;
          const lockSet = await this.redisClient.set(enrichmentLockKey, job.id as string, 'EX', 15 * 60, 'NX');
          if (!lockSet) {
            this.logger.log(`Enrichment already scheduled for request: ${requestId}. Skipping duplicate.`);
          } else {
          // Use all wallet balances for enrichment
          // Tokens are already filtered at source (>1000 balance threshold in WalletBalanceService)
          const validWalletBalances: Record<string, any> = {};
          for (const walletAddr of finalWalletsToAnalyze) {
            if (actualWalletBalances[walletAddr]) {
              validWalletBalances[walletAddr] = actualWalletBalances[walletAddr];
            }
          }

          // Store balances in Redis to avoid bloating BullMQ job data
          const balancesKey = await this.jobPayloadCache.storePayload(requestId, 'similarity', validWalletBalances);

          enrichmentJob = await this.enrichmentOperationsQueue.addParallelEnrichmentJob({
            balancesKey,
            requestId,
            userId: job.data.userId,
            walletAddresses: finalWalletsToAnalyze,
          });
          this.logger.log(`Background enrichment job queued: ${enrichmentJob?.id} for request: ${requestId}.`);
          // DON'T wait for enrichment - keep it truly parallel!
          }
        } catch (error) {
          this.logger.warn(`Failed to queue enrichment job, continuing without enrichment: ${getErrorMessage(error)}`);
        }
      } else if (process.env.DISABLE_ENRICHMENT === 'true') {
        this.logger.log(`Enrichment disabled by DISABLE_ENRICHMENT environment variable`);
      }

      await job.updateProgress(60);
      // BullMQ handles progress - bridge picks it up automatically
      this.checkTimeout(startTime, timeoutMs, 'Parallel operations completed');

      // STEP 3.5: Use only valid wallets that have balances for similarity calculation
      const validWalletsWithBalances = finalWalletsToAnalyze.filter(address => actualWalletBalances[address]);
      this.logger.log(`Using valid wallets for similarity calculation: ${validWalletsWithBalances.length} wallets`);

      // STEP 3.6: Verify all wallets have transaction data before similarity analysis
      if (validWalletsWithBalances.length >= 2) {
        try {
          const transactionData = await this.databaseService.getTransactionsForAnalysis(validWalletsWithBalances, { excludedMints: [] });
          const walletsWithData = Object.keys(transactionData).filter(addr => transactionData[addr]?.length > 0);
          if (walletsWithData.length < 2) {
            throw new Error(`Insufficient valid wallets for similarity analysis. Only ${walletsWithData.length} wallets have transaction data out of ${validWalletsWithBalances.length} wallets with balances.`);
          }
          this.logger.log(`Verified ${walletsWithData.length} wallets have transaction data for similarity analysis`);
        } catch (error: any) {
          this.logger.error(`Error verifying transaction data: ${getErrorMessage(error)}`);
          throw new Error(`Failed to verify transaction data for similarity analysis: ${error.message || 'Unknown error'}`);
        }
      } else {
        throw new Error(`Insufficient valid wallets for similarity analysis. Need at least 2 wallets, got ${validWalletsWithBalances.length}.`);
      }

      // STEP 4: FINAL ANALYSIS (The service now uses the pre-fetched balances)
      this.logger.log('Starting final similarity calculation...');
      
      // Convert the balances object to a Map as expected by the service
      const balancesMap = new Map<string, WalletBalance>();
      for (const address of validWalletsWithBalances) {
        balancesMap.set(address, actualWalletBalances[address] as WalletBalance);
      }

      const similarityResult = await this.similarityApiService.runAnalysis(
        {
          walletAddresses: validWalletsWithBalances, // Use only valid wallets with balances
          vectorType: similarityConfig?.vectorType || 'capital',
          includeBalances,
          includeVectors,
        },
        balancesMap,
      );

      await job.updateProgress(90);
      // BullMQ handles progress - bridge picks it up automatically
      this.checkTimeout(startTime, timeoutMs, 'Final analysis');

      // STEP 5: PREPARE RESULTS (The result from the service is now complete)
      this.logger.log('Similarity analysis completed successfully.');

      await job.updateProgress(100);
      // BullMQ handles progress - bridge picks it up automatically
      this.checkTimeout(startTime, timeoutMs, 'Final result preparation');

      const result: SimilarityFlowResult = {
        success: true,
        data: undefined, // Set after Redis store
        requestId: requestId,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime,
        enrichmentJobId: enrichmentJob?.id, // Include enrichment job ID for frontend subscription
        metadata: {
          requestedWallets: walletAddresses.length,
          processedWallets: validWalletsWithBalances.length,
          failedWallets: invalidWallets.length,
          invalidWallets: invalidWallets.length > 0 ? invalidWallets : undefined,
          systemWallets: undefined,
          successRate: validWalletsWithBalances.length / walletAddresses.length,
          processingTimeMs: Date.now() - startTime
        }
      };
      
      const mode = 'full_sync_raw_balances_with_background_enrichment';
      const serialized = JSON.stringify(similarityResult);
      const payloadSize = Buffer.byteLength(serialized, 'utf8');
      if (payloadSize > this.PAYLOAD_WARN_BYTES) {
        this.logger.warn(`Similarity result is large (${(payloadSize / 1024 / 1024).toFixed(2)} MB) for request ${requestId}`);
      }

      const resultKey = this.buildResultKey(requestId);
      try {
        await this.redisClient.set(resultKey, serialized, 'EX', this.resultTtlSeconds);
        this.logger.debug(`Stored similarity result for ${requestId} with TTL ${this.resultTtlSeconds}s`);
      } catch (storeError) {
        this.logger.error(`Failed to store similarity result for ${requestId}:`, storeError);
        // As a fallback, include the data directly if Redis storage fails
        result.data = similarityResult as any;
      }
      
      if (!result.data) {
        result.data = { resultKey };
      }

      this.logger.log(`Advanced similarity analysis completed successfully in ${Date.now() - startTime}ms. Mode: ${mode}`);
      return result;

    } catch (error) {
      this.logger.error(`Similarity analysis failed for requestId ${requestId}: ${getErrorMessage(error)}`);
      
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

  private buildResultKey(requestId: string) {
    return `similarity:result:${requestId}`;
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
          // BullMQ handles progress - bridge picks it up automatically

          return { walletAddress, status: 'completed' };

        } catch (error) {
          this.logger.error(`Deep sync failed for wallet ${walletAddress}: ${getErrorMessage(error)}`);
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
   * Detects and filters system wallets using the centralized SystemWalletDetectionService.
   *
   * Thresholds:
   * - 15k-70k tokens: LARGE (processed with warning)
   * - 70k+ tokens: SYSTEM (skipped entirely)
   *
   * The service handles 3-tier caching (memory → Redis → database) and dynamic RPC detection.
   */
  private async detectSystemWalletsEarly(walletAddresses: string[]): Promise<{
    validWallets: string[];
    systemWallets: string[];
    tokenCounts: Record<string, number>;
  }> {
    this.logger.log(`🔍 System wallet detection: Using SystemWalletDetectionService (thresholds: 15k LARGE, 70k SYSTEM)`);

    const excludedByRegistry = new Map<string, string>();
    const knownAllowed: string[] = [];
    const unknownWallets: string[] = [];

    for (const address of walletAddresses) {
      const knownEntry = getKnownWallet(address);
      if (!knownEntry) {
        unknownWallets.push(address);
        continue;
      }
      if (EXCLUDE_FROM_SIMILARITY.has(knownEntry.type)) {
        excludedByRegistry.set(address, `Known wallet: ${knownEntry.shortLabel} (${knownEntry.type})`);
      } else {
        knownAllowed.push(address);
      }
    }

    const { valid, filtered, largeWallets, filteredDetails } = await this.systemWalletDetection.filterSystemWallets(unknownWallets);
    const validWallets = [...knownAllowed, ...valid];

    // 🎯 CRITICAL FIX: Extract token counts from detection results
    // This allows balance fetcher to skip whale wallets BEFORE fetching
    const tokenCounts: Record<string, number> = {};
    for (const [address, detection] of filteredDetails.entries()) {
      if (detection.tokenCount !== undefined) {
        tokenCounts[address] = detection.tokenCount;
      }
    }

    if (excludedByRegistry.size > 0) {
      this.logger.warn(`dYs? Filtered ${excludedByRegistry.size} known wallet(s) via registry for similarity analysis`);
      for (const [address, reason] of excludedByRegistry) {
        this.logger.debug(`  - ${address}: ${reason}`);
      }
    }

    if (filtered.size > 0) {
      this.logger.warn(`🚫 Filtered ${filtered.size} system wallet(s) from similarity analysis`);
      for (const [address, reason] of filtered) {
        this.logger.debug(`  - ${address}: ${reason}`);
      }
    }

    if (largeWallets.length > 0) {
      this.logger.log(`⚠️ Processing ${largeWallets.length} large wallet(s) (15k-70k tokens)`);
    }

    this.logger.log(`System wallet detection complete: ${validWallets.length} valid wallets, ${filtered.size + excludedByRegistry.size} wallets filtered`);
    if (Object.keys(tokenCounts).length > 0) {
      this.logger.debug(`Token counts extracted for ${Object.keys(tokenCounts).length} wallets (will guide balance fetching)`);
    }

    return {
      validWallets: validWallets,
      systemWallets: [...Array.from(excludedByRegistry.keys()), ...Array.from(filtered.keys())],
      tokenCounts: tokenCounts,
    };
  }

  /**
   * Shutdown the worker gracefully
   */
  async shutdown(): Promise<void> {
    this.logger.log('Shutting down SimilarityOperationsProcessor worker...');
    await this.worker.close();
  }

  /**
   * Cleanup worker when module is destroyed
   */
  async onModuleDestroy() {
    try {
      await this.shutdown();
    } catch (err) {
      this.logger.warn(`Error shutting down SimilarityOperationsProcessor worker: ${getErrorMessage(err)}`);
    }
  }


} 
