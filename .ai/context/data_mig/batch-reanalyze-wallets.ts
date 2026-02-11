/**
 * Stateful Batch Re-analysis Script - DIRECT QUEUE ACCESS
 *
 * Re-analyzes all wallets using existing SwapAnalysisInput data.
 * Directly adds jobs to BullMQ (no HTTP calls, no auth, no throttling)
 * Resumable - saves progress to .ai/reanalysis-progress.json
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/batch-reanalyze-wallets.ts --test          # Test with first 3 wallets
 *   npx ts-node -r tsconfig-paths/register scripts/batch-reanalyze-wallets.ts                 # Full run
 *   npx ts-node -r tsconfig-paths/register scripts/batch-reanalyze-wallets.ts --reset         # Reset progress
 *   npx ts-node -r tsconfig-paths/register scripts/batch-reanalyze-wallets.ts --concurrency=20
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { QueueNames, JobPriority } from '../../../src/queues/config/queue.config';
import { generateJobId } from '../../../src/queues/utils/job-id-generator';

const prisma = new PrismaClient();

interface ReanalysisProgress {
  startedAt: string;
  lastUpdatedAt: string;
  totalWallets: number;
  processedWallets: string[];
  failedWallets: { address: string; error: string }[];
  skippedWallets: string[];
  currentIndex: number;
  estimatedCompletionTime?: string;
}

const PROGRESS_FILE = path.join(process.cwd(), '.ai', 'reanalysis-progress.json');
const CONCURRENCY = parseInt(process.argv.find(arg => arg.startsWith('--concurrency='))?.split('=')[1] || '10');
const RESET = process.argv.includes('--reset');
const TEST_MODE = process.argv.includes('--test'); // Only process first 3 wallets
const REQUEST_ID = 'batch-reanalysis-script';
const BATCH_USER_ID = 'system-batch-script'; // Silences WebSocket warnings

let progress: ReanalysisProgress;
let analysisQueue: Queue;
let redisConnection: Redis;

/**
 * Load or initialize progress
 */
function loadProgress(): ReanalysisProgress {
  if (RESET || !fs.existsSync(PROGRESS_FILE)) {
    return {
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      totalWallets: 0,
      processedWallets: [],
      failedWallets: [],
      skippedWallets: [],
      currentIndex: 0,
    };
  }

  return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
}

/**
 * Save progress
 */
function saveProgress() {
  progress.lastUpdatedAt = new Date().toISOString();

  // Calculate ETA
  if (progress.processedWallets.length > 0) {
    const elapsed = Date.now() - new Date(progress.startedAt).getTime();
    const avgTimePerWallet = elapsed / progress.processedWallets.length;
    const remaining = progress.totalWallets - progress.processedWallets.length;
    const etaMs = remaining * avgTimePerWallet;
    progress.estimatedCompletionTime = new Date(Date.now() + etaMs).toISOString();
  }

  const dir = path.dirname(PROGRESS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

/**
 * Get all wallets that need re-analysis
 */
async function getWalletsToProcess(): Promise<string[]> {
  console.log('Fetching wallets from database...');

  // Get wallets with SwapAnalysisInput (have transaction data)
  const wallets = await prisma.$queryRaw<{ walletAddress: string; tx_count: number }[]>`
    SELECT
      "walletAddress",
      COUNT(*) as tx_count
    FROM "SwapAnalysisInput"
    GROUP BY "walletAddress"
    ORDER BY tx_count DESC
  `;

  console.log(`Found ${wallets.length} wallets with transaction data`);

  // Filter out already processed
  const toProcess = wallets
    .map(w => w.walletAddress)
    .filter(addr => !progress.processedWallets.includes(addr));

  console.log(`${toProcess.length} wallets remaining to process`);

  // Test mode: only first 3 wallets
  if (TEST_MODE) {
    console.log('\n🧪 TEST MODE: Processing only first 3 wallets');
    return toProcess.slice(0, 3);
  }

  return toProcess;
}

/**
 * Queue analysis jobs directly to BullMQ
 * FIXED: Use correct job names and job ID generation
 */
async function queueWalletAnalysis(walletAddress: string): Promise<{ success: boolean; jobIds?: { pnl: string; behavior: string }; error?: string }> {
  try {
    // Generate proper job IDs using the system's deterministic hash function
    const pnlJobId = generateJobId.analyzePnl(walletAddress, REQUEST_ID);
    const behaviorJobId = generateJobId.analyzeBehavior(walletAddress, REQUEST_ID);

    // Queue PnL analysis job with CORRECT job name
    await analysisQueue.add(
      'analyze-pnl', // ✅ CORRECT (was: 'pnl-wallet-analysis')
      {
        walletAddress,
        forceRefresh: false, // Use existing SwapAnalysisInput
        requestId: REQUEST_ID,
        userId: BATCH_USER_ID, // Suppress WebSocket warnings
      },
      {
        priority: JobPriority.NORMAL,
        jobId: pnlJobId, // ✅ CORRECT deterministic ID
      }
    );

    // Queue behavior analysis job with CORRECT job name
    await analysisQueue.add(
      'analyze-behavior', // ✅ CORRECT (was: 'behavior-wallet-analysis')
      {
        walletAddress,
        forceRefresh: false,
        requestId: REQUEST_ID,
        userId: BATCH_USER_ID, // Suppress WebSocket warnings
      },
      {
        priority: JobPriority.NORMAL,
        jobId: behaviorJobId, // ✅ CORRECT deterministic ID
      }
    );

    // Store userId mapping in Redis to silence WebSocket warnings
    // (Mimics what AnalysisOperationsQueue does)
    await redisConnection.set(`job:user:${pnlJobId}`, BATCH_USER_ID, 'EX', 24 * 60 * 60);
    await redisConnection.set(`job:user:${behaviorJobId}`, BATCH_USER_ID, 'EX', 24 * 60 * 60);

    return {
      success: true,
      jobIds: { pnl: pnlJobId, behavior: behaviorJobId }
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Process wallets in batches
 */
async function processBatch(wallets: string[]) {
  const startTime = Date.now();
  let processed = 0;
  let failed = 0;

  console.log(`\nProcessing ${wallets.length} wallets with concurrency ${CONCURRENCY}...`);
  console.log(`Progress will be saved to: ${PROGRESS_FILE}`);
  console.log('You can stop anytime with Ctrl+C and resume later.\n');

  // Process in chunks
  for (let i = 0; i < wallets.length; i += CONCURRENCY) {
    const chunk = wallets.slice(i, i + CONCURRENCY);
    const chunkIndex = Math.floor(i / CONCURRENCY) + 1;
    const totalChunks = Math.ceil(wallets.length / CONCURRENCY);

    console.log(`[Chunk ${chunkIndex}/${totalChunks}] Processing ${chunk.length} wallets...`);

    // Process chunk in parallel
    const results = await Promise.allSettled(
      chunk.map(async (address) => {
        const result = await queueWalletAnalysis(address);

        if (result.success) {
          progress.processedWallets.push(address);
          processed++;

          // Enhanced logging in test mode
          if (TEST_MODE && result.jobIds) {
            console.log(`  ✓ ${address.slice(0, 8)}...`);
            console.log(`    PnL job:      ${result.jobIds.pnl}`);
            console.log(`    Behavior job: ${result.jobIds.behavior}`);
          }
        } else {
          progress.failedWallets.push({ address, error: result.error || 'Unknown error' });
          failed++;

          if (TEST_MODE) {
            console.log(`  ✗ ${address.slice(0, 8)}... ERROR: ${result.error}`);
          }
        }

        progress.currentIndex++;
        return result;
      })
    );

    // Save progress after each chunk
    saveProgress();

    // Print chunk summary
    const chunkSuccess = results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
    const chunkFailed = chunk.length - chunkSuccess;

    console.log(`  ✓ Success: ${chunkSuccess}, ✗ Failed: ${chunkFailed}`);

    // Print ETA
    const elapsed = Date.now() - startTime;
    const avgTimePerWallet = elapsed / (i + chunk.length);
    const remaining = wallets.length - (i + chunk.length);
    const etaMinutes = Math.ceil((remaining * avgTimePerWallet) / 60000);

    console.log(`  Progress: ${i + chunk.length}/${wallets.length} (${Math.round((i + chunk.length) / wallets.length * 100)}%)`);
    console.log(`  ETA: ~${etaMinutes} minutes\n`);

    // Small delay between chunks
    if (i + CONCURRENCY < wallets.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return { processed, failed };
}

/**
 * Print final summary
 */
function printSummary(stats: { processed: number; failed: number }) {
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('              Batch Re-analysis Complete');
  console.log('════════════════════════════════════════════════════════════════\n');

  console.log(`Total Wallets: ${progress.totalWallets}`);
  console.log(`✓ Successfully Queued: ${stats.processed}`);
  console.log(`✗ Failed: ${stats.failed}`);
  console.log(`⊘ Skipped (already processed): ${progress.processedWallets.length - stats.processed}`);

  if (progress.failedWallets.length > 0) {
    console.log('\nFailed Wallets:');
    progress.failedWallets.slice(0, 10).forEach(({ address, error }) => {
      console.log(`  - ${address}: ${error}`);
    });
    if (progress.failedWallets.length > 10) {
      console.log(`  ... and ${progress.failedWallets.length - 10} more`);
    }
  }

  const elapsed = Date.now() - new Date(progress.startedAt).getTime();
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  console.log(`\nTotal Time: ${minutes}m ${seconds}s`);
  console.log(`\nProgress saved to: ${PROGRESS_FILE}`);
  console.log('\n════════════════════════════════════════════════════════════════\n');
  console.log('Jobs are now queued in BullMQ. Check queue processing with:');
  console.log('  - Dashboard: http://localhost:3000/trackers (if you have a UI)');
  console.log('  - Or monitor the backend logs for job completions');
  console.log('\n════════════════════════════════════════════════════════════════\n');
}

/**
 * Main execution
 */
async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('         Stateful Batch Wallet Re-analysis');
  console.log('         (Direct BullMQ Queue Access)');
  console.log('════════════════════════════════════════════════════════════════\n');

  // Initialize Redis connection and queue
  console.log('Connecting to Redis and BullMQ...');
  redisConnection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  });
  analysisQueue = new Queue(QueueNames.ANALYSIS_OPERATIONS, {
    connection: redisConnection,
  });

  console.log('✓ Connected to BullMQ\n');

  // Load progress
  progress = loadProgress();

  if (RESET) {
    console.log('🔄 Starting fresh (--reset flag detected)\n');
  } else if (progress.processedWallets.length > 0) {
    console.log('📂 Resuming from saved progress');
    console.log(`   Previously processed: ${progress.processedWallets.length} wallets`);
    console.log(`   Previously failed: ${progress.failedWallets.length} wallets\n`);
  }

  // Get wallets to process
  const walletsToProcess = await getWalletsToProcess();

  if (walletsToProcess.length === 0) {
    console.log('✓ All wallets have been processed!');
    console.log('   Run with --reset to start over.\n');
    await analysisQueue.close();
    await redisConnection.quit();
    return;
  }

  progress.totalWallets = walletsToProcess.length + progress.processedWallets.length;

  // Process wallets
  const stats = await processBatch(walletsToProcess);

  // Print summary
  printSummary(stats);

  // Cleanup
  await analysisQueue.close();
  await redisConnection.quit();
  await prisma.$disconnect();
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n⚠ Interrupted! Saving progress...');
  saveProgress();
  console.log('✓ Progress saved. Run the script again to resume.\n');

  if (analysisQueue) {
    await analysisQueue.close();
  }

  process.exit(0);
});

main().catch(async (error) => {
  console.error('Fatal error:', error);
  saveProgress();

  if (analysisQueue) {
    await analysisQueue.close();
  }

  process.exit(1);
});
