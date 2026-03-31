#!/usr/bin/env ts-node

import { PrismaClient, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { DASHBOARD_ANALYSIS_SCOPE_DEFAULTS } from '../config/constants';
import { QueueConfigs, QueueNames, JobPriority } from '../queues/config/queue.config';
import type { DashboardWalletAnalysisJobData } from '../queues/jobs/types';
import { generateJobId } from '../queues/utils/job-id-generator';

type PriorityName = 'low' | 'normal' | 'high' | 'critical';

interface CliOptions {
  search?: string;
  userId?: string;
  limit?: number;
  offset: number;
  batchSize: number;
  pauseMs: number;
  pollMs: number;
  priority: PriorityName;
  forceRefresh: boolean;
  dryRun: boolean;
  continueOnFailure: boolean;
  requestPrefix: string;
}

const prisma = new PrismaClient();
const queue = new Queue(QueueNames.ANALYSIS_OPERATIONS, QueueConfigs[QueueNames.ANALYSIS_OPERATIONS].queueOptions);

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    offset: 0,
    batchSize: 50,
    pauseMs: 1000,
    pollMs: 5000,
    priority: 'low',
    forceRefresh: false,
    dryRun: false,
    continueOnFailure: false,
    requestPrefix: 'kol-flash',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--search':
        options.search = next?.trim() || undefined;
        i += 1;
        break;
      case '--limit':
        options.limit = Number(next);
        i += 1;
        break;
      case '--user-id':
        options.userId = next?.trim() || undefined;
        i += 1;
        break;
      case '--offset':
        options.offset = Number(next);
        i += 1;
        break;
      case '--batch-size':
        options.batchSize = Number(next);
        i += 1;
        break;
      case '--pause-ms':
        options.pauseMs = Number(next);
        i += 1;
        break;
      case '--poll-ms':
        options.pollMs = Number(next);
        i += 1;
        break;
      case '--priority':
        if (next === 'low' || next === 'normal' || next === 'high' || next === 'critical') {
          options.priority = next;
        }
        i += 1;
        break;
      case '--force-refresh':
        options.forceRefresh = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--continue-on-failure':
        options.continueOnFailure = true;
        break;
      case '--request-prefix':
        options.requestPrefix = next?.trim() || options.requestPrefix;
        i += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

function validateOptions(options: CliOptions): void {
  if (!Number.isInteger(options.offset) || options.offset < 0) {
    throw new Error(`Invalid --offset: ${options.offset}`);
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 200) {
    throw new Error(`Invalid --batch-size: ${options.batchSize}`);
  }
  if (!Number.isInteger(options.pauseMs) || options.pauseMs < 0) {
    throw new Error(`Invalid --pause-ms: ${options.pauseMs}`);
  }
  if (!Number.isInteger(options.pollMs) || options.pollMs < 250) {
    throw new Error(`Invalid --poll-ms: ${options.pollMs}`);
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error(`Invalid --limit: ${options.limit}`);
  }
}

function mapPriority(priority: PriorityName): number {
  switch (priority) {
    case 'critical':
      return JobPriority.CRITICAL;
    case 'high':
      return JobPriority.HIGH;
    case 'normal':
      return JobPriority.NORMAL;
    case 'low':
    default:
      return JobPriority.LOW;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForBatch(jobIds: string[], pollMs: number): Promise<{ completed: string[]; failed: string[] }> {
  const pending = new Set(jobIds);
  const completed: string[] = [];
  const failed: string[] = [];

  while (pending.size > 0) {
    for (const jobId of Array.from(pending)) {
      const job = await queue.getJob(jobId);

      if (!job) {
        failed.push(jobId);
        pending.delete(jobId);
        continue;
      }

      if (await job.isCompleted()) {
        completed.push(jobId);
        pending.delete(jobId);
        continue;
      }

      if (await job.isFailed()) {
        failed.push(jobId);
        pending.delete(jobId);
      }
    }

    if (pending.size > 0) {
      await sleep(pollMs);
    }
  }

  return { completed, failed };
}

function buildKolWhere(search?: string): Prisma.WalletWhereInput {
  if (!search) {
    return { knownType: 'KOL' };
  }

  return {
    knownType: 'KOL',
    AND: [
      {
        OR: [
          { address: { contains: search, mode: 'insensitive' } },
          { knownLabel: { contains: search, mode: 'insensitive' } },
          { kolProfile: { is: { name: { contains: search, mode: 'insensitive' } } } },
          { kolProfile: { is: { twitter: { contains: search, mode: 'insensitive' } } } },
          { kolProfile: { is: { telegram: { contains: search, mode: 'insensitive' } } } },
        ],
      },
    ],
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  validateOptions(options);

  const flashDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS.flash;
  const where = buildKolWhere(options.search);
  const total = await prisma.wallet.count({ where });

  const wallets = await prisma.wallet.findMany({
    where,
    select: {
      address: true,
      knownLabel: true,
      kolProfile: {
        select: {
          name: true,
        },
      },
    },
    orderBy: [
      { knownLabel: { sort: 'asc', nulls: 'last' } },
      { address: 'asc' },
    ],
    skip: options.offset,
    take: options.limit,
  });

  const requestId = `${options.requestPrefix}-${Date.now()}`;
  const priority = mapPriority(options.priority);

  console.log(`KOL matches: ${total}`);
  console.log(`Queued subset: ${wallets.length} (offset=${options.offset}${options.limit ? `, limit=${options.limit}` : ''})`);
  console.log(`Flash scope: targetSignatures=${flashDefaults.targetSignatureCount}, freshness=${flashDefaults.freshnessMinutes}m`);
  console.log(`Queue options: priority=${options.priority}, batchSize=${options.batchSize}, pauseMs=${options.pauseMs}, pollMs=${options.pollMs}, forceRefresh=${options.forceRefresh}`);
  console.log(`User routing: ${options.userId ?? 'none'}`);
  console.log(`Request ID: ${requestId}`);

  if (wallets.length === 0) {
    return;
  }

  if (options.dryRun) {
    console.log('\nDry run sample:');
    wallets.slice(0, 10).forEach((wallet, index) => {
      const label = wallet.kolProfile?.name ?? wallet.knownLabel ?? '(unlabeled)';
      console.log(`${index + 1}. ${wallet.address}  ${label}`);
    });
    return;
  }

  for (let start = 0; start < wallets.length; start += options.batchSize) {
    const batch = wallets.slice(start, start + options.batchSize);
    const batchNumber = Math.floor(start / options.batchSize) + 1;
    const batchTotal = Math.ceil(wallets.length / options.batchSize);
    const batchRequestId = `${requestId}-b${batchNumber}`;

    const jobs = await Promise.all(
      batch.map(wallet => {
        const jobData: DashboardWalletAnalysisJobData = {
          walletAddress: wallet.address,
          userId: options.userId,
          requestId: batchRequestId,
          analysisScope: 'flash',
          triggerSource: 'manual',
          targetSignatureCount: flashDefaults.targetSignatureCount,
          forceRefresh: options.forceRefresh,
          queueWorkingAfter: false,
          queueDeepAfter: false,
          timeoutMinutes: flashDefaults.timeoutMinutes,
        };

        const jobId = generateJobId.dashboardWalletAnalysis(wallet.address, batchRequestId);
        return queue.add('dashboard-wallet-analysis', jobData, {
          jobId,
          priority,
          delay: 0,
        });
      }),
    );

    const jobIds = jobs.map(job => String(job.id));
    console.log(`Queued batch ${batchNumber}/${batchTotal} (${batch.length} wallets)`);

    const batchResult = await waitForBatch(jobIds, options.pollMs);
    console.log(
      `Batch ${batchNumber}/${batchTotal} settled: ${batchResult.completed.length} completed, ${batchResult.failed.length} failed`,
    );

    if (batchResult.failed.length > 0 && !options.continueOnFailure) {
      throw new Error(
        `Stopping after batch ${batchNumber}: ${batchResult.failed.length} job(s) failed. ` +
        `Re-run with --continue-on-failure if you want to keep queueing.`,
      );
    }

    if (start + options.batchSize < wallets.length && options.pauseMs > 0) {
      await sleep(options.pauseMs);
    }
  }

  console.log('\nDone.');
}

main()
  .catch((error) => {
    console.error('KOL flash queue failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await queue.close();
    await prisma.$disconnect();
  });
