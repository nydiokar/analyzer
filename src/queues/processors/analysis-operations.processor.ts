import { Injectable, Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueNames, QueueConfigs, JobTimeouts } from '../config/queue.config';
import { AnalyzePnlJobData, AnalyzeBehaviorJobData, AnalysisResult, DashboardWalletAnalysisJobData } from '../jobs/types';
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

@Injectable()
export class AnalysisOperationsProcessor {
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
    private readonly jobProgressGateway: JobProgressGateway
  ) {
    const config = QueueConfigs[QueueNames.ANALYSIS_OPERATIONS];
    
    this.worker = new Worker(
      QueueNames.ANALYSIS_OPERATIONS,
      async (job: Job) => this.processJob(job),
      config.workerOptions
    );

    this.worker.on('completed', (job) => {
      this.logger.debug(`Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed:`, err);
    });

    this.worker.on('error', (err) => {
      this.logger.error('Worker error:', err);
    });

    this.logger.debug('AnalysisOperationsProcessor initialized with worker');
  }

  private async processJob(job: Job): Promise<any> {
    const jobName = job.name;
    
    this.logger.debug(`Processing ${jobName} job ${job.id}`);
    
    switch (jobName) {
      case 'analyze-pnl':
        return await this.processAnalyzePnl(job as Job<AnalyzePnlJobData>);
      case 'analyze-behavior':
        return await this.processAnalyzeBehavior(job as Job<AnalyzeBehaviorJobData>);
      case 'dashboard-wallet-analysis':
        return await this.processDashboardWalletAnalysis(job as Job<DashboardWalletAnalysisJobData>);
      default:
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
    
    // Apply deduplication strategy - verify job ID matches expected
    const expectedJobId = generateJobId.analyzePnl(walletAddress, requestId);
    if (job.id !== expectedJobId) {
      throw new Error(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
    }

    // Acquire Redis lock to prevent concurrent analysis of same wallet
    const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'pnl');
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
    
    if (!lockAcquired) {
      throw new Error(`PnL analysis already in progress for wallet ${walletAddress}`);
    }

    try {
      await job.updateProgress(5);
              this.logger.debug(`Processing PnL analysis for ${walletAddress}`);

      // Check if recent analysis exists (idempotency at service level)
      if (!forceRefresh) {
        const wallet = await this.databaseService.getWallet(walletAddress);
        const lastAnalysisAge = wallet?.analyzedTimestampEnd 
          ? Date.now() - wallet.analyzedTimestampEnd * 1000  // Convert from seconds to milliseconds
          : Infinity;
        
        const shouldSkipAnalysis = lastAnalysisAge < 10 * 60 * 1000; // 10 minutes
        
        if (shouldSkipAnalysis) {
          await job.updateProgress(100);
          this.logger.debug(`PnL analysis for ${walletAddress} is already current. Skipping analysis.`);
          
          return {
            success: true,
            walletAddress,
            analysisType: 'pnl',
            timestamp: Date.now(),
            processingTimeMs: Date.now() - startTime
          };
        }
      }

      // Execute PnL analysis with existing optimal service and timeout guard
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
        resultId: pnlResult.runId?.toString() || undefined,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };

      this.logger.log(`PnL analysis completed for ${walletAddress}. RunId: ${pnlResult.runId}`);
      return result;

    } catch (error) {
      this.logger.error(`PnL analysis failed for ${walletAddress}:`, error);
      
      const result: AnalysisResult = {
        success: false,
        walletAddress,
        analysisType: 'pnl',
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };
      
      throw error;
    } finally {
      // Always release lock
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
    
    // Apply deduplication strategy - verify job ID matches expected
    const expectedJobId = generateJobId.analyzeBehavior(walletAddress, requestId);
    if (job.id !== expectedJobId) {
      throw new Error(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
    }

    // Acquire Redis lock to prevent concurrent analysis of same wallet
    const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'behavior');
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
    
    if (!lockAcquired) {
      throw new Error(`Behavior analysis already in progress for wallet ${walletAddress}`);
    }

    try {
      await job.updateProgress(5);
              this.logger.debug(`Processing behavior analysis for ${walletAddress}`);

      // Execute behavior analysis with existing optimal service and timeout guard
      await job.updateProgress(20);
      this.checkTimeout(startTime, timeoutMs, 'Starting behavior analysis');

      // Create behavior analysis config
      const behaviorConfig: BehaviorAnalysisConfig = config ? {
        timeRange: config.timeRange ? {
          startTs: config.timeRange.from ? Math.floor(config.timeRange.from.getTime() / 1000) : undefined,
          endTs: config.timeRange.to ? Math.floor(config.timeRange.to.getTime() / 1000) : undefined
        } : undefined,
        excludedMints: config.excludeMints || []
      } : this.behaviorService.getDefaultBehaviorAnalysisConfig();

      const timeRange = config?.timeRange ? {
        startTs: config.timeRange.from ? Math.floor(config.timeRange.from.getTime() / 1000) : undefined,
        endTs: config.timeRange.to ? Math.floor(config.timeRange.to.getTime() / 1000) : undefined
      } : undefined;

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
      
      const result: AnalysisResult = {
        success: false,
        walletAddress,
        analysisType: 'behavior',
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };
      
      throw error;
    } finally {
      // Always release lock
      await this.redisLockService.releaseLock(lockKey, job.id!);
    }
  }

  /**
   * Process dashboard wallet analysis job using direct service calls
   * Implements comprehensive wallet analysis with sync, PNL, and behavior analysis
   */
  async processDashboardWalletAnalysis(job: Job<DashboardWalletAnalysisJobData>): Promise<any> {
    const { walletAddress, forceRefresh, enrichMetadata, timeoutMinutes, failureThreshold } = job.data;
    const timeoutMs = (timeoutMinutes || DASHBOARD_JOB_CONFIG.DEFAULT_TIMEOUT_MINUTES) * 60 * 1000;
    const startTime = Date.now();
    
    // Apply deduplication strategy
    const expectedJobId = generateJobId.dashboardWalletAnalysis(walletAddress, job.data.requestId);
    if (job.id !== expectedJobId) {
      throw new Error(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
    }

    // Acquire Redis lock to prevent concurrent processing
    const lockKey = RedisLockService.createWalletLockKey(walletAddress, 'dashboard-analysis');
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
    
    if (!lockAcquired) {
      throw new Error(`Dashboard analysis already in progress for wallet ${walletAddress}`);
    }

    // Declare enrichmentJob outside try block so it's accessible in catch block
    let enrichmentJob: Job | undefined;

    try {
      await job.updateProgress(5);
      await this.jobProgressGateway.publishProgressEvent(job.id!, 'analysis-operations', 5);
      this.logger.debug(`Processing dashboard analysis for ${walletAddress}`);

      // 1. Check wallet status (smart sync detection)
      await job.updateProgress(10);
      await this.jobProgressGateway.publishProgressEvent(job.id!, 'analysis-operations', 10);
      const walletStatuses = await this.databaseService.getWalletsStatus([walletAddress]);
      const needsSync = walletStatuses.statuses[0].status === 'STALE' || 
                       walletStatuses.statuses[0].status === 'MISSING' || 
                       forceRefresh;
      
      // 2. Start sync and balance fetch in parallel (like similarity processor)
      this.logger.debug('🚀 Starting sync and balance fetch in parallel...');
      
      // Start sync immediately (if needed) - DON'T await yet
      const syncPromise = needsSync 
        ? (async () => {
            this.logger.debug(`Wallet ${walletAddress} needs sync, starting sync process`);
            const syncOptions: SyncOptions = {
              limit: 100,
              fetchAll: true,
              skipApi: false,
              fetchOlder: true,
              maxSignatures: ANALYSIS_EXECUTION_CONFIG.DASHBOARD_MAX_SIGNATURES,
              smartFetch: true,
            };
            await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
          })()
        : Promise.resolve();

      // Start balance fetching in parallel - DON'T await yet
      const balancePromise = (async () => {
        const walletBalanceService = new WalletBalanceService(this.heliusApiClient, this.databaseService);
        return await walletBalanceService.fetchWalletBalances([walletAddress]);
      })();
      
      await job.updateProgress(15);
      await this.jobProgressGateway.publishProgressEvent(job.id!, 'analysis-operations', 15);

      // 3. Wait for sync to complete FIRST (critical for analysis)
      this.logger.debug('⏳ Waiting for sync to complete (critical for analysis)...');
      const syncResult = await syncPromise;
      this.logger.debug(`✅ SYNC COMPLETED: Wallet data synced for analysis`);
      
      await job.updateProgress(25);
      await this.jobProgressGateway.publishProgressEvent(job.id!, 'analysis-operations', 25);
      
      // 4. Start analysis with synced data (balance fetch continues in background)
      this.logger.debug('🚀 Starting analysis with synced data (balance fetch in background)...');
      
      await job.updateProgress(40);
      await this.jobProgressGateway.publishProgressEvent(job.id!, 'analysis-operations', 40);
      
      // 5. Run analysis sequentially (NOT in parallel to avoid race conditions)
      await job.updateProgress(50);
      await this.jobProgressGateway.publishProgressEvent(job.id!, 'analysis-operations', 50);
      this.logger.debug(`Starting PNL and behavior analysis for ${walletAddress}`);
      
      // Run PNL analysis first
      const pnlResult = await this.pnlAnalysisService.analyzeWalletPnl(walletAddress);
      await job.updateProgress(65);
      await this.jobProgressGateway.publishProgressEvent(job.id!, 'analysis-operations', 65);
      
      // Then run behavior analysis
      const behaviorResult = await this.behaviorService.getWalletBehavior(
        walletAddress, 
        this.behaviorService.getDefaultBehaviorAnalysisConfig()
      );
      
      await job.updateProgress(80);
      await this.jobProgressGateway.publishProgressEvent(job.id!, 'analysis-operations', 80);
      
      // 6. Queue enrichment if requested (AFTER analysis is complete)
      let enrichmentJobId;
      if (enrichMetadata) {
        await job.updateProgress(85);
        await this.jobProgressGateway.publishProgressEvent(job.id!, 'analysis-operations', 85);
        this.logger.debug(`Queueing token enrichment for ${walletAddress} (after analysis completion)`);
        
        try {
          // CRITICAL FIX: Now that analysis is complete, we can safely query for tokens
          // First try to get balance data (which might have completed by now)
          let walletBalancesForEnrichment = {};
          let balanceData: any = undefined;
          
          try {
            balanceData = await Promise.race([
              balancePromise,
              new Promise((_, reject) => setTimeout(() => reject(new Error('Balance fetch timeout')), 2000))
            ]);
            this.logger.debug(`✅ BALANCE FETCH COMPLETED: Balances available for enrichment`);
          } catch (balanceError) {
            this.logger.warn(`⚠️ Balance fetch not ready yet, will use analysis results: ${balanceError}`);
          }
          
          if (balanceData && balanceData.size > 0) {
            walletBalancesForEnrichment = Object.fromEntries(balanceData);
            this.logger.debug(`Using balance data for enrichment: ${balanceData.size} entries`);
          } else {
            // FALLBACK: Now that analysis is complete, we can safely query AnalysisResult table
            this.logger.debug(`Balance data not available, getting token addresses from completed analysis results`);
            const analysisResults = await this.databaseService.getAnalysisResults({
              where: { walletAddress }
            });
            
            if (analysisResults.length > 0) {
              const tokenAddresses = [...new Set(analysisResults.map(ar => ar.tokenAddress))];
              this.logger.debug(`Found ${tokenAddresses.length} unique tokens from analysis results for enrichment`);
              
              // Create a minimal wallet balances structure for enrichment
              walletBalancesForEnrichment = {
                [walletAddress]: {
                  tokenBalances: tokenAddresses.map(address => ({ mint: address }))
                }
              };
            } else {
              this.logger.warn(`No analysis results found for ${walletAddress}, skipping enrichment`);
            }
          }
          
          if (Object.keys(walletBalancesForEnrichment).length > 0) {
            enrichmentJob = await this.enrichmentOperationsQueue.addEnrichTokenBalances({
              walletBalances: walletBalancesForEnrichment,
              requestId: job.data.requestId,
              priority: 3
            });
            enrichmentJobId = enrichmentJob.id;
            this.logger.debug(`Background enrichment job queued: ${enrichmentJobId} for wallet: ${walletAddress}`);
            // DON'T wait for enrichment - keep it truly parallel!
          } else {
            this.logger.warn(`No token data available for enrichment, skipping enrichment job`);
          }
        } catch (error) {
          this.logger.warn(`Failed to queue enrichment job, continuing without enrichment:`, error);
        }
      }
      
      await job.updateProgress(100);
      await this.jobProgressGateway.publishProgressEvent(job.id!, 'analysis-operations', 100);
      
      const result = {
        success: true,
        walletAddress,
        pnlResult,
        behaviorResult,
        enrichmentJobId,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };

      // Log timing for debugging
      const actualProcessingTime = Date.now() - startTime;
      this.logger.log(`Dashboard analysis completed for ${walletAddress} in ${actualProcessingTime}ms`);

      // Publish completion event with actual processing time (like similarity processor)
      await this.jobProgressGateway.publishCompletedEvent(
        job.id!, 
        'analysis-operations', 
        result, 
        actualProcessingTime  // Use explicit variable for clarity
      );

      this.logger.log(`Dashboard analysis completed for ${walletAddress} in ${actualProcessingTime}ms`);
      return result;

    } catch (error) {
      this.logger.error(`Dashboard analysis failed for ${walletAddress}:`, error);
      
      // Cancel any running enrichment job to prevent orphaned processes
      if (enrichmentJob) {
        try {
          this.logger.log(`Cancelling enrichment job ${enrichmentJob.id} due to dashboard analysis failure`);
          await enrichmentJob.remove();
        } catch (cancelError) {
          this.logger.warn(`Failed to cancel enrichment job ${enrichmentJob.id}:`, cancelError);
        }
      }
      
      const result = {
        success: false,
        walletAddress,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };
      
      throw error;
    } finally {
      // Always release lock
      await this.redisLockService.releaseLock(lockKey, job.id!);
    }
  }

  /**
   * Check if operation has exceeded timeout
   */
  private checkTimeout(startTime: number, timeoutMs: number, operation: string): void {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`${operation} timeout after ${timeoutMs}ms`);
    }
  }

  /**
   * Shutdown the worker gracefully
   */
  async shutdown(): Promise<void> {
    this.logger.debug('Shutting down AnalysisOperationsProcessor worker...');
    await this.worker.close();
  }
} 