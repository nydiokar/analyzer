#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import { prisma } from '../../src/core/services/database-service';
import { createLogger } from '../../src/core/utils/logger';

const logger = createLogger('SmartDbPrune');

type PruneSummary = {
  heliusCandidates: number;
  swapCandidates: number;
  swapGlobalCandidates: number;
  orphanAnalysisResultCandidates: number;
  orphanTokenLotCandidates: number;
  candidateWallets: number;
  estHeliusBytesPerRow: number;
  estSwapBytesPerRow: number;
};

type ProtectionBreakdownEntry = {
  label: string;
  wallets: string[];
  oldRows: number;
};

type ProtectedWalletsResult = {
  protectedWallets: string[];
  breakdown: ProtectionBreakdownEntry[];
};

function parseCsvList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

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

async function countOldSwapRowsForWallets(olderThanUnixTs: number, walletAddresses: string[]): Promise<number> {
  if (walletAddresses.length === 0) return 0;

  const rows = await prisma.swapAnalysisInput.aggregate({
    where: {
      timestamp: { lt: olderThanUnixTs },
      walletAddress: { in: walletAddresses },
    },
    _count: { _all: true },
  });

  return rows._count._all;
}

async function getProtectedWallets(options: {
  protectFavoritedWallets: boolean;
  protectNotedWallets: boolean;
  protectRecentWalletDays: number;
  protectBehaviorProfiles: boolean;
  protectSpeedCategories: string[];
  protectStrategyTypes: string[];
  protectTradingStyleKeywords: string[];
  protectWalletFile?: string;
  olderThanUnixTs: number;
}): Promise<ProtectedWalletsResult> {
  const protectedSet = new Set<string>();
  const breakdown: ProtectionBreakdownEntry[] = [];

  const addBreakdownEntry = async (label: string, wallets: string[]): Promise<void> => {
    const uniqueWallets = Array.from(new Set(wallets));
    breakdown.push({
      label,
      wallets: uniqueWallets,
      oldRows: await countOldSwapRowsForWallets(options.olderThanUnixTs, uniqueWallets),
    });
    uniqueWallets.forEach((wallet) => protectedSet.add(wallet));
  };

  if (options.protectFavoritedWallets) {
    const favorites = await prisma.userFavoriteWallet.findMany({
      select: { walletAddress: true },
      distinct: ['walletAddress'],
    });
    await addBreakdownEntry(
      'favorited wallets',
      favorites.map((f) => f.walletAddress),
    );
  }

  if (options.protectNotedWallets) {
    const notes = await prisma.walletNote.findMany({
      select: { walletAddress: true },
      distinct: ['walletAddress'],
    });
    await addBreakdownEntry(
      'wallet notes',
      notes.map((n) => n.walletAddress),
    );
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
    await addBreakdownEntry(
      `recent wallets (${options.protectRecentWalletDays}d)`,
      recentWallets.map((w) => w.address),
    );
  }

  if (options.protectWalletFile) {
    const content = fs.readFileSync(options.protectWalletFile, 'utf8');
    const fileWallets = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    await addBreakdownEntry('wallet file', fileWallets);
  }

  if (options.protectBehaviorProfiles) {
    const behaviorOrFilters = [
      ...(options.protectSpeedCategories.length > 0
        ? [{ speedCategory: { in: options.protectSpeedCategories } }]
        : []),
      ...(options.protectStrategyTypes.length > 0
        ? [{ strategyType: { in: options.protectStrategyTypes } }]
        : []),
      ...options.protectTradingStyleKeywords.map((keyword) => ({
        tradingStyle: { contains: keyword, mode: 'insensitive' as const },
      })),
    ];

    const behaviorWallets = behaviorOrFilters.length === 0
      ? []
      : await prisma.walletBehaviorProfile.findMany({
      where: {
        OR: behaviorOrFilters,
      },
      select: { walletAddress: true },
      distinct: ['walletAddress'],
    });

    await addBreakdownEntry(
      'behavior profiles (combined)',
      behaviorWallets.map((w) => w.walletAddress),
    );

    for (const speedCategory of options.protectSpeedCategories) {
      const speedWallets = await prisma.walletBehaviorProfile.findMany({
        where: { speedCategory },
        select: { walletAddress: true },
        distinct: ['walletAddress'],
      });
      await addBreakdownEntry(
        `behavior speed=${speedCategory}`,
        speedWallets.map((w) => w.walletAddress),
      );
    }

    for (const strategyType of options.protectStrategyTypes) {
      const strategyWallets = await prisma.walletBehaviorProfile.findMany({
        where: { strategyType },
        select: { walletAddress: true },
        distinct: ['walletAddress'],
      });
      await addBreakdownEntry(
        `behavior strategy=${strategyType}`,
        strategyWallets.map((w) => w.walletAddress),
      );
    }

    for (const keyword of options.protectTradingStyleKeywords) {
      const keywordWallets = await prisma.walletBehaviorProfile.findMany({
        where: {
          tradingStyle: { contains: keyword, mode: 'insensitive' as const },
        },
        select: { walletAddress: true },
        distinct: ['walletAddress'],
      });
      await addBreakdownEntry(
        `behavior tradingStyle~${keyword}`,
        keywordWallets.map((w) => w.walletAddress),
      );
    }
  }

  return {
    protectedWallets: Array.from(protectedSet),
    breakdown,
  };
}

async function countSwapGlobalCandidates(olderThanUnixTs: number, protectedWallets: string[]): Promise<number> {
  return prisma.swapAnalysisInput.count({
    where: {
      timestamp: { lt: olderThanUnixTs },
      ...(protectedWallets.length > 0 ? { walletAddress: { notIn: protectedWallets } } : {}),
    },
  });
}

async function countOrphanRows(tableName: 'AnalysisResult' | 'TokenLot'): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `WITH swap_wallets AS (SELECT DISTINCT "walletAddress" FROM "SwapAnalysisInput")
     SELECT COUNT(*)::bigint AS count
     FROM "public"."${tableName}" t
     WHERE t."walletAddress" NOT IN (SELECT "walletAddress" FROM swap_wallets);`,
  );
  return Number(rows[0]?.count ?? 0);
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

async function pruneOrphanRowsInBatches(
  tableName: 'AnalysisResult' | 'TokenLot',
  batchSize: number,
  pauseMs: number,
  maxBatches: number,
): Promise<number> {
  let deleted = 0;
  let batch = 0;

  while (batch < maxBatches) {
    const result = await prisma.$executeRawUnsafe(
      `WITH swap_wallets AS (SELECT DISTINCT "walletAddress" FROM "SwapAnalysisInput"),
            to_del AS (
              SELECT t.id
              FROM "public"."${tableName}" t
              WHERE t."walletAddress" NOT IN (SELECT "walletAddress" FROM swap_wallets)
              ORDER BY t.id
              LIMIT ${Math.max(1, batchSize)}
            )
       DELETE FROM "public"."${tableName}" t
       USING to_del
       WHERE t.id = to_del.id;`,
    );

    const deletedBatch = Number(result ?? 0);
    if (deletedBatch === 0) break;

    deleted += deletedBatch;
    batch += 1;
    logger.info(`[Orphan${tableName}] Batch ${batch}: deleted ${deletedBatch} rows (total ${deleted})`);

    if (pauseMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }

  return deleted;
}

async function reindexConcurrently(indexName: string): Promise<void> {
  await prisma.$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY "public"."${indexName}";`);
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
    .option('pruneOrphanAnalysisResult', {
      type: 'boolean',
      default: false,
      description: 'Prune AnalysisResult rows for wallets with no remaining SwapAnalysisInput rows.',
    })
    .option('pruneOrphanTokenLot', {
      type: 'boolean',
      default: false,
      description: 'Prune TokenLot rows for wallets with no remaining SwapAnalysisInput rows.',
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
    .option('protectBehaviorProfiles', {
      type: 'boolean',
      default: true,
      description: 'Exclude wallets with protected behavior profile categories from global swap pruning.',
    })
    .option('protectSpeedCategories', {
      type: 'string',
      default: 'MOMENTUM,INTRADAY,DAY_TRADER,SWING,POSITION',
      description: 'Comma-separated WalletBehaviorProfile.speedCategory values to protect.',
    })
    .option('protectStrategyTypes', {
      type: 'string',
      default: 'FAST_TRADER,DAY_TRADER,SWING_TRADER,POSITION_TRADER,ACCUMULATOR',
      description: 'Comma-separated WalletBehaviorProfile.strategyType values to protect.',
    })
    .option('protectTradingStyleKeywords', {
      type: 'string',
      default: 'MOMENTUM,INTRADAY,DAY_TRADER,SWING,POSITION',
      description: 'Comma-separated case-insensitive tradingStyle keywords to protect.',
    })
    .option('protectWalletFile', {
      type: 'string',
      description: 'Path to file with wallet addresses to always protect (one per line, # comments allowed).',
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
    .option('reindexAfterCleanup', {
      type: 'boolean',
      default: false,
      description: 'Run concurrent reindex on selected large indexes after apply cleanup.',
    })
    .option('reindexLargeUniqueSwapIndex', {
      type: 'boolean',
      default: false,
      description: 'Include SwapAnalysisInput_signature_mint_direction_amount_key in reindexAfterCleanup.',
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
      `Config: pruneHelius=${argv.pruneHelius}, pruneSwapInactive=${argv.pruneSwapInactive}, pruneSwapGlobal=${argv.pruneSwapGlobal}, pruneOrphanAnalysisResult=${argv.pruneOrphanAnalysisResult}, pruneOrphanTokenLot=${argv.pruneOrphanTokenLot}, batchSize=${argv.batchSize}, maxBatches=${argv.maxBatches}`,
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
  const protectedWalletsResult = argv.pruneSwapGlobal
    ? await getProtectedWallets({
        protectFavoritedWallets: argv.protectFavoritedWallets,
        protectNotedWallets: argv.protectNotedWallets,
        protectRecentWalletDays: argv.protectRecentWalletDays,
        protectBehaviorProfiles: argv.protectBehaviorProfiles,
        protectSpeedCategories: parseCsvList(argv.protectSpeedCategories),
        protectStrategyTypes: parseCsvList(argv.protectStrategyTypes),
        protectTradingStyleKeywords: parseCsvList(argv.protectTradingStyleKeywords),
        protectWalletFile: argv.protectWalletFile,
        olderThanUnixTs: swapGlobalOlderThanUnixTs,
      })
    : { protectedWallets: [], breakdown: [] };
  const protectedWallets = protectedWalletsResult.protectedWallets;
  const swapGlobalCandidates = argv.pruneSwapGlobal
    ? await countSwapGlobalCandidates(swapGlobalOlderThanUnixTs, protectedWallets)
    : 0;
  const orphanAnalysisResultCandidates = argv.pruneOrphanAnalysisResult
    ? await countOrphanRows('AnalysisResult')
    : 0;
  const orphanTokenLotCandidates = argv.pruneOrphanTokenLot
    ? await countOrphanRows('TokenLot')
    : 0;

  const summary: PruneSummary = {
    heliusCandidates,
    swapCandidates,
    swapGlobalCandidates,
    orphanAnalysisResultCandidates,
    orphanTokenLotCandidates,
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
    ).toFixed(2)} GB logical), orphanAnalysisResultRows=${summary.orphanAnalysisResultCandidates}, orphanTokenLotRows=${summary.orphanTokenLotCandidates}`,
  );

  if (argv.pruneSwapGlobal) {
    logger.info(`Protected wallets excluded from global swap prune: ${protectedWallets.length}`);
    const totalBreakdownWallets = protectedWalletsResult.breakdown.reduce((sum, entry) => sum + entry.wallets.length, 0);
    const overlapWallets = totalBreakdownWallets - protectedWallets.length;

    if (protectedWalletsResult.breakdown.length > 0) {
      logger.info('Protection breakdown:');
      protectedWalletsResult.breakdown.forEach((entry) => {
        logger.info(
          `  - ${entry.label}: wallets=${entry.wallets.length}, oldSwapRowsProtected=${entry.oldRows}`,
        );
      });
      logger.info(
        `Protection overlap: summedWallets=${totalBreakdownWallets}, uniqueWallets=${protectedWallets.length}, overlaps=${overlapWallets}`,
      );
    }
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
  let deletedOrphanAnalysisResult = 0;
  let deletedOrphanTokenLot = 0;

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

  if (argv.pruneOrphanAnalysisResult && orphanAnalysisResultCandidates > 0) {
    deletedOrphanAnalysisResult = await pruneOrphanRowsInBatches(
      'AnalysisResult',
      argv.batchSize,
      argv.pauseMs,
      argv.maxBatches,
    );
  }

  if (argv.pruneOrphanTokenLot && orphanTokenLotCandidates > 0) {
    deletedOrphanTokenLot = await pruneOrphanRowsInBatches(
      'TokenLot',
      argv.batchSize,
      argv.pauseMs,
      argv.maxBatches,
    );
  }

  if (argv.reindexAfterCleanup) {
    const indexes = [
      'HeliusTransactionCache_timestamp_idx',
      'HeliusTransactionCache_pkey',
      'AnalysisResult_walletAddress_tokenAddress_key',
      'TokenLot_walletAddress_tokenAddress_purchaseTimestamp_idx',
      'SwapAnalysisInput_walletAddress_timestamp_idx',
      'SwapAnalysisInput_mint_idx',
    ];
    if (argv.reindexLargeUniqueSwapIndex) {
      indexes.push('SwapAnalysisInput_signature_mint_direction_amount_key');
    }
    for (const idx of indexes) {
      logger.info(`[Reindex] Starting ${idx}`);
      await reindexConcurrently(idx);
      logger.info(`[Reindex] Completed ${idx}`);
    }
  }

  logger.info(
    `Apply complete: deletedHelius=${deletedHelius}, deletedSwapInactive=${deletedSwap}, deletedSwapGlobal=${deletedSwapGlobal}, deletedOrphanAnalysisResult=${deletedOrphanAnalysisResult}, deletedOrphanTokenLot=${deletedOrphanTokenLot}, totalDeleted=${
      deletedHelius + deletedSwap + deletedSwapGlobal + deletedOrphanAnalysisResult + deletedOrphanTokenLot
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
