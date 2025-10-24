import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueNames, QueueConfigs, JobTimeouts, JobPriority } from '../config/queue.config';
import { AnalyzePnlJobData, AnalyzeBehaviorJobData, DashboardWalletAnalysisJobData, AnalysisResult } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
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
import { JobProgressGateway } from '../../api/shared/job-progress.gateway';
import { TokenInfoService } from '../../api/services/token-info.service';
import { runMintParticipantsFlow } from '../../core/flows/mint-participants';
import { TelegramAlertsService } from '../../api/services/telegram-alerts.service';
import { AnalysisOperationsQueue } from '../queues/analysis-operations.queue';
import { DashboardAnalysisScope, DashboardAnalysisTriggerSource } from '../../shared/dashboard-analysis.types';

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
    private readonly telegramAlerts: TelegramAlertsService,
  ) {
    const config = QueueConfigs[QueueNames.ANALYSIS_OPERATIONS];
    
    this.worker = new Worker(
      QueueNames.ANALYSIS_OPERATIONS,
      async (job: Job) => this.processJob(job),
      config.workerOptions
    );

    this.worker.on('completed', (job) => {
      this.logger.debug(`Job ${job.id} from queue ${job.queueName} completed successfully`);
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

      this.logger.log(
        `Syncing wallet data for ${walletAddress} [scope=${scope}, fetchOlder=${syncOptions.fetchOlder}, maxSignatures=${syncOptions.maxSignatures}]`,
      );
      await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
      await job.updateProgress(45);

      this.logger.log(`Fetching balances for ${walletAddress}...`);
      const walletBalanceService = new WalletBalanceService(
        this.heliusApiClient,
        this.databaseService,
        this.tokenInfoService,
      );
      const balanceData = await walletBalanceService.fetchWalletBalances([walletAddress], 'default', true);
      await job.updateProgress(55);

      this.logger.log(`Running PNL analysis for ${walletAddress} [scope=${scope}]`);
      const pnlResult = await this.pnlAnalysisService.analyzeWalletPnl(walletAddress, timeRange, {
        preFetchedBalances: balanceData,
      });
      await job.updateProgress(75);

      this.logger.log(`Running behavior analysis for ${walletAddress} [scope=${scope}]`);
      const behaviorConfig: BehaviorAnalysisConfig = {
        ...this.behaviorService.getDefaultBehaviorAnalysisConfig(),
        ...(timeRange ? { timeRange } : {}),
      };
      const behaviorResult = await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig, timeRange);
      await job.updateProgress(85);

      let enrichmentJobId: string | undefined;
      const shouldEnrich = scope === 'deep' && (job.data.enrichMetadata ?? true);
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

            this.logger.log(
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
            this.logger.log(`No mapped tokens found for ${walletAddress}, skipping enrichment.`);
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
          followUpQueued: followUpJobsQueued,
        },
      });

      await job.updateProgress(100);

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

      throw error;
    } finally {
      await this.redisLockService.releaseLock(lockKey, job.id!);
    }
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
