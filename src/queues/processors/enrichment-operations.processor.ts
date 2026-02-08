import { Inject, Logger, Injectable } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueNames, QueueConfigs, JobTimeouts } from '../config/queue.config';
import { EnrichTokenBalancesJobData, EnrichTokenBalancesResult, ParallelEnrichmentJobData } from '../jobs/types';
import { BalanceCacheService } from '../../api/services/balance-cache.service';
import { JobPayloadCacheService } from '../../api/services/job-payload-cache.service';
import { generateJobId } from '../utils/job-id-generator';
import { RedisLockService } from '../services/redis-lock.service';
import { TokenInfoService } from '../../api/services/token-info.service';
import { REDIS_CLIENT } from '../config/redis.provider';
import Redis from 'ioredis';
import { getErrorMessage } from 'core/utils/error-utils';

@Injectable()
export class EnrichmentOperationsProcessor {
    private readonly logger = new Logger(EnrichmentOperationsProcessor.name);
  private readonly worker: Worker;

    constructor(
    private readonly redisLockService: RedisLockService,
    private readonly tokenInfoService: TokenInfoService,
    private readonly balanceCacheService: BalanceCacheService,
    private readonly jobPayloadCache: JobPayloadCacheService,
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis, // For result caching
  ) {
    const config = QueueConfigs[QueueNames.ENRICHMENT_OPERATIONS];
    
    this.worker = new Worker(
      QueueNames.ENRICHMENT_OPERATIONS,
      async (job: Job) => this.processJob(job),
      config.workerOptions
    );

    this.worker.on('completed', (job) => {
      this.logger.log(` ✅ Job ${job.id} completed successfully`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${getErrorMessage(err)}`);
    });

    this.worker.on('error', (err) => {
      this.logger.error(`Worker error: ${getErrorMessage(err)}`);
    });

    this.logger.debug('EnrichmentOperationsProcessor initialized with worker');
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
  async processParallelEnrichment(job: Job<ParallelEnrichmentJobData>): Promise<{ enrichedBalances: Record<string, any> }> {
    const { walletBalances, balancesKey, requestId, walletAddresses } = job.data;
    const startTime = Date.now();
    
    let balancesPayload = walletBalances;
    if (!balancesPayload && balancesKey) {
      balancesPayload = await this.jobPayloadCache.retrievePayload(balancesKey);
      if (!balancesPayload) {
        throw new Error(`Missing balances payload for enrichment request ${requestId}`);
      }
      // 🔧 FIX: Don't delete payload immediately - let TTL handle cleanup
      // Deleting here prevents retries from working (payload already gone on 2nd/3rd attempt)
      // await this.jobPayloadCache.deletePayload(balancesKey);
    }

    if (!balancesPayload) {
      if (walletAddresses && walletAddresses.length > 0) {
        const fetched = await this.balanceCacheService.getManyBalances(walletAddresses);
        const filtered: Record<string, any> = {};
        for (const [address, balance] of Object.entries(fetched)) {
          if (balance) {
            filtered[address] = balance;
          }
        }
        balancesPayload = filtered;
      }
    }

    if (!balancesPayload || Object.keys(balancesPayload).length === 0) {
      throw new Error(`No balances provided for enrichment request ${requestId}`);
    }

    this.logger.log(`Processing parallel enrichment for ${Object.keys(balancesPayload).length} wallets, requestId: ${requestId}`);
    
    try {
      // Check for cancellation before starting
      await this.checkJobCancellation(job);
      
      // Use the existing sophisticated enrichment logic
      const { enrichedBalances, summary } = await this.enrichBalancesWithSophisticatedLogic(balancesPayload, job);

      // BullMQ handles progress - bridge picks it up automatically
      await job.updateProgress(100);

      // If no new tokens were actually fetched, we can short-circuit the expensive cache write.
      if (summary.newTokensFetched === 0) {
        this.logger.log(`Skipping cache write for request ${requestId} as no new token metadata was fetched.`);

        this.logger.log(`Parallel enrichment completed for requestId: ${requestId} (no-op).`);
        return { enrichedBalances };
      }
      
      // Store enriched result in Redis cache (reuse injected connection)
      const cacheKey = `enrich:${requestId}`;
      await this.redisClient.set(cacheKey, JSON.stringify(enrichedBalances), 'EX', 300);
      

      
      this.logger.log(`Parallel enrichment completed for requestId: ${requestId}. Total processing time: ${Date.now() - startTime}ms`);
      return { enrichedBalances };
      
    } catch (error) {
      this.logger.error(`Parallel enrichment failed for requestId: ${requestId}: ${getErrorMessage(error)}`);
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
    const { walletBalances, balancesKey, walletAddresses, requestId, optimizationHint } = job.data;
    const timeoutMs = JobTimeouts['enrich-token-balances'].timeout;
    const startTime = Date.now();

      let balancesPayload = walletBalances;
      if (!balancesPayload && balancesKey) {
        balancesPayload = await this.jobPayloadCache.retrievePayload(balancesKey);
        if (!balancesPayload) {
          throw new Error(`Missing balances payload for enrichment request ${requestId}`);
        }
        // 🔧 FIX: Don't delete payload immediately - let TTL handle cleanup
        // Deleting here prevents retries from working (payload already gone on 2nd/3rd attempt)
        // await this.jobPayloadCache.deletePayload(balancesKey);
      }

      if (!balancesPayload) {
        if (walletAddresses && walletAddresses.length > 0) {
          const fetched = await this.balanceCacheService.getManyBalances(walletAddresses);
          const filtered: Record<string, any> = {};
          for (const [address, balance] of Object.entries(fetched)) {
            if (balance) {
              filtered[address] = balance;
            }
          }
          balancesPayload = filtered;
        }
      }

      if (!balancesPayload || Object.keys(balancesPayload).length === 0) {
        throw new Error(`No balances provided for enrichment request ${requestId}`);
      }

      // Apply deduplication strategy using wallet balances
      const allTokens = Object.values(balancesPayload).flatMap(b => b.tokenBalances.map(t => t.mint));
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
        // BullMQ handles progress - bridge picks it up automatically
        await job.updateProgress(5);

        // Use the sophisticated logic from enrichBalances method
        const enrichedBalances = await this.enrichBalancesWithSophisticatedLogic(balancesPayload, job);

        await job.updateProgress(100);

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
      this.logger.error(`Token enrichment failed for request ${requestId}: ${getErrorMessage(error)}`);
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
    // 🎯 LOG: Show which wallets have how many tokens (identify whales)
    Object.entries(walletBalances).forEach(([address, balance]) => {
      const tokenCount = balance.tokenBalances?.length || 0;
      if (tokenCount > 10000) {
        this.logger.warn(`🐋 WHALE DETECTED: ${address} has ${tokenCount} tokens`);
      } else if (tokenCount > 5000) {
        this.logger.log(`⚠️ Large wallet: ${address} has ${tokenCount} tokens`);
      }
    });

    // Extract all unique token addresses
    const allTokens = Object.values(walletBalances).flatMap(b => b.tokenBalances.map(t => t.mint));
    const uniqueTokens = [...new Set(allTokens)];

    // For dashboard analysis, we should only process the tokens that were actually analyzed
    // The walletBalances object should already contain only the analyzed tokens
    const jobData = job.data as any;
    const isDashboardAnalysis = jobData?.enrichmentContext === 'dashboard-analysis';

    if (isDashboardAnalysis) {
      this.logger.log(`🔄 Starting enrichment for ${uniqueTokens.length} mapped tokens (dashboard analysis context)`);
    } else {
      this.logger.log(`🔄 Starting enrichment for ${uniqueTokens.length} unique tokens`);
    }

    // 🚨 GUARDRAIL: Protect against whale wallets with 10k+ shitcoins
    // This should rarely trigger now that similarity processor filters tokens before passing
    const MAX_TOKENS_PER_ENRICHMENT = 5000;
    const MIN_BALANCE_THRESHOLD = 1000; // Minimum UI balance to consider (filters dust)

    if (uniqueTokens.length > MAX_TOKENS_PER_ENRICHMENT) {
      this.logger.warn(`⚠️ Whale wallet detected! ${uniqueTokens.length} tokens found. Applying aggressive filtering to prevent system overload.`);
    }

    // For dashboard analysis, process ALL tokens that are mapped to this wallet
    // For other contexts, filter tokens that are likely to have metadata
    let meaningfulTokens = uniqueTokens.filter(tokenAddress => {
      // For dashboard analysis, include ALL tokens regardless of current balance
      if (isDashboardAnalysis) {
        return true; // Include all mapped tokens for dashboard analysis
      }

      // For other contexts, check if token has a meaningful balance
      const hasMeaningfulBalance = Object.values(walletBalances).some(wallet => {
        const tokenBalance = wallet.tokenBalances?.find(t => t.mint === tokenAddress);
        if (!tokenBalance) return false;

        // Check if token has a meaningful balance (not zero or very small)
        const uiBalance = tokenBalance.uiBalance || 0;
        const rawBalance = tokenBalance.balance || '0';

        // Skip only if both UI and raw balance are explicitly zero
        if (uiBalance === 0 && rawBalance === '0') return false;

        // For whale wallets, apply stricter threshold to filter dust
        if (uniqueTokens.length > MAX_TOKENS_PER_ENRICHMENT) {
          return uiBalance >= MIN_BALANCE_THRESHOLD;
        }

        return true;
      });

      return hasMeaningfulBalance;
    });

    // 🚨 FINAL GUARDRAIL: Hard cap on enrichment
    if (meaningfulTokens.length > MAX_TOKENS_PER_ENRICHMENT) {
      this.logger.warn(`⚠️ Still ${meaningfulTokens.length} tokens after filtering. Sorting by balance and capping at ${MAX_TOKENS_PER_ENRICHMENT}.`);

      // Sort tokens by total balance across all wallets (highest first)
      const tokenBalanceSums = new Map<string, number>();
      meaningfulTokens.forEach(tokenAddress => {
        let totalBalance = 0;
        Object.values(walletBalances).forEach(wallet => {
          const tokenBalance = wallet.tokenBalances?.find(t => t.mint === tokenAddress);
          if (tokenBalance) {
            totalBalance += tokenBalance.uiBalance || 0;
          }
        });
        tokenBalanceSums.set(tokenAddress, totalBalance);
      });

      meaningfulTokens = meaningfulTokens
        .sort((a, b) => (tokenBalanceSums.get(b) || 0) - (tokenBalanceSums.get(a) || 0))
        .slice(0, MAX_TOKENS_PER_ENRICHMENT);

      this.logger.warn(`✂️ Capped to top ${meaningfulTokens.length} tokens by balance. Whale wallet protection activated.`);
    }
    
    if (isDashboardAnalysis) {
      this.logger.log(`Processing ${meaningfulTokens.length} mapped tokens for dashboard analysis (all tokens included)`);
    } else {
      this.logger.log(`Filtered to ${meaningfulTokens.length} meaningful tokens (${uniqueTokens.length - meaningfulTokens.length} filtered out as likely account addresses or zero balances)`);
    }
    
    // STEP 1: Centralized staleness plan from TokenInfoService
    const enrichmentPlan = await this.tokenInfoService.getTokenEnrichmentPlan(meaningfulTokens);
    const tokensToFetch = enrichmentPlan.needsEnrichment;
    const newTokens = enrichmentPlan.newTokens;
    const staleTokens = enrichmentPlan.staleTokens;

    if (isDashboardAnalysis) {
      this.logger.log(`Found ${enrichmentPlan.existingTokens.length} existing mapped tokens, need to fetch ${tokensToFetch.length} new/stale mapped tokens`);
    } else {
      this.logger.log(`Found ${enrichmentPlan.existingTokens.length} existing tokens, need to fetch ${tokensToFetch.length} new/stale tokens`);
    }
    
    if (isDashboardAnalysis) {
      this.logger.log(`Breakdown: ${newTokens.length} new mapped tokens, ${staleTokens.length} stale mapped tokens`);
    } else {
      this.logger.log(`Breakdown: ${newTokens.length} new tokens, ${staleTokens.length} stale tokens`);
    }
    
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
      // BullMQ handles progress - bridge picks it up automatically
      await job.updateProgress(progress);

      this.logger.log(`Enriched batch ${Math.ceil((i + batchSize) / batchSize)} of ${Math.ceil(tokensToFetch.length / batchSize)} (${processedTokens}/${tokensToFetch.length} tokens)`);
      
    } catch (error) {
      if (error instanceof Error && error.message.includes('cancelled')) {
        throw error; // Re-throw cancellation errors
      }
      
      this.logger.warn(`Failed to enrich batch starting at index ${i}: ${getErrorMessage(error)}`);
      // Continue with other batches instead of failing the entire job
    }
  }
} else {
  if (isDashboardAnalysis) {
    this.logger.log('All mapped tokens already have recent metadata, no API calls needed');
  } else {
    this.logger.log('All tokens already have recent metadata, no API calls needed');
  }
  // BullMQ handles progress - bridge picks it up automatically
  await job.updateProgress(90);
}


    // STEP 4: Return enriched balances with metadata from database
    const finalTokenInfos = await this.tokenInfoService.findMany(meaningfulTokens);
    const finalTokenMap = new Map(finalTokenInfos.map(t => [t.tokenAddress, t]));
    
    // Enrich the wallet balances with the final metadata and USD values
    const meaningfulTokenSet = new Set(meaningfulTokens);
    const enrichedBalances = { ...walletBalances };
    for (const [walletAddress, balance] of Object.entries(enrichedBalances)) {
      if (balance.tokenBalances) {
        balance.tokenBalances = balance.tokenBalances
          .filter(token => meaningfulTokenSet.has(token.mint))
          .map(token => {
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
              this.logger.warn(`Failed to calculate USD value for token ${token.mint}: ${getErrorMessage(error)}`);
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
        await this.tokenInfoService.enrichTokensBackground(batch);
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        this.logger.warn(`Background enrichment failed for batch of ${batch.length} tokens: ${getErrorMessage(error)}`);
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
