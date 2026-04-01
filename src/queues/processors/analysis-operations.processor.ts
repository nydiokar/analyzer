import { Injectable, Logger, OnModuleDestroy, Inject } from '@nestjs/common';
import { Job, Worker, UnrecoverableError } from 'bullmq';
import { QueueNames, QueueConfigs, JobTimeouts, JobPriority } from '../config/queue.config';
import { AnalyzePnlJobData, AnalyzeBehaviorJobData, DashboardWalletAnalysisJobData, AnalysisResult, AnalyzeHolderProfilesJobData, HolderProfilesResult, HolderProfile, SigBuyersJobData } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
import { buildHolderProfilesJobId } from '../utils/holder-profiles-job-id';
import { BatchProcessor, BatchResult } from '../utils/batch-processor';
import { RedisLockService } from '../services/redis-lock.service';
import { PnlAnalysisService } from '../../api/services/pnl-analysis.service';
import { BehaviorService } from '../../api/services/behavior.service';
import { DatabaseService } from '../../api/services/database.service';
import { BehaviorAnalysisConfig } from '../../types/analysis';
import { HeliusSyncService } from '../../core/services/helius-sync-service';
import { EnrichmentOperationsQueue } from '../queues/enrichment-operations.queue';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { WalletBalanceService } from '../../core/services/wallet-balance-service';
import { SyncOptions } from '../../core/services/helius-sync-service';
import { ANALYSIS_EXECUTION_CONFIG, DASHBOARD_ANALYSIS_SCOPE_DEFAULTS, DASHBOARD_JOB_CONFIG } from '../../config/constants';
import { TokenInfoService } from '../../api/services/token-info.service';
import { TokenHoldersService, HolderWithLabel } from '../../api/services/token-holders.service';
import { HolderProfilesCacheService } from '../../api/services/holder-profiles-cache.service';
import { WalletHudService } from '../../api/services/wallet-hud.service';
import { SystemWalletDetectionService } from '../../api/services/system-wallet-detection.service';
import { CreditsService } from '../../api/services/credits.service';
import { SKIP_BEHAVIOR_ANALYSIS, SKIP_PNL_CALCULATION, getKnownWallet } from '../../config/known-wallets';
import type { KnownWalletType } from '../../config/known-wallets';
import { runMintParticipantsFlow } from '../../core/flows/mint-participants';
import { SigBuyersService } from '../../api/services/sig-buyers.service';
import { TelegramAlertsService } from '../../api/services/telegram-alerts.service';
import { AnalysisOperationsQueue } from '../queues/analysis-operations.queue';
import { SimilarityOperationsQueue } from '../queues/similarity-operations.queue';
import { DashboardAnalysisScope, DashboardAnalysisTriggerSource } from '../../shared/dashboard-analysis.types';
import { BalanceCacheService } from '../../api/services/balance-cache.service';
import { WalletBalance } from '../../types/wallet';
import { MetricsService } from '../../api/services/metrics.service';
import { MarketContextService } from '../../api/services/market-context.service';
import { getErrorMessage } from 'core/utils/error-utils';
import { REDIS_CLIENT } from '../config/redis.provider';
import Redis from 'ioredis';

@Injectable()
export class AnalysisOperationsProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(AnalysisOperationsProcessor.name);
  private readonly worker: Worker;

  constructor(
    private readonly redisLockService: RedisLockService,
    private readonly pnlAnalysisService: PnlAnalysisService,
    private readonly behaviorService: BehaviorService,
    private readonly databaseService: DatabaseService,
    private readonly heliusSyncService: HeliusSyncService,
    private readonly analysisQueueService: AnalysisOperationsQueue,
    private readonly similarityOperationsQueue: SimilarityOperationsQueue,
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
    private readonly heliusApiClient: HeliusApiClient,
    private readonly tokenInfoService: TokenInfoService,
    private readonly tokenHoldersService: TokenHoldersService,
    private readonly holderProfilesCacheService: HolderProfilesCacheService,
    private readonly walletHudService: WalletHudService,
    private readonly telegramAlerts: TelegramAlertsService,
    private readonly balanceCacheService: BalanceCacheService,
    private readonly systemWalletDetection: SystemWalletDetectionService,
    private readonly creditsService: CreditsService,
    private readonly metricsService: MetricsService,
    private readonly marketContextService: MarketContextService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis,
    private readonly sigBuyersService: SigBuyersService,
  ) {
    const config = QueueConfigs[QueueNames.ANALYSIS_OPERATIONS];
    
    this.worker = new Worker(
      QueueNames.ANALYSIS_OPERATIONS,
      async (job: Job) => this.processJob(job),
      config.workerOptions
    );

    this.worker.on('completed', (job) => {
      // this.logger.debug(`Job ${job.id} from queue ${job.queueName} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      if (err instanceof UnrecoverableError) {
        this.logger.warn(`Job ${job?.id} from queue ${job?.queueName} failed: ${err.message}`);
      } else {
        this.logger.error(`Job ${job?.id} from queue ${job?.queueName} failed: ${getErrorMessage(err)}`);
      }
    });

    this.worker.on('error', (err) => {
      this.logger.error(`Worker error in AnalysisOperationsProcessor: ${getErrorMessage(err)}`);
    });

    this.logger.debug('AnalysisOperationsProcessor has been initialized');
  }

  private async processJob(job: Job): Promise<any> {
    const jobName = job.name;
    this.logger.debug(`Processing job '${jobName}' with ID ${job.id}`);
    
    switch (jobName) {
      case 'analyze-pnl':
        return this.processAnalyzePnl(job as Job<AnalyzePnlJobData>);
      case 'analyze-behavior':
        return this.processAnalyzeBehavior(job as Job<AnalyzeBehaviorJobData>);
      case 'dashboard-wallet-analysis':
        return this.processDashboardWalletAnalysis(job as Job<DashboardWalletAnalysisJobData>);
      case 'analyze-holder-profiles':
        return this.processAnalyzeHolderProfilesWithMetrics(job as Job<AnalyzeHolderProfilesJobData>);
      case 'mint-participants-run':
        return this.processMintParticipants(job as Job<{ mint: string; cutoffTs: number; signature?: string }>);
      case 'sig-buyers-run':
        return this.processSigBuyers(job as Job<SigBuyersJobData>);
      default:
        this.logger.error(`Unknown job name: ${jobName} for job ID ${job.id}`);
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
    const metricsStartTime = Date.now();
    
    // Deduplication check
    const expectedJobId = generateJobId.analyzePnl(walletAddress, requestId);
    if (job.id !== expectedJobId) {
      this.logger.warn(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
      throw new Error(`Job ID mismatch - possible duplicate`);
    }

    // Acquire lock
    const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'pnl');
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);

    if (!lockAcquired) {
      // 🚨 FAIL FAST: Prevent retry storms
      const lockOwner = await this.redisLockService.getLockValue(lockKey);
      const ttl = await this.redisLockService.getLockTTL(lockKey);

      // 📊 Track lock contention metrics
      this.metricsService.lockContentionTotal.inc({ lock_type: 'pnl', resource: 'wallet' });

      this.logger.warn(
        `❌ Cannot acquire lock for PnL analysis on ${walletAddress}. ` +
        `Locked by: ${lockOwner}, TTL: ${Math.max(0, ttl)}ms. Job ${job.id} FAILED (no retry).`
      );
      throw new UnrecoverableError(
        `PnL analysis already in progress for wallet ${walletAddress} (locked by: ${lockOwner})`
      );
    }

    try {
      await job.updateProgress(5);
      this.logger.debug(`Starting PnL analysis for ${walletAddress}`);

      // 🚨 EARLY DETECTION: Skip expensive operations for system wallets
      this.logger.debug(`Checking if ${walletAddress} is a system wallet...`);
      const detection = await this.systemWalletDetection.detectSystemWallet(walletAddress);

      if (detection.knownType && SKIP_PNL_CALCULATION.has(detection.knownType)) {
        this.logger.log(
          `⏭️ Skipping PnL analysis for known wallet ${walletAddress} ` +
          `(${detection.knownType}: ${detection.knownLabel || 'N/A'})`
        );

        await job.updateProgress(100);

        return {
          success: true,
          walletAddress,
          analysisType: 'pnl',
          timestamp: Date.now(),
          processingTimeMs: Date.now() - startTime,
          analysisSkipped: true,
          skipReason: `Known wallet type: ${detection.knownType}`,
          knownType: detection.knownType,
          knownLabel: detection.knownLabel,
        };
      }

      this.logger.debug(`${walletAddress} is not a system wallet, proceeding with PnL analysis`);

      // Idempotency check
      if (!forceRefresh) {
        const wallet = await this.databaseService.getWallet(walletAddress);
        const lastAnalysisAge = wallet?.analyzedTimestampEnd
          ? Date.now() - wallet.analyzedTimestampEnd * 1000
          : Infinity;

        if (lastAnalysisAge < 10 * 60 * 1000) { // 10 minutes idempotency threshold
          await job.updateProgress(100);
          this.logger.log(`Skipping PnL analysis for ${walletAddress} as recent data exists.`);
          return { success: true, walletAddress, analysisType: 'pnl', timestamp: Date.now(), processingTimeMs: Date.now() - startTime };
        }
      }

      // Execute analysis
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
        resultId: pnlResult.runId?.toString(),
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };

      // 🔄 Invalidate HUD cache for this wallet (PNL metrics updated)
      // PRAGMATIC: Invalidation at processor level until we have event-driven architecture
      // TODO: Refactor to event-driven pattern (emit 'wallet.pnl.updated' event, WalletHudService subscribes)
      await this.walletHudService.invalidateCache(walletAddress);

      this.logger.log(`PnL analysis completed for ${walletAddress}. RunId: ${pnlResult.runId}`);

      // Track successful job completion
      this.metricsService.analysisJobsTotal.labels('pnl', 'success').inc();
      this.metricsService.analysisJobDuration.labels('pnl').observe((Date.now() - metricsStartTime) / 1000);

      return result;

    } catch (error) {
      this.logger.error(`PnL analysis failed for ${walletAddress}: ${getErrorMessage(error)}`);

      // Track failed job
      this.metricsService.analysisJobsTotal.labels('pnl', 'failed').inc();
      this.metricsService.analysisJobDuration.labels('pnl').observe((Date.now() - metricsStartTime) / 1000);

      throw error;
    } finally {
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
    const metricsStartTime = Date.now();
    
    // Deduplication check
    const expectedJobId = generateJobId.analyzeBehavior(walletAddress, requestId);
    if (job.id !== expectedJobId) {
      this.logger.warn(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
      throw new Error(`Job ID mismatch - possible duplicate`);
    }

    // Acquire lock
    const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'behavior');
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);

    if (!lockAcquired) {
      // 🚨 FAIL FAST: Prevent retry storms
      const lockOwner = await this.redisLockService.getLockValue(lockKey);
      const ttl = await this.redisLockService.getLockTTL(lockKey);

      // 📊 Track lock contention metrics
      this.metricsService.lockContentionTotal.inc({ lock_type: 'behavior', resource: 'wallet' });

      this.logger.warn(
        `❌ Cannot acquire lock for behavior analysis on ${walletAddress}. ` +
        `Locked by: ${lockOwner}, TTL: ${Math.max(0, ttl)}ms. Job ${job.id} FAILED (no retry).`
      );
      throw new UnrecoverableError(
        `Behavior analysis already in progress for wallet ${walletAddress} (locked by: ${lockOwner})`
      );
    }

    try {
      await job.updateProgress(5);
      this.logger.debug(`Starting behavior analysis for ${walletAddress}`);

      // 🚨 EARLY DETECTION: Skip expensive operations for system wallets
      this.logger.debug(`Checking if ${walletAddress} is a system wallet...`);
      const detection = await this.systemWalletDetection.detectSystemWallet(walletAddress);

      if (detection.knownType && SKIP_BEHAVIOR_ANALYSIS.has(detection.knownType)) {
        this.logger.log(
          `⏭️ Skipping behavior analysis for known wallet ${walletAddress} ` +
          `(${detection.knownType}: ${detection.knownLabel || 'N/A'})`
        );

        await job.updateProgress(100);

        return {
          success: true,
          walletAddress,
          analysisType: 'behavior',
          timestamp: Date.now(),
          processingTimeMs: Date.now() - startTime,
          analysisSkipped: true,
          skipReason: `Known wallet type: ${detection.knownType}`,
          knownType: detection.knownType,
          knownLabel: detection.knownLabel,
        };
      }

      this.logger.debug(`${walletAddress} is not a system wallet, proceeding with behavior analysis`);

      // Execute analysis
      await job.updateProgress(20);
      this.checkTimeout(startTime, timeoutMs, 'Starting behavior analysis');

      const behaviorConfig: BehaviorAnalysisConfig = config ? {
        timeRange: config.timeRange ? {
          startTs: config.timeRange.from ? Math.floor(config.timeRange.from.getTime() / 1000) : undefined,
          endTs: config.timeRange.to ? Math.floor(config.timeRange.to.getTime() / 1000) : undefined
        } : undefined,
        excludedMints: config.excludeMints || []
      } : this.behaviorService.getDefaultBehaviorAnalysisConfig();

      const timeRange = behaviorConfig.timeRange;

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

      // 🔄 Invalidate caches for this wallet (behavioral metrics + HUD updated)
      // PRAGMATIC: Invalidation at processor level until we have event-driven architecture
      // TODO: Refactor to event-driven pattern (emit 'wallet.behavior.updated' event, services subscribe)
      await Promise.all([
        this.holderProfilesCacheService.invalidateForWallet(walletAddress),
        this.walletHudService.invalidateCache(walletAddress),
      ]);

      this.logger.log(`Behavior analysis completed for ${walletAddress}`);

      // Track successful job completion
      this.metricsService.analysisJobsTotal.labels('behavior', 'success').inc();
      this.metricsService.analysisJobDuration.labels('behavior').observe((Date.now() - metricsStartTime) / 1000);

      return result;

    } catch (error) {
      this.logger.error(`Behavior analysis failed for ${walletAddress}: ${getErrorMessage(error)}`);

      // Track failed job
      this.metricsService.analysisJobsTotal.labels('behavior', 'failed').inc();
      this.metricsService.analysisJobDuration.labels('behavior').observe((Date.now() - metricsStartTime) / 1000);

      throw error;
    } finally {
      await this.redisLockService.releaseLock(lockKey, job.id!);
    }
  }

  /**
   * Process dashboard wallet analysis job using direct service calls
   * Implements comprehensive wallet analysis with sync, PNL, and behavior analysis
   */
  async processDashboardWalletAnalysis(job: Job<DashboardWalletAnalysisJobData>): Promise<any> {
    const walletAddress = job.data.walletAddress;
    const scope: DashboardAnalysisScope = job.data.analysisScope ?? 'deep';
    const triggerSource: DashboardAnalysisTriggerSource = job.data.triggerSource ?? 'manual';
    const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS[scope];

    if (!scopeDefaults) {
      throw new Error(`Unsupported dashboard analysis scope '${scope}'`);
    }

    const effectiveHistoryWindowDays =
      scope === 'deep' ? undefined : job.data.historyWindowDays ?? scopeDefaults.historyWindowDays ?? 7;

    const targetSignatureBaseline =
      job.data.targetSignatureCount ??
      scopeDefaults.targetSignatureCount ??
      ANALYSIS_EXECUTION_CONFIG.DASHBOARD_MAX_SIGNATURES;
    const effectiveTargetSignatures = Math.min(targetSignatureBaseline, ANALYSIS_EXECUTION_CONFIG.DASHBOARD_MAX_SIGNATURES);

    const effectiveTimeoutMinutes =
      job.data.timeoutMinutes ?? scopeDefaults.timeoutMinutes ?? DASHBOARD_JOB_CONFIG.DEFAULT_TIMEOUT_MINUTES;
    const timeoutMs = effectiveTimeoutMinutes * 60 * 1000;
    const startTime = Date.now();
    const metricsStartTime = Date.now();
    const enqueuedAtMs = typeof job.timestamp === 'number' ? job.timestamp : startTime;
    const queueWaitMs = Math.max(0, startTime - enqueuedAtMs);

    const expectedJobId = generateJobId.dashboardWalletAnalysis(walletAddress, job.data.requestId);
    if (job.id !== expectedJobId) {
      this.logger.warn(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
      throw new Error(`Job ID mismatch - possible duplicate`);
    }

    const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'dashboard-analysis');
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);

    if (!lockAcquired) {
      // 🚨 FAIL FAST: Lock acquisition failures are unrecoverable - don't retry
      // Retrying creates priority inversion and starves other jobs
      const lockOwner = await this.redisLockService.getLockValue(lockKey);
      const ttl = await this.redisLockService.getLockTTL(lockKey);

      // 📊 Track lock contention metrics
      this.metricsService.lockContentionTotal.inc({ lock_type: 'dashboard', resource: 'wallet' });

      this.logger.warn(
        `❌ Cannot acquire lock for dashboard analysis on ${walletAddress} [scope=${scope}]. ` +
        `Lock held by job: ${lockOwner}, TTL: ${Math.max(0, ttl)}ms. ` +
        `Job ${job.id} FAILED (no retry - preventing retry storm).`,
      );

      // UnrecoverableError prevents BullMQ from retrying this job
      throw new UnrecoverableError(
        `Dashboard analysis already in progress for wallet ${walletAddress} ` +
        `(locked by: ${lockOwner}, TTL: ${Math.max(0, ttl)}ms). ` +
        `Please wait for the current analysis to complete.`
      );
    }

    let enrichmentJob: Job | undefined;
    const followUpJobsQueued: Array<{ scope: DashboardAnalysisScope; jobId: string }> = [];

    // Dashboard scopes (flash/working/deep) are progressive all-time snapshots, NOT time windows.
    // They differ only in depth (targetSignatureCount: 250/2000/3000), not time filtering.
    //
    // CRITICAL: Do NOT set timeRange for dashboard scopes to avoid incorrectly triggering
    // "historical view" mode in PnL service, which would skip persistence and corrupt FIFO lots.
    //
    // The historyWindowDays config is just a heuristic hint for pagination, but analysis should
    // always process ALL fetched transactions to maintain cumulative FIFO lot state.
    const timeRange = undefined;

    try {
      await job.updateProgress(5);
      this.logger.log(
        `Starting dashboard analysis for wallet ${walletAddress} [scope=${scope}, trigger=${triggerSource}]`,
      );

      // 🚨 EARLY DETECTION: Defense Layer 1 - Entry Point Filtering
      //
      // Why: Prevents queueing expensive jobs (sync, PnL, behavior) for system wallets
      // How: Uses 3-tier detection (memory → Redis → DB → RPC)
      //      - Registry wallets: O(1) instant lookup
      //      - Previously tagged: Cached in Redis/memory
      //      - Unknown wallets: RPC call to count tokens (slow, but ONE TIME)
      //
      // If knownType exists (registry OR 70k+ tokens detected), skip ALL analysis
      // because dashboard does both PnL + behavior. Detection result is cached
      // for future requests, so RPC call only happens ONCE per wallet.
      this.logger.debug(`Checking if ${walletAddress} is a system wallet...`);
      const detection = await this.systemWalletDetection.detectSystemWallet(walletAddress);

      if (detection.shouldSkipAnalysis) {
        this.logger.log(
          `⏭️ Skipping dashboard analysis for known wallet ${walletAddress} ` +
          `(${detection.knownType}: ${detection.knownLabel || 'N/A'})`
        );

        // Return stub result with wallet info for UI display (includes badge labels)
        return {
          walletAddress,
          scope,
          requestId: job.data.requestId,
          knownType: detection.knownType,
          knownLabel: detection.knownLabel,
          analysisSkipped: true,
          skipReason: `Known wallet type: ${detection.knownType}`,
          pnl: {
            totalVolume: 0,
            totalFees: 0,
            realizedPnl: 0,
            unrealizedPnl: 0,
            netPnl: 0,
            stablecoinNetFlow: 0,
            averageSwapSize: 0,
            profitableTokensCount: 0,
            unprofitableTokensCount: 0,
            totalExecutedSwapsCount: 0,
            averageRealizedPnlPerExecutedSwap: 0,
            realizedPnlToTotalVolumeRatio: 0,
            results: [],
            totalSignaturesProcessed: 0,
            overallFirstTimestamp: 0,
            overallLastTimestamp: 0,
          },
          behavior: null,
          completedAt: new Date().toISOString(),
        };
      }

      this.logger.debug(`${walletAddress} is not a system wallet, proceeding with analysis`);

      await job.updateProgress(10);
      const walletStatuses = await this.databaseService.getWalletsStatus([walletAddress]);
      const needsSync =
        walletStatuses.statuses[0].status === 'STALE' ||
        walletStatuses.statuses[0].status === 'MISSING' ||
        job.data.forceRefresh;

      await job.updateProgress(15);
      const syncOptions: SyncOptions = {
        limit: 100,
        fetchAll: scope === 'deep' || needsSync || !!job.data.forceRefresh,
        skipApi: false,
        fetchOlder: scope !== 'flash',
        maxSignatures: effectiveTargetSignatures,
        smartFetch: true,
        onProgress: (progress) => {
          const syncProgress = 15 + Math.floor(progress * 0.3);
          job.updateProgress(Math.min(syncProgress, 40));
        },
      };

      this.logger.debug(
        `Syncing wallet data for ${walletAddress} [scope=${scope}, fetchOlder=${syncOptions.fetchOlder}, maxSignatures=${syncOptions.maxSignatures}]`,
      );
      await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
      await job.updateProgress(45);

      this.logger.debug(`Enriching market context for ${walletAddress} before downstream analysis...`);
      await this.marketContextService.enrichWallet(walletAddress, 500);
      await job.updateProgress(50);

      this.logger.debug(`Fetching balances for ${walletAddress}...`);
      
      // Try to get cached balances first (cache set by previous scope in this chain)
      let balanceData: Map<string, WalletBalance> | undefined;
      const cachedBalance = await this.balanceCacheService.getBalances(walletAddress);
      
      if (cachedBalance) {
        this.logger.debug(`Using cached balances for ${walletAddress} (saved ${scope} from API call)`);
        balanceData = new Map([[walletAddress, cachedBalance]]);
      } else {
        // Cache miss - fetch fresh and cache for follow-up scopes
        this.logger.debug(`Balance cache miss for ${walletAddress}, fetching from Helius`);
        const walletBalanceService = new WalletBalanceService(
          this.heliusApiClient,
          this.databaseService,
          this.tokenInfoService,
        );
        balanceData = await walletBalanceService.fetchWalletBalances([walletAddress], 'default', true);
        
        // Cache with 30-minute TTL for dashboard analysis chains (extended from 10 min)
        const fetchedBalance = balanceData?.get(walletAddress);
        if (fetchedBalance) {
          await this.balanceCacheService.cacheBalances(walletAddress, fetchedBalance, 1800); // ✅ Extended TTL
          this.logger.debug(`Cached balances for ${walletAddress} for follow-up scopes`);
        }
      }
      await job.updateProgress(55);

      // Fetch SOL price for unrealized PNL calculations (cached in Redis with 30s TTL)
      let solPriceUsd: number | undefined;
      try {
        solPriceUsd = await this.tokenInfoService.getSolPrice();
        // this.logger.log(`Fetched SOL price for PNL analysis: $${solPriceUsd}`);
      } catch (error) {
        // this.logger.warn(`Failed to fetch SOL price, unrealized PNL will not be calculated: ${getErrorMessage(error)}`);
      }
      if (!solPriceUsd || solPriceUsd <= 0) {
        try {
          const cachedSol = await this.tokenInfoService.getCachedSolPrice();
          if (cachedSol && cachedSol > 0) {
            solPriceUsd = cachedSol;
            this.logger.debug(`Using cached SOL price fallback for PNL analysis: $${solPriceUsd}`);
          } else {
            this.logger.warn('No cached SOL price available; unrealized PNL/SOL conversions will be skipped.');
          }
        } catch (fallbackError) {
          this.logger.warn(`Failed to read cached SOL price fallback: ${fallbackError}`);
        }
      }
      await job.updateProgress(60);

      this.logger.debug(`Running PNL analysis for ${walletAddress} [scope=${scope}]`);
      const pnlResult = await this.pnlAnalysisService.analyzeWalletPnl(walletAddress, timeRange, {
        preFetchedBalances: balanceData,
        solPriceUsd,
      });
      await job.updateProgress(78);

      this.logger.debug(`Running behavior analysis for ${walletAddress} [scope=${scope}]`);
      const behaviorConfig: BehaviorAnalysisConfig = {
        ...this.behaviorService.getDefaultBehaviorAnalysisConfig(),
        ...(timeRange ? { timeRange } : {}),
      };
      const behaviorResult = await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig, timeRange);
      await job.updateProgress(88);

      let enrichmentJobId: string | undefined;
      // Enrichment should run for ALL scopes - it's about data quality, not analysis depth
      // Whether we analyze 750 txs or 3000 txs, we still need token metadata for display
      const shouldEnrich = job.data.enrichMetadata ?? true;
      if (shouldEnrich) {
        await job.updateProgress(92);
        try {
          const allWalletTokens = await this.databaseService.getUniqueTokenAddressesFromAnalysisResults(walletAddress);

          if (allWalletTokens.length > 0) {
            const walletBalanceData = balanceData?.get(walletAddress);
            const allTokenBalances =
              walletBalanceData?.tokenBalances?.filter((tokenBalance) =>
                allWalletTokens.includes(tokenBalance.mint),
              ) || [];

            const tokensWithoutBalances = allWalletTokens.filter(
              (tokenAddress) => !allTokenBalances.some((tb) => tb.mint === tokenAddress),
            );

            const placeholderBalances = tokensWithoutBalances.map((tokenAddress) => ({
              mint: tokenAddress,
              uiBalance: 0,
              balance: '0',
            }));

            const allBalancesForEnrichment = [...allTokenBalances, ...placeholderBalances];

            this.logger.debug(
              `Queuing enrichment for ${allBalancesForEnrichment.length} mapped tokens (scope=${scope}) for wallet ${walletAddress}`,
            );

            const walletBalancesForEnrichment = {
              [walletAddress]: {
                tokenBalances: allBalancesForEnrichment.map((tokenBalance) => ({
                  mint: tokenBalance.mint,
                  uiBalance: tokenBalance.uiBalance,
                  balance: tokenBalance.balance,
                })),
              },
            };

            enrichmentJob = await this.enrichmentOperationsQueue.addEnrichTokenBalances({
              walletBalances: walletBalancesForEnrichment,
              userId: job.data.userId,
              requestId: job.data.requestId,
              priority: JobPriority.LOW,
              enrichmentContext: 'dashboard-analysis',
            });
            enrichmentJobId = enrichmentJob.id;
          } else {
            this.logger.debug(`No mapped tokens found for ${walletAddress}, skipping enrichment.`);
          }
        } catch (error) {
          this.logger.warn(
            `Failed to queue enrichment job for ${walletAddress} (scope=${scope}), continuing without it:`,
            error,
          );
        }
      }

      const signaturesConsidered = await this.databaseService.countSwapInputs(
        walletAddress,
        timeRange ? { sinceTs: timeRange.startTs, untilTs: timeRange.endTs } : {},
      );

      const processingTimeMs = Date.now() - startTime;

      // Record the analysis run BEFORE releasing lock
      await this.databaseService.recordDashboardAnalysisRun({
        walletAddress,
        scope,
        status: 'COMPLETED',
        triggerSource,
        runTimestamp: new Date(),
        durationMs: processingTimeMs,
        signaturesConsidered,
        inputDataStartTs: timeRange?.startTs,
        inputDataEndTs: timeRange?.endTs,
        historyWindowDays: effectiveHistoryWindowDays,
        notes: {
          queueWaitMs,
          queueEnqueuedAt: new Date(enqueuedAtMs).toISOString(),
          queueStartedAt: new Date(startTime).toISOString(),
          queueJobId: String(job.id),
          followUpRequested: { working: job.data.queueWorkingAfter, deep: job.data.queueDeepAfter },
          followUpQueued: [], // Will be updated after queueing
        },
      });

      await job.updateProgress(100);

      // ✅ CRITICAL: Release lock BEFORE queuing follow-ups
      // This prevents lock contention when follow-up jobs start immediately
      await this.redisLockService.releaseLock(lockKey, job.id!);
      this.logger.debug(`Released lock for ${walletAddress} [scope=${scope}] before queueing follow-ups`);

      // Now queue follow-ups - they can acquire the lock immediately
      if (scope === 'flash' && job.data.queueWorkingAfter) {
        const queuedJobId = await this.queueFollowUpAnalysis({
          walletAddress,
          scope: 'working',
          parentRequestId: job.data.requestId,
          forceRefresh: job.data.forceRefresh ?? false,
          userId: job.data.userId,
        });
        if (queuedJobId) {
          followUpJobsQueued.push({ scope: 'working', jobId: queuedJobId });
        }
      }

      if (scope !== 'deep' && job.data.queueDeepAfter) {
        const queuedJobId = await this.queueFollowUpAnalysis({
          walletAddress,
          scope: 'deep',
          parentRequestId: job.data.requestId,
          forceRefresh: job.data.forceRefresh ?? false,
          userId: job.data.userId,
        });
        if (queuedJobId) {
          followUpJobsQueued.push({ scope: 'deep', jobId: queuedJobId });
        }
      }

      // Clear balance cache after deep scope completes
      // This ensures the next refresh always fetches fresh balances from Helius
      // Without this, consecutive refreshes within 10 minutes would use stale cached balances
      if (scope === 'deep') {
        try {
          await this.balanceCacheService.clearCache(walletAddress);
          this.logger.debug(`Cleared balance cache for ${walletAddress} after deep scope completion`);
        } catch (error) {
          this.logger.warn(`Failed to clear balance cache for ${walletAddress}: ${getErrorMessage(error)}`);
          // Non-critical, don't fail the job
        }
      }

      const result = {
        success: true,
        walletAddress,
        pnlResult,
        behaviorResult,
        enrichmentJobId,
        analysisScope: scope,
        triggerSource,
        historyWindowDays: effectiveHistoryWindowDays ?? null,
        targetSignatureCount: effectiveTargetSignatures,
        signaturesConsidered,
        timeRange,
        followUpJobsQueued,
        queueWaitMs,
        timestamp: Date.now(),
        processingTimeMs,
      };

      this.logger.log(
        `✅ Dashboard analysis for ${walletAddress} [scope=${scope}] completed in ${processingTimeMs}ms. Follow-ups queued: ${
          followUpJobsQueued.map((f) => `${f.scope}:${f.jobId}`).join(',') || 'none'
        }`,
      );

      // 🔄 Invalidate HUD cache for this wallet (PNL + behavior metrics updated)
      // PRAGMATIC: Invalidation at processor level until we have event-driven architecture
      // TODO: Refactor to event-driven pattern (emit 'wallet.dashboard.completed' event, WalletHudService subscribes)
      await this.walletHudService.invalidateCache(walletAddress);

      // Note: JobEventsBridgeService automatically publishes completion events via BullMQ's 'completed' event
      // No need to manually publish here to avoid duplicate events
      // await this.jobProgressGateway.publishCompletedEvent(job.id!, 'analysis-operations', result, processingTimeMs);

      // Track successful job completion
      this.metricsService.analysisJobsTotal.labels('dashboard', 'success').inc();
      this.metricsService.analysisJobDuration.labels('dashboard').observe((Date.now() - metricsStartTime) / 1000);

      return result;
    } catch (error) {
      this.logger.error(`Dashboard analysis for ${walletAddress} [scope=${scope}] failed: ${getErrorMessage(error)}`);

      // Track failed job
      this.metricsService.analysisJobsTotal.labels('dashboard', 'failed').inc();
      this.metricsService.analysisJobDuration.labels('dashboard').observe((Date.now() - metricsStartTime) / 1000);

      await this.databaseService.recordDashboardAnalysisRun({
        walletAddress,
        scope,
        status: 'FAILED',
        triggerSource,
        runTimestamp: new Date(),
        notes: {
          error: error instanceof Error ? error.message : 'unknown-error',
          queueWaitMs,
          queueEnqueuedAt: new Date(enqueuedAtMs).toISOString(),
          queueStartedAt: new Date(startTime).toISOString(),
          queueJobId: String(job.id),
        },
      });

      if (enrichmentJob) {
        try {
          this.logger.log(`Cancelling enrichment job ${enrichmentJob.id} due to main analysis failure.`);
          await enrichmentJob.remove();
        } catch (cancelError) {
          this.logger.warn(`Failed to cancel enrichment job ${enrichmentJob.id}:`, cancelError);
        }
      }

      // Release lock before throwing error
      await this.redisLockService.releaseLock(lockKey, job.id!);
      throw error;
    }
    // No finally block - lock is released in both success and error paths
  }

  private async queueFollowUpAnalysis(params: {
    walletAddress: string;
    scope: DashboardAnalysisScope;
    parentRequestId: string;
    forceRefresh: boolean;
    userId?: string;
  }): Promise<string | null> {
    if (params.scope === 'flash') {
      return null;
    }

    const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS[params.scope];
    if (!scopeDefaults) {
      return null;
    }

    const latestRun = await this.databaseService.getLatestDashboardAnalysisRun(params.walletAddress, params.scope);
    if (latestRun && scopeDefaults.freshnessMinutes) {
      const ageMinutes = (Date.now() - new Date(latestRun.runTimestamp).getTime()) / 60000;
      if (ageMinutes < scopeDefaults.freshnessMinutes) {
        this.logger.debug(
          `Skipping follow-up ${params.scope} analysis for ${params.walletAddress} — fresh within ${scopeDefaults.freshnessMinutes}m`,
        );
        return null;
      }
    }

    const requestId = `${params.parentRequestId}-${params.scope}-${Math.random().toString(36).slice(2, 8)}`;
    const historyWindowDays = params.scope === 'deep' ? undefined : scopeDefaults.historyWindowDays;
    const targetSignatureCount = scopeDefaults.targetSignatureCount;

    const priority =
      params.scope === 'working'
        ? JobPriority.HIGH
        : params.scope === 'deep'
          ? JobPriority.NORMAL
          : JobPriority.CRITICAL;

    const jobData: DashboardWalletAnalysisJobData = {
      walletAddress: params.walletAddress,
      userId: params.userId,
      requestId,
      analysisScope: params.scope,
      triggerSource: 'system',
      historyWindowDays,
      targetSignatureCount,
      forceRefresh: params.forceRefresh,
      enrichMetadata: params.scope === 'deep',
      queueWorkingAfter: false,
      queueDeepAfter: params.scope === 'working',
      failureThreshold: 0.8,
      timeoutMinutes: scopeDefaults.timeoutMinutes ?? DASHBOARD_JOB_CONFIG.DEFAULT_TIMEOUT_MINUTES,
    };

    const job = await this.analysisQueueService.addDashboardWalletAnalysisJob(jobData, {
      priority,
      delay: 0,
    });

    this.logger.debug(
      `Queued follow-up ${params.scope} analysis job ${job.id} for wallet ${params.walletAddress} (parent=${params.parentRequestId})`,
    );

    return job.id ?? null;
  }

  // TTL for holder-profiles results stored in Redis (matches similarity job TTL).
  private readonly holderProfilesResultTtlSeconds = 15 * 60; // 15 minutes

  /**
   * Wrapper for holder profiles with metrics tracking.
   *
   * Mirrors the similarity pointer pattern:
   * - Stores the full HolderProfilesResult in Redis under `holder-profiles:result:{jobId}`
   * - Returns only { resultKey, success, metadata } as BullMQ returnvalue (~200 bytes)
   * - Frontend hydrates via GET /jobs/result/by-key?key=... (1 Redis read, no BullMQ lookup)
   *
   * This prevents blasting ~50-200KB through BullMQ Redis → bridge → pub/sub → WebSocket.
   * Progressive streaming (job.updateProgress) continues unchanged.
   */
  private async processAnalyzeHolderProfilesWithMetrics(job: Job<AnalyzeHolderProfilesJobData>): Promise<object> {
    const metricsStartTime = Date.now();
    try {
      const result = await this.processAnalyzeHolderProfiles(job);
      const isInternalHolderProfilesRequest =
        typeof job.data.requestId === 'string' && job.data.requestId.startsWith('holder-profiles-');

      if (
        isInternalHolderProfilesRequest &&
        result.mode === 'token' &&
        result.metadata.cacheOnly === true &&
        job.data.userId
      ) {
        try {
          await this.creditsService.topUp(
            job.data.userId,
            20,
            'refund:AnalysisOperationsProcessor.holderProfilesCacheOnly',
          );
          this.logger.log(`Refunded 20 credits for cache-only holder-profiles job ${job.id} (user=${job.data.userId})`);
        } catch (refundError) {
          this.logger.warn(
            `Failed to refund cache-only holder-profiles job ${job.id} for user ${job.data.userId}: ${getErrorMessage(refundError)}`,
          );
        }
      }

      // Track successful job completion
      this.metricsService.analysisJobsTotal.labels('holder-profiles', 'success').inc();
      this.metricsService.analysisJobDuration.labels('holder-profiles').observe((Date.now() - metricsStartTime) / 1000);

      // Store full payload in Redis; return only a lightweight pointer as BullMQ returnvalue.
      const resultKey = `holder-profiles:result:${job.id}`;
      try {
        await this.redisClient.set(resultKey, JSON.stringify(result), 'EX', this.holderProfilesResultTtlSeconds);
        this.logger.debug(`Stored holder-profiles result for job ${job.id} with TTL ${this.holderProfilesResultTtlSeconds}s`);

        // Chain similarity job if requested (INTEL-DEEP-BUG fix)
        if (job.data.chainSimilarity && job.data.chainSimilarityRequestId && result.mode === 'token' && result.success) {
          const walletAddresses = (result.profiles ?? [])
            .map((p: any) => p.walletAddress as string | undefined)
            .filter((addr): addr is string => !!addr && addr.length > 30);

          if (walletAddresses.length >= 2) {
            try {
              await this.similarityOperationsQueue.addSimilarityAnalysisFlow(
                {
                  walletAddresses,
                  userId: job.data.userId,
                  requestId: job.data.chainSimilarityRequestId,
                  walletsNeedingSync: [],
                  enrichMetadata: false,
                  includeBalances: false,
                  includeVectors: false,
                  failureThreshold: 0.8,
                  timeoutMinutes: 15,
                  skipIncrementalBalanceRefresh: true,
                  similarityConfig: { vectorType: 'capital' },
                },
                { priority: JobPriority.NORMAL, delay: 0 },
              );
              this.logger.log(`Chained similarity job queued for holder-profiles job ${job.id} (${walletAddresses.length} wallets, requestId=${job.data.chainSimilarityRequestId})`);
            } catch (chainError) {
              // Non-fatal — holder-profiles result is already stored; agent can fall back to POST /intel/wallets/similarity
              this.logger.error(`Failed to chain similarity job after holder-profiles ${job.id}: ${getErrorMessage(chainError)}`);
            }
          } else {
            this.logger.warn(`chainSimilarity requested for job ${job.id} but only ${walletAddresses.length} valid wallets found — skipping`);
          }
        }

        return {
          success: result.success,
          data: { resultKey },
          metadata: result.metadata,
          processingTimeMs: result.processingTimeMs,
          timestamp: result.timestamp,
        };
      } catch (storeError) {
        // Redis storage failed — fall back to returning full result (safe but large)
        this.logger.error(`Failed to store holder-profiles result in Redis for job ${job.id}:`, storeError);
        return result;
      }
    } catch (error) {
      // Track failed job
      this.metricsService.analysisJobsTotal.labels('holder-profiles', 'failed').inc();
      this.metricsService.analysisJobDuration.labels('holder-profiles').observe((Date.now() - metricsStartTime) / 1000);

      throw error;
    }
  }

  /**
   * Process holder profiles analysis job with progressive streaming architecture.
   *
   * ARCHITECTURE OVERVIEW:
   * =====================
   * This implements a tiered caching strategy with progressive loading:
   *
   * TIER 1 (Redis - HolderProfilesCacheService):
   *   - Caches complete HolderProfilesResult objects
   *   - TTL: 1 hour (hot cache for repeated requests)
   *   - Use case: Avoid re-querying DB for same token/topN within 1 hour
   *
   * TIER 2 (PostgreSQL - HolderProfileSnapshot table):
   *   - Persists individual HolderProfile records as JSON
   *   - TTL: Until wallet re-syncs (smart freshness check)
   *   - Use case: Instant streaming of cached profiles while analyzing stale ones
   *
   * PROGRESSIVE STREAMING FLOW:
   * ==========================
   * Example: Request top 10 holders of Token X
   *
   * 1. Check Redis cache → Cache miss (or expired after 1 hour)
   * 2. Query DB for all 10 wallet snapshots (batched)
   *    ├─ Found 7 fresh profiles (wallets analyzed today)
   *    └─ 3 wallets are stale/missing
   *
   * 3. IMMEDIATELY stream 7 cached profiles to frontend ⚡
   *    └─ User sees data in <1 second
   *
   * 4. Sync 3 stale wallets in background (parallel)
   *
   * 5. Analyze 3 stale wallets, save to DB, stream to frontend
   *    └─ User sees remaining 3 profiles after ~30 seconds
   *
   * FRESHNESS GUARANTEE:
   * ===================
   * Snapshot considered fresh if:
   *   - snapshot.computedAt >= wallet.lastSuccessfulFetchTimestamp (primary)
   *   - OR snapshot.computedAt within last hour (fallback)
   *
   * This ensures profiles are only reused when underlying wallet data unchanged.
   *
   * MEMORY EFFICIENCY:
   * =================
   * - Redis holds full results for 1 hour → Prevents pressure on frequent requests
   * - PostgreSQL persists individual profiles → Survives Redis eviction
   * - Wallets analyzed 7-8 hours ago can be served instantly from DB
   *
   * @param job - Job data containing mode ('token' | 'wallet'), tokenMint, topN, walletAddress
   * @returns HolderProfilesResult with profiles array and metadata
   */
  async processAnalyzeHolderProfiles(job: Job<AnalyzeHolderProfilesJobData>): Promise<HolderProfilesResult> {
    const { mode = 'token', tokenMint, topN = 10, walletAddress, requestId } = job.data;
    const startTime = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    const debugFailAfterProfiles = process.env.NODE_ENV !== 'production'
      ? job.data.debugFailAfterProfiles
      : undefined;
    const shouldDebugFailAfterProfiles = Number.isFinite(debugFailAfterProfiles) && (debugFailAfterProfiles as number) >= 0;
    let debugFailTriggered = false;

    /**
     * TOKEN MODE OVERVIEW (new orchestrator pattern)
     * -------------------------------------------------
     * 1. Check Redis cache (kept identical to legacy flow).
     * 2. Fetch top holders + token supply metadata -> build rank/supply map.
     * 3. Use Tier-2 cache (Postgres snapshots) exactly as before:
     *    - Fresh snapshots are hydrated + streamed immediately.
     *    - Stale wallets are queued as wallet-mode jobs which still perform their own
     *      sync + PnL/behavior analysis before caching and returning a single profile.
     * 4. BatchProcessor now emits per-job callbacks; every wallet completion streams to
     *    clients right away so UX stays progressive without the 60k-record memory load.
     * 5. Once tolerance criteria met, aggregate the cached wallet profiles, cache the
     *    combined token result, and emit the same final payload the frontend expects.
     */

    const expectedJobId = buildHolderProfilesJobId(job.data);
    if (job.id !== expectedJobId) {
      this.logger.warn(`Job ID mismatch: expected ${expectedJobId}, got ${job.id}`);
      throw new Error('Job ID mismatch - possible duplicate');
    }

    if (mode === 'wallet') {
      if (!walletAddress) {
        throw new Error('Wallet address required for wallet-mode holder profile analysis');
      }
      return this.processSingleHolderProfile(job, walletAddress, startTime, timeoutMs);
    }

    if (!tokenMint) {
      throw new Error('Token mint is required for token-mode holder profile analysis');
    }

    this.logger.log(`Starting token holder orchestration for ${tokenMint} [topN=${topN}]`);

    try {
      this.checkTimeout(startTime, timeoutMs, 'Starting holder profiles analysis');
      await job.updateProgress(5);

      this.logger.debug(`Fetching top ${topN} holders for ${tokenMint}...`);
      let topHoldersResponse = await this.holderProfilesCacheService.getCachedTopHolders(tokenMint);
      if (!topHoldersResponse) {
        try {
          topHoldersResponse = await this.tokenHoldersService.getTopHolders(tokenMint);
          await this.holderProfilesCacheService.cacheTopHolders(tokenMint, topHoldersResponse);
        } catch (error: any) {
          const message = String(error?.message || '').toLowerCase();
          if (message.includes('invalid token mint') || message.includes('not a token mint') || message.includes('invalid param')) {
            throw new UnrecoverableError(`Invalid token mint: ${tokenMint}`);
          }
          throw error;
        }
      }
      const topHolders = topHoldersResponse.holders.slice(0, topN);

      this.checkTimeout(startTime, timeoutMs, 'Fetching top holders');
      await job.updateProgress(10);

      const holderEntries = topHolders.filter((holder) => !!holder.ownerAccount);
      if (holderEntries.length === 0) {
        const processingTimeMs = Date.now() - startTime;
        await job.updateProgress(100);
        return {
          success: true,
          mode: 'token',
          tokenMint,
          profiles: [],
          metadata: {
            totalHoldersRequested: topN,
            totalHoldersAnalyzed: 0,
            totalProcessingTimeMs: processingTimeMs,
            avgProcessingTimePerWalletMs: 0,
            failedHolders: 0,
          },
          timestamp: Date.now(),
          processingTimeMs,
        };
      }

      this.logger.debug(`Fetching actual token supply for ${tokenMint}...`);
      let actualTotalSupply: number;
      try {
        const cachedSupply = await this.tokenInfoService.getTokenSupply(tokenMint);
        if (cachedSupply !== undefined) {
          actualTotalSupply = cachedSupply;
          this.logger.debug(`Token ${tokenMint} total supply (cached): ${actualTotalSupply}`);
        } else {
          this.logger.warn(`Failed to fetch token supply for ${tokenMint}, falling back to sum of holders`);
          actualTotalSupply = holderEntries.reduce((sum, h) => sum + (h.uiAmount || 0), 0);
        }
      } catch (supplyError) {
        this.logger.warn(`Error fetching token supply for ${tokenMint}, falling back to sum of holders:`, supplyError);
        actualTotalSupply = holderEntries.reduce((sum, h) => sum + (h.uiAmount || 0), 0);
      }

      this.checkTimeout(startTime, timeoutMs, 'Fetching token supply');

      let tokenPriceUsd: number | null = null;
      let solPriceUsd: number | null = null;
      try {
        const prices = await this.tokenInfoService.getTokenPrices([tokenMint]);
        tokenPriceUsd = prices.get(tokenMint) ?? null;
      } catch (priceError) {
        this.logger.warn(`Failed to load token price for ${tokenMint}:`, priceError);
      }
      try {
        solPriceUsd = await this.tokenInfoService.getSolPrice();
      } catch (solError) {
        this.logger.warn(`Failed to load SOL price for ${tokenMint} valuation:`, solError);
      }

        const holderMetadataByWallet = new Map<string, { rank: number; supplyPercent: number; tokenHoldingValueSol: number | null }>();
        const walletAddresses: string[] = [];
        const knownWalletProfiles: HolderProfile[] = []; // Pre-built profiles for known wallets (skip analysis)
        const holderByWallet = new Map<string, HolderWithLabel>();
        const externalTaggedWallets = new Map<string, HolderWithLabel>();

        holderEntries.forEach((holder, index) => {
          if (!holder.ownerAccount) {
            return;
          }
          holderByWallet.set(holder.ownerAccount, holder);
          const rank = typeof holder.rank === 'number' ? holder.rank : index + 1;
        const supplyPercent =
          actualTotalSupply > 0 && typeof holder.uiAmount === 'number'
            ? (holder.uiAmount / actualTotalSupply) * 100
            : 0;
        const tokenHoldingValueSol =
          tokenPriceUsd && solPriceUsd && solPriceUsd > 0 && typeof holder.uiAmount === 'number'
            ? (holder.uiAmount * tokenPriceUsd) / solPriceUsd
            : null;

        // Check if this is a known wallet that should skip expensive analysis
        const holderWithLabel = holder as HolderWithLabel;
        const shouldSkipAnalysis = holderWithLabel.knownType &&
          SKIP_BEHAVIOR_ANALYSIS.has(holderWithLabel.knownType as KnownWalletType);

          if (shouldSkipAnalysis) {
            externalTaggedWallets.set(holder.ownerAccount, holderWithLabel);
            const uiAmount = typeof holder.uiAmount === 'number' ? holder.uiAmount : null;
            const valueUsd =
              tokenPriceUsd && tokenPriceUsd > 0 && typeof holder.uiAmount === 'number'
                ? holder.uiAmount * tokenPriceUsd
                : null;
          const currentHoldings = uiAmount !== null
            ? [{
                tokenAddress: tokenMint,
                uiBalance: uiAmount,
                decimals: holder.decimals ?? null,
                valueSol: tokenHoldingValueSol ?? null,
                valueUsd,
              }]
            : [];
          // Create stub profile for known wallets - no expensive analysis needed
          knownWalletProfiles.push({
            walletAddress: holder.ownerAccount,
            rank,
            supplyPercent,
            tokenHoldingValueSol,
            knownType: holderWithLabel.knownType,
            knownLabel: holderWithLabel.knownLabel,
            analysisSkipped: true,
            // Null out behavioral metrics - not applicable to system wallets
            medianHoldTimeHours: null,
            avgHoldTimeHours: null,
            dailyFlipRatio: null,
            behaviorType: null,
            exitPattern: null,
            dataQualityTier: 'INSUFFICIENT',
            completedCycleCount: 0,
            confidence: 0,
            insufficientDataReason: `Known ${holderWithLabel.knownType} wallet - analysis skipped`,
            processingTimeMs: 0,
            currentHoldingsCount: currentHoldings.length,
            currentHoldings,
          });
          this.logger.debug(`Skipping analysis for known wallet ${holder.ownerAccount} (${holderWithLabel.knownType})`);
        } else {
          // Normal wallet - queue for analysis
          walletAddresses.push(holder.ownerAccount);
          holderMetadataByWallet.set(holder.ownerAccount, {
            rank,
            supplyPercent,
            tokenHoldingValueSol,
          });
        }
      });

        if (knownWalletProfiles.length > 0) {
          this.logger.debug(`Skipped analysis for ${knownWalletProfiles.length} known wallets (${tokenMint})`);
        }

        for (const [address, holder] of externalTaggedWallets) {
          if (!holder.knownType) {
            continue;
          }
          await this.systemWalletDetection.registerExternalKnownWallet(
            address,
            holder.knownType as KnownWalletType,
            holder.knownLabel,
            `Top holder program-owned classification (${holder.knownType})`
          );
        }

        const { valid: validWallets, filtered: systemWallets, filteredDetails, largeWallets } =
          await this.systemWalletDetection.filterSystemWallets(walletAddresses);

        if (systemWallets.size > 0) {
          this.logger.warn(`🚫 Filtered ${systemWallets.size} system wallet(s) from holder profiles analysis`);
          for (const [address, reason] of systemWallets) {
            this.logger.debug(`  - ${address}: ${reason}`);
          }
        }

        if (largeWallets.length > 0) {
          this.logger.log(`⚠️ Processing ${largeWallets.length} large wallet(s) (15k-70k tokens)`);
        }

        for (const [address, detection] of filteredDetails) {
          if (!detection.knownType || !detection.shouldSkipAnalysis || !holderMetadataByWallet.has(address)) {
            continue;
          }
          const metadata = holderMetadataByWallet.get(address);
          if (!metadata) {
            continue;
          }
          const holder = holderByWallet.get(address);
          const uiAmount = typeof holder?.uiAmount === 'number' ? holder.uiAmount : null;
          const valueUsd =
            tokenPriceUsd && tokenPriceUsd > 0 && typeof uiAmount === 'number'
              ? uiAmount * tokenPriceUsd
              : null;
          const currentHoldings = uiAmount !== null
            ? [{
                tokenAddress: tokenMint,
                uiBalance: uiAmount,
                decimals: holder?.decimals ?? null,
                valueSol: metadata.tokenHoldingValueSol ?? null,
                valueUsd,
              }]
            : [];
          knownWalletProfiles.push({
            walletAddress: address,
            rank: metadata.rank,
            supplyPercent: metadata.supplyPercent,
            tokenHoldingValueSol: metadata.tokenHoldingValueSol,
            knownType: detection.knownType,
            knownLabel: detection.knownLabel,
            analysisSkipped: true,
            medianHoldTimeHours: null,
            avgHoldTimeHours: null,
            dailyFlipRatio: null,
            behaviorType: null,
            exitPattern: null,
            dataQualityTier: 'INSUFFICIENT',
            completedCycleCount: 0,
            confidence: 0,
            insufficientDataReason: detection.reason,
            processingTimeMs: 0,
            currentHoldingsCount: currentHoldings.length,
            currentHoldings,
          });
        }

        walletAddresses.length = 0;
        walletAddresses.push(...validWallets);

      const cachedResult = await this.holderProfilesCacheService.getTokenResult(tokenMint, topN);
      if (cachedResult) {
        const cachedWallets = cachedResult.profiles.map((profile) => profile.walletAddress);
        const sameWallets = cachedWallets.length === walletAddresses.length &&
          cachedWallets.every((wallet, idx) => wallet === walletAddresses[idx]);
        const hasMissingHoldings = cachedResult.profiles.some((profile) => {
          const count = profile.currentHoldingsCount ?? 0;
          if (count <= 0) {
            return false;
          }
          const holdings = profile.currentHoldings ?? [];
          if (holdings.length === 0) {
            return true;
          }
          const hasValue = holdings.some((holding) => typeof holding.valueSol === 'number');
          return !hasValue && (profile.tokenHoldingValueSol === null || profile.tokenHoldingValueSol === undefined);
        });
        if (sameWallets) {
          if (!hasMissingHoldings) {
            this.logger.log(`Returning cached holder profiles for ${tokenMint} (topN=${topN})`);
            await job.updateProgress(100);
            return {
              ...cachedResult,
              metadata: {
                ...cachedResult.metadata,
                cacheOnly: true,
              },
            };
          }
          this.logger.log(`Cached holder profiles incomplete for ${tokenMint} (topN=${topN}); recomputing`);
        }
      }

      if (walletAddresses.length === 0) {
        const processingTimeMs = Date.now() - startTime;
        await job.updateProgress(100);
        return {
          success: true,
          mode: 'token',
          tokenMint,
          profiles: [],
          metadata: {
            totalHoldersRequested: topN,
            totalHoldersAnalyzed: 0,
            totalProcessingTimeMs: processingTimeMs,
            avgProcessingTimePerWalletMs: 0,
            failedHolders: 0,
            cacheOnly: true,
          },
          timestamp: Date.now(),
          processingTimeMs,
        };
      }

      const orderLookup = new Map(walletAddresses.map((addr, index) => [addr, index]));
      const aggregatedProfiles = new Map<string, HolderProfile>();
      const failedWallets = new Set<string>();

      const publishProgressUpdate = async () => {
        const analyzedCount = aggregatedProfiles.size;
        const orderedProfiles = [...aggregatedProfiles.values()].sort(
          (a, b) => (orderLookup.get(a.walletAddress) ?? 0) - (orderLookup.get(b.walletAddress) ?? 0),
        );
        const percent = Math.min(95, 20 + Math.floor((analyzedCount / walletAddresses.length) * 70));
        // Strip large array fields to keep BullMQ event payload small.
        // Large payloads (e.g. currentHoldings for wallets with thousands of tokens) can block
        // the event loop long enough to starve the BullMQ lock renewal timer, causing stalls.
        // Full data is always available in the final result stored in Redis.
        const strippedProfiles = orderedProfiles.map(({ currentHoldings: _ch, enrichedHoldTimeDistribution: _ehd, ...rest }) => rest);
        // BullMQ handles rich progress objects - bridge picks it up automatically
        await job.updateProgress({
          percent,
          mode: 'token',
          tokenMint,
          totalHoldersRequested: walletAddresses.length,
          analyzedCount,
          profiles: strippedProfiles,
        });
      };

      const streamProfile = async (wallet: string, profile: HolderProfile) => {
        if (aggregatedProfiles.has(wallet)) {
          return;
        }
        aggregatedProfiles.set(wallet, profile);
        await publishProgressUpdate();
        if (shouldDebugFailAfterProfiles && !debugFailTriggered && aggregatedProfiles.size >= (debugFailAfterProfiles as number)) {
          debugFailTriggered = true;
          throw new UnrecoverableError(`Debug failure after ${debugFailAfterProfiles} profile(s)`);
        }
      };

      await job.updateProgress(20);

        const { snapshots, readyWallets, staleWallets } = await this.holderProfilesCacheService.getTokenSnapshots(
          tokenMint,
          walletAddresses,
        );

      if (readyWallets.length > 0) {
        this.logger.debug(`Streaming ${readyWallets.length} cached holder profiles immediately`);
        const solPriceUsd = await this.getSolPriceUsd();
        for (const wallet of readyWallets) {
          const snapshot = snapshots.get(wallet);
          const metadata = holderMetadataByWallet.get(wallet);
          if (!snapshot || !metadata) {
            continue;
          }
          try {
            const hydrated = this.holderProfilesCacheService.hydrateSnapshot(snapshot, metadata);
            const withFinancials = await this.hydrateWalletFinancials(hydrated, solPriceUsd);
            await streamProfile(wallet, withFinancials);
          } catch (error) {
            this.logger.warn(`Failed to hydrate cached holder profile for ${wallet}: ${getErrorMessage(error)}`);
          }
        }
      }

        const walletsNeedingJobs = staleWallets.filter(addr => holderMetadataByWallet.has(addr));

      // ✅ BATCH FETCH BALANCES: Reduces RPC calls by caching all balances at once
      // Parent fetches once for all wallets → child jobs hit cache instead of fetching individually
      if (walletsNeedingJobs.length > 0) {
        this.logger.debug(`🚀 Batch fetching balances for ${walletsNeedingJobs.length} stale wallets to reduce RPC calls...`);
        try {
          await this.balanceCacheService.getManyBalances(walletsNeedingJobs);
          this.logger.debug(`✅ Batch balance fetch complete - all balances now cached for child jobs`);
        } catch (error) {
          this.logger.warn(`⚠️ Batch balance fetch failed, jobs will fetch individually: ${getErrorMessage(error)}`);
          // Continue - jobs will fetch individually as fallback
        }
      }

      const childJobIds: string[] = [];
      const jobIdToWallet = new Map<string, string>();
      let walletsRequiringSyncCount = 0;
      let allChildWalletJobsCacheOnly = true;

      // 🎯 Dynamic priority: Smaller jobs get higher priority to prevent starvation
      // Priority calculation: Smaller topN = higher priority (lower number)
      // Examples: topN=5 → priority=1, topN=10 → priority=2, topN=20 → priority=4
      const jobPriority = Math.max(1, Math.min(5, Math.ceil(topN / 5)));
      this.logger.debug(`Using priority ${jobPriority} for topN=${topN} (lower=higher priority)`);

      for (const wallet of walletsNeedingJobs) {
        const metadata = holderMetadataByWallet.get(wallet);

        // ✅ Get pre-computed system wallet detection result
        const detection = filteredDetails.get(wallet);

        const childJob = await this.analysisQueueService.addHolderProfilesJob({
          mode: 'wallet',
          userId: job.data.userId,
          walletAddress: wallet,
          requestId: `${requestId}-wallet-${wallet}`,
          _holderContext: {
            rank: metadata?.rank ?? childJobIds.length + 1,
            supplyPercent: metadata?.supplyPercent ?? 0,
            systemWalletDetection: detection ? {
              isSystemWallet: !!detection.shouldSkipAnalysis,
              knownType: detection.knownType,
              knownLabel: detection.knownLabel,
              reason: detection.reason,
            } : undefined,
          },
        }, {
          priority: jobPriority,  // Pass priority to ensure fair processing
        });

        if (childJob?.id) {
          childJobIds.push(childJob.id);
          jobIdToWallet.set(childJob.id, wallet);
        } else {
          this.logger.warn(`Wallet analysis job for ${wallet} did not return an ID`);
        }
      }

      if (childJobIds.length > 0) {
        const walletStatuses = await this.databaseService.getWalletsStatus(walletsNeedingJobs);
        walletsRequiringSyncCount = walletStatuses.statuses.filter(
          (status) => status.status === 'STALE' || status.status === 'MISSING',
        ).length;

        this.logger.debug(`Queueing ${childJobIds.length} wallet analysis jobs for token ${tokenMint}`);
        const batchProcessor = new BatchProcessor();
        const queue = this.analysisQueueService.getQueue();

        const handleJobResult = async (result: BatchResult<HolderProfilesResult>) => {
          const wallet = jobIdToWallet.get(result.itemId);
          if (!wallet) {
            return;
          }

          if (!result.success) {
            failedWallets.add(wallet);
            allChildWalletJobsCacheOnly = false;
            return;
          }

          if (aggregatedProfiles.has(wallet)) {
            return;
          }

          let walletResult: HolderProfilesResult | null = null;
          const resultData = result.data as unknown as Record<string, unknown> | undefined;
          if (resultData && typeof resultData === 'object' && Array.isArray(resultData['profiles'])) {
            // Inline result (should not happen with pointer pattern, kept for safety)
            walletResult = resultData as unknown as HolderProfilesResult;
          } else {
            // Pointer pattern: child job returned { data: { resultKey } }.
            // Resolve child payload directly first, then fall back to wallet cache.
            const pointerData = resultData && typeof resultData['data'] === 'object'
              ? (resultData['data'] as Record<string, unknown>)
              : undefined;
            const pointerKey = typeof pointerData?.resultKey === 'string'
              ? pointerData.resultKey
              : null;

            if (pointerKey && pointerKey.startsWith('holder-profiles:result:')) {
              try {
                const raw = await this.redisClient.get(pointerKey);
                if (raw) {
                  const parsed = JSON.parse(raw) as HolderProfilesResult;
                  if (parsed && Array.isArray(parsed.profiles)) {
                    walletResult = parsed;
                  }
                }
              } catch (error) {
                this.logger.warn(`Failed to resolve child holder profile pointer for ${wallet}: ${getErrorMessage(error)}`);
              }
            }

            if (!walletResult) {
              walletResult = await this.holderProfilesCacheService.getWalletResult(wallet);
            }
          }

          if (walletResult && walletResult.profiles.length > 0) {
            if (walletResult.metadata?.cacheOnly !== true) {
              allChildWalletJobsCacheOnly = false;
            }
            const metadata = holderMetadataByWallet.get(wallet);
            const profile = { ...walletResult.profiles[0] };
            if (metadata) {
              profile.rank = metadata.rank;
              profile.supplyPercent = metadata.supplyPercent;
              profile.tokenHoldingValueSol = metadata.tokenHoldingValueSol;
            }
            const solPriceUsd = await this.getSolPriceUsd();
            const withFinancials = await this.hydrateWalletFinancials(profile, solPriceUsd);
            await streamProfile(wallet, withFinancials);
          } else {
            failedWallets.add(wallet);
            allChildWalletJobsCacheOnly = false;
          }
        };

        await batchProcessor.waitForJobsWithTolerance<HolderProfilesResult>(
          childJobIds,
          async (jobId) => {
            const jobRef = await queue.getJob(jobId);
            if (!jobRef) {
              return null;
            }
            const [completed, failed] = await Promise.all([jobRef.isCompleted(), jobRef.isFailed()]);
            return {
              isCompleted: () => completed,
              isFailed: () => failed,
              returnvalue: jobRef.returnvalue as HolderProfilesResult | undefined,
            };
          },
          0.8,
          timeoutMs,
          2000,
          handleJobResult,
        );

        this.checkTimeout(startTime, timeoutMs, 'Waiting for wallet analysis jobs');
      } else {
        this.logger.log('All holder profiles served from cache; no wallet jobs queued');
      }

      const totalWalletsToProcess = walletAddresses.length + knownWalletProfiles.length;
      await job.updateProgress(Math.min(95, 20 + Math.floor((aggregatedProfiles.size / Math.max(1, walletAddresses.length)) * 70)));

      const processingTimeMs = Date.now() - startTime;
      // Merge analyzed profiles with pre-built known wallet profiles, sorted by holder rank
      const allProfiles = [...aggregatedProfiles.values(), ...knownWalletProfiles].sort(
        (a, b) => a.rank - b.rank,
      );
      const hydratedFinalProfiles = await this.hydrateHoldingsValues(allProfiles);

      // Inject per-wallet entry mcap for this specific token from AnalysisResult
      const realWalletAddresses = hydratedFinalProfiles
        .filter(p => !p.analysisSkipped)
        .map(p => p.walletAddress);
      if (realWalletAddresses.length > 0) {
        try {
          const mcapRows = await this.databaseService.getAnalysisResults({
            where: { walletAddress: { in: realWalletAddresses }, tokenAddress: tokenMint },
          });
          const mcapByWallet = new Map(
            mcapRows.map(r => [r.walletAddress, { entryMcapUsd: r.avgEntryMcap ?? null, entryMcapBucket: r.avgEntryMcapBucket ?? null }])
          );
          for (const profile of hydratedFinalProfiles) {
            const mcap = mcapByWallet.get(profile.walletAddress);
            if (mcap) {
              profile.entryMcapUsd = mcap.entryMcapUsd;
              profile.entryMcapBucket = mcap.entryMcapBucket;
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to inject entry mcap for token ${tokenMint}: ${getErrorMessage(error)}`);
        }
      }

      const analyzedCount = aggregatedProfiles.size;
      const skippedCount = knownWalletProfiles.length;
      const failedCount = Math.max(failedWallets.size, walletAddresses.length - analyzedCount);
      const tokenCacheOnly =
        walletsNeedingJobs.length === 0 ||
        (walletsRequiringSyncCount === 0 && allChildWalletJobsCacheOnly);

      const result: HolderProfilesResult = {
        success: true,
        mode: 'token',
        tokenMint,
        profiles: hydratedFinalProfiles,
        metadata: {
          totalHoldersRequested: totalWalletsToProcess,
          totalHoldersAnalyzed: analyzedCount,
          totalProcessingTimeMs: processingTimeMs,
          avgProcessingTimePerWalletMs: analyzedCount > 0 ? Math.round(processingTimeMs / analyzedCount) : 0,
          failedHolders: failedCount,
          cacheOnly: tokenCacheOnly,
        },
        timestamp: Date.now(),
        processingTimeMs,
      };

      await this.holderProfilesCacheService.cacheTokenResult(tokenMint, topN, result);

      // Persist per-profile snapshots for history (only on genuine re-analyses, not cache-only runs).
      // Known-wallet stubs (burn, LP, Raydium, etc.) have no Wallet DB record so are excluded from
      // individual rows (FK constraint). Instead, we store them in the metadata of the rank-1 row
      // so the snapshot endpoint can reconstruct the full profile list including known wallets.
      if (!tokenCacheOnly) {
        const jobIdStr = job.id?.toString() ?? null;
        const profilesToSnapshot = hydratedFinalProfiles.filter((p) => !p.analysisSkipped);
        const knownWalletStubs = hydratedFinalProfiles.filter((p) => p.analysisSkipped);

        // Fetch token metadata once to stamp into the rank-1 snapshot row.
        // This lets the snapshot endpoint return the mcap/price/symbol at run time
        // so historical snapshots can show "mcap then" rather than the live value.
        let tokenSnapshot: { marketCapUsd?: number | null; priceUsd?: string | number | null; name?: string; symbol?: string } | null = null;
        try {
          const tokenInfoRows = await this.tokenInfoService.findMany([tokenMint]);
          const ti = tokenInfoRows[0];
          if (ti) {
            tokenSnapshot = {
              marketCapUsd: ti.marketCapUsd ?? null,
              priceUsd: ti.priceUsd ?? null,
              name: ti.name ?? null,
              symbol: ti.symbol ?? null,
            };
          }
        } catch {
          // non-fatal — snapshot writes fine without it
        }

        await Promise.allSettled(
          profilesToSnapshot.map((profile, idx) =>
            this.holderProfilesCacheService.saveSnapshot({
              walletAddress: profile.walletAddress,
              tokenMint,
              analysisMode: 'token',
              holderRank: profile.rank,
              supplyPercent: profile.supplyPercent,
              topN,
              jobId: jobIdStr,
              requestId: job.data.requestId,
              profile,
              // Attach known-wallet stubs + token snapshot to the first real profile's metadata.
              metadata: idx === 0
                ? { mode: 'token', topN, knownWalletStubs: knownWalletStubs.length > 0 ? knownWalletStubs : undefined, tokenSnapshot }
                : { mode: 'token', topN },
            })
          )
        );
      }

      await job.updateProgress(100);

      // Note: JobEventsBridgeService automatically publishes completion events via BullMQ's 'completed' event
      // No need to manually publish here to avoid duplicate events
      // await this.jobProgressGateway.publishCompletedEvent(job.id!, job.queueName, result, processingTimeMs);
      this.logger.log(
        `Token holder orchestration for ${tokenMint} completed: ${analyzedCount} analyzed, ${skippedCount} skipped (known wallets), ${failedCount} failed in ${processingTimeMs}ms`,
      );

      return result;
    } catch (error) {
      if (error instanceof UnrecoverableError) {
        this.logger.warn(`Holder profiles analysis failed for ${tokenMint}: ${error.message}`);
      } else {
        this.logger.error(`Holder profiles analysis failed for ${tokenMint}: ${getErrorMessage(error)}`);
      }
      throw error;
    }
  }

  /**
   * Create stub holder profile for system wallets
   */
  private async createStubHolderProfile(
    walletAddress: string,
    knownType: string,
    knownLabel: string | undefined,
    rank: number,
    supplyPercent: number,
    reason: string,
    startTime: number,
    job: Job<AnalyzeHolderProfilesJobData>
  ): Promise<HolderProfilesResult> {
    const profile: HolderProfile = {
      walletAddress,
      rank,
      supplyPercent,
      knownType,
      knownLabel,
      analysisSkipped: true,
      medianHoldTimeHours: null,
      avgHoldTimeHours: null,
      dailyFlipRatio: null,
      behaviorType: null,
      exitPattern: null,
      dataQualityTier: 'INSUFFICIENT',
      completedCycleCount: 0,
      confidence: 0,
      insufficientDataReason: reason,
      processingTimeMs: 0,
      currentHoldingsCount: 0,
      currentHoldings: [],
    };

    const processingTimeMs = Date.now() - startTime;
    const result: HolderProfilesResult = {
      success: true,
      mode: 'wallet',
      targetWallet: walletAddress,
      profiles: [profile],
      metadata: {
        totalHoldersRequested: 1,
        totalHoldersAnalyzed: 0,
        totalProcessingTimeMs: processingTimeMs,
        avgProcessingTimePerWalletMs: processingTimeMs,
        cacheOnly: true,
      },
      timestamp: Date.now(),
      processingTimeMs,
    };

    await this.holderProfilesCacheService.cacheWalletResult(walletAddress, result);
    await job.updateProgress(100);
    this.logger.debug(`⏭️ Skipped holder profile for ${walletAddress} (${knownType})`);
    return result;
  }

  /**
   * Analyze holder profile for a single wallet (wallet mode)
   */
  private async processSingleHolderProfile(
    job: Job<AnalyzeHolderProfilesJobData>,
    walletAddress: string,
    startTime: number,
    timeoutMs: number,
  ): Promise<HolderProfilesResult> {
    this.logger.debug(`Starting holder profile analysis for wallet ${walletAddress}`);

      const holderContext = job.data._holderContext;
      const inferredRank = holderContext?.rank ?? 1;
      const inferredSupplyPercent = holderContext?.supplyPercent ?? 0;

      // ✅ Use pre-computed detection from parent job if available
      const cachedDetection = holderContext?.systemWalletDetection;

      if (cachedDetection?.isSystemWallet && cachedDetection.knownType) {
        // Use cached result - no RPC call needed!
        this.logger.debug(`✅ Using pre-computed system wallet detection for ${walletAddress} (saved RPC call)`);
        return this.createStubHolderProfile(
          walletAddress,
          cachedDetection.knownType as any, // Type assertion needed
          cachedDetection.knownLabel,
          inferredRank,
          inferredSupplyPercent,
          cachedDetection.reason || 'System wallet (pre-detected in parent job)',
          startTime,
          job
        );
      }

      // ❌ FALLBACK: Only detect if not already done in parent
      // This path runs for wallet-mode jobs NOT from holder profiles parent
      const detection = await this.systemWalletDetection.detectSystemWallet(walletAddress);
      if (detection.knownType && SKIP_BEHAVIOR_ANALYSIS.has(detection.knownType)) {
        return this.createStubHolderProfile(
          walletAddress,
          detection.knownType,
          detection.knownLabel,
          inferredRank,
          inferredSupplyPercent,
          detection.reason,
          startTime,
          job
        );
      }

    // Try Tier 1 cache (Redis) first
    const cached = await this.holderProfilesCacheService.getWalletResult(walletAddress);
      if (cached) {
        this.logger.debug(`Returning cached holder profile for wallet ${walletAddress}`);
        const solPriceUsd = await this.getSolPriceUsd();
        const hydratedProfiles = await Promise.all(
          cached.profiles.map((profile) => this.hydrateWalletFinancials(profile, solPriceUsd)),
        );
        await job.updateProgress(100);
        return {
          ...cached,
          profiles: hydratedProfiles,
          metadata: {
            ...cached.metadata,
            cacheOnly: true,
          },
        };
      }

    // Try Tier 2 cache (DB snapshots)
    const cachedProfile = await this.holderProfilesCacheService.getWalletSnapshot(walletAddress);
    if (cachedProfile) {
      const solPriceUsd = await this.getSolPriceUsd();
      const hydratedProfile = await this.hydrateWalletFinancials(cachedProfile, solPriceUsd);
      const processingTimeMs = Date.now() - startTime;
      const result: HolderProfilesResult = {
        success: true,
        mode: 'wallet',
        targetWallet: walletAddress,
        profiles: [hydratedProfile],
        metadata: {
          totalHoldersRequested: 1,
          totalHoldersAnalyzed: 1,
          totalProcessingTimeMs: processingTimeMs,
          avgProcessingTimePerWalletMs: processingTimeMs,
          cacheOnly: true,
        },
        timestamp: Date.now(),
        processingTimeMs,
      };
      // Ensure parent token-mode aggregator can read wallet-mode child result from Tier-1 key.
      await this.holderProfilesCacheService.cacheWalletResult(walletAddress, result);
      await job.updateProgress(100);
      return result;
    }

    this.checkTimeout(startTime, timeoutMs, 'Starting wallet holder profile analysis');
    await job.updateProgress(5);

    // 📊 Track concurrent analysis attempts (no lock, just monitoring)
    const existingLock = await this.redisLockService.getLockValue(
      RedisLockService.createWalletLockKey(walletAddress, 'dashboard-analysis')
    );
    if (existingLock) {
      this.metricsService.concurrentAnalysisAttempts.inc({
        analysis_type: 'holder_profiles',
        resource_type: 'wallet'
      });
      this.logger.debug(
        `📊 Concurrent analysis detected: holder profile analysis for ${walletAddress} ` +
        `while dashboard analysis is in progress (job: ${existingLock})`
      );
    }

    // Check if wallet needs sync
    this.logger.debug(`Checking wallet status for ${walletAddress}`);
    const walletStatuses = await this.databaseService.getWalletsStatus([walletAddress]);
    const walletStatus = walletStatuses.statuses[0]?.status;
    const needsSync = walletStatus === 'STALE' || walletStatus === 'MISSING';

    await job.updateProgress(10);

    // Sync wallet if needed
    if (needsSync) {
      this.logger.debug(`Syncing wallet ${walletAddress} for holder profile analysis (status: ${walletStatus})`);
      const syncOptions: SyncOptions = {
        limit: 100,
        fetchAll: true,
        skipApi: false,
        fetchOlder: true,
        maxSignatures: ANALYSIS_EXECUTION_CONFIG.HOLDER_PROFILES_MAX_SIGNATURES, // Reasonable default for holder analysis
        smartFetch: true,
      };
      await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
      this.logger.debug(`Wallet sync completed for ${walletAddress}`);
    } else {
      this.logger.debug(`Wallet ${walletAddress} is up-to-date, skipping sync`);
    }

    await this.marketContextService.enrichWallet(walletAddress, 500);

    await job.updateProgress(30);
    this.checkTimeout(startTime, timeoutMs, 'Wallet sync completed');

    const swapRecords = await this.databaseService.getSwapAnalysisInputs(walletAddress);
    this.logger.debug(`Fetched ${swapRecords.length} swap records for ${walletAddress}`);
    this.checkTimeout(startTime, timeoutMs, 'Fetching wallet swap records');
    await job.updateProgress(40);

    // Aggregate SwapAnalysisInput → AnalysisResult (PnL calculation)
    // Reuse cached balances when available to avoid extra RPC calls later (e.g., similarity).
    this.logger.debug(`Running PnL aggregation for ${walletAddress} [holder-profile mode]`);

    // Check cache first (parent's batch fetch likely cached this already)
    const cachedBalance = await this.balanceCacheService.getBalances(walletAddress);
    const preFetchedBalances = cachedBalance
      ? new Map([[walletAddress, cachedBalance]])
      : undefined;

    const pnlSummary = await this.pnlAnalysisService.analyzeWalletPnl(walletAddress, undefined, {
      preFetchedBalances,
    });

    // Cache balance from PnL summary if not already cached
    if (!cachedBalance && pnlSummary?.tokenBalances && pnlSummary.balancesFetchedAt) {
      const balanceToCache: WalletBalance = {
        solBalance: pnlSummary.currentSolBalance ?? 0,
        tokenBalances: pnlSummary.tokenBalances,
        fetchedAt: pnlSummary.balancesFetchedAt,
      };
      await this.balanceCacheService.cacheBalances(walletAddress, balanceToCache, 1800); // 30 min TTL
    }
    await job.updateProgress(50);

    const profile = await this.analyzeWalletProfile(walletAddress, inferredRank, inferredSupplyPercent, swapRecords);
    await this.holderProfilesCacheService.saveSnapshot({
      walletAddress,
      tokenMint: null,
      analysisMode: 'wallet',
      holderRank: profile.rank,
      supplyPercent: profile.supplyPercent,
      topN: 1,
      jobId: job.id?.toString() ?? null,
      requestId: job.data.requestId,
      profile,
      metadata: {
        mode: 'wallet',
      },
    });

    const processingTimeMs = Date.now() - startTime;
    const result: HolderProfilesResult = {
      success: true,
      mode: 'wallet',
      targetWallet: walletAddress,
      profiles: profile ? [profile] : [],
      metadata: {
        totalHoldersRequested: 1,
        totalHoldersAnalyzed: profile ? 1 : 0,
        totalProcessingTimeMs: processingTimeMs,
        avgProcessingTimePerWalletMs: profile ? processingTimeMs : 0,
      },
      timestamp: Date.now(),
      processingTimeMs,
    };

    await job.updateProgress(100);
    await this.holderProfilesCacheService.cacheWalletResult(walletAddress, result);

    // Invalidate HUD cache after wallet analysis completes
    await this.walletHudService.invalidateCache(walletAddress);

    // Note: JobEventsBridgeService automatically publishes completion events via BullMQ's 'completed' event
    // No need to manually publish here to avoid duplicate events
    // await this.jobProgressGateway.publishCompletedEvent(job.id!, 'analysis-operations', result, processingTimeMs);

    this.logger.debug(`Holder profile analysis for wallet ${walletAddress} completed in ${processingTimeMs}ms`);

    return result;
  }

  private async getSolPriceUsd(): Promise<number | null> {
    try {
      const solPriceUsd = await this.tokenInfoService.getSolPrice();
      return solPriceUsd > 0 ? solPriceUsd : null;
    } catch (error) {
      this.logger.debug('SOL price unavailable for wallet financial hydration.');
      return null;
    }
  }

  private async hydrateWalletFinancials(profile: HolderProfile, solPriceUsd: number | null): Promise<HolderProfile> {
    const needsPnl = profile.walletPnlSol === null || profile.walletPnlSol === undefined;
    const needsSolBalance = profile.solBalance === null || profile.solBalance === undefined;
    if (!needsPnl && !needsSolBalance) {
      return profile;
    }

    try {
      const summary = await this.databaseService.getWalletPnlSummaryWithRelations(profile.walletAddress);
      if (!summary) {
        return profile;
      }
      const walletPnlSol = summary.netPnl ?? null;
      const walletRealizedPnlSol = summary.realizedPnl ?? null;
      const solBalance = summary.currentSolBalance ?? null;
      const walletPnlUsd =
        walletPnlSol !== null && solPriceUsd !== null ? walletPnlSol * solPriceUsd : profile.walletPnlUsd ?? null;
      const walletRealizedPnlUsd =
        walletRealizedPnlSol !== null && solPriceUsd !== null ? walletRealizedPnlSol * solPriceUsd : null;

      return {
        ...profile,
        walletPnlSol: needsPnl ? walletPnlSol : profile.walletPnlSol,
        walletPnlUsd: needsPnl ? walletPnlUsd : profile.walletPnlUsd ?? walletPnlUsd,
        walletRealizedPnlSol: needsPnl ? walletRealizedPnlSol : profile.walletRealizedPnlSol,
        walletRealizedPnlUsd: needsPnl ? walletRealizedPnlUsd : profile.walletRealizedPnlUsd,
        solBalance: needsSolBalance ? solBalance : profile.solBalance,
      };
    } catch (error) {
      this.logger.debug(`Failed to hydrate wallet financials for ${profile.walletAddress}`);
      return profile;
    }
  }

  private async hydrateHoldingsValues(profiles: HolderProfile[]): Promise<HolderProfile[]> {
    const missingMints = new Set<string>();
    for (const profile of profiles) {
      for (const holding of profile.currentHoldings ?? []) {
        if ((holding.uiBalance ?? 0) > 0 && holding.tokenAddress) {
          if (holding.tokenAddress) {
            missingMints.add(holding.tokenAddress);
          }
        }
      }
    }

    if (missingMints.size === 0) {
      return profiles;
    }

    let solPriceUsd = 0;
    try {
      solPriceUsd = await this.tokenInfoService.getSolPrice();
    } catch (error) {
      this.logger.debug('SOL price unavailable for holdings hydration.');
      return profiles;
    }

    if (!solPriceUsd || solPriceUsd <= 0) {
      return profiles;
    }

    try {
      const pricesByMint = await this.tokenInfoService.getTokenPrices([...missingMints]);
      return profiles.map((profile) => {
        const holdings = profile.currentHoldings ?? [];
        if (holdings.length === 0) {
          return profile;
        }
        const updatedHoldings = holdings.map((holding) => {
          if ((holding.uiBalance ?? 0) <= 0) {
            return holding;
          }
          const priceUsd = pricesByMint.get(holding.tokenAddress) ?? null;
          if (!priceUsd || priceUsd <= 0) {
            return holding;
          }
          const valueUsd = (holding.uiBalance ?? 0) * priceUsd;
          const valueSol = valueUsd / solPriceUsd;
          return {
            ...holding,
            valueUsd,
            valueSol,
          };
        });
        return {
          ...profile,
          currentHoldings: updatedHoldings,
        };
      });
    } catch (error: any) {
      this.logger.debug(`Failed to hydrate holdings values: ${error?.message || 'unknown error'}`);
      return profiles;
    }
  }
  private async processMintParticipants(job: Job<{ mint: string; cutoffTs: number; signature?: string }>): Promise<{ success: boolean; written?: number; zeroDayAlerts?: number; processingTimeMs: number }> {
    const { mint, cutoffTs } = job.data;
    const startTime = Date.now();
    const metricsStartTime = Date.now();

    // Note: SOL/WSOL filtering is now handled upstream in the webhook controller
    // No jobs for SOL/WSOL should reach this processor

    const lockKey = `lock:mint-participants:${mint}:${cutoffTs}`;
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, 30_000);
    if (!lockAcquired) {
      this.logger.warn(`MintParticipants already processing for ${mint}@${cutoffTs}`);
      return { success: true, written: 0, zeroDayAlerts: 0, processingTimeMs: Date.now() - startTime };
    }
    try {
      await job.updateProgress(10);
      const trackedWallet = process.env.MINT_PARTICIPANTS_TRACKED_WALLET;
      const result = await runMintParticipantsFlow(
        this.heliusApiClient,
        this.databaseService,
        {
          mint,
          cutoffTs,
          addressType: 'auto',
          sourceWallet: trackedWallet,
          // Only apply a time window if explicitly configured (in seconds).
          // If not set, we rely on limitBuyers to select the last N buyers.
          windowSeconds: process.env.MINT_PARTICIPANTS_WINDOW_SECONDS
            ? Number(process.env.MINT_PARTICIPANTS_WINDOW_SECONDS)
            : undefined,
          limitBuyers: Number(process.env.MINT_PARTICIPANTS_LIMIT_BUYERS || 20),
          txCountLimit: Number(process.env.MINT_PARTICIPANTS_TX_COUNT_LIMIT || 500),
          candidateWindow: Number(process.env.MINT_PARTICIPANTS_CANDIDATE_WINDOW || 300),
          creationScan: (process.env.MINT_PARTICIPANTS_CREATION_SCAN === 'none' ? 'none' : 'full') as 'none' | 'full',
          creationSkipIfTokenAccountsOver: Number(process.env.MINT_PARTICIPANTS_CREATION_SKIP_IF_TOKEN_ACCOUNTS_OVER || 10000),
          excludeWallets: (process.env.MINT_PARTICIPANTS_EXCLUDE_WALLETS || '')
            .split(',')
            .map(w => w.trim())
            .filter(Boolean),
          output: (process.env.MINT_PARTICIPANTS_OUTPUT as any) || 'jsonl',
          outFile: process.env.MINT_PARTICIPANTS_OUTFILE || undefined,
          verbose: process.env.MINT_PARTICIPANTS_VERBOSE === 'true',
        },
        { runScannedAtIso: new Date().toISOString(), runSource: 'auto' }
      );

      // Alerts: zero-day and sub-5-day (configurable)
      const alertAgeThresholdDays = Number(process.env.MINT_PARTICIPANTS_ALERT_AGE_DAYS || 0);
      let alertCount = 0;
      const nowIso = new Date().toISOString();
      const formatAlert = (wallets: typeof result.buyers) => {
        const MAX_LINES = 50;
        const listArr = wallets.map(w => {
          const age = w.stats.accountAgeDays ?? null;
          const ageStr = age == null ? '?' : `${age}`;
          const addr = `<code>${w.walletAddress}</code>`;
          return `• ${addr} (<b>${ageStr}d</b>)`;
        });
        const list = listArr.slice(0, MAX_LINES).join('\n') + (listArr.length > MAX_LINES ? `\n…and ${listArr.length - MAX_LINES} more` : '');
        const cohort = alertAgeThresholdDays === 0 ? '0d' : `≤${alertAgeThresholdDays}d`;
        const header = `<b>Chen Group alert</b> • <b>${wallets.length}</b> wallet(s) ${cohort}\n<code>${mint}</code>\ncutoff: ${cutoffTs} (${nowIso})`;
        return `${header}\n\n${list}`;
      };

      if (alertAgeThresholdDays === 0) {
        const zeroDay = result.buyers.filter(b => (b.stats.accountAgeDays ?? 1) === 0);
        if (zeroDay.length > 0) {
          const msg = formatAlert(zeroDay);
          await this.telegramAlerts.broadcast(msg, { html: true });
        }
        alertCount = zeroDay.length;
      } else {
        const young = result.buyers.filter(b => typeof b.stats.accountAgeDays === 'number' && (b.stats.accountAgeDays as number) <= alertAgeThresholdDays);
        if (young.length > 0) {
          const msg = formatAlert(young);
          await this.telegramAlerts.broadcast(msg, { html: true });
        }
        alertCount = young.length;
      }

      await job.updateProgress(100);

      // Track successful job completion
      this.metricsService.analysisJobsTotal.labels('mint-participants', 'success').inc();
      this.metricsService.analysisJobDuration.labels('mint-participants').observe((Date.now() - metricsStartTime) / 1000);

      return { success: true, written: result.writtenCount, zeroDayAlerts: alertCount, processingTimeMs: Date.now() - startTime };
    } catch (err) {
      this.logger.error(`mint-participants-run failed for ${mint}@${cutoffTs}: ${getErrorMessage(err)}`);

      // Track failed job
      this.metricsService.analysisJobsTotal.labels('mint-participants', 'failed').inc();
      this.metricsService.analysisJobDuration.labels('mint-participants').observe((Date.now() - metricsStartTime) / 1000);

      throw err;
    } finally {
      await this.redisLockService.releaseLock(lockKey, job.id!);
    }
  }

  /**
   * Analyze individual wallet's holding profile
   */
  private async analyzeWalletProfile(
    walletAddress: string,
    rank: number,
    supplyPercent: number,
    swapRecords: any[],
  ): Promise<HolderProfile> {
    const walletStartTime = Date.now();

    const oldestTransactionTimestamp =
      swapRecords.length > 0 ? swapRecords.reduce((min, r) => Math.min(min, r.timestamp), Infinity) : null;
    const newestTransactionTimestamp =
      swapRecords.length > 0 ? swapRecords.reduce((max, r) => Math.max(max, r.timestamp), -Infinity) : null;

    // If no swap records, return insufficient data
    if (swapRecords.length === 0) {
      return {
        walletAddress,
        rank,
        supplyPercent,
        medianHoldTimeHours: null,
        avgHoldTimeHours: null,
        dailyFlipRatio: null,
        behaviorType: null,
        exitPattern: null,
        dataQualityTier: 'INSUFFICIENT' as const,
        completedCycleCount: 0,
        confidence: 0,
        insufficientDataReason: 'No transaction history found',
        processingTimeMs: Date.now() - walletStartTime,
        holdTimeDistribution: undefined,
        enrichedHoldTimeDistribution: undefined,
        includesCurrentHoldings: false,
        exitRate: null,
        totalTokensTraded: 0,
        typicalHoldTimeHours: null,
        typicalHoldTimeSource: 'CURRENT',
        realizedMedianHoldTimeHours: null,
        realizedAverageHoldTimeHours: null,
        currentHoldMedianHours: null,
        currentHoldAverageHours: null,
        percentValueInCurrentHoldings: null,
        dailyFlipRatioConfidence: 'NONE',
        currentHoldingsCount: null,
        currentHoldings: [],
        walletPnlSol: null,
        walletPnlUsd: null,
        solBalance: null,
        oldestTransactionTimestamp,
        newestTransactionTimestamp,
      };
    }

    // Query pre-computed PnL from AnalysisResult table (source of truth)
    let pnlMap: Map<string, { pnl: number; capital: number }> | undefined;
    let currentHoldings: Array<{ tokenAddress: string; uiBalance: number | null; decimals: number | null; valueSol?: number | null; valueUsd?: number | null }> = [];
    let walletPnlSol: number | null = null;
    let walletPnlUsd: number | null = null;
    let solBalance: number | null = null;
    try {
      const pnlResults = await this.databaseService.getAnalysisResults({
        where: { walletAddress },
      });

      if (pnlResults.length > 0) {
        // Include ALL tokens from AnalysisResult, even those with incomplete history
        // This ensures alignment with lifecyclesByToken used in behavior analysis
        // Tokens with hasIncompleteHistory=true still have derived PnL (best effort FIFO calculation)
        pnlMap = new Map(
          pnlResults.map(r => [
            r.tokenAddress,
            {
              pnl: r.realizedPnlSol ?? r.totalPnlSol ?? r.netSolProfitLoss,
              capital: r.totalSolSpent,
            },
          ])
        );
        currentHoldings = pnlResults
          .filter(r => typeof r.currentUiBalance === 'number' && (r.currentUiBalance ?? 0) > 0)
          .map(r => ({
            tokenAddress: r.tokenAddress,
            uiBalance: r.currentUiBalance,
            decimals: typeof r.balanceDecimals === 'number' ? r.balanceDecimals : null,
            valueSol: r.currentHoldingsValueSol,
            valueUsd: r.currentHoldingsValueUsd,
          }));
        // ALWAYS recalculate holdings values with fresh prices (don't trust stale DB values)
        const allTokenMints = currentHoldings
          .filter((holding) => (holding.uiBalance ?? 0) > 0)
          .map((holding) => holding.tokenAddress);
        if (allTokenMints.length > 0 && this.tokenInfoService) {
          try {
            // Batch fetch fresh prices for all tokens
            const pricesByMint = await this.tokenInfoService.getTokenPrices(allTokenMints);
            let solPriceUsd = 0;
            try {
              solPriceUsd = await this.tokenInfoService.getSolPrice();
            } catch (error) {
              this.logger.debug(`SOL price unavailable for current holdings valuation: ${walletAddress}`);
            }
            if (solPriceUsd > 0) {
              // Recalculate ALL holdings with fresh prices (ignore stale DB values)
              currentHoldings = currentHoldings.map((holding) => {
                const priceUsd = pricesByMint.get(holding.tokenAddress) ?? null;
                if (!priceUsd || priceUsd <= 0) {
                  // Keep holding but clear stale price-dependent values
                  return {
                    ...holding,
                    valueUsd: null,
                    valueSol: null,
                  };
                }
                const valueUsd = (holding.uiBalance ?? 0) * priceUsd;
                const valueSol = valueUsd / solPriceUsd;
                return {
                  ...holding,
                  valueUsd,
                  valueSol,
                };
              });
            }
          } catch (error: any) {
            this.logger.debug(`Failed to recalculate current holdings values with fresh prices: ${error?.message || 'Unknown error'}`);
          }
        }
        this.logger.debug(
          `Loaded PnL for ${pnlResults.length} tokens for wallet ${walletAddress}`
        );
      } else {
        this.logger.debug(`No PnL data found in AnalysisResult for wallet ${walletAddress}`);
      }
    } catch (error: any) {
      this.logger.warn(
        `Failed to query PnL for wallet ${walletAddress}: ${error?.message || 'Unknown error'}. Will proceed without PnL metrics.`
      );
      pnlMap = undefined;
    }

    try {
      const pnlSummary = await this.databaseService.getWalletPnlSummaryWithRelations(walletAddress);
      if (pnlSummary) {
        walletPnlSol = pnlSummary.netPnl ?? null;
        solBalance = pnlSummary.currentSolBalance ?? null;
        if (walletPnlSol !== null) {
          try {
            const solPriceUsd = await this.tokenInfoService.getSolPrice();
            if (solPriceUsd && solPriceUsd > 0) {
              walletPnlUsd = walletPnlSol * solPriceUsd;
            }
          } catch (error) {
            this.logger.debug(`SOL price unavailable for wallet PnL USD conversion: ${walletAddress}`);
          }
        }
      }
    } catch (error: any) {
      this.logger.warn(
        `Failed to query wallet PnL summary for ${walletAddress}: ${error?.message || 'Unknown error'}.`
      );
    }

    // Use BehaviorService to get historical pattern (with PnL map)
    try {
      const behaviorResult = await this.behaviorService.getWalletBehavior(
        walletAddress,
        this.behaviorService.getDefaultBehaviorAnalysisConfig(),
        undefined,
        pnlMap,
      );

      const historicalPattern = behaviorResult?.historicalPattern;

      this.logger.debug(
        `Historical pattern for ${walletAddress}: ` +
        `completedCycles=${historicalPattern?.completedCycleCount ?? 0}, ` +
        `median=${historicalPattern?.medianCompletedHoldTimeHours?.toFixed(4) ?? 'null'}h, ` +
        `behaviorType=${historicalPattern?.behaviorType ?? 'null'}`
      );

      // HYBRID APPROACH: Use historical pattern if available, otherwise fall back to current holdings
      const hasEnoughExitedData = historicalPattern && historicalPattern.completedCycleCount >= 3;
      const hasCurrentHoldingsData = behaviorResult?.medianCurrentHoldingDurationHours !== null &&
                                      behaviorResult?.medianCurrentHoldingDurationHours !== undefined &&
                                      behaviorResult?.medianCurrentHoldingDurationHours > 0;
      const percentValueInCurrentHoldings = typeof behaviorResult?.percentOfValueInCurrentHoldings === 'number'
        ? behaviorResult.percentOfValueInCurrentHoldings
        : null;
      const HOLD_VALUE_THRESHOLD_SOL = 0.01;
      const valueFilteredHoldings = currentHoldings.filter((holding) => {
        if (typeof holding.valueSol === 'number') {
          return holding.valueSol >= HOLD_VALUE_THRESHOLD_SOL;
        }
        return (holding.uiBalance ?? 0) > 0;
      });
      const rawHoldingsCount = currentHoldings.length;
      const currentHoldingsCount = valueFilteredHoldings.length;
      const currentHoldMedianHours = hasCurrentHoldingsData
        ? (behaviorResult?.medianCurrentHoldingDurationHours ?? null)
        : null;
      const currentHoldAverageHours = hasCurrentHoldingsData
        ? (behaviorResult?.averageCurrentHoldingDurationHours ?? null)
        : null;
      const realizedMedianHoldTimeHours = hasEnoughExitedData
        ? (historicalPattern?.medianCompletedHoldTimeHours ?? null)
        : null;
      const realizedAverageHoldTimeHours = hasEnoughExitedData
        ? (historicalPattern?.historicalAverageHoldTimeHours ?? null)
        : null;

      if (!hasEnoughExitedData && !hasCurrentHoldingsData) {
        return {
          walletAddress,
          rank,
          supplyPercent,
          medianHoldTimeHours: null,
          avgHoldTimeHours: null,
          dailyFlipRatio: null,
          behaviorType: historicalPattern?.behaviorType ?? null,
          exitPattern: historicalPattern?.exitPattern ?? null,
          dataQualityTier: 'INSUFFICIENT' as const,
          completedCycleCount: historicalPattern?.completedCycleCount ?? 0,
          confidence: historicalPattern?.dataQuality ?? 0,
          insufficientDataReason: `Only ${historicalPattern?.completedCycleCount ?? 0} completed exits, no current holdings data`,
          processingTimeMs: Date.now() - walletStartTime,
          holdTimeDistribution: historicalPattern?.holdTimeDistribution,
          enrichedHoldTimeDistribution: historicalPattern?.enrichedHoldTimeDistribution,
          includesCurrentHoldings: false,
          exitRate: null,
          totalTokensTraded: behaviorResult?.uniqueTokensTraded ?? 0,
          typicalHoldTimeHours: null,
          typicalHoldTimeSource: 'CURRENT',
          realizedMedianHoldTimeHours,
          realizedAverageHoldTimeHours,
          currentHoldMedianHours,
          currentHoldAverageHours,
          percentValueInCurrentHoldings,
          dailyFlipRatioConfidence: 'NONE',
          currentHoldingsCount,
          currentHoldings,
          walletPnlSol,
          walletPnlUsd,
          solBalance,
          oldestTransactionTimestamp,
          newestTransactionTimestamp,
        };
      }

      // Calculate daily flip ratio from historical pattern distribution (if available)
      const flipRatioResult = hasEnoughExitedData
        ? this.calculateDailyFlipRatioFromPattern(historicalPattern)
        : { ratio: 0, confidence: 'NONE' as const };

      const typicalHoldTime = this.computeTypicalHoldTimeMetrics({
        realizedMedian: realizedMedianHoldTimeHours,
        realizedAverage: realizedAverageHoldTimeHours,
        currentMedian: currentHoldMedianHours,
        currentAverage: currentHoldAverageHours,
        percentCurrentValue: percentValueInCurrentHoldings,
      });

      const medianHoldTimeHours =
        typicalHoldTime.median ??
        realizedMedianHoldTimeHours ??
        currentHoldMedianHours ??
        null;
      const avgHoldTimeHours =
        typicalHoldTime.average ??
        realizedAverageHoldTimeHours ??
        currentHoldAverageHours ??
        null;
      const includesCurrentHoldings =
        (currentHoldMedianHours !== null || currentHoldAverageHours !== null) &&
        typicalHoldTime.source !== 'EXITED';
      const typicalHoldTimeHours = typicalHoldTime.median;
      const typicalHoldTimeSource = typicalHoldTime.source;

      // Calculate exit rate (% of tokens that have been fully exited)
      const totalTokensTraded = behaviorResult?.uniqueTokensTraded ?? 0;
      const exitedTokensCount = historicalPattern?.completedCycleCount ?? 0;
      const exitRate = totalTokensTraded > 0 ? (exitedTokensCount / totalTokensTraded) * 100 : 0;
      const unresolvedTokensCount = Math.max(totalTokensTraded - exitedTokensCount - (currentHoldingsCount ?? 0), 0);

      // Determine data quality tier
      const dataQualityTier = hasEnoughExitedData
        ? this.determineDataQualityTier(
            historicalPattern.completedCycleCount,
            historicalPattern.dataQuality,
          )
        : 'BRONZE' as const; // Current holdings data = lower quality

      // Fallback classification for holders with no exits
      const behaviorType =
        historicalPattern?.behaviorType ??
        ((currentHoldingsCount ?? 0) > 0 ? 'HODLER' : null);

      return {
        walletAddress,
        rank,
        supplyPercent,
        medianHoldTimeHours,
        avgHoldTimeHours,
        dailyFlipRatio: flipRatioResult.ratio,
        dailyFlipRatioConfidence: flipRatioResult.confidence,
        behaviorType,
        exitPattern: historicalPattern?.exitPattern ?? null,
        dataQualityTier,
        completedCycleCount: exitedTokensCount,
        confidence: historicalPattern?.dataQuality ?? 0,
        holdTimeDistribution: historicalPattern?.holdTimeDistribution,
        enrichedHoldTimeDistribution: historicalPattern?.enrichedHoldTimeDistribution,
        includesCurrentHoldings, // NEW: Flag to show user that still-held positions are included
        exitRate, // NEW: Replaces flip ratio - more meaningful metric
        totalTokensTraded, // NEW: Total tokens this wallet has touched
        processingTimeMs: Date.now() - walletStartTime,
        typicalHoldTimeHours,
        typicalHoldTimeSource,
        realizedMedianHoldTimeHours,
        realizedAverageHoldTimeHours,
        currentHoldMedianHours,
        currentHoldAverageHours,
        percentValueInCurrentHoldings,
        currentHoldingsCount,
        currentHoldings: valueFilteredHoldings,
        unresolvedTokensCount,
        activeHoldingsFilteredOut: Math.max(rawHoldingsCount - (currentHoldingsCount ?? 0), 0),
        heldValueThresholdSol: HOLD_VALUE_THRESHOLD_SOL,
        walletPnlSol,
        walletPnlUsd,
        solBalance,
        oldestTransactionTimestamp,
        newestTransactionTimestamp,
      };
    } catch (error) {
      this.logger.warn(`Error analyzing wallet ${walletAddress}: ${getErrorMessage(error)}`);
      return {
        walletAddress,
        rank,
        supplyPercent,
        medianHoldTimeHours: null,
        avgHoldTimeHours: null,
        dailyFlipRatio: null,
        dailyFlipRatioConfidence: 'NONE',
        behaviorType: null,
        exitPattern: null,
        dataQualityTier: 'INSUFFICIENT' as const,
        completedCycleCount: 0,
        confidence: 0,
        insufficientDataReason: `Analysis error: ${error instanceof Error ? error.message : 'unknown'}`,
        processingTimeMs: Date.now() - walletStartTime,
        holdTimeDistribution: undefined,
        enrichedHoldTimeDistribution: undefined,
        includesCurrentHoldings: false,
        exitRate: null,
        totalTokensTraded: 0,
        typicalHoldTimeHours: null,
        typicalHoldTimeSource: 'CURRENT',
        realizedMedianHoldTimeHours: null,
        realizedAverageHoldTimeHours: null,
        currentHoldMedianHours: null,
        currentHoldAverageHours: null,
        percentValueInCurrentHoldings: null,
        currentHoldingsCount: null,
        currentHoldings: currentHoldings,
        walletPnlSol,
        walletPnlUsd,
        solBalance,
        oldestTransactionTimestamp,
        newestTransactionTimestamp,
      };
    }
  }

  /**
   * Calculate daily flip ratio from historical pattern distribution
   * % of completed positions held <5min (instant + ultraFast + fast categories)
   * Returns ratio (0-100) and confidence level based on sample size
   */
  private calculateDailyFlipRatioFromPattern(historicalPattern: any): { ratio: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' } {
    if (!historicalPattern?.holdTimeDistribution) {
      return { ratio: 0, confidence: 'NONE' };
    }

    const dist = historicalPattern.holdTimeDistribution;
    const total = historicalPattern.completedCycleCount;

    if (total === 0) {
      return { ratio: 0, confidence: 'NONE' };
    }

    // <5min includes: instant (<0.36s), ultraFast (<1min), fast (1-5min)
    const shortHolds = (dist.instant || 0) + (dist.ultraFast || 0) + (dist.fast || 0);

    // Calculate ratio: (short holds / total completed) * 100
    // This shows what % of their positions are ultra-short flips
    const ratio = (shortHolds / total) * 100;

    // Determine confidence based on sample size
    // HIGH: ≥30 completed cycles (reliable pattern)
    // MEDIUM: 10-29 completed cycles (decent sample)
    // LOW: 3-9 completed cycles (minimum viable)
    // NONE: <3 completed cycles (insufficient data)
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    if (total >= 30) {
      confidence = 'HIGH';
    } else if (total >= 10) {
      confidence = 'MEDIUM';
    } else if (total >= 3) {
      confidence = 'LOW';
    } else {
      confidence = 'NONE';
    }

    return { ratio, confidence };
  }

  private computeTypicalHoldTimeMetrics(params: {
    realizedMedian: number | null;
    realizedAverage: number | null;
    currentMedian: number | null;
    currentAverage: number | null;
    percentCurrentValue: number | null;
  }): { median: number | null; average: number | null; source: HolderProfile['typicalHoldTimeSource'] } {
    const clampPercent = (value: number | null) => {
      if (value === null || value === undefined || Number.isNaN(value)) return null;
      return Math.min(Math.max(value, 0), 100);
    };
    const percentCurrent = clampPercent(params.percentCurrentValue);
    const contributions: Array<{
      source: HolderProfile['typicalHoldTimeSource'];
      weight: number;
      median: number;
      average: number | null;
    }> = [];

    const resolvedWeights = (target: 'CURRENT' | 'EXITED') => {
      if (percentCurrent === null) {
        if (params.currentMedian !== null && params.realizedMedian !== null) {
          return 0.5;
        }
        return 1;
      }
      if (target === 'CURRENT') {
        return percentCurrent / 100;
      }
      return 1 - percentCurrent / 100;
    };

    if (params.realizedMedian !== null) {
      const weight = resolvedWeights('EXITED');
      contributions.push({
        source: 'EXITED',
        weight,
        median: params.realizedMedian,
        average: params.realizedAverage,
      });
    }
    if (params.currentMedian !== null) {
      const weight = resolvedWeights('CURRENT');
      contributions.push({
        source: 'CURRENT',
        weight,
        median: params.currentMedian,
        average: params.currentAverage,
      });
    }

    const totalWeight = contributions.reduce((sum, contrib) => sum + contrib.weight, 0);
    let median: number | null = null;
    let average: number | null = null;

    if (totalWeight > 0) {
      median = contributions.reduce((sum, contrib) => sum + contrib.median * (contrib.weight / totalWeight), 0);
      const averageContribs = contributions.filter(contrib => contrib.average !== null);
      if (averageContribs.length > 0) {
        average = averageContribs.reduce(
          (sum, contrib) => sum + (contrib.average ?? 0) * (contrib.weight / totalWeight),
          0,
        );
      } else {
        average = median;
      }
    } else if (params.realizedMedian !== null) {
      median = params.realizedMedian;
      average = params.realizedAverage ?? params.realizedMedian;
    } else if (params.currentMedian !== null) {
      median = params.currentMedian;
      average = params.currentAverage ?? params.currentMedian;
    }

    let source: HolderProfile['typicalHoldTimeSource'] = 'CURRENT';
    if (contributions.length > 1 && (contributions[0].weight > 0 || contributions[1].weight > 0)) {
      source = 'MIXED';
    } else if (contributions.length === 1) {
      source = contributions[0].source;
    } else if (params.realizedMedian !== null && params.currentMedian === null) {
      source = 'EXITED';
    }

    return { median, average, source };
  }

  /**
   * Determine data quality tier based on cycle count and confidence
   */
  private determineDataQualityTier(cycles: number, confidence: number): 'GOLD' | 'SILVER' | 'BRONZE' | 'INSUFFICIENT' {
    if (cycles >= 30 && confidence >= 0.8) return 'GOLD';
    if (cycles >= 10 && confidence >= 0.6) return 'SILVER';
    if (cycles >= 3) return 'BRONZE';
    return 'INSUFFICIENT';
  }


  /**
   * Check if operation has exceeded timeout
   */
  private checkTimeout(startTime: number, timeoutMs: number, operation: string): void {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Operation '${operation}' timed out after ${timeoutMs / 1000}s`);
    }
  }

  /**
   * Shutdown the worker gracefully
   */
  async shutdown(): Promise<void> {
    this.logger.debug('Shutting down AnalysisOperationsProcessor worker...');
    await this.worker.close();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.shutdown();
    } catch (err) {
      this.logger.warn(`Error shutting down AnalysisOperationsProcessor worker: ${getErrorMessage(err)}`);
    }
  }

  private readonly sigBuyersResultTtlSeconds = 15 * 60; // 15 minutes

  /**
   * Process a significant buyers job.
   *
   * Mirrors the holder-profiles pointer pattern:
   * - Calls SigBuyersService synchronously (the job IS the work)
   * - Stores the full SigBuyersResponseDto in Redis under `sig-buyers:result:{jobId}`
   * - Returns only { resultKey, success } as the BullMQ return value
   * - Frontend hydrates via GET /jobs/result/by-key?key=...
   */
  private async processSigBuyers(job: Job<SigBuyersJobData>): Promise<object> {
    const { mint, startTime, endTime, minSolSpent, maxTransactions, requestId } = job.data;
    const t0 = Date.now();

    this.logger.log(`sig-buyers-run START: mint=${mint} window=${new Date(startTime * 1000).toISOString()}–${new Date(endTime * 1000).toISOString()} minSol=${minSolSpent} requestId=${requestId}`);

    await job.updateProgress(5);

    const result = await this.sigBuyersService.findSignificantBuyers(
      mint,
      startTime,
      endTime,
      minSolSpent,
      maxTransactions,
    );

    this.logger.log(`sig-buyers-run DONE: mint=${mint} txFetched=${result.totalTransactionsFetched} wallets=${result.qualifyingWallets} elapsed=${Date.now() - t0}ms`);
    await job.updateProgress(95);

    const resultKey = `sig-buyers:result:${job.id}`;
    try {
      await this.redisClient.set(resultKey, JSON.stringify(result), 'EX', this.sigBuyersResultTtlSeconds);
      this.logger.log(`sig-buyers-run completed for ${mint} in ${Date.now() - t0}ms — ${result.qualifyingWallets} wallets`);
      await job.updateProgress(100);
      return {
        success: true,
        data: { resultKey },
        metadata: {
          qualifyingWallets: result.qualifyingWallets,
          totalTransactionsFetched: result.totalTransactionsFetched,
          durationMs: result.durationMs,
        },
      };
    } catch (storeError) {
      this.logger.error(`Failed to store sig-buyers result in Redis for job ${job.id}: ${getErrorMessage(storeError)}`);
      // Fall back to returning the full result inline
      return { success: true, data: result };
    }
  }
} 
