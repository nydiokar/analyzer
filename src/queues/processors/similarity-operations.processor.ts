import { Injectable, Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
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
import { EnrichmentOperationsProcessor } from './enrichment-operations.processor';
import { EnrichmentOperationsQueue } from '../queues/enrichment-operations.queue';
import { JobProgressGateway } from '../../api/websocket/job-progress.gateway';
import { BalanceCacheService } from '../../core/services/balance-cache.service';

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
    private readonly enrichmentProcessor: EnrichmentOperationsProcessor,
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
    private readonly websocketGateway: JobProgressGateway,
    private readonly balanceCacheService: BalanceCacheService,
  ) {
    // Initialize WalletBalanceService
    this.walletBalanceService = new WalletBalanceService(this.heliusApiClient, this.tokenInfoService);
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
        return this.processSimilarityFlow(job as Job<ComprehensiveSimilarityFlowData>);
      default:
        throw new Error(`Unknown job type: ${jobName}`);
    }
  }

  /**
   * Process the similarity analysis flow: run a full historical sync and enrichment in parallel.
   * This is the true "Advanced Analysis" flow.
   */
  async processSimilarityFlow(job: Job<ComprehensiveSimilarityFlowData>): Promise<SimilarityFlowResult> {
    const { walletAddresses, requestId, walletsNeedingSync = [], enrichMetadata = false, failureThreshold = 0.8, timeoutMinutes = 45, similarityConfig } = job.data;
    
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
      this.checkTimeout(startTime, timeoutMs, 'Analysis initialization');
      
      // STEP 1: PARALLEL I/O KICK-OFF
      let balancesMap: Map<string, any>;
      
      if (syncRequired) {
        this.logger.log('Kicking off deep sync and balance fetch in parallel.');
        this.logger.log(`Syncing ${walletsNeedingSync.length}/${walletAddresses.length} wallets: ${walletsNeedingSync.join(', ')}`);
        
        const [syncSettlement, balancesSettlement] = await Promise.allSettled([
          this._orchestrateDeepSync(walletsNeedingSync, job), // Only sync wallets that need it
          this.walletBalanceService.fetchWalletBalancesRaw(walletAddresses) // Fetch all balances
        ]);

        // Critical Path Failure Handling
        if (syncSettlement.status === 'rejected') {
          this.logger.error('Critical failure during historical sync:', syncSettlement.reason);
          throw new Error(`Critical failure during historical sync: ${syncSettlement.reason}`);
        }
        if (balancesSettlement.status === 'rejected') {
          this.logger.error('Critical failure during balance fetching:', balancesSettlement.reason);
          throw new Error(`Critical failure during balance fetching: ${balancesSettlement.reason}`);
        }
        balancesMap = balancesSettlement.value;
      } else {
        this.logger.log('Skipping deep sync, fetching current balances only.');
        balancesMap = await this.walletBalanceService.fetchWalletBalancesRaw(walletAddresses);
      }
      
      this.logger.log('Deep sync and balance fetch complete. DB is ready.');
      await job.updateProgress(60); // Progress checkpoint after the slowest parts
      this.checkTimeout(startTime, timeoutMs, 'Data sync and balance fetch');

      // STEP 2: FINAL ANALYSIS (Raw balances, enrichment will be handled by job queue)
      this.logger.log('Starting final similarity calculation with raw balances...');
      const similarityResult = await this.similarityApiService.runAnalysis({
        walletAddresses: walletAddresses,
        vectorType: similarityConfig?.vectorType || 'capital'
      }, balancesMap);
      
      await job.updateProgress(90);
      this.checkTimeout(startTime, timeoutMs, 'Final analysis');

      // STEP 3: PREPARE RESULTS (Raw balances, enrichment will run in background)
      const finalResult = similarityResult;
      
      // Convert balances map to the format expected by the result
      const rawBalances: Record<string, any> = {};
      for (const [walletAddress, balanceData] of balancesMap) {
        rawBalances[walletAddress] = balanceData;
      }
      finalResult.walletBalances = rawBalances;
      
      this.logger.log('Similarity analysis completed successfully with raw balances.');

      await job.updateProgress(100);
      this.checkTimeout(startTime, timeoutMs, 'Final result preparation');

      // STEP 4: CACHE BALANCES FOR PARALLEL PROCESSING
      this.logger.log('Caching balances for parallel processing...');
      for (const [walletAddress, balanceData] of balancesMap) {
        await this.balanceCacheService.cacheBalances(walletAddress, balanceData);
      }

      const result: SimilarityFlowResult = {
        success: true,
        data: finalResult,
        requestId: requestId,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime,
        metadata: {
          requestedWallets: walletAddresses.length,
          processedWallets: walletAddresses.length,
          failedWallets: 0,
          successRate: 1.0,
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
   */
  private async _orchestrateDeepSync(walletAddresses: string[], job: Job): Promise<void> {
    if (walletAddresses.length === 0) {
      this.logger.log('No wallets need sync - skipping deep sync operation.');
      return;
    }
    
    this.logger.log(`Orchestrating deep sync for ${walletAddresses.length} wallets...`);
    // This part of the flow will account for up to 55% of the progress bar (5% to 60%).
    const progressStep = 55 / walletAddresses.length;
    let currentProgress = 5;

    // Process each wallet's full sync pipeline in parallel.
    await Promise.all(
      walletAddresses.map(async (walletAddress) => {
        try {
          const syncOptions: SyncOptions = { 
            fetchAll: true, 
            smartFetch: true, 
            maxSignatures: 2000,
            limit: 1000,
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
          await job.updateProgress(Math.floor(currentProgress));

        } catch (error) {
          this.logger.error(`Deep sync failed for wallet ${walletAddress}`, error);
          // We throw to ensure the entire job fails if one wallet cannot be synced,
          // guaranteeing data integrity for the final similarity analysis.
          throw new Error(`Failed to sync and analyze wallet: ${walletAddress}`);
        }
      })
    );

    this.logger.log('All wallets have completed the deep sync process.');
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