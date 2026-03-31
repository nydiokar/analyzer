/**
 * Drip-feed market-context enrichment jobs wallet-by-wallet.
 *
 * Queues one wallet, waits until its job is done (or failed), then queues the next.
 * Zero queue bloat, zero worker starvation of live traffic.
 *
 * Safe to run against the live server — no Nest bootstrap, no worker registration.
 * Wallets sorted heaviest first so the big ones finish while the server is fresh.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/queue-market-context-backfill.ts
 */

import { Queue, QueueEvents } from 'bullmq';
import * as crypto from 'crypto';
import { prisma } from '../src/core/services/database-service';
import * as dotenv from 'dotenv';
dotenv.config();

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const redisConnection = { host: REDIS_HOST, port: REDIS_PORT, password: REDIS_PASSWORD };

const JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 min max per wallet before we move on

function makeJobId(walletAddress: string): string {
  return `mcx-${crypto.createHash('md5').update(`mcx-${walletAddress}`).digest('hex').slice(0, 8)}`;
}

async function addAndWait(
  queue: Queue,
  queueEvents: QueueEvents,
  walletAddress: string,
  swapCount: number,
  index: number,
  total: number,
): Promise<'completed' | 'failed' | 'timeout'> {
  const jobId = makeJobId(walletAddress);

  process.stdout.write(`  [${index}/${total}] ${walletAddress.slice(0, 16)}... (${swapCount} swaps) `);

  // Set up listeners BEFORE adding the job — eliminates the race condition where
  // a fast worker completes the job before our listeners are registered.
  const resultPromise = new Promise<'completed' | 'failed' | 'timeout'>((resolve) => {
    const timer = setTimeout(() => {
      queueEvents.off('completed', onCompleted);
      queueEvents.off('failed', onFailed);
      resolve('timeout');
    }, JOB_TIMEOUT_MS);

    const onCompleted = ({ jobId: id }: { jobId: string }) => {
      if (id !== jobId) return;
      clearTimeout(timer);
      queueEvents.off('completed', onCompleted);
      queueEvents.off('failed', onFailed);
      resolve('completed');
    };

    const onFailed = ({ jobId: id }: { jobId: string }) => {
      if (id !== jobId) return;
      clearTimeout(timer);
      queueEvents.off('completed', onCompleted);
      queueEvents.off('failed', onFailed);
      resolve('failed');
    };

    queueEvents.on('completed', onCompleted);
    queueEvents.on('failed', onFailed);
  });

  await queue.add(
    'process-market-context',
    { walletAddress, requestId: jobId },
    {
      jobId,
      priority: 9,
      // Keep completed jobs long enough for this script's session — removed on next run
      removeOnComplete: { count: 10, age: 3600 },
      removeOnFail: 10,
    },
  );

  const result = await resultPromise;
  console.log(result);
  return result;
}

async function main() {
  const queue = new Queue('enrichment-operations', { connection: redisConnection });
  const queueEvents = new QueueEvents('enrichment-operations', { connection: redisConnection });
  await queueEvents.waitUntilReady();

  // Source of truth for what still needs enriching — the DB, not Redis job state.
  // Re-running this script always picks up exactly the remaining work, nothing more.
  const wallets = await prisma.swapAnalysisInput.groupBy({
    by: ['walletAddress'],
    where: { enrichedAt: null },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });

  if (wallets.length === 0) {
    console.log('Nothing to backfill — all swaps are enriched.');
    await queueEvents.close();
    await queue.close();
    await prisma.$disconnect();
    return;
  }

  console.log(`${wallets.length} wallets to backfill, one at a time.\n`);

  let done = 0;
  let failed = 0;

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const jobId = makeJobId(w.walletAddress);

    // If already active/waiting (e.g. triggered by a live sync), wait for it
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed') {
        process.stdout.write(`  [${i + 1}/${wallets.length}] ${w.walletAddress.slice(0, 16)}... already running, waiting... `);
        // Still attach listeners before awaiting — job might finish while we're checking
        const result = await new Promise<'completed' | 'failed' | 'timeout'>((resolve) => {
          const timer = setTimeout(() => resolve('timeout'), JOB_TIMEOUT_MS);
          const onCompleted = ({ jobId: id }: { jobId: string }) => {
            if (id !== jobId) return;
            clearTimeout(timer);
            queueEvents.off('completed', onCompleted);
            queueEvents.off('failed', onFailed);
            resolve('completed');
          };
          const onFailed = ({ jobId: id }: { jobId: string }) => {
            if (id !== jobId) return;
            clearTimeout(timer);
            queueEvents.off('completed', onCompleted);
            queueEvents.off('failed', onFailed);
            resolve('failed');
          };
          queueEvents.on('completed', onCompleted);
          queueEvents.on('failed', onFailed);
        });
        console.log(result);
        result === 'completed' ? done++ : failed++;
        continue;
      }
    }

    const result = await addAndWait(queue, queueEvents, w.walletAddress, w._count.id, i + 1, wallets.length);
    result === 'completed' ? done++ : failed++;
  }

  console.log(`\nBackfill complete. Done: ${done} | Failed/timeout: ${failed}`);
  await queueEvents.close();
  await queue.close();
  await prisma.$disconnect();
}

main().catch(console.error);
