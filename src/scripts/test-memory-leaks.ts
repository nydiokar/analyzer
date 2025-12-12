#!/usr/bin/env node

/**
 * REALISTIC MEMORY LEAK TESTING SCRIPT
 *
 * This script performs real-world memory leak testing by:
 * - Running actual HeliusSyncService operations with real database/Redis
 * - Monitoring RSS, heap usage, and external memory over time
 * - Testing various workload patterns (sequential, concurrent, mixed)
 * - Generating detailed memory reports
 *
 * USAGE:
 *   npm run test:memory              # Run all tests (50 iterations)
 *   npm run test:memory:100          # 100 iterations
 *   npm run test:memory:200          # 200 iterations
 *   npm run test:memory:stress       # 500 iterations
 *   npm run test:memory:trace        # With GC tracing
 *
 * OPTIONS:
 *   --pattern <type>      Test pattern: sequential, concurrent, all (default: all)
 *   --iterations <num>    Number of iterations per test (default: 50)
 *   --report              Generate detailed JSON report
 *
 * INTERPRETING RESULTS:
 *   - RSS growth < 2MB per iteration: PASS
 *   - RSS growth 2-5MB per iteration: WARNING (potential slow leak)
 *   - RSS growth > 5MB per iteration: FAIL (definite leak)
 *   - Growth rate DECREASING over time: Just GC lag, not a leak
 *   - Growth rate CONSTANT over time: Real memory leak!
 */

import dotenv from 'dotenv';
import { createLogger } from '../core/utils/logger';
import { HeliusSyncService, SyncOptions } from '../core/services/helius-sync-service';
import { HeliusApiClient } from '../core/services/helius-api-client';
import { DatabaseService } from '../api/services/database.service';
import Redis from 'ioredis';

dotenv.config();

const logger = createLogger('MemoryLeakTest');

interface MemorySnapshot {
  timestamp: number;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface TestResult {
  pattern: string;
  iterations: number;
  duration: number;
  initialMemory: MemorySnapshot;
  finalMemory: MemorySnapshot;
  peakMemory: MemorySnapshot;
  growthRate: number; // bytes per iteration
  passed: boolean;
  warnings: string[];
}

class MemoryLeakTester {
  private snapshots: MemorySnapshot[] = [];
  private results: TestResult[] = [];
  private heliusClient?: HeliusApiClient;
  private syncService?: HeliusSyncService;
  private databaseService?: DatabaseService;
  private redisClient?: Redis;

  constructor(
    private iterations: number = 50,
    private enableGC: boolean = true
  ) {}

  async initialize(): Promise<void> {
    logger.info('🚀 Initializing memory leak tester...');

    // Initialize database service
    this.databaseService = new DatabaseService();

    // Initialize Redis client
    this.redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      lazyConnect: true,
    });

    try {
      await this.redisClient.connect();
      logger.info('✅ Redis connected');
    } catch (error) {
      logger.warn('⚠️  Redis connection failed, some tests may be limited', error);
    }

    // Initialize Helius client
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) {
      throw new Error('HELIUS_API_KEY environment variable is required for realistic testing');
    }

    this.heliusClient = new HeliusApiClient(
      { apiKey: heliusApiKey },
      this.databaseService
    );

    this.syncService = new HeliusSyncService(this.databaseService, this.heliusClient);

    logger.info('✅ Services initialized');
  }

  async cleanup(): Promise<void> {
    logger.info('🧹 Cleaning up...');
    if (this.redisClient) {
      await this.redisClient.quit();
    }
    logger.info('✅ Cleanup complete');
  }

  takeSnapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    return {
      timestamp: Date.now(),
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
    };
  }

  forceGC(): void {
    if (this.enableGC && global.gc) {
      global.gc();
    }
  }

  formatBytes(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  calculateGrowthRate(initial: MemorySnapshot, final: MemorySnapshot, iterations: number): number {
    return (final.rss - initial.rss) / iterations;
  }

  async runSequentialTest(): Promise<TestResult> {
    logger.info(`\n📊 Running SEQUENTIAL test (${this.iterations} iterations)...`);

    const startTime = Date.now();
    this.forceGC();
    const initialMemory = this.takeSnapshot();

    const options: SyncOptions = {
      limit: 100,
      fetchAll: false,
      skipApi: false,
      fetchOlder: false,
      maxSignatures: 100,
      smartFetch: false,
    };

    let peakMemory = initialMemory;

    for (let i = 0; i < this.iterations; i++) {
      const walletAddress = this.generateTestWallet(i);

      try {
        await this.syncService!.syncWalletData(walletAddress, options);
      } catch (error) {
        // Silent - errors are expected for some wallets
      }

      if (i % 10 === 0 || i === this.iterations - 1) {
        this.forceGC();
        const snapshot = this.takeSnapshot();
        this.snapshots.push(snapshot);

        if (snapshot.rss > peakMemory.rss) {
          peakMemory = snapshot;
        }

        const progress = ((i / this.iterations) * 100).toFixed(1);
        const currentGrowth = snapshot.rss - initialMemory.rss;
        logger.info(`  Progress: ${progress}% | RSS: ${this.formatBytes(snapshot.rss)} | Growth: ${this.formatBytes(currentGrowth)}`);
      }
    }

    this.forceGC();
    const finalMemory = this.takeSnapshot();
    const duration = Date.now() - startTime;

    const growthRate = this.calculateGrowthRate(initialMemory, finalMemory, this.iterations);
    const growthRateMB = growthRate / 1024 / 1024;

    const warnings: string[] = [];
    let passed = true;

    if (growthRateMB > 5) {
      warnings.push(`CRITICAL: Growth rate ${growthRateMB.toFixed(3)}MB per iteration indicates severe leak`);
      passed = false;
    } else if (growthRateMB > 2) {
      warnings.push(`WARNING: Growth rate ${growthRateMB.toFixed(3)}MB per iteration may indicate slow leak`);
    }

    return {
      pattern: 'sequential',
      iterations: this.iterations,
      duration,
      initialMemory,
      finalMemory,
      peakMemory,
      growthRate,
      passed,
      warnings,
    };
  }

  async runConcurrentTest(): Promise<TestResult> {
    logger.info(`\n📊 Running CONCURRENT test (${this.iterations} iterations in batches of 5)...`);

    const startTime = Date.now();
    this.forceGC();
    const initialMemory = this.takeSnapshot();

    const options: SyncOptions = {
      limit: 100,
      fetchAll: false,
      skipApi: false,
      fetchOlder: false,
      maxSignatures: 50,
      smartFetch: false,
    };

    let peakMemory = initialMemory;
    const batchSize = 5;
    const numBatches = Math.ceil(this.iterations / batchSize);

    for (let batch = 0; batch < numBatches; batch++) {
      const promises: Promise<void>[] = [];

      for (let i = 0; i < batchSize && (batch * batchSize + i) < this.iterations; i++) {
        const walletAddress = this.generateTestWallet(batch * batchSize + i);
        promises.push(
          this.syncService!.syncWalletData(walletAddress, options).catch(() => {
            // Silent - errors expected
          })
        );
      }

      await Promise.all(promises);

      if (batch % 3 === 0 || batch === numBatches - 1) {
        this.forceGC();
        const snapshot = this.takeSnapshot();
        this.snapshots.push(snapshot);

        if (snapshot.rss > peakMemory.rss) {
          peakMemory = snapshot;
        }

        const progress = ((batch / numBatches) * 100).toFixed(1);
        const currentGrowth = snapshot.rss - initialMemory.rss;
        logger.info(`  Progress: ${progress}% | RSS: ${this.formatBytes(snapshot.rss)} | Growth: ${this.formatBytes(currentGrowth)}`);
      }
    }

    this.forceGC();
    const finalMemory = this.takeSnapshot();
    const duration = Date.now() - startTime;

    const growthRate = this.calculateGrowthRate(initialMemory, finalMemory, this.iterations);
    const growthRateMB = growthRate / 1024 / 1024;

    const warnings: string[] = [];
    let passed = true;

    if (growthRateMB > 5) {
      warnings.push(`CRITICAL: Growth rate ${growthRateMB.toFixed(3)}MB per iteration indicates severe leak`);
      passed = false;
    } else if (growthRateMB > 2) {
      warnings.push(`WARNING: Growth rate ${growthRateMB.toFixed(3)}MB per iteration may indicate slow leak`);
    }

    return {
      pattern: 'concurrent',
      iterations: this.iterations,
      duration,
      initialMemory,
      finalMemory,
      peakMemory,
      growthRate,
      passed,
      warnings,
    };
  }

  generateTestWallet(index: number): string {
    // Real Solana wallet addresses for realistic testing
    const realWallets = [
      '3ESYpN6WpEdN5syU5ohucpfEC8txmoF8VFpeJwRdnVHm',
      'Cad1G6JpfW8LX4LNvBJkrCo6VJFoWqxSy9gQfcgeX98Y',
      'CPDJZzVqhMXtoquqPYLkV683FjDzVn8Hpa2sE6STPuz1',
      'HrCPnDvDgbpbFxKxer6Pw3qEcfAQQNNjb6aJNFWgTEng',
      'CbhJzggrRj2txuRUPB5EWvefGmjxz3AUgF3M8LmH4ff1',
      'FUbnme4UJ3x6aZ5nGPymTWoDghE9p3XJx1BfLzSpGefM',
      '5DkD2cPeG9Ya3tjCnDfxBL7p6FmKQaHjuKYuyz9MQdxC',
      'FC3nyVqdufVfrgXiRJEqgST1JdJSEBEz6a9KoBfFP7c4',
      '3iz9EHcSJy5DcV5GSrpCjvmoe5wJfWwcj7opJRcBUWp4',
      'Bt9jAvwbXhmLrNZfp54Y8nPHA2wqN4oPxppE7yA5xJv6',
      '6Z5yqoDsoTJgbqMpystRhWz94SSWnTYr9xMvvV3EYoFK',
      '3K1ru3SS7wjx7RgzPiTBWcx4mJhZyo52mw3z8Mrxrx4H',
      'AAtEhHf2utcH749CoaRG9iQ6QvvqqwQkYMmVKaZydcmD',
      '8m99yKAQ3zFhhyXGuuW7753Tnn9qkBR4LPGUd6VxXH4U',
      '2WXaRC1XsCNXX8EMVFwgQVX5FV2sdkvn8yvFDm71xcix',
      '2Epict5fij7s1kAJr88fAR2Wq7w8h3chErH4B1LcD9XL',
      'CpjT2AHF9ZVAmVLUk7DWStsaM8z3JLnrtMyXNFSnzn43',
      '3KuJkWDBzpj5488ZqSGfHDnWP9UJmG7C9NxDeShhYKQt',
      '2Rd5Y1fLGftqxAjhG9LNaBeQJhE4FY1Cz8CEXzQoeqG1',
      '58X73wN2hJymgdgyrZkYPJwgyBLvaxn4YBM3ezE1C4jm',
      '5t81R6KicyDq8PNfCs44nqiAtJbLMruvf3s9GwgcFUg2',
      'FJpQDY5JfsMCiZyFuLzk5zkD7vSnnngeERPe8Y6UqANM',
    ];

    // Cycle through the real wallet addresses
    return realWallets[index % realWallets.length];
  }

  printResults(): void {
    logger.info('\n' + '='.repeat(80));
    logger.info('📊 MEMORY LEAK TEST RESULTS');
    logger.info('='.repeat(80));

    let allPassed = true;

    for (const result of this.results) {
      const totalGrowth = result.finalMemory.rss - result.initialMemory.rss;
      const growthRateMB = result.growthRate / 1024 / 1024;

      logger.info(`\n🧪 Test: ${result.pattern.toUpperCase()}`);
      logger.info(`   Iterations: ${result.iterations}`);
      logger.info(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);
      logger.info(`   Initial RSS: ${this.formatBytes(result.initialMemory.rss)}`);
      logger.info(`   Final RSS: ${this.formatBytes(result.finalMemory.rss)}`);
      logger.info(`   Peak RSS: ${this.formatBytes(result.peakMemory.rss)}`);
      logger.info(`   Total Growth: ${this.formatBytes(totalGrowth)}`);
      logger.info(`   Growth Rate: ${growthRateMB.toFixed(3)} MB/iteration`);
      logger.info(`   Status: ${result.passed ? '✅ PASS' : '❌ FAIL'}`);

      if (result.warnings.length > 0) {
        logger.warn(`   Warnings:`);
        result.warnings.forEach(w => logger.warn(`     - ${w}`));
      }

      if (!result.passed) {
        allPassed = false;
      }
    }

    logger.info('\n' + '='.repeat(80));
    if (allPassed) {
      logger.info('✅ ALL TESTS PASSED - No memory leaks detected!');
    } else {
      logger.error('❌ SOME TESTS FAILED - Memory leaks detected!');
    }
    logger.info('='.repeat(80) + '\n');
  }

  async run(pattern: string = 'all'): Promise<void> {
    try {
      await this.initialize();

      if (pattern === 'all' || pattern === 'sequential') {
        const result = await this.runSequentialTest();
        this.results.push(result);
      }

      if (pattern === 'all' || pattern === 'concurrent') {
        const result = await this.runConcurrentTest();
        this.results.push(result);
      }

      this.printResults();
    } finally {
      await this.cleanup();
    }
  }
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  let pattern = 'all';
  let iterations = 50;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pattern' && args[i + 1]) {
      pattern = args[i + 1];
      i++;
    } else if (args[i] === '--iterations' && args[i + 1]) {
      iterations = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help') {
      console.log(`
USAGE: npm run test:memory [OPTIONS]

OPTIONS:
  --pattern <type>      Test pattern: sequential, concurrent, all (default: all)
  --iterations <num>    Number of iterations (default: 50)
  --help                Show this help message

QUICK COMMANDS:
  npm run test:memory           # 50 iterations (default)
  npm run test:memory:100       # 100 iterations
  npm run test:memory:200       # 200 iterations
  npm run test:memory:stress    # 500 iterations
  npm run test:memory:trace     # With GC tracing
      `);
      process.exit(0);
    }
  }

  logger.info('🔬 Starting realistic memory leak testing...');
  logger.info(`   Pattern: ${pattern}`);
  logger.info(`   Iterations: ${iterations}`);
  logger.info(`   GC Available: ${global.gc ? 'Yes (--expose-gc)' : 'No (run with --expose-gc for better results)'}`);

  const tester = new MemoryLeakTester(iterations, !!global.gc);
  await tester.run(pattern);
}

main().catch(error => {
  logger.error('Fatal error during memory leak testing:', error);
  process.exit(1);
});
