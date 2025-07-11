import { Injectable, Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueNames, QueueConfigs, JobTimeouts } from '../config/queue.config';
import { EnrichTokenBalancesJobData, EnrichTokenBalancesResult } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
import { RedisLockService } from '../services/redis-lock.service';
import { TokenInfoService } from '../../api/token-info/token-info.service';
import { DexscreenerService } from '../../api/dexscreener/dexscreener.service';
import { BalanceCacheService } from '../../api/balance-cache/balance-cache.service';
import { JobProgressGateway } from '../../api/websocket/job-progress.gateway';

@Injectable()
export class EnrichmentOperationsProcessor {
  private readonly logger = new Logger(EnrichmentOperationsProcessor.name);
  private readonly worker: Worker;

  constructor(
    private readonly redisLockService: RedisLockService,
    private readonly tokenInfoService: TokenInfoService,
    private readonly dexscreenerService: DexscreenerService,
    private readonly balanceCacheService: BalanceCacheService,
    private readonly websocketGateway: JobProgressGateway,
  ) {
    const config = QueueConfigs[QueueNames.ENRICHMENT_OPERATIONS];
    
    this.worker = new Worker(
      QueueNames.ENRICHMENT_OPERATIONS,
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

    this.logger.log('EnrichmentOperationsProcessor initialized with worker');
  }

  private async processJob(job: Job): Promise<any> {
    const jobName = job.name;
    
    this.logger.log(`Processing ${jobName} job ${job.id}`);
    
    switch (jobName) {
      case 'enrich-token-balances':
        return await this.processEnrichTokenBalances(job as Job<EnrichTokenBalancesJobData>);
      case 'parallel-enrichment':
        return await this.processParallelEnrichment(job);

      default:
        throw new Error(`Unknown job type: ${jobName}`);
    }
  }

  /**
   * Process parallel enrichment job using cached balances
   * This runs in the enrichQ queue for the new parallel architecture
   */
  async processParallelEnrichment(job: Job<{ walletBalances: Record<string, any>; requestId: string }>): Promise<{ enrichedBalances: Record<string, any> }> {
    const { walletBalances, requestId } = job.data;
    const startTime = Date.now();
    
    this.logger.log(`Processing parallel enrichment for ${Object.keys(walletBalances).length} wallets, requestId: ${requestId}`);
    
    try {
      // Use the existing sophisticated enrichment logic
      const { enrichedBalances, summary } = await this.enrichBalancesWithSophisticatedLogic(walletBalances, job);
      
      await job.updateProgress(100);
      await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 100);

      // If no new tokens were actually fetched, we can short-circuit the expensive cache write.
      if (summary.newTokensFetched === 0) {
        this.logger.log(`Skipping cache write for request ${requestId} as no new token metadata was fetched.`);
        await this.websocketGateway.publishCompletedEvent(
          job.id!,
          'enrichment',
          enrichedBalances,
          Date.now() - startTime
        );
        this.logger.log(`Parallel enrichment completed for requestId: ${requestId} (no-op).`);
        return { enrichedBalances };
      }
      
      // Store enriched result in Redis cache
      const cacheKey = `enrich:${requestId}`;
      const redis = new (require('ioredis'))({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379')
      });
      
      await redis.set(cacheKey, JSON.stringify(enrichedBalances), 'EX', 300); // 5 minutes TTL
      
      // Emit WebSocket event for frontend update
      await this.websocketGateway.publishCompletedEvent(
        job.id!,  // Use the actual job ID that frontend subscribes to
        'enrichment',
        enrichedBalances,
        Date.now() - startTime
      );
      
      this.logger.log(`Parallel enrichment completed for requestId: ${requestId}`);
      
      // Return the enriched balances for the frontend to consume
      return { enrichedBalances };
      
    } catch (error) {
      this.logger.error(`Parallel enrichment failed for requestId: ${requestId}`, error);
      
      // Emit failure event
      await this.websocketGateway.publishFailedEvent(
        job.id!,  // Use the actual job ID that frontend subscribes to
        'enrichment',
        error instanceof Error ? error.message : String(error),
        1,
        1
      );
      
      throw error;
    }
  }

  /**
   * Process token balance enrichment job with sophisticated logic transferred from similarity service
   * Preserves database-first optimization, smart batching, and background processing
   */
  async processEnrichTokenBalances(job: Job<EnrichTokenBalancesJobData>): Promise<EnrichTokenBalancesResult> {
    const { walletBalances, requestId, optimizationHint } = job.data;
    const timeoutMs = JobTimeouts['enrich-token-balances'].timeout;
    const startTime = Date.now();
    
          // Apply deduplication strategy using wallet balances
      const allTokens = Object.values(walletBalances).flatMap(b => b.tokenBalances.map(t => t.mint));
      const sortedTokens = [...new Set(allTokens)].sort().join('-');
      const expectedJobId = generateJobId.enrichMetadata(sortedTokens, requestId);
      if (job.id !== expectedJobId) {
        throw new Error(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
      }

      // Acquire Redis lock to prevent concurrent processing
      const lockKey = RedisLockService.createEnrichmentLockKey(sortedTokens);
      const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
      
      if (!lockAcquired) {
        throw new Error(`Token balance enrichment already in progress for request: ${requestId}`);
      }

      try {
        await job.updateProgress(5);
        await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 5);
        this.logger.log(`Processing sophisticated token enrichment for ${Object.keys(walletBalances).length} wallets`);

        // Use the sophisticated logic from enrichBalances method
        const enrichedBalances = await this.enrichBalancesWithSophisticatedLogic(walletBalances, job);

        await job.updateProgress(100);
        await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 100);
        this.logger.log(`Sophisticated token enrichment completed successfully`);
        
        // Format the result according to the new interface
        const result: EnrichTokenBalancesResult = {
          success: true,
          enrichedBalances,
          metadata: {
            totalTokens: allTokens.length,
            enrichedTokens: Object.keys(enrichedBalances).length,
            backgroundProcessedTokens: 0, // TODO: Track this from sophisticated logic
            processingStrategy: this.mapOptimizationHintToStrategy(optimizationHint)
          },
          timestamp: Date.now(),
          processingTimeMs: Date.now() - startTime
        };
        
        return result;

    } catch (error) {
      this.logger.error(`Token enrichment failed for request ${requestId}:`, error);
      throw error;
    } finally {
      // Always release lock
      await this.redisLockService.releaseLock(lockKey, job.id!);
    }
  }

  /**
   * Sophisticated balance enrichment logic using actual service methods.
   * This version is corrected to use the real implementation.
   */
  public async enrichBalancesWithSophisticatedLogic(
    walletBalances: Record<string, { tokenBalances: { mint: string, uiBalance: number }[] }>,
    job: Job
  ): Promise<{ enrichedBalances: Record<string, any>, summary: { newTokensFetched: number, totalTokens: number } }> {
    this.logger.log(`Enriching balances for ${Object.keys(walletBalances).length} wallets using sophisticated logic.`);
    
    try {
      const allMints = Object.values(walletBalances).flatMap(b => b.tokenBalances.map(t => t.mint));
      const uniqueMints = [...new Set(allMints)];

      // Step 0: CRITICAL - Trigger the fetching and saving of any NEW token metadata.
      // This was the missing piece. This ensures our DB has the info before we try to read from it.
      await this.tokenInfoService.triggerTokenInfoEnrichment(uniqueMints, 'system-enrichment-job');
      
      await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 25);

      // Step 1: Get all available token info from our local database. This is now up-to-date.
      const allExistingInfo = await this.tokenInfoService.findMany(uniqueMints);
      const existingInfoMap = new Map(allExistingInfo.map(info => [info.tokenAddress, info]));
      this.logger.log(`Found ${existingInfoMap.size} records in the DB for ${uniqueMints.length} unique mints after enrichment trigger.`);

      await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 50);
      // Step 2: Get fresh prices from the external API.
      const freshPrices = await this.dexscreenerService.getTokenPrices(uniqueMints);
      const freshPricesMap = new Map(Object.entries(freshPrices));
      this.logger.log(`Fetched ${freshPricesMap.size} fresh prices from the external API.`);

      await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 75);
      // Step 3: Enrich the balances using the best available data.
      const finalEnrichedBalances = { ...walletBalances };
      for (const walletAddress in finalEnrichedBalances) {
        const balances = finalEnrichedBalances[walletAddress].tokenBalances as any[];
        for (const tokenBalance of balances) {
          const dbInfo = existingInfoMap.get(tokenBalance.mint);
          
          // Use fresh price if available, otherwise fall back to the price from our database.
          const freshPrice = freshPricesMap.get(tokenBalance.mint);
          const priceToUse = freshPrice ?? (dbInfo?.priceUsd ? parseFloat(dbInfo.priceUsd) : null);
          
          tokenBalance.name = dbInfo?.name ?? 'Unknown Token';
          tokenBalance.symbol = dbInfo?.symbol ?? 'UNKNOWN';
          tokenBalance.imageUrl = dbInfo?.imageUrl ?? null;
          tokenBalance.priceUsd = priceToUse;

          if (priceToUse !== null && typeof tokenBalance.uiBalance === 'number') {
            tokenBalance.valueUsd = tokenBalance.uiBalance * priceToUse;
          } else {
            tokenBalance.valueUsd = null;
          }
        }
      }

      this.logger.log(`Enrichment logic completed for ${Object.keys(walletBalances).length} wallets.`);
      
      // Step 4: Return the fully enriched balances.
      return { 
        enrichedBalances: finalEnrichedBalances, 
        summary: {
          newTokensFetched: existingInfoMap.size, // A more representative number of available tokens.
          totalTokens: uniqueMints.length,
        }
      };
      
    } catch (error) {
      this.logger.error(`Error in enrichBalancesWithSophisticatedLogic for job ${job.id}:`, error);
      throw error;
    }
  }

  /**
   * Trigger background enrichment for large token sets
   * This allows the system to continue processing while enrichment happens asynchronously
   */
  private async triggerBackgroundEnrichment(tokenAddresses: string[]): Promise<void> {
    // Process in smaller batches to avoid overwhelming the system
    const batchSize = 50;
    const batches = [];
    
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      batches.push(tokenAddresses.slice(i, i + batchSize));
    }

    // Process batches with delays to avoid rate limiting
    for (const batch of batches) {
      try {
        await this.dexscreenerService.fetchAndSaveTokenInfo(batch);
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        this.logger.warn(`Background enrichment failed for batch of ${batch.length} tokens:`, error);
        // Continue with other batches
      }
    }
    
    this.logger.log(`Background enrichment completed for ${tokenAddresses.length} tokens`);
  }



  /**
   * Map optimization hint to processing strategy
   */
  private mapOptimizationHintToStrategy(hint?: 'small' | 'large' | 'massive'): 'sync' | 'background' | 'hybrid' {
    switch (hint) {
      case 'small':
        return 'sync';
      case 'large':
        return 'hybrid';
      case 'massive':
        return 'background';
      default:
        return 'sync';
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
    this.logger.log('Shutting down EnrichmentOperationsProcessor worker...');
    await this.worker.close();
  }
} 