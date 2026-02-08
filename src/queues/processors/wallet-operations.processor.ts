import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Worker, UnrecoverableError } from 'bullmq';
import { QueueNames, QueueConfigs, JobTimeouts } from '../config/queue.config';
import { SyncWalletJobData, FetchBalanceJobData, WalletSyncResult } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
import { RedisLockService } from '../services/redis-lock.service';
import { HeliusSyncService, SyncOptions } from '../../core/services/helius-sync-service';
import { WalletBalanceService } from '../../core/services/wallet-balance-service';
import { DatabaseService } from '../../api/services/database.service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { ANALYSIS_EXECUTION_CONFIG } from '../../config/constants';
import { HolderProfilesCacheService } from '../../api/services/holder-profiles-cache.service';
import { getErrorMessage, getErrorDetails } from '../../core/utils/error-utils';


@Injectable()
export class WalletOperationsProcessor implements OnModuleDestroy {
  private readonly logger = new Logger(WalletOperationsProcessor.name);
  private readonly worker: Worker;

  constructor(
    private readonly redisLockService: RedisLockService,
    private readonly heliusSyncService: HeliusSyncService,
    private readonly databaseService: DatabaseService,
    private readonly heliusApiClient: HeliusApiClient,
    private readonly holderProfilesCacheService: HolderProfilesCacheService,
  ) {
    const config = QueueConfigs[QueueNames.WALLET_OPERATIONS];
    
    this.worker = new Worker(
      QueueNames.WALLET_OPERATIONS,
      async (job: Job) => this.processJob(job),
      config.workerOptions
    );

    this.worker.on('completed', (job) => {
      this.logger.debug(`Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${getErrorMessage(err)}`);
    });

    this.worker.on('error', (err) => {
      this.logger.error(`Worker error: ${getErrorMessage(err)}`);
    });

          this.logger.debug('WalletOperationsProcessor initialized with worker');
  }

  private async processJob(job: Job): Promise<any> {
    const jobName = job.name;
    
    this.logger.debug(`Processing ${jobName} job ${job.id}`);
    
    switch (jobName) {
      case 'sync-wallet':
        return await this.processSyncWallet(job as Job<SyncWalletJobData>);
      case 'fetch-balance':
        return await this.processFetchBalance(job as Job<FetchBalanceJobData>);
      default:
        throw new Error(`Unknown job type: ${jobName}`);
    }
  }

  /**
   * Process wallet sync job with Redis lock-based idempotency as specified in the plan
   * Implements the safeguards from the BullMQ implementation document
   */
  async processSyncWallet(job: Job<SyncWalletJobData>): Promise<WalletSyncResult> {
    const { walletAddress, syncOptions, requestId } = job.data;
    const timeoutMs = JobTimeouts['sync-wallet'].timeout;
    const startTime = Date.now();
    
    // Apply deduplication strategy - verify job ID matches expected
    const expectedJobId = generateJobId.syncWallet(walletAddress, requestId);
    if (job.id !== expectedJobId) {
      throw new Error(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
    }

    // 1. Acquire Redis lock to prevent concurrent processing
    const lockKey = RedisLockService.createSyncLockKey(walletAddress);
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);

    if (!lockAcquired) {
      // 🚨 FAIL FAST: Prevent retry storms
      const lockOwner = await this.redisLockService.getLockValue(lockKey);
      const ttl = await this.redisLockService.getLockTTL(lockKey);
      this.logger.warn(
        `❌ Cannot acquire lock for wallet sync on ${walletAddress}. ` +
        `Locked by: ${lockOwner}, TTL: ${Math.max(0, ttl)}ms. Job ${job.id} FAILED (no retry).`
      );
      throw new UnrecoverableError(
        `Wallet ${walletAddress} is already being synced (locked by: ${lockOwner})`
      );
    }

    try {
      await job.updateProgress(5);
      // this.logger.log(`Processing wallet sync for ${walletAddress} with options:`, syncOptions);

      // 2. Check if recent sync exists (idempotency at service level)
      const wallet = await this.databaseService.getWallet(walletAddress);
      const lastSyncAge = wallet?.lastSuccessfulFetchTimestamp 
        ? Date.now() - wallet.lastSuccessfulFetchTimestamp.getTime() 
        : Infinity;
      
      const shouldSkipSync = lastSyncAge < 5 * 60 * 1000 && !syncOptions.forceRefresh;
      
      if (shouldSkipSync) {
        await job.updateProgress(100);
        this.logger.debug(`Wallet ${walletAddress} is already current. Skipping sync.`);
        return {
          success: true,
          walletAddress,
          status: 'already-current',
          lastSync: wallet?.lastSuccessfulFetchTimestamp,
          timestamp: Date.now(),
          processingTimeMs: Date.now() - startTime
        };
      }

      // 3. Execute sync with existing optimal service and timeout guard
      await job.updateProgress(10);
      this.checkTimeout(startTime, timeoutMs, 'Starting wallet sync');

      // Convert job sync options to HeliusSyncService SyncOptions
      const heliusSyncOptions: SyncOptions = {
        limit: 100,
        fetchAll: syncOptions.fetchAll ?? true,
        skipApi: false,
        fetchOlder: syncOptions.fetchOlder ?? false,
        maxSignatures: ANALYSIS_EXECUTION_CONFIG.DASHBOARD_MAX_SIGNATURES,
        smartFetch: true,
      };

      await job.updateProgress(20);
      await this.heliusSyncService.syncWalletData(walletAddress, heliusSyncOptions);
      
      await job.updateProgress(90);
      this.checkTimeout(startTime, timeoutMs, 'Completing wallet sync');

      // Get updated wallet info
      const updatedWallet = await this.databaseService.getWallet(walletAddress);
      
      await job.updateProgress(100);

      const result: WalletSyncResult = {
        success: true,
        walletAddress,
        status: 'synced',
        lastSync: updatedWallet?.lastSuccessfulFetchTimestamp,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };

      // 🔄 Invalidate holder profiles cache for this wallet (prevents stale data)
      await this.holderProfilesCacheService.invalidateForWallet(walletAddress);

      this.logger.log(`Wallet sync completed for ${walletAddress}.`);
      return result;

    } catch (error) {
      this.logger.error(`Wallet sync failed for ${walletAddress}:`, getErrorMessage(error));
      
      const result: WalletSyncResult = {
        success: false,
        walletAddress,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };
      
      throw error;
    } finally {
      // 4. Always release lock
      await this.redisLockService.releaseLock(lockKey, job.id!);
    }
  }

  /**
   * Process balance fetch job
   */
  async processFetchBalance(job: Job<FetchBalanceJobData>): Promise<any> {
    const { walletAddress, requestId } = job.data;
    const startTime = Date.now();
    
    try {
      await job.updateProgress(10);
      this.logger.debug(`Fetching balance for wallet ${walletAddress}`);

      const walletBalanceService = new WalletBalanceService(this.heliusApiClient, this.databaseService);
      
      await job.updateProgress(50);
      const balancesMap = await walletBalanceService.fetchWalletBalances([walletAddress]);
      const walletBalance = balancesMap.get(walletAddress);
      
      await job.updateProgress(100);

      if (!walletBalance) {
        throw new Error(`Failed to fetch balance for wallet ${walletAddress}`);
      }

      const result = {
        success: true,
        walletAddress,
        balance: walletBalance,
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };

      this.logger.debug(`Balance fetched for ${walletAddress}: ${walletBalance.solBalance} SOL`);
      return result;

    } catch (error) {
      this.logger.error(`Balance fetch failed for ${walletAddress}:`, getErrorMessage(error));
      throw error;
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
    this.logger.debug('Shutting down WalletOperationsProcessor worker...');
    await this.worker.close();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.shutdown();
    } catch (err) {
      this.logger.warn(`Error shutting down WalletOperationsProcessor worker: ${getErrorMessage(err)}`);
    }
  }
} 