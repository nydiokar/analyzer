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

const DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 min default keeps "one at a time" behavior for heavy wallets
const MAX_JOB_TIMEOUT_MS = 90 * 60 * 1000;

function makeJobId(walletAddress: string): string {
  return `mcx-${crypto.createHash('md5').update(`mcx-${walletAddress}`).digest('hex').slice(0, 8)}`;
}

function parseSkippedWallets(argv: string[]): Set<string> {
  const skippedWallets = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-wallet') {
      const wallet = argv[i + 1];
      if (!wallet) {
        throw new Error('Missing wallet address after --skip-wallet');
      }
      skippedWallets.add(wallet);
      i++;
      continue;
    }

    if (arg.startsWith('--skip-wallet=')) {
      const wallet = arg.slice('--skip-wallet='.length);
      if (!wallet) {
        throw new Error('Missing wallet address after --skip-wallet=');
      }
      skippedWallets.add(wallet);
    }
  }

  return skippedWallets;
}

function parseTimeoutOverrideMs(argv: string[]): number | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--timeout-minutes') {
      const raw = argv[i + 1];
      if (!raw) {
        throw new Error('Missing number after --timeout-minutes');
      }
      const minutes = Number(raw);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error(`Invalid --timeout-minutes value: ${raw}`);
      }
      return Math.min(MAX_JOB_TIMEOUT_MS, Math.round(minutes * 60 * 1000));
    }

    if (arg.startsWith('--timeout-minutes=')) {
      const raw = arg.slice('--timeout-minutes='.length);
      const minutes = Number(raw);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error(`Invalid --timeout-minutes value: ${raw}`);
      }
      return Math.min(MAX_JOB_TIMEOUT_MS, Math.round(minutes * 60 * 1000));
    }
  }

  return null;
}

function getJobTimeoutMs(swapCount: number, timeoutOverrideMs: number | null): number {
  if (timeoutOverrideMs != null) {
    return timeoutOverrideMs;
  }

  // Heavier wallets need longer than the old fixed 5m wait.
  // Scale gently by swap count while keeping an upper bound.
  const scaledMinutes = Math.max(30, Math.ceil(swapCount / 5000) * 10);
  return Math.min(MAX_JOB_TIMEOUT_MS, scaledMinutes * 60 * 1000);
}

async function addAndWait(
  queue: Queue,
  queueEvents: QueueEvents,
  walletAddress: string,
  swapCount: number,
  index: number,
  total: number,
  timeoutMs: number,
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
    }, timeoutMs);

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
  const skippedWallets = parseSkippedWallets(process.argv.slice(2));
  const timeoutOverrideMs = parseTimeoutOverrideMs(process.argv.slice(2));
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

  if (skippedWallets.size > 0) {
    console.log(`Skipping ${skippedWallets.size} wallet(s): ${[...skippedWallets].join(', ')}`);
  }

  console.log(`${wallets.length} wallets to backfill, one at a time.\n`);

  let done = 0;
  let failed = 0;

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    const jobId = makeJobId(w.walletAddress);

    if (skippedWallets.has(w.walletAddress)) {
      console.log(`  [${i + 1}/${wallets.length}] ${w.walletAddress} skipped via --skip-wallet`);
      continue;
    }

    // If already active/waiting (e.g. triggered by a live sync), wait for it
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed') {
        const timeoutMs = getJobTimeoutMs(w._count.id, timeoutOverrideMs);
        process.stdout.write(
          `  [${i + 1}/${wallets.length}] ${w.walletAddress} already running as ${jobId} (${state}), waiting up to ${Math.round(timeoutMs / 60000)}m... `,
        );
        // Still attach listeners before awaiting — job might finish while we're checking
        const result = await new Promise<'completed' | 'failed' | 'timeout'>((resolve) => {
          const timer = setTimeout(() => {
            queueEvents.off('completed', onCompleted);
            queueEvents.off('failed', onFailed);
            resolve('timeout');
          }, timeoutMs);
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

    const timeoutMs = getJobTimeoutMs(w._count.id, timeoutOverrideMs);
    const result = await addAndWait(queue, queueEvents, w.walletAddress, w._count.id, i + 1, wallets.length, timeoutMs);
    result === 'completed' ? done++ : failed++;
  }

  console.log(`\nBackfill complete. Done: ${done} | Failed/timeout: ${failed}`);
  await queueEvents.close();
  await queue.close();
  await prisma.$disconnect();
}

main().catch(console.error);
