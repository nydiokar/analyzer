/**
 * Step 1 — DA validation: trigger dashboard-wallet-analysis for a wallet,
 * then poll until WalletDailyPnl rows appear (dispatchDailyAggregation fires
 * automatically after the analysis job completes).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/validate-daily-agg-trigger.ts [WALLET_ADDRESS]
 */

import { Queue, QueueEvents } from 'bullmq';
import * as crypto from 'crypto';
import { prisma } from '../src/core/services/database-service';
import * as dotenv from 'dotenv';
dotenv.config();

function makeDashboardJobId(walletAddress: string, requestId: string): string {
  const hash = crypto.createHash('md5').update(`dashboard-${walletAddress}-${requestId}`).digest('hex').slice(0, 8);
  return `dashboard-${hash}`;
}

const WALLET = process.argv[2] || 'Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const redisConnection = { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD };

const QUEUE_NAME = 'analysis-operations';
const JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

async function main() {
  console.log('\n=== DA Validation — Step 1: Trigger Analysis ===\n');
  console.log(`Wallet: ${WALLET}\n`);

  // Check existing swap history first
  const swapCount = await prisma.swapAnalysisInput.count({ where: { walletAddress: WALLET } });
  console.log(`Existing SwapAnalysisInput rows: ${swapCount}`);
  if (swapCount === 0) {
    console.log('WARNING: No swap rows found yet — analysis will sync from Helius first (may take longer).');
  }

  // Check if already has daily rows
  const existingRows = await prisma.walletDailyPnl.count({ where: { walletAddress: WALLET } });
  console.log(`Existing WalletDailyPnl rows: ${existingRows}\n`);

  const queue = new Queue(QUEUE_NAME, { connection: redisConnection });
  const queueEvents = new QueueEvents(QUEUE_NAME, { connection: redisConnection });

  const requestId = `val-${crypto.randomBytes(4).toString('hex')}`;
  console.log(`Dispatching dashboard-wallet-analysis (requestId: ${requestId})...`);

  const jobId = makeDashboardJobId(WALLET, requestId);
  const job = await queue.add(
    'dashboard-wallet-analysis',
    { walletAddress: WALLET, requestId, analysisScope: 'flash', triggerSource: 'system' },
    { jobId, removeOnComplete: { age: 300 }, removeOnFail: { age: 300 } },
  );

  console.log(`Job queued: ${job.id}. Waiting for completion (timeout: ${JOB_TIMEOUT_MS / 1000}s)...\n`);

  try {
    await queueEvents.waitUntilReady();
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        queueEvents.on('completed', ({ jobId }) => {
          if (jobId === job.id) resolve();
        });
        queueEvents.on('failed', ({ jobId, failedReason }) => {
          if (jobId === job.id) reject(new Error(`Job failed: ${failedReason}`));
        });
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Job timed out')), JOB_TIMEOUT_MS),
      ),
    ]);
    console.log('Analysis job COMPLETED.\n');
  } catch (err: any) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  } finally {
    await queueEvents.close();
    await queue.close();
  }

  // Poll for daily rows — dispatchDailyAggregation is non-blocking so give it a moment
  console.log('Polling for WalletDailyPnl rows (up to 30s)...');
  let dailyRows = 0;
  for (let i = 0; i < 30; i++) {
    dailyRows = await prisma.walletDailyPnl.count({ where: { walletAddress: WALLET } });
    if (dailyRows > 0) break;
    await new Promise(r => setTimeout(r, 1000));
    process.stdout.write('.');
  }
  console.log('\n');

  if (dailyRows === 0) {
    console.error('FAIL: No WalletDailyPnl rows written after 30s. Check server logs for [DailyAgg] entries.');
    process.exit(1);
  }

  console.log(`OK: ${dailyRows} WalletDailyPnl row(s) written.\n`);
  console.log('Run next: npx ts-node -r tsconfig-paths/register scripts/validate-daily-agg-check.ts\n');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
