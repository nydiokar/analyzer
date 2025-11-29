import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueNames, QueueConfigs, JobTimeouts, JobPriority } from '../config/queue.config';
import { AnalyzePnlJobData, AnalyzeBehaviorJobData, DashboardWalletAnalysisJobData, AnalysisResult, AnalyzeHolderProfilesJobData, HolderProfilesResult, HolderProfile } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
import { buildHolderProfilesJobId } from '../utils/holder-profiles-job-id';
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
import { ANALYSIS_EXECUTION_CONFIG, DASHBOARD_ANALYSIS_SCOPE_DEFAULTS, DASHBOARD_JOB_CONFIG, PROCESSING_CONFIG } from '../../config/constants';
import { JobProgressGateway } from '../../api/shared/job-progress.gateway';
import { TokenInfoService } from '../../api/services/token-info.service';
import { TokenHoldersService } from '../../api/services/token-holders.service';
import { HolderProfilesCacheService } from '../../api/services/holder-profiles-cache.service';
import { runMintParticipantsFlow } from '../../core/flows/mint-participants';
import { TelegramAlertsService } from '../../api/services/telegram-alerts.service';
import { AnalysisOperationsQueue } from '../queues/analysis-operations.queue';
import { DashboardAnalysisScope, DashboardAnalysisTriggerSource } from '../../shared/dashboard-analysis.types';
import { DexscreenerService } from '../../api/services/dexscreener.service';
import { BalanceCacheService } from '../../api/services/balance-cache.service';
import { WalletBalance } from '../../types/wallet';
import type { HolderProfileSnapshot, Wallet as PrismaWallet } from '@prisma/client';

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
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
    private readonly heliusApiClient: HeliusApiClient,
    private readonly jobProgressGateway: JobProgressGateway,
    private readonly tokenInfoService: TokenInfoService,
    private readonly tokenHoldersService: TokenHoldersService,
    private readonly holderProfilesCacheService: HolderProfilesCacheService,
    private readonly telegramAlerts: TelegramAlertsService,
    private readonly dexscreenerService: DexscreenerService,
    private readonly balanceCacheService: BalanceCacheService,
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
      this.logger.error(`Job ${job?.id} from queue ${job?.queueName} failed:`, err);
    });

    this.worker.on('error', (err) => {
      this.logger.error('Worker error in AnalysisOperationsProcessor:', err);
    });

    this.logger.log('AnalysisOperationsProcessor has been initialized');
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
        return this.processAnalyzeHolderProfiles(job as Job<AnalyzeHolderProfilesJobData>);
      case 'mint-participants-run':
        return this.processMintParticipants(job as Job<{ mint: string; cutoffTs: number; signature?: string }>);
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
      this.logger.warn(`Could not acquire lock for PnL analysis on ${walletAddress}, job ${job.id} will be retried.`);
      throw new Error(`PnL analysis already in progress for wallet ${walletAddress}`);
    }

    try {
      await job.updateProgress(5);
      this.logger.log(`Starting PnL analysis for ${walletAddress}`);

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

      this.logger.log(`PnL analysis completed for ${walletAddress}. RunId: ${pnlResult.runId}`);
      return result;

    } catch (error) {
      this.logger.error(`PnL analysis failed for ${walletAddress}:`, error);
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
      this.logger.warn(`Could not acquire lock for behavior analysis on ${walletAddress}, job ${job.id} will be retried.`);
      throw new Error(`Behavior analysis already in progress for wallet ${walletAddress}`);
    }

    try {
      await job.updateProgress(5);
      this.logger.log(`Starting behavior analysis for ${walletAddress}`);

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

      // 🔄 Invalidate holder profiles cache for this wallet (behavioral metrics updated)
      await this.holderProfilesCacheService.invalidateForWallet(walletAddress);

      this.logger.log(`Behavior analysis completed for ${walletAddress}`);
      return result;

    } catch (error) {
      this.logger.error(`Behavior analysis failed for ${walletAddress}:`, error);
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

    const expectedJobId = generateJobId.dashboardWalletAnalysis(walletAddress, job.data.requestId);
    if (job.id !== expectedJobId) {
      this.logger.warn(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
      throw new Error(`Job ID mismatch - possible duplicate`);
    }

    const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'dashboard-analysis');
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);

    if (!lockAcquired) {
      this.logger.warn(
        `Could not acquire lock for dashboard analysis on ${walletAddress} [scope=${scope}], job ${job.id} will be retried.`,
      );
      throw new Error(`Dashboard analysis already in progress for wallet ${walletAddress}`);
    }

    let enrichmentJob: Job | undefined;
    const followUpJobsQueued: Array<{ scope: DashboardAnalysisScope; jobId: string }> = [];

    const nowSeconds = Math.floor(Date.now() / 1000);
    const timeRange =
      scope === 'deep'
        ? undefined
        : {
            startTs: Math.max(0, nowSeconds - Math.round((effectiveHistoryWindowDays ?? 7) * 86400)),
            endTs: nowSeconds,
          };

    try {
      await job.updateProgress(5);
      this.logger.log(
        `Starting dashboard analysis for wallet ${walletAddress} [scope=${scope}, trigger=${triggerSource}]`,
      );

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
        
        // Cache with 10-minute TTL for dashboard analysis chains
        const fetchedBalance = balanceData?.get(walletAddress);
        if (fetchedBalance) {
          await this.balanceCacheService.cacheBalances(walletAddress, fetchedBalance, 600);
          this.logger.debug(`Cached balances for ${walletAddress} for follow-up scopes`);
        }
      }
      await job.updateProgress(50);

      // Fetch SOL price for unrealized PNL calculations (cached in Redis with 30s TTL)
      let solPriceUsd: number | undefined;
      try {
        solPriceUsd = await this.tokenInfoService.getSolPrice();
        this.logger.log(`Fetched SOL price for PNL analysis: $${solPriceUsd}`);
      } catch (error) {
        this.logger.warn(`Failed to fetch SOL price, unrealized PNL will not be calculated: ${error}`);
      }
      await job.updateProgress(55);

      this.logger.debug(`Running PNL analysis for ${walletAddress} [scope=${scope}]`);
      const pnlResult = await this.pnlAnalysisService.analyzeWalletPnl(walletAddress, timeRange, {
        preFetchedBalances: balanceData,
        solPriceUsd,
      });
      await job.updateProgress(75);

      this.logger.debug(`Running behavior analysis for ${walletAddress} [scope=${scope}]`);
      const behaviorConfig: BehaviorAnalysisConfig = {
        ...this.behaviorService.getDefaultBehaviorAnalysisConfig(),
        ...(timeRange ? { timeRange } : {}),
      };
      const behaviorResult = await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig, timeRange);
      await job.updateProgress(85);

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
        });
        if (queuedJobId) {
          followUpJobsQueued.push({ scope: 'deep', jobId: queuedJobId });
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
        timestamp: Date.now(),
        processingTimeMs,
      };

      this.logger.log(
        `✅ Dashboard analysis for ${walletAddress} [scope=${scope}] completed in ${processingTimeMs}ms. Follow-ups queued: ${
          followUpJobsQueued.map((f) => `${f.scope}:${f.jobId}`).join(',') || 'none'
        }`,
      );

      await this.jobProgressGateway.publishCompletedEvent(job.id!, 'analysis-operations', result, processingTimeMs);

      return result;
    } catch (error) {
      this.logger.error(`Dashboard analysis for ${walletAddress} [scope=${scope}] failed:`, error);

      await this.databaseService.recordDashboardAnalysisRun({
        walletAddress,
        scope,
        status: 'FAILED',
        triggerSource,
        runTimestamp: new Date(),
        notes: { error: error instanceof Error ? error.message : 'unknown-error' },
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

    this.logger.log(
      `Queued follow-up ${params.scope} analysis job ${job.id} for wallet ${params.walletAddress} (parent=${params.parentRequestId})`,
    );

    return job.id ?? null;
  }

  /**
   * Process holder profiles analysis job
   * Supports analyzing top holders for a token or an individual wallet
   */
  async processAnalyzeHolderProfiles(job: Job<AnalyzeHolderProfilesJobData>): Promise<HolderProfilesResult> {
    const { mode = 'token', tokenMint, topN = 10, walletAddress } = job.data;
    const startTime = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    const syncConcurrency = Math.max(1, PROCESSING_CONFIG.WALLET_SYNC_CONCURRENCY || 3);

    // Simple bounded concurrency helper to avoid sequential bottlenecks
    const processWithConcurrency = async <T>(
      items: T[],
      limit: number,
      worker: (item: T, index: number) => Promise<void>,
    ) => {
      const size = Math.min(limit, items.length);
      let cursor = 0;
      const runners = Array.from({ length: size }).map(async () => {
        while (cursor < items.length) {
          const idx = cursor++;
          await worker(items[idx], idx);
        }
      });
      await Promise.all(runners);
    };

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

    this.logger.log(`Starting holder profiles analysis for token ${tokenMint} [topN=${topN}]`);

    try {
      const cachedResult = await this.holderProfilesCacheService.getTokenResult(tokenMint, topN);
      if (cachedResult) {
        this.logger.log(`Returning cached holder profiles for ${tokenMint} (topN=${topN})`);
        await job.updateProgress(100);
        return cachedResult;
      }

      this.checkTimeout(startTime, timeoutMs, 'Starting holder profiles analysis');
      await job.updateProgress(5);

      this.logger.debug(`Fetching top ${topN} holders for ${tokenMint}...`);
      const topHoldersResponse = await this.tokenHoldersService.getTopHolders(tokenMint);

      this.checkTimeout(startTime, timeoutMs, 'Fetching top holders');
      await job.updateProgress(10);

      this.logger.debug(`Fetching actual token supply for ${tokenMint}...`);
      let actualTotalSupply: number;
      try {
        const cachedSupply = await this.tokenInfoService.getTokenSupply(tokenMint);
        if (cachedSupply !== undefined) {
          actualTotalSupply = cachedSupply;
          this.logger.debug(`Token ${tokenMint} total supply (cached): ${actualTotalSupply}`);
        } else {
          this.logger.warn(`Failed to fetch token supply for ${tokenMint}, falling back to sum of holders`);
          actualTotalSupply = topHoldersResponse.holders.reduce((sum, h) => sum + (h.uiAmount || 0), 0);
        }
      } catch (supplyError) {
        this.logger.warn(`Error fetching token supply for ${tokenMint}, falling back to sum of holders:`, supplyError);
        actualTotalSupply = topHoldersResponse.holders.reduce((sum, h) => sum + (h.uiAmount || 0), 0);
      }

      this.checkTimeout(startTime, timeoutMs, 'Fetching token supply');
      await job.updateProgress(15);

      const topHolders = topHoldersResponse.holders.slice(0, topN);
      const walletAddresses = topHolders
        .map(h => h.ownerAccount)
        .filter((addr): addr is string => addr !== undefined);

      const holderMetadataByWallet = new Map<string, { rank: number; supplyPercent: number }>();
      topHolders.forEach((holder, index) => {
        if (!holder.ownerAccount) return;
        const supplyPercent = actualTotalSupply > 0 ? ((holder.uiAmount || 0) / actualTotalSupply) * 100 : 0;
        holderMetadataByWallet.set(holder.ownerAccount, {
          rank: typeof holder.rank === 'number' ? holder.rank : index + 1,
          supplyPercent,
        });
      });

      if (walletAddresses.length === 0) {
        this.logger.warn(`No holder wallet addresses found for ${tokenMint}`);
        return {
          success: true,
          mode: 'token',
          tokenMint,
          profiles: [],
          metadata: {
            totalHoldersRequested: topN,
            totalHoldersAnalyzed: 0,
            totalProcessingTimeMs: Date.now() - startTime,
            avgProcessingTimePerWalletMs: 0,
          },
          timestamp: Date.now(),
          processingTimeMs: Date.now() - startTime,
        };
      }

      this.logger.log(`Analyzing ${walletAddresses.length} holder wallets for ${tokenMint}...`);
      const snapshotCacheEnabled = this.isHolderSnapshotCacheEnabled();
      await job.updateProgress(20);

      const latestSnapshots = snapshotCacheEnabled
        ? await this.databaseService.getLatestHolderProfileSnapshotsForToken(tokenMint, walletAddresses)
        : new Map<string, HolderProfileSnapshot>();
      if (snapshotCacheEnabled) {
        this.logger.log(`Found ${latestSnapshots.size}/${walletAddresses.length} cached holder profile snapshots`);
      }

      const walletRecordMap: Map<string, PrismaWallet> = snapshotCacheEnabled
        ? new Map(
            (await this.databaseService.getWallets(walletAddresses, true) as PrismaWallet[]).map(wallet => [
              wallet.address,
              wallet,
            ]),
          )
        : new Map<string, PrismaWallet>();

      // Sync stale/missing holders first (same as wallet-mode flow)
      this.logger.debug(`Checking wallet statuses for top holders of ${tokenMint}`);
      const holderStatuses = await this.databaseService.getWalletsStatus(walletAddresses);
      const statusMap = new Map(holderStatuses.statuses.map(status => [status.walletAddress, status]));
      const walletsNeedingAnalysis = walletAddresses.filter(addr => {
        const status = statusMap.get(addr);
        const snapshot = latestSnapshots.get(addr);
        const walletRecord = walletRecordMap.get(addr);
        const snapshotFresh = snapshotCacheEnabled && snapshot ? this.isHolderSnapshotFresh(snapshot, walletRecord) : false;
        if (!status) return true;
        if (status.status === 'STALE' || status.status === 'MISSING' || status.status === 'IN_PROGRESS') return true;
        if (!snapshotFresh) return true;
        return false;
      });
      const walletsNeedingAnalysisSet = new Set(walletsNeedingAnalysis);
      const walletsNeedingSync = walletsNeedingAnalysis.filter(addr => {
        const status = statusMap.get(addr);
        return status?.status === 'STALE' || status?.status === 'MISSING';
      });
      const readyWalletsOrdered = snapshotCacheEnabled
        ? topHolders
            .map(holder => holder.ownerAccount)
            .filter((addr): addr is string => !!addr && !walletsNeedingAnalysisSet.has(addr))
        : [];
      const walletsNeedingAnalysisOrdered = topHolders
        .map(holder => holder.ownerAccount)
        .filter((addr): addr is string => !!addr && walletsNeedingAnalysisSet.has(addr));

      const syncPromise = (async () => {
        if (walletsNeedingSync.length > 0) {
          this.logger.log(`Syncing ${walletsNeedingSync.length} holder wallets for ${tokenMint}`);
          const syncOptions: SyncOptions = {
            limit: 100,
            fetchAll: true,
            skipApi: false,
            fetchOlder: true,
            maxSignatures: ANALYSIS_EXECUTION_CONFIG.HOLDER_PROFILES_MAX_SIGNATURES,
            smartFetch: true,
          };
          await processWithConcurrency(walletsNeedingSync, syncConcurrency, async (addr) => {
            try {
              await this.heliusSyncService.syncWalletData(addr, syncOptions);
            } catch (syncErr) {
              this.logger.warn(`Sync failed for holder wallet ${addr}:`, syncErr);
            }
          });
        } else {
          this.logger.debug(`All holder wallets for ${tokenMint} appear current (status check)`);
        }
      })();
      await job.updateProgress(30);
      await job.updateProgress(40);

      const progressStep = 50 / walletAddresses.length;
      let completedCount = 0;
      const partialProfiles: HolderProfile[] = [];
      const profiles: HolderProfile[] = [];

      const publishProfile = async (profile: HolderProfile, walletAddress: string) => {
        completedCount++;
        const percent = 40 + Math.floor(completedCount * progressStep);
        await job.updateProgress(percent);
        partialProfiles.push(profile);
        profiles.push(profile);

        const progressPayload = {
          mode: 'token',
          tokenMint,
          totalHoldersRequested: walletAddresses.length,
          analyzedCount: partialProfiles.length,
          profiles: [...partialProfiles],
        };
        this.logger.log(
          `Streaming partial holder profile (${partialProfiles.length}/${walletAddresses.length}) for token ${tokenMint}: ${walletAddress}`,
        );
        await this.jobProgressGateway.publishProgressEvent(job.id!, job.queueName, progressPayload);
      };

      const runFullAnalysis = async (walletAddress: string, swapRecords: any[]) => {
        const metadata = holderMetadataByWallet.get(walletAddress);
        if (!metadata) {
          this.logger.warn(`Missing holder metadata for wallet ${walletAddress}, skipping`);
          return;
        }

        if (swapRecords.length > 0) {
          try {
            await this.pnlAnalysisService.analyzeWalletPnl(walletAddress, undefined);
          } catch (pnlError) {
            this.logger.warn(`PnL analysis failed for holder wallet ${walletAddress}:`, pnlError);
          }
        }

        const profile = await this.analyzeWalletProfile(
          walletAddress,
          metadata.rank,
          metadata.supplyPercent,
          swapRecords,
        );
        if (snapshotCacheEnabled) {
          await this.databaseService.saveHolderProfileSnapshot({
            walletAddress,
            tokenMint,
            analysisMode: 'token',
            holderRank: metadata.rank,
            supplyPercent: metadata.supplyPercent,
            topN,
            jobId: job.id?.toString() ?? null,
            requestId: job.data.requestId,
            profile,
            metadata: {
              mode: 'token',
            },
          });
        }
        await publishProfile(profile, walletAddress);
      };

      if (snapshotCacheEnabled && readyWalletsOrdered.length > 0) {
        this.logger.log(`Serving ${readyWalletsOrdered.length} cached holder profiles immediately (no sync needed)`);
        for (const walletAddress of readyWalletsOrdered) {
          try {
            const metadata = holderMetadataByWallet.get(walletAddress);
            const snapshot = latestSnapshots.get(walletAddress);
            if (!metadata || !snapshot) {
              continue;
            }
            const profile = this.hydrateSnapshotProfile(snapshot, metadata);
            await publishProfile(profile, walletAddress);
          } catch (error) {
            this.logger.warn(`Failed to stream cached holder profile for ${walletAddress}:`, error);
          }
        }
      } else {
        this.logger.debug('No cached holder profiles to serve immediately');
      }

      await syncPromise;

      if (walletsNeedingAnalysisOrdered.length > 0) {
        this.logger.debug(`Batch fetching swap records for ${walletsNeedingAnalysisOrdered.length} wallets needing analysis...`);
        let allSwapRecords = await this.databaseService.getSwapAnalysisInputsBatch(walletsNeedingAnalysisOrdered);

        this.checkTimeout(startTime, timeoutMs, 'Fetching swap records');

        const swapRecordsByWallet: Record<string, typeof allSwapRecords> = {};
        for (const record of allSwapRecords) {
          if (!swapRecordsByWallet[record.walletAddress]) {
            swapRecordsByWallet[record.walletAddress] = [];
          }
          swapRecordsByWallet[record.walletAddress].push(record);
        }

        // If any wallets queued for re-analysis have no swap records, force a fresh sync + refetch
        const walletsMissingData = walletsNeedingAnalysisOrdered.filter(
          addr => !swapRecordsByWallet[addr] || swapRecordsByWallet[addr].length === 0,
        );
        if (walletsMissingData.length > 0) {
          this.logger.log(`Detected ${walletsMissingData.length} holder wallets with no swap records; forcing sync (tokenMode)`);
          const syncOptions: SyncOptions = {
            limit: 100,
            fetchAll: true,
            skipApi: false,
            fetchOlder: true,
            maxSignatures: ANALYSIS_EXECUTION_CONFIG.HOLDER_PROFILES_MAX_SIGNATURES,
            smartFetch: true,
          };
          await processWithConcurrency(walletsMissingData, syncConcurrency, async (addr) => {
            try {
              await this.heliusSyncService.syncWalletData(addr, syncOptions);
            } catch (syncErr) {
              this.logger.warn(`Sync failed for holder wallet ${addr}:`, syncErr);
            }
          });

          // Refetch swap records for the missing wallets only
          allSwapRecords = await this.databaseService.getSwapAnalysisInputsBatch(walletsNeedingAnalysisOrdered);
          for (const record of allSwapRecords) {
            if (!swapRecordsByWallet[record.walletAddress]) {
              swapRecordsByWallet[record.walletAddress] = [];
            }
            swapRecordsByWallet[record.walletAddress].push(record);
          }
          this.logger.debug(`Refetched swap records for ${walletsMissingData.length} wallets after sync`);
        }

        for (const walletAddress of walletsNeedingAnalysisOrdered) {
          const walletSwapRecords = swapRecordsByWallet[walletAddress] || [];
          try {
            await runFullAnalysis(walletAddress, walletSwapRecords);
          } catch (error) {
            this.logger.warn(`Failed to analyze wallet ${walletAddress}:`, error);
          }
        }
      }

      this.checkTimeout(startTime, timeoutMs, 'Completing analysis');
      await job.updateProgress(95);

      this.logger.log(`Completed analyzing ${profiles.length}/${walletAddresses.length} holders for ${tokenMint}`);

      const processingTimeMs = Date.now() - startTime;
      const result: HolderProfilesResult = {
        success: true,
        mode: 'token',
        tokenMint,
        profiles,
        metadata: {
          totalHoldersRequested: topN,
          totalHoldersAnalyzed: profiles.length,
          totalProcessingTimeMs: processingTimeMs,
          avgProcessingTimePerWalletMs: profiles.length > 0
            ? Math.round(processingTimeMs / profiles.length)
            : 0,
        },
        timestamp: Date.now(),
        processingTimeMs,
      };

      await job.updateProgress(100);
      this.logger.log(`Holder profiles analysis for ${tokenMint} completed in ${processingTimeMs}ms`);

      await this.holderProfilesCacheService.cacheTokenResult(tokenMint, topN, result);

      // Emit WebSocket completion event so frontend receives updates
      await this.jobProgressGateway.publishCompletedEvent(job.id!, 'analysis-operations', result, processingTimeMs);

      return result;
    } catch (error) {
      this.logger.error(`Holder profiles analysis failed for ${tokenMint}:`, error);
      throw error;
    }
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
    this.logger.log(`Starting holder profile analysis for wallet ${walletAddress}`);

    const cached = await this.holderProfilesCacheService.getWalletResult(walletAddress);
    if (cached) {
      this.logger.log(`Returning cached holder profile for wallet ${walletAddress}`);
      await job.updateProgress(100);
      return cached;
    }

    const snapshotCacheEnabled = this.isHolderSnapshotCacheEnabled();
    if (snapshotCacheEnabled) {
      const walletRecord = await this.databaseService.getWallet(walletAddress);
      const latestSnapshot = await this.databaseService.getLatestHolderProfileSnapshot({
        walletAddress,
        tokenMint: null,
        analysisMode: 'wallet',
      });

      if (latestSnapshot && this.isHolderSnapshotFresh(latestSnapshot, walletRecord)) {
        this.logger.log(`Serving cached holder snapshot for wallet ${walletAddress}`);
        const profile = latestSnapshot.profile as HolderProfile;
        const processingTimeMs = Date.now() - startTime;
        const result: HolderProfilesResult = {
          success: true,
          mode: 'wallet',
          targetWallet: walletAddress,
          profiles: [profile],
          metadata: {
            totalHoldersRequested: 1,
            totalHoldersAnalyzed: 1,
            totalProcessingTimeMs: processingTimeMs,
            avgProcessingTimePerWalletMs: processingTimeMs,
          },
          timestamp: Date.now(),
          processingTimeMs,
        };
        await job.updateProgress(100);
        return result;
      }
    }

    this.checkTimeout(startTime, timeoutMs, 'Starting wallet holder profile analysis');
    await job.updateProgress(5);

    // Check if wallet needs sync
    this.logger.debug(`Checking wallet status for ${walletAddress}`);
    const walletStatuses = await this.databaseService.getWalletsStatus([walletAddress]);
    const needsSync =
      walletStatuses.statuses[0].status === 'STALE' ||
      walletStatuses.statuses[0].status === 'MISSING';

    await job.updateProgress(10);

    // Sync wallet if needed
    if (needsSync) {
      this.logger.log(`Syncing wallet ${walletAddress} for holder profile analysis`);
      const syncOptions: SyncOptions = {
        limit: 100,
        fetchAll: true,
        skipApi: false,
        fetchOlder: true,
        maxSignatures: ANALYSIS_EXECUTION_CONFIG.HOLDER_PROFILES_MAX_SIGNATURES, // Reasonable default for holder analysis
        smartFetch: true,
      };
      await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
      this.logger.log(`Wallet sync completed for ${walletAddress}`);
    } else {
      this.logger.debug(`Wallet ${walletAddress} is up-to-date, skipping sync`);
    }

    await job.updateProgress(30);
    this.checkTimeout(startTime, timeoutMs, 'Wallet sync completed');

    const swapRecords = await this.databaseService.getSwapAnalysisInputs(walletAddress);
    this.logger.debug(`Fetched ${swapRecords.length} swap records for ${walletAddress}`);
    this.checkTimeout(startTime, timeoutMs, 'Fetching wallet swap records');
    await job.updateProgress(40);

    // Aggregate SwapAnalysisInput → AnalysisResult (PnL calculation)
    this.logger.debug(`Running PnL aggregation for ${walletAddress} [holder-profile mode]`);
    await this.pnlAnalysisService.analyzeWalletPnl(walletAddress, undefined);
    await job.updateProgress(50);

    const profile = await this.analyzeWalletProfile(walletAddress, 1, 0, swapRecords);
    if (snapshotCacheEnabled) {
      await this.databaseService.saveHolderProfileSnapshot({
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
    }

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

    // Emit WebSocket completion event so frontend receives updates
    await this.jobProgressGateway.publishCompletedEvent(job.id!, 'analysis-operations', result, processingTimeMs);

    this.logger.log(`Holder profile analysis for wallet ${walletAddress} completed in ${processingTimeMs}ms`);

    return result;
  }
  private async processMintParticipants(job: Job<{ mint: string; cutoffTs: number; signature?: string }>): Promise<{ success: boolean; written?: number; zeroDayAlerts?: number; processingTimeMs: number }> {
    const { mint, cutoffTs } = job.data;
    const startTime = Date.now();

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
      return { success: true, written: result.writtenCount, zeroDayAlerts: alertCount, processingTimeMs: Date.now() - startTime };
    } catch (err) {
      this.logger.error(`mint-participants-run failed for ${mint}@${cutoffTs}`, err as Error);
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
        oldestTransactionTimestamp,
        newestTransactionTimestamp,
      };
    }

    // Query pre-computed PnL from AnalysisResult table (source of truth)
    let pnlMap: Map<string, { pnl: number; capital: number }> | undefined;
    let currentHoldings: Array<{ tokenAddress: string; uiBalance: number | null; decimals: number | null }> = [];
    try {
      const pnlResults = await this.databaseService.getAnalysisResults({
        where: { walletAddress },
      });

      if (pnlResults.length > 0) {
        pnlMap = new Map(
          pnlResults.map(r => [
            r.tokenAddress,
            {
              pnl: r.netSolProfitLoss,
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
          }));
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
      const currentHoldingsCount = typeof behaviorResult?.tokensWithOnlyBuys === 'number'
        ? behaviorResult.tokensWithOnlyBuys
        : null;
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

      // Determine data quality tier
      const dataQualityTier = hasEnoughExitedData
        ? this.determineDataQualityTier(
            historicalPattern.completedCycleCount,
            historicalPattern.dataQuality,
          )
        : 'LOW' as const; // Current holdings data = lower quality

      return {
        walletAddress,
        rank,
        supplyPercent,
        medianHoldTimeHours,
        avgHoldTimeHours,
        dailyFlipRatio: flipRatioResult.ratio,
        dailyFlipRatioConfidence: flipRatioResult.confidence,
        behaviorType: historicalPattern?.behaviorType ?? null,
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
        currentHoldings,
        oldestTransactionTimestamp,
        newestTransactionTimestamp,
      };
    } catch (error) {
      this.logger.warn(`Error analyzing wallet ${walletAddress}:`, error);
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
  private determineDataQualityTier(cycles: number, confidence: number): 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT' {
    if (cycles >= 30 && confidence >= 0.8) return 'HIGH';
    if (cycles >= 10 && confidence >= 0.6) return 'MEDIUM';
    if (cycles >= 3) return 'LOW';
    return 'INSUFFICIENT';
  }

  private isHolderSnapshotCacheEnabled(): boolean {
    return process.env.DISABLE_HOLDER_PROFILE_SNAPSHOT_CACHE === 'true' ? false : true;
  }

  private hydrateSnapshotProfile(
    snapshot: HolderProfileSnapshot,
    metadata: { rank: number; supplyPercent: number },
  ): HolderProfile {
    const raw = snapshot.profile as HolderProfile;
    const cloned: HolderProfile = JSON.parse(JSON.stringify(raw));
    cloned.rank = metadata.rank;
    cloned.supplyPercent = metadata.supplyPercent;
    return cloned;
  }

  private isHolderSnapshotFresh(
    snapshot: HolderProfileSnapshot,
    walletRecord?: PrismaWallet | null,
  ): boolean {
    const computedAt =
      snapshot.computedAt instanceof Date
        ? snapshot.computedAt.getTime()
        : new Date(snapshot.computedAt).getTime();
    if (Number.isNaN(computedAt)) {
      return false;
    }

    if (walletRecord?.lastSuccessfulFetchTimestamp instanceof Date) {
      return computedAt >= walletRecord.lastSuccessfulFetchTimestamp.getTime();
    }

    return Date.now() - computedAt < 60 * 60 * 1000;
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
    this.logger.log('Shutting down AnalysisOperationsProcessor worker...');
    await this.worker.close();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.shutdown();
    } catch (err) {
      this.logger.warn('Error shutting down AnalysisOperationsProcessor worker', err as Error);
    }
  }
} 
