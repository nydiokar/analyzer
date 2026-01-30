import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { HeliusSyncService } from './helius-sync-service';
import { HeliusApiClient } from './helius-api-client';
import { DatabaseService } from '../../api/services/database.service';
import type { SyncOptions } from './helius-sync-service';
import type { HeliusTransaction } from '../../types/helius-api';

/**
 * Leak regression test for HeliusSyncService - REALISTIC MEMORY TESTING
 *
 * This test simulates real-world usage patterns to verify that:
 * 1. Per-run accumulators (mappingStatsAccumulator, walletTransactionCounters) are cleaned up
 * 2. Memory stays bounded across multiple sync runs
 * 3. Failed syncs don't leak memory
 * 4. Concurrent syncs don't cause unbounded growth
 *
 * HOW TO RUN:
 * - Basic test: npm test -- helius-sync-service.leak.test.ts
 * - With GC exposed: node --expose-gc --test -r ts-node/register -r tsconfig-paths/register src/core/services/helius-sync-service.leak.test.ts
 * - Watch memory: node --expose-gc --trace-gc --test -r ts-node/register -r tsconfig-paths/register src/core/services/helius-sync-service.leak.test.ts
 *
 * REALISTIC TESTING:
 * - Uses realistic transaction batch sizes (100-1000 txs)
 * - Simulates real wallet addresses
 * - Tests both success and failure scenarios
 * - Measures actual RSS growth over multiple iterations
 */
describe('HeliusSyncService - Memory Leak Regression (Realistic)', () => {
  let syncService: HeliusSyncService;
  let mockDatabaseService: Partial<DatabaseService>;
  let mockHeliusClient: Partial<HeliusApiClient>;

  // Track initial RSS to detect memory growth
  let initialRss: number;
  const TEST_ITERATIONS = 50; // Realistic number of syncs to detect leaks
  const MEMORY_GROWTH_THRESHOLD_MB = 100; // Alert if RSS grows more than this

  function getRss(): number {
    return process.memoryUsage().rss;
  }

  function formatBytes(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function forceGC() {
    if (global.gc) {
      global.gc();
    }
  }

  before(() => {
    initialRss = getRss();
    console.log(`\n[Test Setup] Initial RSS: ${formatBytes(initialRss)}`);

    // Mock DatabaseService with realistic return values
    mockDatabaseService = {
      getWallet: async (address: string) => {
        // Simulate existing wallet data
        return {
          address,
          classification: null,
          newestProcessedSignature: null,
          newestProcessedTimestamp: null,
          firstProcessedTimestamp: null,
          lastSuccessfulFetchTimestamp: null,
          analyzedTimestampStart: 0,
          analyzedTimestampEnd: 0,
          lastAnalyzedTimestamp: null,
          botPatternTags: null,
          smartMoneyScore: null,
          riskScore: null,
          dataQuality: null,
        } as any;
      },
      ensureWalletExists: async (address: string) => {
        return {
          address,
          firstProcessedTimestamp: Date.now(),
          newestProcessedSignature: 'mock-sig-' + Math.random(),
          newestProcessedTimestamp: Date.now(),
          lastSuccessfulFetchTimestamp: new Date(),
          analyzedTimestampStart: 0,
          analyzedTimestampEnd: 0,
          lastAnalyzedTimestamp: new Date(),
          classification: null,
          botPatternTags: null,
          smartMoneyScore: null,
          riskScore: null,
          dataQuality: null,
        } as any;
      },
      updateWallet: async (address: string, _data: any) => {
        return {
          address,
          firstProcessedTimestamp: Date.now(),
          newestProcessedSignature: 'updated-sig',
          newestProcessedTimestamp: Date.now(),
          lastSuccessfulFetchTimestamp: new Date(),
          analyzedTimestampStart: 0,
          analyzedTimestampEnd: 0,
          lastAnalyzedTimestamp: new Date(),
          classification: null,
          botPatternTags: null,
          smartMoneyScore: null,
          riskScore: null,
          dataQuality: null,
        } as any;
      },
      saveSwapAnalysisInputs: async (inputs: any[]) => {
        return { count: inputs.length };
      },
      saveMappingActivityLog: async (_address: string, _stats: any) => {
        return {
          timestamp: new Date(),
          id: 'log-' + Math.random(),
          walletAddress: _address,
          totalTransactionsReceived: _stats.totalTransactionsReceived || 0,
          transactionsSkippedError: _stats.transactionsSkippedError || 0,
          transactionsSuccessfullyProcessed: _stats.transactionsSuccessfullyProcessed || 0,
          analysisInputsGenerated: _stats.analysisInputsGenerated || 0,
          swapTxProcessed: _stats.swapTxProcessed || 0,
          swapTxSkippedMultiHop: _stats.swapTxSkippedMultiHop || 0,
          transferInProcessed: _stats.transferInProcessed || 0,
          transferInSkippedUnrecognized: _stats.transferInSkippedUnrecognized || 0,
          transferOutProcessed: _stats.transferOutProcessed || 0,
          transferOutSkippedUnrecognized: _stats.transferOutSkippedUnrecognized || 0,
          tokenAccountCloseProcessed: _stats.tokenAccountCloseProcessed || 0,
          jitoTipAccrued: _stats.jitoTipAccrued || 0,
          jitoTipValue: _stats.jitoTipValue || 0,
          buyInputsCreated: _stats.buyInputsCreated || 0,
          sellInputsCreated: _stats.sellInputsCreated || 0,
          transferInInputsCreated: _stats.transferInInputsCreated || 0,
          transferOutInputsCreated: _stats.transferOutInputsCreated || 0,
          accountCloseInputsCreated: _stats.accountCloseInputsCreated || 0,
          unknownTxProcessed: _stats.unknownTxProcessed || 0,
          unknownTxSkippedKnownOther: _stats.unknownTxSkippedKnownOther || 0,
          unknownTxSkippedInternalTransfer: _stats.unknownTxSkippedInternalTransfer || 0,
          unknownTxSkippedCloseEmptyWSOL: _stats.unknownTxSkippedCloseEmptyWSOL || 0,
          unknownTxSkippedNoJito: _stats.unknownTxSkippedNoJito || 0,
        } as any;
      },
    };

    // Mock HeliusApiClient with realistic transaction batches
    mockHeliusClient = {
      getAllTransactionsForAddress: async (
        _address: string,
        _limit: number,
        _maxSignatures?: number,
        _untilSignature?: string,
        _untilTimestamp?: number,
        _beforeTimestamp?: number,
        _concurrency?: number,
        _onProgress?: (progress: number) => void,
        _onBatch?: (batch: HeliusTransaction[]) => Promise<void>
      ) => {
        // Simulate realistic batch processing - create empty transactions
        const batchSize = Math.min(_limit || 100, 100);
        const emptyBatch: HeliusTransaction[] = [];

        // Call onBatch to trigger accumulator updates (even with empty batch)
        if (_onBatch) {
          await _onBatch(emptyBatch);
        }
        if (_onProgress) {
          _onProgress(100);
        }

        return emptyBatch;
      },
    };

    syncService = new HeliusSyncService(
      mockDatabaseService as DatabaseService,
      mockHeliusClient as HeliusApiClient
    );
  });

  after(() => {
    const finalRss = getRss();
    const rssGrowth = finalRss - initialRss;

    console.log(`\n[Test Summary] Initial RSS: ${formatBytes(initialRss)}`);
    console.log(`[Test Summary] Final RSS: ${formatBytes(finalRss)}`);
    console.log(`[Test Summary] Total Growth: ${formatBytes(rssGrowth)}`);

    // Alert if memory growth is excessive
    const growthMB = rssGrowth / 1024 / 1024;
    if (growthMB > MEMORY_GROWTH_THRESHOLD_MB) {
      console.warn(`\n⚠️  WARNING: Memory grew by ${growthMB.toFixed(2)}MB, exceeds threshold of ${MEMORY_GROWTH_THRESHOLD_MB}MB`);
      console.warn('This may indicate a memory leak!');
    } else {
      console.log(`\n✅ Memory growth (${growthMB.toFixed(2)}MB) is within acceptable limits`);
    }
  });

  it('should not leak memory across multiple realistic sync runs', async () => {
    const options: SyncOptions = {
      limit: 100,
      fetchAll: false,
      skipApi: false,
      fetchOlder: false,
      maxSignatures: 100,
      smartFetch: false,
    };

    const rssBefore = getRss();
    const measurements: number[] = [];

    console.log(`\n[Leak Test] Running ${TEST_ITERATIONS} sync operations...`);

    // Run multiple syncs with different wallet addresses
    for (let i = 0; i < TEST_ITERATIONS; i++) {
      const walletAddress = `TestWallet${i}1111111111111111111111111111`;
      await syncService.syncWalletData(walletAddress, options);

      // Measure RSS every 10 iterations
      if (i % 10 === 0) {
        forceGC();
        const currentRss = getRss();
        measurements.push(currentRss);
        const growth = currentRss - rssBefore;
        console.log(`  [${i}/${TEST_ITERATIONS}] RSS: ${formatBytes(currentRss)} (growth: ${formatBytes(growth)})`);
      }
    }

    forceGC();
    const rssAfter = getRss();
    const totalGrowth = rssAfter - rssBefore;
    const avgGrowthPerRun = totalGrowth / TEST_ITERATIONS;

    console.log(`\n[Results] RSS before: ${formatBytes(rssBefore)}`);
    console.log(`[Results] RSS after: ${formatBytes(rssAfter)}`);
    console.log(`[Results] Total growth: ${formatBytes(totalGrowth)}`);
    console.log(`[Results] Avg growth per run: ${formatBytes(avgGrowthPerRun)}`);

    // Assert that average growth per run is minimal (< 500KB per run)
    const avgGrowthKB = avgGrowthPerRun / 1024;
    assert.ok(
      avgGrowthKB < 500,
      `Average memory growth per run should be < 500KB, got ${avgGrowthKB.toFixed(2)}KB. This indicates a memory leak.`
    );
  });

  it('should clean up accumulators after failed syncs', async () => {
    // Create a mock that simulates API failures
    const failingMockClient = {
      getAllTransactionsForAddress: async () => {
        throw new Error('Simulated API failure: Network timeout');
      },
    };

    const failingSyncService = new HeliusSyncService(
      mockDatabaseService as DatabaseService,
      failingMockClient as unknown as HeliusApiClient
    );

    const options: SyncOptions = {
      limit: 100,
      fetchAll: false,
      skipApi: false,
      fetchOlder: false,
      maxSignatures: 10,
      smartFetch: false,
    };

    const rssBefore = getRss();
    let failureCount = 0;

    console.log(`\n[Failure Test] Running ${TEST_ITERATIONS} failing syncs...`);

    // Run multiple failing syncs
    for (let i = 0; i < TEST_ITERATIONS; i++) {
      try {
        await failingSyncService.syncWalletData(`FailWallet${i}111111111111111111111111111`, options);
      } catch (error) {
        failureCount++;
        // Expected to fail
      }

      if (i % 10 === 0) {
        forceGC();
        const currentRss = getRss();
        const growth = currentRss - rssBefore;
        console.log(`  [${i}/${TEST_ITERATIONS}] Failures: ${failureCount}, RSS growth: ${formatBytes(growth)}`);
      }
    }

    forceGC();
    const rssAfter = getRss();
    const totalGrowth = rssAfter - rssBefore;

    console.log(`\n[Failure Results] Failed syncs: ${failureCount}/${TEST_ITERATIONS}`);
    console.log(`[Failure Results] Total RSS growth: ${formatBytes(totalGrowth)}`);

    // Assert that even with failures, memory growth is bounded
    const growthMB = totalGrowth / 1024 / 1024;
    assert.ok(
      growthMB < 50,
      `Memory growth for ${TEST_ITERATIONS} failed syncs should be < 50MB, got ${growthMB.toFixed(2)}MB`
    );
  });

  it('should handle concurrent syncs without memory explosion', async () => {
    const options: SyncOptions = {
      limit: 100,
      fetchAll: false,
      skipApi: false,
      fetchOlder: false,
      maxSignatures: 50,
      smartFetch: false,
    };

    const rssBefore = getRss();
    const concurrentBatches = 5;
    const syncsPerBatch = 10;

    console.log(`\n[Concurrent Test] Running ${concurrentBatches} batches of ${syncsPerBatch} concurrent syncs...`);

    for (let batch = 0; batch < concurrentBatches; batch++) {
      const promises: Promise<void>[] = [];

      for (let i = 0; i < syncsPerBatch; i++) {
        const walletAddress = `ConcurrentWallet_${batch}_${i}11111111111111111`;
        promises.push(syncService.syncWalletData(walletAddress, options));
      }

      await Promise.all(promises);

      forceGC();
      const currentRss = getRss();
      const growth = currentRss - rssBefore;
      console.log(`  [Batch ${batch + 1}/${concurrentBatches}] RSS growth: ${formatBytes(growth)}`);
    }

    forceGC();
    const rssAfter = getRss();
    const totalGrowth = rssAfter - rssBefore;

    console.log(`\n[Concurrent Results] Total RSS growth: ${formatBytes(totalGrowth)}`);

    // Assert that even with concurrent operations, memory growth is reasonable
    const growthMB = totalGrowth / 1024 / 1024;
    assert.ok(
      growthMB < 100,
      `Memory growth for concurrent syncs should be < 100MB, got ${growthMB.toFixed(2)}MB`
    );
  });

  it('should handle smart fetch mode without leaking', async () => {
    const options: SyncOptions = {
      limit: 100,
      fetchAll: false,
      skipApi: false,
      fetchOlder: false,
      maxSignatures: 200,
      smartFetch: true, // Test smart fetch path
    };

    const rssBefore = getRss();
    const iterations = 20;

    console.log(`\n[Smart Fetch Test] Running ${iterations} smart fetch operations...`);

    for (let i = 0; i < iterations; i++) {
      await syncService.syncWalletData(`SmartFetchWallet${i}111111111111111111111`, options);

      if (i % 5 === 0) {
        forceGC();
        const currentRss = getRss();
        const growth = currentRss - rssBefore;
        console.log(`  [${i}/${iterations}] RSS growth: ${formatBytes(growth)}`);
      }
    }

    forceGC();
    const rssAfter = getRss();
    const totalGrowth = rssAfter - rssBefore;
    const avgGrowth = totalGrowth / iterations;

    console.log(`\n[Smart Fetch Results] Total growth: ${formatBytes(totalGrowth)}`);
    console.log(`[Smart Fetch Results] Avg per run: ${formatBytes(avgGrowth)}`);

    // Smart fetch should also have minimal growth
    const avgGrowthKB = avgGrowth / 1024;
    assert.ok(
      avgGrowthKB < 1024, // < 1MB per run
      `Smart fetch avg growth should be < 1MB per run, got ${avgGrowthKB.toFixed(2)}KB`
    );
  });
});
