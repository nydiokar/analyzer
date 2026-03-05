#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { prisma } from '../../src/core/services/database-service';
import { createLogger } from '../../src/core/utils/logger';

const logger = createLogger('SmartDbPrune');

type PruneSummary = {
  heliusCandidates: number;
  swapCandidates: number;
  swapGlobalCandidates: number;
  candidateWallets: number;
  estHeliusBytesPerRow: number;
  estSwapBytesPerRow: number;
};

async function estimateBytesPerRow(tableName: 'HeliusTransactionCache' | 'SwapAnalysisInput'): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ rows: number }>>(
    `SELECT COUNT(*)::bigint AS rows FROM "public"."${tableName}";`,
  );
  const size = await prisma.$queryRawUnsafe<Array<{ total_bytes: number }>>(
    `SELECT pg_total_relation_size('public."${tableName}"')::bigint AS total_bytes;`,
  );

  const totalRows = Number(rows[0]?.rows ?? 0);
  const totalBytes = Number(size[0]?.total_bytes ?? 0);
  if (!totalRows || !totalBytes) return 0;
  return totalBytes / totalRows;
}

async function countHeliusCandidates(olderThanUnixTs: number): Promise<number> {
  return prisma.heliusTransactionCache.count({
    where: {
      timestamp: { lt: olderThanUnixTs },
    },
  });
}

async function findInactiveWallets(inactiveBeforeDate: Date, inactiveBeforeUnixTs: number): Promise<string[]> {
  const wallets = await prisma.wallet.findMany({
    where: {
      AND: [
        {
          OR: [
            { lastSuccessfulFetchTimestamp: { lt: inactiveBeforeDate } },
            {
              lastSuccessfulFetchTimestamp: null,
              newestProcessedTimestamp: { lt: inactiveBeforeUnixTs },
            },
          ],
        },
        { favoritedBy: { none: {} } },
        { walletNotes: { none: {} } },
      ],
    },
    select: { address: true },
  });

  return wallets.map((w) => w.address);
}

async function findSwapCandidates(
  inactiveWallets: string[],
  olderThanUnixTs: number,
  minWalletOldRows: number,
  maxWallets: number,
): Promise<Array<{ walletAddress: string; oldRows: number }>> {
  if (inactiveWallets.length === 0) return [];

  const grouped = await prisma.swapAnalysisInput.groupBy({
    by: ['walletAddress'],
    where: {
      walletAddress: { in: inactiveWallets },
      timestamp: { lt: olderThanUnixTs },
    },
    _count: { _all: true },
  });

  return grouped
    .map((g) => ({ walletAddress: g.walletAddress, oldRows: g._count._all }))
    .filter((g) => g.oldRows >= minWalletOldRows)
    .sort((a, b) => b.oldRows - a.oldRows)
    .slice(0, maxWallets);
}

async function getProtectedWallets(options: {
  protectFavoritedWallets: boolean;
  protectNotedWallets: boolean;
  protectRecentWalletDays: number;
}): Promise<string[]> {
  const protectedSet = new Set<string>();

  if (options.protectFavoritedWallets) {
    const favorites = await prisma.userFavoriteWallet.findMany({
      select: { walletAddress: true },
      distinct: ['walletAddress'],
    });
    favorites.forEach((f) => protectedSet.add(f.walletAddress));
  }

  if (options.protectNotedWallets) {
    const notes = await prisma.walletNote.findMany({
      select: { walletAddress: true },
      distinct: ['walletAddress'],
    });
    notes.forEach((n) => protectedSet.add(n.walletAddress));
  }

  if (options.protectRecentWalletDays > 0) {
    const cutoffDate = new Date(Date.now() - options.protectRecentWalletDays * 24 * 60 * 60 * 1000);
    const cutoffUnix = Math.floor(cutoffDate.getTime() / 1000);

    const recentWallets = await prisma.wallet.findMany({
      where: {
        OR: [
          { lastSuccessfulFetchTimestamp: { gte: cutoffDate } },
          { newestProcessedTimestamp: { gte: cutoffUnix } },
        ],
      },
      select: { address: true },
    });
    recentWallets.forEach((w) => protectedSet.add(w.address));
  }

  return Array.from(protectedSet);
}

async function countSwapGlobalCandidates(olderThanUnixTs: number, protectedWallets: string[]): Promise<number> {
  return prisma.swapAnalysisInput.count({
    where: {
      timestamp: { lt: olderThanUnixTs },
      ...(protectedWallets.length > 0 ? { walletAddress: { notIn: protectedWallets } } : {}),
    },
  });
}

async function pruneHeliusInBatches(olderThanUnixTs: number, batchSize: number, pauseMs: number, maxBatches: number): Promise<number> {
  let deleted = 0;
  let batch = 0;

  while (batch < maxBatches) {
    const keys = await prisma.heliusTransactionCache.findMany({
      where: { timestamp: { lt: olderThanUnixTs } },
      orderBy: { signature: 'asc' },
      take: batchSize,
      select: { signature: true },
    });

    if (keys.length === 0) break;

    const signatures = keys.map((k) => k.signature);
    const result = await prisma.heliusTransactionCache.deleteMany({
      where: { signature: { in: signatures } },
    });

    deleted += result.count;
    batch += 1;
    logger.info(`[Helius] Batch ${batch}: deleted ${result.count} rows (total ${deleted})`);

    if (pauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }

  return deleted;
}

async function pruneSwapInactiveInBatches(
  candidates: Array<{ walletAddress: string; oldRows: number }>,
  olderThanUnixTs: number,
  batchSize: number,
  pauseMs: number,
  maxBatches: number,
): Promise<number> {
  let deleted = 0;
  let batch = 0;

  for (const wallet of candidates) {
    while (batch < maxBatches) {
      const keys = await prisma.swapAnalysisInput.findMany({
        where: {
          walletAddress: wallet.walletAddress,
          timestamp: { lt: olderThanUnixTs },
        },
        orderBy: { id: 'asc' },
        take: batchSize,
        select: { id: true },
      });

      if (keys.length === 0) break;

      const ids = keys.map((k) => k.id);
      const result = await prisma.swapAnalysisInput.deleteMany({
        where: { id: { in: ids } },
      });

      deleted += result.count;
      batch += 1;
      logger.info(
        `[SwapInactive] Batch ${batch}: wallet=${wallet.walletAddress} deleted ${result.count} rows (total ${deleted})`,
      );

      if (pauseMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
    }

    if (batch >= maxBatches) break;
  }

  return deleted;
}

async function pruneSwapGlobalInBatches(
  olderThanUnixTs: number,
  protectedWallets: string[],
  batchSize: number,
  pauseMs: number,
  maxBatches: number,
): Promise<number> {
  let deleted = 0;
  let batch = 0;

  while (batch < maxBatches) {
    const keys = await prisma.swapAnalysisInput.findMany({
      where: {
        timestamp: { lt: olderThanUnixTs },
        ...(protectedWallets.length > 0 ? { walletAddress: { notIn: protectedWallets } } : {}),
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true },
    });

    if (keys.length === 0) break;

    const ids = keys.map((k) => k.id);
    const result = await prisma.swapAnalysisInput.deleteMany({
      where: { id: { in: ids } },
    });

    deleted += result.count;
    batch += 1;
    logger.info(`[SwapGlobal] Batch ${batch}: deleted ${result.count} rows (total ${deleted})`);

    if (pauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }

  return deleted;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('smart-db-prune')
    .usage('$0 [options]')
    .option('apply', {
      type: 'boolean',
      default: false,
      description: 'Execute deletes. Default is dry-run preview.',
    })
    .option('pruneHelius', {
      type: 'boolean',
      default: true,
      description: 'Prune old HeliusTransactionCache rows.',
    })
    .option('pruneSwapInactive', {
      type: 'boolean',
      default: false,
      description: 'Prune old SwapAnalysisInput rows for inactive, unstarred wallets.',
    })
    .option('pruneSwapGlobal', {
      type: 'boolean',
      default: false,
      description: 'Prune old SwapAnalysisInput rows globally, excluding protected wallets.',
    })
    .option('heliusOlderThanDays', {
      type: 'number',
      default: 30,
      description: 'Age threshold for Helius cache pruning.',
    })
    .option('swapOlderThanDays', {
      type: 'number',
      default: 120,
      description: 'Age threshold for inactive wallet swap-history pruning.',
    })
    .option('swapGlobalOlderThanDays', {
      type: 'number',
      default: 90,
      description: 'Age threshold for global swap-history pruning.',
    })
    .option('walletInactiveDays', {
      type: 'number',
      default: 60,
      description: 'Wallet considered inactive if untouched for at least this many days.',
    })
    .option('protectFavoritedWallets', {
      type: 'boolean',
      default: true,
      description: 'Exclude favorited wallets from global swap pruning.',
    })
    .option('protectNotedWallets', {
      type: 'boolean',
      default: true,
      description: 'Exclude wallets with user notes from global swap pruning.',
    })
    .option('protectRecentWalletDays', {
      type: 'number',
      default: 45,
      description: 'Exclude wallets seen recently from global swap pruning.',
    })
    .option('minWalletOldRows', {
      type: 'number',
      default: 5000,
      description: 'Only prune swap history for wallets with at least this many old rows.',
    })
    .option('maxWallets', {
      type: 'number',
      default: 300,
      description: 'Maximum inactive wallets to target in one run.',
    })
    .option('batchSize', {
      type: 'number',
      default: 1500,
      description: 'Rows deleted per batch.',
    })
    .option('pauseMs', {
      type: 'number',
      default: 75,
      description: 'Pause between batches to reduce pressure.',
    })
    .option('maxBatches', {
      type: 'number',
      default: 400,
      description: 'Safety cap: stop after this many batches.',
    })
    .strict()
    .help()
    .alias('help', 'h')
    .parse();

  const now = Date.now();
  const heliusOlderThanUnixTs = Math.floor((now - argv.heliusOlderThanDays * 24 * 60 * 60 * 1000) / 1000);
  const swapOlderThanUnixTs = Math.floor((now - argv.swapOlderThanDays * 24 * 60 * 60 * 1000) / 1000);
  const swapGlobalOlderThanUnixTs = Math.floor(
    (now - argv.swapGlobalOlderThanDays * 24 * 60 * 60 * 1000) / 1000,
  );
  const walletInactiveBefore = new Date(now - argv.walletInactiveDays * 24 * 60 * 60 * 1000);
  const walletInactiveBeforeUnixTs = Math.floor(walletInactiveBefore.getTime() / 1000);

  logger.info(`Mode: ${argv.apply ? 'APPLY' : 'DRY_RUN'}`);
  logger.info(
    `Config: pruneHelius=${argv.pruneHelius}, pruneSwapInactive=${argv.pruneSwapInactive}, pruneSwapGlobal=${argv.pruneSwapGlobal}, batchSize=${argv.batchSize}, maxBatches=${argv.maxBatches}`,
  );

  const [estHeliusBytesPerRow, estSwapBytesPerRow] = await Promise.all([
    estimateBytesPerRow('HeliusTransactionCache'),
    estimateBytesPerRow('SwapAnalysisInput'),
  ]);

  const heliusCandidates = argv.pruneHelius ? await countHeliusCandidates(heliusOlderThanUnixTs) : 0;
  const inactiveWallets = argv.pruneSwapInactive
    ? await findInactiveWallets(walletInactiveBefore, walletInactiveBeforeUnixTs)
    : [];
  const swapCandidatesByWallet = argv.pruneSwapInactive
    ? await findSwapCandidates(
        inactiveWallets,
        swapOlderThanUnixTs,
        argv.minWalletOldRows,
        argv.maxWallets,
      )
    : [];
  const swapCandidates = swapCandidatesByWallet.reduce((acc, cur) => acc + cur.oldRows, 0);
  const protectedWallets = argv.pruneSwapGlobal
    ? await getProtectedWallets({
        protectFavoritedWallets: argv.protectFavoritedWallets,
        protectNotedWallets: argv.protectNotedWallets,
        protectRecentWalletDays: argv.protectRecentWalletDays,
      })
    : [];
  const swapGlobalCandidates = argv.pruneSwapGlobal
    ? await countSwapGlobalCandidates(swapGlobalOlderThanUnixTs, protectedWallets)
    : 0;

  const summary: PruneSummary = {
    heliusCandidates,
    swapCandidates,
    swapGlobalCandidates,
    candidateWallets: swapCandidatesByWallet.length,
    estHeliusBytesPerRow,
    estSwapBytesPerRow,
  };

  logger.info(
    `Preview: heliusRows=${summary.heliusCandidates} (~${(
      (summary.heliusCandidates * summary.estHeliusBytesPerRow) /
      1024 /
      1024 /
      1024
    ).toFixed(2)} GB logical), swapInactiveRows=${summary.swapCandidates} across ${summary.candidateWallets} wallets (~${(
      (summary.swapCandidates * summary.estSwapBytesPerRow) /
      1024 /
      1024 /
      1024
    ).toFixed(2)} GB logical), swapGlobalRows=${summary.swapGlobalCandidates} (~${(
      (summary.swapGlobalCandidates * summary.estSwapBytesPerRow) /
      1024 /
      1024 /
      1024
    ).toFixed(2)} GB logical)`,
  );

  if (argv.pruneSwapGlobal) {
    logger.info(`Protected wallets excluded from global swap prune: ${protectedWallets.length}`);
  }

  if (swapCandidatesByWallet.length > 0) {
    const top = swapCandidatesByWallet.slice(0, 10);
    logger.info(
      `Top inactive swap candidates: ${top
        .map((w) => `${w.walletAddress}:${w.oldRows}`)
        .join(', ')}`,
    );
  }

  if (!argv.apply) {
    logger.info('Dry-run complete. Re-run with --apply to execute.');
    return;
  }

  let deletedHelius = 0;
  let deletedSwap = 0;
  let deletedSwapGlobal = 0;

  if (argv.pruneHelius) {
    deletedHelius = await pruneHeliusInBatches(
      heliusOlderThanUnixTs,
      argv.batchSize,
      argv.pauseMs,
      argv.maxBatches,
    );
  }

  if (argv.pruneSwapInactive && swapCandidatesByWallet.length > 0) {
    const remainingBatches = Math.max(0, argv.maxBatches - Math.ceil(deletedHelius / Math.max(1, argv.batchSize)));
    if (remainingBatches > 0) {
      deletedSwap = await pruneSwapInactiveInBatches(
        swapCandidatesByWallet,
        swapOlderThanUnixTs,
        argv.batchSize,
        argv.pauseMs,
        remainingBatches,
      );
    } else {
      logger.warn('Batch budget exhausted by Helius pruning; skipping swap-inactive prune this run.');
    }
  }

  if (argv.pruneSwapGlobal && swapGlobalCandidates > 0) {
    const consumedByHelius = Math.ceil(deletedHelius / Math.max(1, argv.batchSize));
    const consumedByInactive = Math.ceil(deletedSwap / Math.max(1, argv.batchSize));
    const remainingBatches = Math.max(0, argv.maxBatches - consumedByHelius - consumedByInactive);
    if (remainingBatches > 0) {
      deletedSwapGlobal = await pruneSwapGlobalInBatches(
        swapGlobalOlderThanUnixTs,
        protectedWallets,
        argv.batchSize,
        argv.pauseMs,
        remainingBatches,
      );
    } else {
      logger.warn('Batch budget exhausted before global swap prune.');
    }
  }

  logger.info(
    `Apply complete: deletedHelius=${deletedHelius}, deletedSwapInactive=${deletedSwap}, deletedSwapGlobal=${deletedSwapGlobal}, totalDeleted=${
      deletedHelius + deletedSwap + deletedSwapGlobal
    }`,
  );
}

main()
  .catch((error) => {
    logger.error('Fatal error in smart-db-prune', { error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
