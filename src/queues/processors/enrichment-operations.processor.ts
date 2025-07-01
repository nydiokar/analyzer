import { Injectable, Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QueueNames, QueueConfigs, JobTimeouts } from '../config/queue.config';
import { EnrichMetadataJobData, FetchDexScreenerJobData, MetadataEnrichmentResult } from '../jobs/types';
import { generateJobId } from '../utils/job-id-generator';
import { RedisLockService } from '../services/redis-lock.service';
import { TokenInfoService } from '../../api/token-info/token-info.service';
import { DexscreenerService } from '../../api/dexscreener/dexscreener.service';

@Injectable()
export class EnrichmentOperationsProcessor {
  private readonly logger = new Logger(EnrichmentOperationsProcessor.name);
  private readonly worker: Worker;

  constructor(
    private readonly redisLockService: RedisLockService,
    private readonly tokenInfoService: TokenInfoService,
    private readonly dexscreenerService: DexscreenerService,
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
      case 'enrich-metadata':
        return await this.processEnrichMetadata(job as Job<EnrichMetadataJobData>);
      case 'fetch-dexscreener':
        return await this.processFetchDexScreener(job as Job<FetchDexScreenerJobData>);
      default:
        throw new Error(`Unknown job type: ${jobName}`);
    }
  }

  /**
   * Process token metadata enrichment job with Redis lock-based idempotency
   */
  async processEnrichMetadata(job: Job<EnrichMetadataJobData>): Promise<MetadataEnrichmentResult[]> {
    const { tokenAddresses, requestId } = job.data;
    const timeoutMs = JobTimeouts['enrich-metadata'].timeout;
    const startTime = Date.now();
    
    // Apply deduplication strategy
    // Create deterministic job ID for batch of tokens
    const sortedTokens = tokenAddresses.sort().join('-');
    const expectedJobId = generateJobId.enrichMetadata(sortedTokens, requestId);
    if (job.id !== expectedJobId) {
      throw new Error(`Job ID mismatch - possible duplicate: expected ${expectedJobId}, got ${job.id}`);
    }

    // Acquire Redis lock to prevent concurrent processing
    const lockKey = RedisLockService.createEnrichmentLockKey(tokenAddresses.join('-'));
    const lockAcquired = await this.redisLockService.acquireLock(lockKey, job.id!, timeoutMs);
    
    if (!lockAcquired) {
      throw new Error(`Token metadata enrichment already in progress for: ${tokenAddresses.join(', ')}`);
    }

    try {
      await job.updateProgress(5);
      this.logger.log(`Processing metadata enrichment for ${tokenAddresses.length} tokens`);

      const results: MetadataEnrichmentResult[] = [];

      // Process tokens in batches to avoid overwhelming external APIs
      const batchSize = 10;
      for (let i = 0; i < tokenAddresses.length; i += batchSize) {
        this.checkTimeout(startTime, timeoutMs, `Batch ${Math.floor(i/batchSize) + 1}`);
        
        const batch = tokenAddresses.slice(i, i + batchSize);
        await job.updateProgress(5 + (i / tokenAddresses.length) * 85);

        // Check if tokens already have metadata
        const existingTokens = await this.tokenInfoService.findMany(batch);
        const existingTokenMap = new Map(existingTokens.map(t => [t.tokenAddress, t]));

        // Process each token in the batch
        for (const tokenAddress of batch) {
          try {
            const existing = existingTokenMap.get(tokenAddress);
            const lastUpdated = existing?.updatedAt;
            const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime()) > 24 * 60 * 60 * 1000; // 24 hours

            if (existing && !isStale) {
              results.push({
                success: true,
                tokenAddress,
                status: 'already-current',
                lastUpdated,
                timestamp: Date.now(),
                processingTimeMs: Date.now() - startTime
              });
            } else {
              // Fetch and save new metadata using existing optimal service
              await this.dexscreenerService.fetchAndSaveTokenInfo([tokenAddress]);
              
              results.push({
                success: true,
                tokenAddress,
                status: 'enriched',
                lastUpdated: new Date(),
                timestamp: Date.now(),
                processingTimeMs: Date.now() - startTime
              });
            }
          } catch (error) {
            this.logger.error(`Failed to enrich metadata for token ${tokenAddress}:`, error);
            results.push({
              success: false,
              tokenAddress,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
              timestamp: Date.now(),
              processingTimeMs: Date.now() - startTime
            });
          }
        }

        // Small delay between batches to respect API rate limits
        if (i + batchSize < tokenAddresses.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      await job.updateProgress(100);

      this.logger.log(`Metadata enrichment completed. Processed ${results.filter(r => r.success).length}/${tokenAddresses.length} tokens successfully`);
      return results;

    } catch (error) {
      this.logger.error(`Metadata enrichment failed for request ${requestId}:`, error);
      throw error;
    } finally {
      // Always release lock
      await this.redisLockService.releaseLock(lockKey, job.id!);
    }
  }

  /**
   * Process DexScreener data fetch job
   */
  async processFetchDexScreener(job: Job<FetchDexScreenerJobData>): Promise<MetadataEnrichmentResult> {
    const { tokenAddress, requestId } = job.data;
    const startTime = Date.now();
    
    try {
      await job.updateProgress(10);
      this.logger.log(`Fetching DexScreener data for token ${tokenAddress}`);

      // Use existing optimal service for DexScreener data
      await this.dexscreenerService.fetchAndSaveTokenInfo([tokenAddress]);
      
      await job.updateProgress(100);

      const result: MetadataEnrichmentResult = {
        success: true,
        tokenAddress,
        status: 'enriched',
        lastUpdated: new Date(),
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };

      this.logger.log(`DexScreener data fetched for ${tokenAddress}`);
      return result;

    } catch (error) {
      this.logger.error(`DexScreener fetch failed for ${tokenAddress}:`, error);
      
      const result: MetadataEnrichmentResult = {
        success: false,
        tokenAddress,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
        processingTimeMs: Date.now() - startTime
      };
      
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
    this.logger.log('Shutting down EnrichmentOperationsProcessor worker...');
    await this.worker.close();
  }
} 