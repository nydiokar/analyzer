import { Logger, Injectable } from '@nestjs/common';
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
      // Check for cancellation before starting
      await this.checkJobCancellation(job);
      
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
      
      await redis.set(cacheKey, JSON.stringify(enrichedBalances), 'EX', 300);
      await redis.quit();
      
      // Notify completion with enriched balances
      await this.websocketGateway.publishCompletedEvent(
        job.id!,
        'enrichment',
        enrichedBalances,
        Date.now() - startTime
      );
      
      this.logger.log(`Parallel enrichment completed for requestId: ${requestId}. Total processing time: ${Date.now() - startTime}ms`);
      return { enrichedBalances };
      
    } catch (error) {
      this.logger.error(`Parallel enrichment failed for requestId: ${requestId}`, error);
      throw error;
    }
  }

  /**
   * Check if the job has been cancelled and throw an error if so
   * This allows for graceful cancellation during long-running operations
   */
  private async checkJobCancellation(job: Job): Promise<void> {
    try {
      // In BullMQ, cancelled jobs are REMOVED from the queue, not set to 'cancelled' state
      // So we check if the job still exists and is in a processing state
      const jobState = await job.getState();
      
      // If job is failed, it might have been cancelled
      if (jobState === 'failed') {
        // Check if the failure reason indicates cancellation
        if (job.failedReason && job.failedReason.includes('cancelled')) {
          throw new Error(`Job ${job.id} was cancelled by user request`);
        }
      }
      
      // Additional check: try to reload the job to see if it still exists
      const jobExists = await job.getState();
      if (!jobExists) {
        throw new Error(`Job ${job.id} was cancelled by user request`);
      }
      
    } catch (error) {
      if (error instanceof Error && error.message.includes('cancelled')) {
        this.logger.log(`Job ${job.id} was gracefully cancelled`);
        throw error;
      }
      // If we can't check the state, continue processing
      this.logger.warn(`Could not check cancellation state for job ${job.id}, continuing...`);
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
   * Enhanced enrichment logic with cancellation support and better progress tracking
   * Uses proper database-first approach to avoid creating "Unknown Token" placeholders
   */
  private async enrichBalancesWithSophisticatedLogic(
    walletBalances: Record<string, any>, 
    job: Job
  ): Promise<{ enrichedBalances: Record<string, any>; summary: { newTokensFetched: number } }> {
    // Extract all unique token addresses
    const allTokens = Object.values(walletBalances).flatMap(b => b.tokenBalances.map(t => t.mint));
    const uniqueTokens = [...new Set(allTokens)];
    
    this.logger.log(`Starting enrichment for ${uniqueTokens.length} unique tokens`);
    
    // STEP 1: Get existing tokens from database (database-first approach)
    const existingTokens = await this.tokenInfoService.findMany(uniqueTokens);
    const existingTokenMap = new Map(existingTokens.map(t => [t.tokenAddress, t]));
    
    // STEP 2: Filter to only fetch tokens that don't exist or are stale (5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const tokensToFetch = uniqueTokens.filter(address => {
      const existingToken = existingTokenMap.get(address);
      return !existingToken || !existingToken.dexscreenerUpdatedAt || existingToken.dexscreenerUpdatedAt < fiveMinutesAgo;
    });
    
    this.logger.log(`Found ${existingTokens.length} existing tokens, need to fetch ${tokensToFetch.length} new/stale tokens`);
    
    let newTokensFetched = 0;
    
            // STEP 3: Only fetch new/stale tokens from DexScreener
        if (tokensToFetch.length > 0) {
          // Process tokens in batches with cancellation checks
          const batchSize = 500; // Smaller batches for better cancellation responsiveness
          let processedTokens = 0;
          
          for (let i = 0; i < tokensToFetch.length; i += batchSize) {
            // Check for cancellation before each batch
            await this.checkJobCancellation(job);
            
            const batch = tokensToFetch.slice(i, i + batchSize);
            
            try {
              // Process this batch using TokenInfoService (which has proper database logic)
              await this.tokenInfoService.triggerTokenInfoEnrichment(batch, 'system-enrichment-job');
              processedTokens += batch.length;
              newTokensFetched += batch.length;
          
          // Update progress
          const progress = Math.min(90, Math.floor((processedTokens / tokensToFetch.length) * 90));
          await job.updateProgress(progress);
          await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, progress);
          
          this.logger.log(`Enriched batch ${Math.ceil((i + batchSize) / batchSize)} of ${Math.ceil(tokensToFetch.length / batchSize)} (${processedTokens}/${tokensToFetch.length} tokens)`);
          
        } catch (error) {
          if (error instanceof Error && error.message.includes('cancelled')) {
            throw error; // Re-throw cancellation errors
          }
          
          this.logger.warn(`Failed to enrich batch starting at index ${i}:`, error);
          // Continue with other batches instead of failing the entire job
        }
      }
    } else {
      this.logger.log('All tokens already have recent metadata, no API calls needed');
      await job.updateProgress(90);
      await this.websocketGateway.publishProgressEvent(job.id!, job.queueName, 90);
    }
    
    // STEP 4: Return enriched balances with metadata from database
    const finalTokenInfos = await this.tokenInfoService.findMany(uniqueTokens);
    const finalTokenMap = new Map(finalTokenInfos.map(t => [t.tokenAddress, t]));
    
    // Enrich the wallet balances with the final metadata and USD values
    const enrichedBalances = { ...walletBalances };
    for (const [walletAddress, balance] of Object.entries(enrichedBalances)) {
      if (balance.tokenBalances) {
        balance.tokenBalances = balance.tokenBalances.map(token => {
          const metadata = finalTokenMap.get(token.mint);
          
          // Calculate USD value if we have price data
          let priceUsd: number | null = null;
          let valueUsd: number | null = null;
          
          if (metadata?.priceUsd) {
            try {
              priceUsd = parseFloat(metadata.priceUsd);
              // Calculate USD value: balance * price
              const rawBalance = BigInt(token.balance || '0');
              const divisor = BigInt(10 ** (token.decimals || 0));
              const numericBalance = Number(rawBalance) / Number(divisor);
              valueUsd = numericBalance * priceUsd;
            } catch (error) {
              this.logger.warn(`Failed to calculate USD value for token ${token.mint}:`, error);
            }
          }
          
          return {
            ...token,
            name: metadata?.name,
            symbol: metadata?.symbol,
            imageUrl: metadata?.imageUrl,
            websiteUrl: metadata?.websiteUrl,
            twitterUrl: metadata?.twitterUrl,
            telegramUrl: metadata?.telegramUrl,
            priceUsd,
            valueUsd,
          };
        });
      }
    }
    
    return {
      enrichedBalances,
      summary: { newTokensFetched }
    };
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
   * 🔥 CRITICAL PERFORMANCE FIX: Filter tokens to only actively traded ones  
   * Reduces 32k+ tokens down to ~2-5k meaningful tokens
   */


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