import { Logger } from '@nestjs/common';

export interface BatchProcessingOptions {
  failureThreshold?: number;    // Default 0.8 (80% success rate required)
  timeoutMs?: number;          // Default 30 minutes
  maxConcurrency?: number;     // Default unlimited
  retryAttempts?: number;      // Default 0 (no retries)
  retryDelayMs?: number;      // Default 1000ms
}

export interface BatchResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  processingTimeMs: number;
  itemId: string;
}

export interface BatchSummary<T> {
  totalItems: number;
  successfulItems: number;
  failedItems: number;
  successRate: number;
  results: BatchResult<T>[];
  processingTimeMs: number;
  timedOut: boolean;
}

/**
 * Utility class for processing batches of items with partial failure tolerance
 * Used for multi-wallet operations where some failures are acceptable
 */
export class BatchProcessor {
  private readonly logger = new Logger(BatchProcessor.name);

  /**
   * Process a batch of items with partial failure tolerance
   */
  async processBatch<TInput, TOutput>(
    items: TInput[],
    processor: (item: TInput, index: number) => Promise<TOutput>,
    itemIdExtractor: (item: TInput, index: number) => string,
    options: BatchProcessingOptions = {}
  ): Promise<BatchSummary<TOutput>> {
    const {
      failureThreshold = 0.8,
      timeoutMs = 30 * 60 * 1000,
      maxConcurrency = Infinity,
      retryAttempts = 0,
      retryDelayMs = 1000
    } = options;

    const startTime = Date.now();
    const results: BatchResult<TOutput>[] = [];
    
    this.logger.log(`Starting batch processing of ${items.length} items with ${(failureThreshold * 100).toFixed(0)}% success threshold`);

    // Create processing promises with concurrency control
    const processingPromises = items.map(async (item, index) => {
      const itemId = itemIdExtractor(item, index);
      const itemStartTime = Date.now();
      
      let lastError: Error | undefined;
      
      // Retry logic
      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          // Check timeout before each attempt
          if (Date.now() - startTime > timeoutMs) {
            throw new Error(`Batch processing timeout exceeded for item ${itemId}`);
          }
          
          const data = await processor(item, index);
          
          const result: BatchResult<TOutput> = {
            success: true,
            data,
            processingTimeMs: Date.now() - itemStartTime,
            itemId
          };
          
          results.push(result);
          return;
          
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          
          if (attempt < retryAttempts) {
            this.logger.warn(`Attempt ${attempt + 1} failed for item ${itemId}, retrying...`, lastError.message);
            await this.delay(retryDelayMs);
          }
        }
      }
      
      // All attempts failed
      const result: BatchResult<TOutput> = {
        success: false,
        error: lastError?.message || 'Unknown error',
        processingTimeMs: Date.now() - itemStartTime,
        itemId
      };
      
      results.push(result);
      this.logger.warn(`All ${retryAttempts + 1} attempts failed for item ${itemId}: ${result.error}`);
    });

    // Execute with concurrency control
    if (maxConcurrency < Infinity) {
      await this.processConcurrently(processingPromises, maxConcurrency);
    } else {
      await Promise.allSettled(processingPromises);
    }

    // Calculate summary
    const processingTimeMs = Date.now() - startTime;
    const successfulItems = results.filter(r => r.success).length;
    const failedItems = results.length - successfulItems;
    const successRate = items.length > 0 ? successfulItems / items.length : 1;
    const timedOut = processingTimeMs >= timeoutMs;

    const summary: BatchSummary<TOutput> = {
      totalItems: items.length,
      successfulItems,
      failedItems,
      successRate,
      results,
      processingTimeMs,
      timedOut
    };

    this.logger.log(
      `Batch processing completed: ${successfulItems}/${items.length} items successful ` +
      `(${(successRate * 100).toFixed(1)}%) in ${processingTimeMs}ms`
    );

    // Check if failure threshold is met
    if (successRate < failureThreshold) {
      throw new Error(
        `Batch processing failed: success rate ${(successRate * 100).toFixed(1)}% ` +
        `is below required threshold ${(failureThreshold * 100).toFixed(1)}%`
      );
    }

    if (timedOut) {
      this.logger.warn(`Batch processing completed but exceeded timeout of ${timeoutMs}ms`);
    }

    return summary;
  }

  /**
   * Wait for jobs with partial failure tolerance
   * Specifically designed for BullMQ job tracking
   */
  async waitForJobsWithTolerance<T>(
    jobIds: string[],
    jobGetter: (jobId: string) => Promise<{ isCompleted(): boolean; isFailed(): boolean; returnvalue?: T } | null>,
    failureThreshold = 0.8,
    timeoutMs = 30 * 60 * 1000,
    pollIntervalMs = 1000
  ): Promise<BatchSummary<T>> {
    const startTime = Date.now();
    const results: BatchResult<T>[] = [];
    const pendingJobs = new Set(jobIds);

    this.logger.log(`Waiting for ${jobIds.length} jobs to complete with ${(failureThreshold * 100).toFixed(0)}% success threshold`);

    while (pendingJobs.size > 0 && (Date.now() - startTime) < timeoutMs) {
      const jobPromises = Array.from(pendingJobs).map(async (jobId) => {
        try {
          const job = await jobGetter(jobId);
          
          if (!job) {
            // Job not found - consider it failed
            results.push({
              success: false,
              error: 'Job not found',
              processingTimeMs: Date.now() - startTime,
              itemId: jobId
            });
            pendingJobs.delete(jobId);
            return;
          }

          if (job.isCompleted()) {
            results.push({
              success: true,
              data: job.returnvalue,
              processingTimeMs: Date.now() - startTime,
              itemId: jobId
            });
            pendingJobs.delete(jobId);
          } else if (job.isFailed()) {
            results.push({
              success: false,
              error: 'Job failed',
              processingTimeMs: Date.now() - startTime,
              itemId: jobId
            });
            pendingJobs.delete(jobId);
          }
        } catch (error) {
          this.logger.warn(`Error checking job ${jobId}:`, error);
        }
      });

      await Promise.allSettled(jobPromises);

      if (pendingJobs.size > 0) {
        await this.delay(pollIntervalMs);
      }
    }

    // Handle timeout - mark remaining jobs as failed
    if (pendingJobs.size > 0) {
      pendingJobs.forEach(jobId => {
        results.push({
          success: false,
          error: 'Job timeout',
          processingTimeMs: Date.now() - startTime,
          itemId: jobId
        });
      });
    }

    const processingTimeMs = Date.now() - startTime;
    const successfulItems = results.filter(r => r.success).length;
    const failedItems = results.length - successfulItems;
    const successRate = jobIds.length > 0 ? successfulItems / jobIds.length : 1;
    const timedOut = processingTimeMs >= timeoutMs;

    const summary: BatchSummary<T> = {
      totalItems: jobIds.length,
      successfulItems,
      failedItems,
      successRate,
      results,
      processingTimeMs,
      timedOut
    };

    this.logger.log(
      `Job waiting completed: ${successfulItems}/${jobIds.length} jobs successful ` +
      `(${(successRate * 100).toFixed(1)}%) in ${processingTimeMs}ms`
    );

    if (successRate < failureThreshold) {
      throw new Error(
        `Job completion failed: success rate ${(successRate * 100).toFixed(1)}% ` +
        `is below required threshold ${(failureThreshold * 100).toFixed(1)}%`
      );
    }

    return summary;
  }

  /**
   * Process promises with concurrency limit
   */
  private async processConcurrently<T>(promises: Promise<T>[], maxConcurrency: number): Promise<void> {
    const executing: Promise<any>[] = [];
    
    for (const promise of promises) {
      const wrapped = promise.finally(() => {
        const index = executing.indexOf(wrapped);
        if (index !== -1) {
          executing.splice(index, 1);
        }
      });
      
      executing.push(wrapped);
      
      if (executing.length >= maxConcurrency) {
        await Promise.race(executing);
      }
    }
    
    await Promise.allSettled(executing);
  }

  /**
   * Simple delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 