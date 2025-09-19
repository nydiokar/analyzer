import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueNames, QueueConfigs, JobTimeouts } from '../config/queue.config';
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
import { ANALYSIS_EXECUTION_CONFIG, DASHBOARD_JOB_CONFIG } from '../../config/constants';
import { JobProgressGateway } from '../../api/shared/job-progress.gateway';
import { TokenInfoService } from '../../api/services/token-info.service';
import { runMintParticipantsFlow } from '../../core/flows/mint-participants';
import { TelegramAlertsService } from '../../api/services/telegram-alerts.service';

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
    const { walletAddress, forceRefresh, enrichMetadata, timeoutMinutes } = job.data;
    const timeoutMs = (timeoutMinutes || DASHBOARD_JOB_CONFIG.DEFAULT_TIMEOUT_MINUTES) * 60 * 1000;
    const startTime = Date.now();
    
    // Deduplication check
    const expectedJobId = generateJobId.dashboardWalletAnalysis(walletAddress, job.data.requestId);
    if (job.id !== expectedJobId) {
      this.logger.warn(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
      throw new Error(`Job ID mismatch - possible duplicate`);
    }

    // Acquire lock
    const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'dashboard-analysis');
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
    
    if (!lockAcquired) {
      this.logger.warn(`Could not acquire lock for dashboard analysis on ${walletAddress}, job ${job.id} will be retried.`);
      throw new Error(`Dashboard analysis already in progress for wallet ${walletAddress}`);
    }

    let enrichmentJob: Job | undefined;

    try {
      await job.updateProgress(5);
      this.logger.log(`Starting dashboard analysis for wallet: ${walletAddress}`);

      // 1. Check wallet status for smart sync
      await job.updateProgress(10);
      const walletStatuses = await this.databaseService.getWalletsStatus([walletAddress]);
      const needsSync = walletStatuses.statuses[0].status === 'STALE' || 
                       walletStatuses.statuses[0].status === 'MISSING' || 
                       forceRefresh;
      
      // 2. Sync wallet data if necessary
      if (needsSync) {
        await job.updateProgress(15);
        this.logger.log(`Syncing transaction data for ${walletAddress}...`);
        
        const syncOptions: SyncOptions = {
          limit: 100,
          fetchAll: true,
          skipApi: false,
          fetchOlder: true,
          maxSignatures: ANALYSIS_EXECUTION_CONFIG.DASHBOARD_MAX_SIGNATURES,
          smartFetch: true,
          onProgress: (progress) => {
            const syncProgress = 15 + Math.floor(progress * 0.35); // Sync is 35% of total progress
            job.updateProgress(syncProgress);
          },
        };
        
        await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
        this.logger.log(`Sync completed for ${walletAddress}`);
      }
      
      await job.updateProgress(50);
      
      // 3. Fetch current balances
      this.logger.log(`Fetching balances for ${walletAddress}...`);
      const walletBalanceService = new WalletBalanceService(this.heliusApiClient, this.databaseService, this.tokenInfoService);
      const balanceData = await walletBalanceService.fetchWalletBalances([walletAddress], 'default', true);
      
      await job.updateProgress(55);
      
      // 4. Run PNL and Behavior analysis
      this.logger.log(`Running PNL and Behavior analysis for ${walletAddress}`);
      await job.updateProgress(65);
      
      const pnlResult = await this.pnlAnalysisService.analyzeWalletPnl(walletAddress, undefined, { preFetchedBalances: balanceData });
      await job.updateProgress(80);
      
      const behaviorResult = await this.behaviorService.getWalletBehavior(walletAddress, this.behaviorService.getDefaultBehaviorAnalysisConfig());
      await job.updateProgress(90);
      
      // 5. Queue metadata enrichment job
      let enrichmentJobId: string | undefined;
      if (enrichMetadata) {
        await job.updateProgress(95);
        try {
          // Get ALL tokens mapped to this wallet from the database (not just current balances)
          // This ensures we enrich all tokens that have ever been associated with this wallet
          const allWalletTokens = await this.databaseService.getUniqueTokenAddressesFromAnalysisResults(walletAddress);
          
          if (allWalletTokens.length > 0) {
            // Get current balances for all mapped tokens
            const walletBalanceData = balanceData?.get(walletAddress);
            const allTokenBalances = walletBalanceData?.tokenBalances?.filter(tokenBalance => 
              allWalletTokens.includes(tokenBalance.mint)
            ) || [];
            
            // For tokens that don't have current balances, create placeholder entries
            const tokensWithoutBalances = allWalletTokens.filter(tokenAddress => 
              !allTokenBalances.some(tb => tb.mint === tokenAddress)
            );
            
            const placeholderBalances = tokensWithoutBalances.map(tokenAddress => ({
              mint: tokenAddress,
              uiBalance: 0,
              balance: '0',
            }));
            
            const allBalancesForEnrichment = [...allTokenBalances, ...placeholderBalances];
            
            this.logger.log(`Queuing enrichment for ${allBalancesForEnrichment.length} mapped tokens (${allTokenBalances.length} with current balances, ${placeholderBalances.length} without current balances) for wallet ${walletAddress}`);
            
            const walletBalancesForEnrichment = {
              [walletAddress]: {
                tokenBalances: allBalancesForEnrichment.map(tokenBalance => ({
                  mint: tokenBalance.mint,
                  uiBalance: tokenBalance.uiBalance,
                  balance: tokenBalance.balance,
                }))
              }
            };
            
            enrichmentJob = await this.enrichmentOperationsQueue.addEnrichTokenBalances({
              walletBalances: walletBalancesForEnrichment,
              requestId: job.data.requestId,
              priority: 3,
              enrichmentContext: 'dashboard-analysis'
            });
            enrichmentJobId = enrichmentJob.id;
          } else {
            this.logger.log(`No mapped tokens found for ${walletAddress}, skipping enrichment.`);
          }
        } catch (error) {
          this.logger.warn(`Failed to queue enrichment job for ${walletAddress}, continuing without it:`, error);
        }
      }
      
      await job.updateProgress(100);
      
      const result = {
        success: true,
        walletAddress,
        pnlResult,
        behaviorResult,
        enrichmentJobId,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };

      const actualProcessingTime = Date.now() - startTime;
      this.logger.log(`✅ Dashboard analysis for ${walletAddress} completed in ${actualProcessingTime}ms.`);

      await this.jobProgressGateway.publishCompletedEvent(job.id!, 'analysis-operations', result, actualProcessingTime);

      return result;

    } catch (error) {
      this.logger.error(`Dashboard analysis for ${walletAddress} failed:`, error);
      
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