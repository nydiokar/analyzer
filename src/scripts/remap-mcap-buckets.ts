#!/usr/bin/env node
/**
 * Remap mcap bucket labels across all tables using already-stored numeric mcap values.
 * No API calls, no re-analysis — pure reclassification from stored numeric fields.
 *
 * Tables:
 *   SwapAnalysisInput       mcapBucket          ← marketCapUsd
 *   AnalysisResult          avgEntryMcapBucket  ← avgEntryMcap
 *                           avgExitMcapBucket   ← avgExitMcap
 *   TokenLot                entryMcapBucket     ← entryMcapUsd
 *   WalletBehaviorProfile   preferredMcapBucket ← avgEntryMcap
 *                           mcapDistribution    ← nulled (recomputed on next wallet request)
 *                           mcapBucketPnl       ← nulled (recomputed on next wallet request)
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/remap-mcap-buckets.ts [--apply] [--batch-size 500] [--pause-ms 50]
 */

import * as dotenv from 'dotenv';
dotenv.config();

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { prisma } from '../core/services/database-service';
import { classifyMcap } from '../core/services/market-context-standalone';

// ---------------------------------------------------------------------------
// Batched update helper — fetch IDs + current mcap value, reclassify, updateMany
// No cursor drift: always re-query from id > lastSeenId with the OLD bucket value
// to avoid double-processing rows already updated in this run.
// ---------------------------------------------------------------------------

async function remapBatch(opts: {
  label: string;
  batchSize: number;
  pauseMs: number;
  apply: boolean;
  fetchBatch: (afterId: number) => Promise<Array<{ id: number; mcapUsd: number | null }>>;
  applyBatch: (updates: Array<{ id: number; bucket: string }>) => Promise<number>;
}): Promise<{ total: number; updated: number; skipped: number }> {
  const { label, batchSize, pauseMs, apply, fetchBatch, applyBatch } = opts;
  let afterId = 0;
  let total = 0;
  let updated = 0;
  let skipped = 0;

  while (true) {
    const rows = await fetchBatch(afterId);
    if (rows.length === 0) break;

    afterId = rows[rows.length - 1].id;
    total += rows.length;

    const updates: Array<{ id: number; bucket: string }> = [];
    for (const row of rows) {
      if (row.mcapUsd == null) { skipped++; continue; }
      updates.push({ id: row.id, bucket: classifyMcap(row.mcapUsd) });
    }

    if (apply && updates.length > 0) {
      const count = await applyBatch(updates);
      updated += count;
    } else {
      updated += updates.length;
    }

    process.stdout.write(`\r  [${label}] processed=${total} updated=${updated} skipped=${skipped}...`);

    if (pauseMs > 0) await new Promise(resolve => setTimeout(resolve, pauseMs));
  }

  process.stdout.write(`\r  [${label}] done — processed=${total} updated=${updated} skipped=${skipped}       \n`);
  return { total, updated, skipped };
}

// ---------------------------------------------------------------------------
// Per-table remap functions
// ---------------------------------------------------------------------------

async function remapSwapAnalysisInput(batchSize: number, pauseMs: number, apply: boolean) {
  return remapBatch({
    label: 'SwapAnalysisInput.mcapBucket',
    batchSize, pauseMs, apply,
    fetchBatch: (afterId) => prisma.swapAnalysisInput.findMany({
      where: { id: { gt: afterId }, marketCapUsd: { not: null } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, marketCapUsd: true },
    }).then(rows => rows.map(r => ({ id: r.id, mcapUsd: r.marketCapUsd }))),
    applyBatch: async (updates) => {
      // Group by new bucket label and fire one updateMany per group
      const byBucket = new Map<string, number[]>();
      for (const u of updates) {
        const ids = byBucket.get(u.bucket) ?? [];
        ids.push(u.id);
        byBucket.set(u.bucket, ids);
      }
      let count = 0;
      for (const [bucket, ids] of byBucket) {
        const result = await prisma.swapAnalysisInput.updateMany({
          where: { id: { in: ids } },
          data: { mcapBucket: bucket },
        });
        count += result.count;
      }
      return count;
    },
  });
}

async function remapAnalysisResultEntry(batchSize: number, pauseMs: number, apply: boolean) {
  return remapBatch({
    label: 'AnalysisResult.avgEntryMcapBucket',
    batchSize, pauseMs, apply,
    fetchBatch: (afterId) => prisma.analysisResult.findMany({
      where: { id: { gt: afterId }, avgEntryMcap: { not: null } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, avgEntryMcap: true },
    }).then(rows => rows.map(r => ({ id: r.id, mcapUsd: r.avgEntryMcap }))),
    applyBatch: async (updates) => {
      const byBucket = new Map<string, number[]>();
      for (const u of updates) {
        const ids = byBucket.get(u.bucket) ?? [];
        ids.push(u.id);
        byBucket.set(u.bucket, ids);
      }
      let count = 0;
      for (const [bucket, ids] of byBucket) {
        const result = await prisma.analysisResult.updateMany({
          where: { id: { in: ids } },
          data: { avgEntryMcapBucket: bucket },
        });
        count += result.count;
      }
      return count;
    },
  });
}

async function remapAnalysisResultExit(batchSize: number, pauseMs: number, apply: boolean) {
  return remapBatch({
    label: 'AnalysisResult.avgExitMcapBucket',
    batchSize, pauseMs, apply,
    fetchBatch: (afterId) => prisma.analysisResult.findMany({
      where: { id: { gt: afterId }, avgExitMcap: { not: null } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, avgExitMcap: true },
    }).then(rows => rows.map(r => ({ id: r.id, mcapUsd: r.avgExitMcap }))),
    applyBatch: async (updates) => {
      const byBucket = new Map<string, number[]>();
      for (const u of updates) {
        const ids = byBucket.get(u.bucket) ?? [];
        ids.push(u.id);
        byBucket.set(u.bucket, ids);
      }
      let count = 0;
      for (const [bucket, ids] of byBucket) {
        const result = await prisma.analysisResult.updateMany({
          where: { id: { in: ids } },
          data: { avgExitMcapBucket: bucket },
        });
        count += result.count;
      }
      return count;
    },
  });
}

async function remapTokenLot(batchSize: number, pauseMs: number, apply: boolean) {
  return remapBatch({
    label: 'TokenLot.entryMcapBucket',
    batchSize, pauseMs, apply,
    fetchBatch: (afterId) => prisma.tokenLot.findMany({
      where: { id: { gt: afterId }, entryMcapUsd: { not: null } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, entryMcapUsd: true },
    }).then(rows => rows.map(r => ({ id: r.id, mcapUsd: r.entryMcapUsd }))),
    applyBatch: async (updates) => {
      const byBucket = new Map<string, number[]>();
      for (const u of updates) {
        const ids = byBucket.get(u.bucket) ?? [];
        ids.push(u.id);
        byBucket.set(u.bucket, ids);
      }
      let count = 0;
      for (const [bucket, ids] of byBucket) {
        const result = await prisma.tokenLot.updateMany({
          where: { id: { in: ids } },
          data: { entryMcapBucket: bucket },
        });
        count += result.count;
      }
      return count;
    },
  });
}

async function remapWalletBehaviorProfile(batchSize: number, pauseMs: number, apply: boolean) {
  return remapBatch({
    label: 'WalletBehaviorProfile.preferredMcapBucket',
    batchSize, pauseMs, apply,
    fetchBatch: (afterId) => prisma.walletBehaviorProfile.findMany({
      where: { id: { gt: afterId }, avgEntryMcap: { not: null } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, avgEntryMcap: true },
    }).then(rows => rows.map(r => ({ id: r.id, mcapUsd: r.avgEntryMcap }))),
    applyBatch: async (updates) => {
      const byBucket = new Map<string, number[]>();
      for (const u of updates) {
        const ids = byBucket.get(u.bucket) ?? [];
        ids.push(u.id);
        byBucket.set(u.bucket, ids);
      }
      let count = 0;
      for (const [bucket, ids] of byBucket) {
        const result = await prisma.walletBehaviorProfile.updateMany({
          where: { id: { in: ids } },
          data: {
            preferredMcapBucket: bucket,
            // Null out JSON aggregates — BehaviorService recomputes on next wallet request
            mcapDistribution: undefined,
            mcapBucketPnl: undefined,
          },
        });
        count += result.count;
      }
      return count;
    },
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('remap-mcap-buckets')
    .usage('$0 [options]')
    .option('apply', {
      type: 'boolean',
      default: false,
      description: 'Execute updates. Default is dry-run (counts only, no writes).',
    })
    .option('batch-size', {
      type: 'number',
      default: 500,
      description: 'Rows per batch.',
    })
    .option('pause-ms', {
      type: 'number',
      default: 50,
      description: 'Pause between batches in ms.',
    })
    .strict()
    .help()
    .alias('help', 'h')
    .parse();

  const apply = argv.apply;
  const batchSize = argv['batch-size'];
  const pauseMs = argv['pause-ms'];

  console.log(`remap-mcap-buckets | mode=${apply ? 'APPLY' : 'DRY_RUN'} batchSize=${batchSize} pauseMs=${pauseMs}`);

  const results = [];
  results.push(await remapSwapAnalysisInput(batchSize, pauseMs, apply));
  results.push(await remapAnalysisResultEntry(batchSize, pauseMs, apply));
  results.push(await remapAnalysisResultExit(batchSize, pauseMs, apply));
  results.push(await remapTokenLot(batchSize, pauseMs, apply));
  results.push(await remapWalletBehaviorProfile(batchSize, pauseMs, apply));

  const totals = results.reduce((acc, r) => ({
    total: acc.total + r.total,
    updated: acc.updated + r.updated,
    skipped: acc.skipped + r.skipped,
  }), { total: 0, updated: 0, skipped: 0 });

  console.log(`done | rows=${totals.total} updated=${totals.updated} skipped=${totals.skipped}${!apply ? ' (dry-run)' : ''}`);
}

main()
  .catch((error) => {
    console.error('fatal:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
