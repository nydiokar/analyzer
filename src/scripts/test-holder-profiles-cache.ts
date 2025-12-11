#!/usr/bin/env node
/**
 * Test Two-Tier Holder Profiles Cache System
 *
 * @description
 * Validates the two-tier caching system (Redis + PostgreSQL) for holder profile analysis.
 * Tests cache hit/miss scenarios, snapshot persistence, freshness logic, and metrics tracking.
 *
 * @architecture
 * TIER 1 (Redis - Hot Cache):
 *   - Stores: Complete HolderProfilesResult objects
 *   - TTL: 1 hour (configurable)
 *   - Use case: Repeated queries for same token/topN
 *
 * TIER 2 (PostgreSQL - Persistent Cache):
 *   - Stores: Individual HolderProfile snapshots as JSONB
 *   - TTL: Until wallet re-syncs (smart freshness check)
 *   - Use case: Progressive streaming (serve cached instantly, compute stale)
 *
 * @tests
 * 1. Tier 1 Cache Miss → Computes fresh result
 * 2. Tier 1 Cache Hit → Returns cached result instantly
 * 3. Tier 1 Invalidation → Falls back to Tier 2
 * 4. Tier 2 Cache Hit → Serves snapshots from PostgreSQL
 * 5. Tier 2 Freshness Logic → Validates snapshot staleness checks
 * 6. Cache Metrics → Verifies hit/miss rate tracking
 * 7. Snapshot Hydration → Tests rank/supply percent updates
 *
 * @usage
 * Test with default settings:
 * ```bash
 * npm run test:cache
 * ```
 *
 * Test with custom token:
 * ```bash
 * npm run test:cache -- --token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --topN 5
 * ```
 *
 * Skip cleanup (leave test data in cache):
 * ```bash
 * npm run test:cache -- --skipCleanup
 * ```
 *
 * @output
 * Console output with:
 * - Test results for each scenario (✓ Pass / ✗ Fail)
 * - Cache metrics (hit rates, counts)
 * - Timing measurements
 * - Detailed error messages if tests fail
 *
 * @performance
 * - Full test suite: ~5-10 seconds
 * - No waiting for TTL expiration (uses manual invalidation)
 * - No app/frontend required
 *
 * @see src/api/services/holder-profiles-cache.service.ts - Cache implementation
 * @see src/queues/processors/analysis-operations.processor.ts - Cache orchestration
 */

import * as dotenv from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { DatabaseService } from '../api/services/database.service';
import { HolderProfilesCacheService } from '../api/services/holder-profiles-cache.service';
import { HolderProfilesResult, HolderProfile } from '../queues/jobs/types';
import type { HolderProfileSnapshot } from '@prisma/client';

dotenv.config();

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: string;
  error?: string;
}

interface TestSummary {
  totalTests: number;
  passed: number;
  failed: number;
  duration: number;
  results: TestResult[];
}

/**
 * Pretty print test result
 */
function printTestResult(result: TestResult): void {
  const status = result.passed
    ? `${colors.green}✓ PASS${colors.reset}`
    : `${colors.red}✗ FAIL${colors.reset}`;
  console.log(`\n${status} ${result.name} ${colors.gray}(${result.duration}ms)${colors.reset}`);
  if (result.details) {
    console.log(`  ${colors.cyan}→${colors.reset} ${result.details}`);
  }
  if (result.error) {
    console.log(`  ${colors.red}ERROR:${colors.reset} ${result.error}`);
  }
}

/**
 * Print test summary
 */
function printSummary(summary: TestSummary): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`${colors.blue}${colors.bold}TEST SUMMARY${colors.reset}`);
  console.log('='.repeat(80));
  console.log(`Total Tests: ${summary.totalTests}`);
  console.log(`${colors.green}Passed: ${summary.passed}${colors.reset}`);
  if (summary.failed > 0) {
    console.log(`${colors.red}Failed: ${summary.failed}${colors.reset}`);
  }
  console.log(`Total Duration: ${summary.duration}ms (${(summary.duration / 1000).toFixed(2)}s)`);
  console.log('='.repeat(80));
}

/**
 * Create a mock HolderProfile matching the actual type structure
 */
function createMockHolderProfile(walletAddress: string, rank: number, supplyPercent: number): HolderProfile {
  return {
    walletAddress,
    rank,
    supplyPercent,
    medianHoldTimeHours: 24.5,
    avgHoldTimeHours: 36.2,
    dailyFlipRatio: 0.15,
    dailyFlipRatioConfidence: 'HIGH',
    behaviorType: 'SWING_TRADER',
    exitPattern: 'GRADUAL',
    dataQualityTier: 'GOLD',
    completedCycleCount: 25,
    confidence: 0.85,
    processingTimeMs: 50,
    holdTimeDistribution: undefined,
    enrichedHoldTimeDistribution: undefined,
    includesCurrentHoldings: false,
    exitRate: 0.75,
    totalTokensTraded: 50,
    typicalHoldTimeHours: 30.0,
    typicalHoldTimeSource: 'EXITED',
    realizedMedianHoldTimeHours: 24.5,
    realizedAverageHoldTimeHours: 36.2,
    currentHoldMedianHours: null,
    currentHoldAverageHours: null,
    percentValueInCurrentHoldings: null,
    currentHoldingsCount: 0,
    currentHoldings: [],
    oldestTransactionTimestamp: Date.now() / 1000 - 86400 * 30, // 30 days ago
    newestTransactionTimestamp: Date.now() / 1000,
  };
}

/**
 * Create a mock HolderProfilesResult for testing
 */
function createMockResult(tokenMint: string, topN: number): HolderProfilesResult {
  const profiles: HolderProfile[] = [];
  for (let i = 1; i <= topN; i++) {
    const mockAddress = `MockWallet${i}${'x'.repeat(32)}`;
    profiles.push(createMockHolderProfile(mockAddress, i, (100 / topN) * (topN - i + 1)));
  }

  return {
    success: true,
    mode: 'token',
    tokenMint,
    profiles,
    metadata: {
      totalHoldersRequested: topN,
      totalHoldersAnalyzed: topN,
      totalProcessingTimeMs: 1000,
      avgProcessingTimePerWalletMs: 1000 / topN,
    },
    timestamp: Date.now(),
    processingTimeMs: 1000,
  };
}

/**
 * Test Suite Runner
 */
class CacheTestSuite {
  private cacheService: HolderProfilesCacheService;
  private databaseService: DatabaseService;
  private results: TestResult[] = [];
  private testStartTime: number = 0;

  constructor(
    cacheService: HolderProfilesCacheService,
    databaseService: DatabaseService,
  ) {
    this.cacheService = cacheService;
    this.databaseService = databaseService;
  }

  /**
   * Run a single test with timing and error handling
   */
  private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const startTime = Date.now();
    try {
      await testFn();
      const duration = Date.now() - startTime;
      const result: TestResult = { name, passed: true, duration };
      this.results.push(result);
      printTestResult(result);
    } catch (error) {
      const duration = Date.now() - startTime;
      const result: TestResult = {
        name,
        passed: false,
        duration,
        error: error instanceof Error ? error.message : String(error),
      };
      this.results.push(result);
      printTestResult(result);
    }
  }

  /**
   * Test 1: Tier 1 Cache Miss
   */
  private async testTier1CacheMiss(tokenMint: string, topN: number): Promise<void> {
    await this.runTest('Tier 1 Cache Miss', async () => {
      // Clear cache first
      await this.cacheService.invalidateForToken(tokenMint);

      // Try to get cached result (should be null)
      const cached = await this.cacheService.getTokenResult(tokenMint, topN);

      if (cached !== null) {
        throw new Error(`Expected null, but got cached result`);
      }
    });
  }

  /**
   * Test 2: Tier 1 Cache Write and Hit
   */
  private async testTier1CacheWriteAndHit(tokenMint: string, topN: number): Promise<void> {
    await this.runTest('Tier 1 Cache Write and Hit', async () => {
      // Create and cache a result
      const mockResult = createMockResult(tokenMint, topN);
      await this.cacheService.cacheTokenResult(tokenMint, topN, mockResult);

      // Try to get cached result (should return the mock result)
      const cached = await this.cacheService.getTokenResult(tokenMint, topN);

      if (!cached) {
        throw new Error('Expected cached result, but got null');
      }

      if (cached.profiles.length !== topN) {
        throw new Error(`Expected ${topN} profiles, got ${cached.profiles.length}`);
      }

      if (cached.tokenMint !== tokenMint) {
        throw new Error(`Token mint mismatch: expected ${tokenMint}, got ${cached.tokenMint}`);
      }
    });
  }

  /**
   * Test 3: Tier 1 Invalidation
   */
  private async testTier1Invalidation(tokenMint: string, topN: number): Promise<void> {
    await this.runTest('Tier 1 Invalidation', async () => {
      // Cache a result first
      const mockResult = createMockResult(tokenMint, topN);
      await this.cacheService.cacheTokenResult(tokenMint, topN, mockResult);

      // Verify it's cached
      let cached = await this.cacheService.getTokenResult(tokenMint, topN);
      if (!cached) {
        throw new Error('Result should be cached before invalidation');
      }

      // Invalidate
      await this.cacheService.invalidateForToken(tokenMint);

      // Verify it's gone
      cached = await this.cacheService.getTokenResult(tokenMint, topN);
      if (cached !== null) {
        throw new Error('Result should be null after invalidation');
      }
    });
  }

  /**
   * Test 4: Tier 2 Snapshot Save and Retrieve
   */
  private async testTier2SnapshotSaveAndRetrieve(tokenMint: string): Promise<void> {
    await this.runTest('Tier 2 Snapshot Save and Retrieve', async () => {
      const walletAddress = `TestWallet${Date.now()}${'x'.repeat(20)}`;
      const profile = createMockHolderProfile(walletAddress, 1, 10.5);

      // Ensure wallet exists in database (FK constraint requirement)
      await this.databaseService.ensureWalletExists(walletAddress);

      // Save snapshot
      await this.cacheService.saveSnapshot({
        walletAddress,
        tokenMint,
        analysisMode: 'token',
        holderRank: 1,
        supplyPercent: 10.5,
        topN: 10,
        jobId: 'test-job-id',
        requestId: 'test-request-id',
        profile,
        metadata: { testMode: true },
      });

      // Retrieve snapshots
      const { snapshots, readyWallets, staleWallets } = await this.cacheService.getTokenSnapshots(tokenMint, [
        walletAddress,
      ]);

      if (snapshots.size !== 1) {
        throw new Error(`Expected 1 snapshot, got ${snapshots.size}`);
      }

      const snapshot = snapshots.get(walletAddress);
      if (!snapshot) {
        throw new Error('Snapshot not found');
      }

      if (readyWallets.length !== 1 || readyWallets[0] !== walletAddress) {
        throw new Error('Wallet should be in readyWallets list');
      }

      if (staleWallets.length !== 0) {
        throw new Error('Wallet should not be in staleWallets list (just created)');
      }
    });
  }

  /**
   * Test 5: Snapshot Freshness Logic
   */
  private async testSnapshotFreshness(): Promise<void> {
    await this.runTest('Snapshot Freshness Logic', async () => {
      const baseProfile = createMockHolderProfile('TestWallet', 1, 10.0);

      // Create a fresh snapshot (just created)
      const freshSnapshot: HolderProfileSnapshot = {
        id: 1,
        walletAddress: 'TestWallet',
        tokenMint: 'TestToken',
        analysisMode: 'token',
        holderRank: 1,
        supplyPercent: 10.0,
        topN: 10,
        jobId: null,
        requestId: null,
        computedAt: new Date(), // Just now
        profile: baseProfile as any,
        metadata: null,
      };

      // Create a stale snapshot (computed 2 hours ago)
      const staleSnapshot: HolderProfileSnapshot = {
        ...freshSnapshot,
        id: 2,
        computedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      };

      // Test fresh snapshot (no wallet record - uses time-based fallback)
      const isFresh = this.cacheService.isSnapshotFresh(freshSnapshot, null);
      if (!isFresh) {
        throw new Error('Fresh snapshot should be valid (computed < 1 hour ago)');
      }

      // Test stale snapshot (no wallet record - uses time-based fallback)
      const isStale = this.cacheService.isSnapshotFresh(staleSnapshot, null);
      if (isStale) {
        throw new Error('Stale snapshot should be invalid (computed > 1 hour ago)');
      }

      // Test with wallet record - snapshot fresher than wallet sync
      const walletRecord: any = {
        address: 'TestWallet',
        lastSuccessfulFetchTimestamp: new Date(Date.now() - 30 * 60 * 1000), // 30 mins ago
      };
      const isFreshVsWallet = this.cacheService.isSnapshotFresh(freshSnapshot, walletRecord);
      if (!isFreshVsWallet) {
        throw new Error('Snapshot should be fresh (computed after wallet sync)');
      }
    });
  }

  /**
   * Test 6: Snapshot Hydration
   */
  private async testSnapshotHydration(): Promise<void> {
    await this.runTest('Snapshot Hydration', async () => {
      const baseProfile = createMockHolderProfile('TestWallet', 5, 8.0);

      const snapshot: HolderProfileSnapshot = {
        id: 1,
        walletAddress: 'TestWallet',
        tokenMint: 'TestToken',
        analysisMode: 'token',
        holderRank: 5,
        supplyPercent: 8.0,
        topN: 10,
        jobId: null,
        requestId: null,
        computedAt: new Date(),
        profile: baseProfile as any,
        metadata: null,
      };

      // Hydrate with new metadata (rank changed from 5 to 3, supply from 8% to 12%)
      const hydrated = this.cacheService.hydrateSnapshot(snapshot, {
        rank: 3,
        supplyPercent: 12.0,
      });

      if (hydrated.rank !== 3) {
        throw new Error(`Expected rank 3, got ${hydrated.rank}`);
      }

      if (hydrated.supplyPercent !== 12.0) {
        throw new Error(`Expected supplyPercent 12.0, got ${hydrated.supplyPercent}`);
      }

      // Verify other fields are preserved
      if (hydrated.walletAddress !== 'TestWallet') {
        throw new Error('Wallet address should be preserved');
      }

      if (hydrated.behaviorType !== 'SWING_TRADER') {
        throw new Error('Behavior type should be preserved');
      }
    });
  }

  /**
   * Test 7: Cache Metrics Tracking
   */
  private async testCacheMetrics(tokenMint: string, topN: number): Promise<void> {
    await this.runTest('Cache Metrics Tracking', async () => {
      // Reset metrics
      this.cacheService.resetMetrics();

      // Initial metrics should be zero
      let metrics = this.cacheService.getCacheMetrics();
      if (metrics.tier1.hits !== 0 || metrics.tier1.misses !== 0) {
        throw new Error('Initial metrics should be zero');
      }

      // Clear cache and trigger a miss
      await this.cacheService.invalidateForToken(tokenMint);
      await this.cacheService.getTokenResult(tokenMint, topN);

      metrics = this.cacheService.getCacheMetrics();
      if (metrics.tier1.misses !== 1) {
        throw new Error(`Expected 1 miss, got ${metrics.tier1.misses}`);
      }

      // Cache a result and trigger a hit
      const mockResult = createMockResult(tokenMint, topN);
      await this.cacheService.cacheTokenResult(tokenMint, topN, mockResult);
      await this.cacheService.getTokenResult(tokenMint, topN);

      metrics = this.cacheService.getCacheMetrics();
      if (metrics.tier1.hits !== 1) {
        throw new Error(`Expected 1 hit, got ${metrics.tier1.hits}`);
      }

      // Verify hit rate calculation
      const expectedHitRate = (1 / 2) * 100; // 1 hit out of 2 total requests
      if (Math.abs(metrics.tier1.hitRate - expectedHitRate) > 0.01) {
        throw new Error(`Expected hit rate ${expectedHitRate}%, got ${metrics.tier1.hitRate}%`);
      }
    });
  }

  /**
   * Test 8: Wallet Mode Caching
   */
  private async testWalletModeCaching(walletAddress: string): Promise<void> {
    await this.runTest('Wallet Mode Caching', async () => {
      // Clear wallet cache
      await this.cacheService.invalidateForWallet(walletAddress);

      // Cache miss
      let cached = await this.cacheService.getWalletResult(walletAddress);
      if (cached !== null) {
        throw new Error('Expected null on first request');
      }

      // Cache a wallet result
      const mockProfile = createMockHolderProfile(walletAddress, 1, 100);
      const mockResult: HolderProfilesResult = {
        success: true,
        mode: 'wallet',
        targetWallet: walletAddress,
        profiles: [mockProfile],
        metadata: {
          totalHoldersRequested: 1,
          totalHoldersAnalyzed: 1,
          totalProcessingTimeMs: 100,
          avgProcessingTimePerWalletMs: 100,
        },
        timestamp: Date.now(),
        processingTimeMs: 100,
      };
      await this.cacheService.cacheWalletResult(walletAddress, mockResult);

      // Cache hit
      cached = await this.cacheService.getWalletResult(walletAddress);
      if (!cached) {
        throw new Error('Expected cached result');
      }

      if (cached.targetWallet !== walletAddress) {
        throw new Error(`Wallet address mismatch: expected ${walletAddress}, got ${cached.targetWallet}`);
      }

      // Invalidate and verify
      await this.cacheService.invalidateForWallet(walletAddress);
      cached = await this.cacheService.getWalletResult(walletAddress);
      if (cached !== null) {
        throw new Error('Expected null after invalidation');
      }
    });
  }

  /**
   * Run all tests
   */
  async runAll(tokenMint: string, topN: number, walletAddress: string): Promise<TestSummary> {
    this.testStartTime = Date.now();
    this.results = [];

    console.log(`\n${colors.blue}${colors.bold}${'='.repeat(80)}${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}TWO-TIER CACHE TEST SUITE${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}${'='.repeat(80)}${colors.reset}`);
    console.log(`${colors.cyan}Token:${colors.reset} ${tokenMint}`);
    console.log(`${colors.cyan}Top N:${colors.reset} ${topN}`);
    console.log(`${colors.cyan}Test Wallet:${colors.reset} ${walletAddress}`);
    console.log(`${colors.blue}${colors.bold}${'='.repeat(80)}${colors.reset}\n`);

    // Run all tests
    await this.testTier1CacheMiss(tokenMint, topN);
    await this.testTier1CacheWriteAndHit(tokenMint, topN);
    await this.testTier1Invalidation(tokenMint, topN);
    await this.testTier2SnapshotSaveAndRetrieve(tokenMint);
    await this.testSnapshotFreshness();
    await this.testSnapshotHydration();
    await this.testCacheMetrics(tokenMint, topN);
    await this.testWalletModeCaching(walletAddress);

    const duration = Date.now() - this.testStartTime;
    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;

    return {
      totalTests: this.results.length,
      passed,
      failed,
      duration,
      results: this.results,
    };
  }

  /**
   * Print final cache metrics
   */
  async printFinalMetrics(): Promise<void> {
    console.log(`\n${colors.blue}${colors.bold}${'='.repeat(80)}${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}FINAL CACHE METRICS${colors.reset}`);
    console.log(`${colors.blue}${colors.bold}${'='.repeat(80)}${colors.reset}`);

    const metrics = this.cacheService.getCacheMetrics();

    console.log(`\n${colors.cyan}Tier 1 (Redis):${colors.reset}`);
    console.log(`  Hits: ${metrics.tier1.hits}`);
    console.log(`  Misses: ${metrics.tier1.misses}`);
    console.log(`  Hit Rate: ${metrics.tier1.hitRate.toFixed(2)}%`);
    console.log(`  Total Requests: ${metrics.tier1.total}`);

    console.log(`\n${colors.cyan}Tier 2 (PostgreSQL):${colors.reset}`);
    console.log(`  Hits: ${metrics.tier2.hits}`);
    console.log(`  Misses: ${metrics.tier2.misses}`);
    console.log(`  Partial Hits: ${metrics.tier2.partial}`);
    console.log(`  Hit Rate: ${metrics.tier2.hitRate.toFixed(2)}%`);
    console.log(`  Total Requests: ${metrics.tier2.total}`);

    console.log(`\n${colors.cyan}Uptime:${colors.reset}`);
    console.log(`  Since: ${metrics.uptime.since.toISOString()}`);
    console.log(`  Hours: ${metrics.uptime.hours.toFixed(2)}h`);
  }
}

/**
 * Main function
 */
async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('token', {
      type: 'string',
      description: 'Token mint address to test with',
      default: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    })
    .option('topN', {
      type: 'number',
      description: 'Number of top holders to test',
      default: 5,
    })
    .option('wallet', {
      type: 'string',
      description: 'Wallet address for wallet-mode tests',
      default: 'TestWalletForCaching' + 'x'.repeat(20),
    })
    .option('skipCleanup', {
      type: 'boolean',
      description: 'Skip cache cleanup after tests',
      default: false,
    })
    .help()
    .alias('help', 'h')
    .parse();

  const tokenMint = argv.token;
  const topN = argv.topN;
  const walletAddress = argv.wallet;
  const skipCleanup = argv.skipCleanup;

  console.log(`\n${colors.cyan}Initializing services...${colors.reset}`);

  // Initialize services
  const databaseService = new DatabaseService();
  // Create Redis client for cache service
  const Redis = require('ioredis');
  const redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
  const cacheService = new HolderProfilesCacheService(databaseService, redisClient);

  console.log(`${colors.green}✓ Services initialized${colors.reset}`);

  // Run test suite
  const testSuite = new CacheTestSuite(cacheService, databaseService);

  try {
    const summary = await testSuite.runAll(tokenMint, topN, walletAddress);

    // Print summary
    printSummary(summary);

    // Print final metrics
    await testSuite.printFinalMetrics();

    // Cleanup (unless skipped)
    if (!skipCleanup) {
      console.log(`\n${colors.yellow}Cleaning up test data...${colors.reset}`);
      await cacheService.invalidateForToken(tokenMint);
      await cacheService.invalidateForWallet(walletAddress);
      console.log(`${colors.green}✓ Cleanup complete${colors.reset}\n`);
    } else {
      console.log(`\n${colors.yellow}⚠ Skipping cleanup (--skipCleanup flag set)${colors.reset}\n`);
    }

    // Exit with appropriate code
    process.exit(summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(`\n${colors.red}Fatal error during test execution:${colors.reset}`, error);
    process.exit(1);
  }
}

// Run the script
main();
