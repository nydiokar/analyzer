/**
 * SPEC-001 Gate-0 ledger (READ-ONLY).
 *
 * Measures local/server DB size and projection budget inputs before large
 * backfills. This script writes nothing.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/spec001-gate0-ledger.ts
 */

import { prisma } from '../src/core/services/database-service';

async function main(): Promise<void> {
  const [
    walletCount,
    swapRows,
    distinctMints,
    behaviorProfiles,
    advancedStats,
    nonObvious,
    walletTokenProjection,
    labelCounts,
  ] = await Promise.all([
    prisma.wallet.count(),
    prisma.swapAnalysisInput.count(),
    countDistinctMints(),
    prisma.walletBehaviorProfile.count(),
    prisma.advancedTradeStats.count(),
    countNonObviousMints(),
    countWalletTokenProjection(),
    prisma.radarHolding.groupBy({ by: ['reviewStatus'], _count: { _all: true } }),
  ]);

  const vectorBytes = behaviorProfiles * 64 * 4;
  const out = {
    walletCount,
    swapAnalysisInputRows: swapRows,
    distinctMints,
    behaviorProfiles,
    advancedStats,
    nonObviousMintCount: nonObvious,
    projectedWalletVectorRows: behaviorProfiles,
    projectedWalletVectorBytes: vectorBytes,
    projectedWalletTokenEdgeRows: walletTokenProjection,
    projectedWalletWalletEdgeRows: 'run SPEC-001 Phase 2 pruned edge materializer dry-run after WalletTokenEdge exists',
    radarHoldingByStatus: labelCounts.map((row) => ({ status: row.reviewStatus, count: row._count._all })),
  };

  console.log(JSON.stringify(out, null, 2));
}

async function countNonObviousMints(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    WITH mint_counts AS (
      SELECT mint, COUNT(DISTINCT "walletAddress")::int AS wallet_count
      FROM "SwapAnalysisInput"
      GROUP BY mint
    ),
    ranked AS (
      SELECT wallet_count, percent_rank() OVER (ORDER BY wallet_count) AS pct
      FROM mint_counts
    )
    SELECT COUNT(*)::bigint AS count
    FROM ranked
    WHERE pct < 0.95
  `;
  return Number(rows[0]?.count ?? 0);
}

async function countDistinctMints(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(DISTINCT mint)::bigint AS count
    FROM "SwapAnalysisInput"
  `;
  return Number(rows[0]?.count ?? 0);
}

async function countWalletTokenProjection(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM (
      SELECT "walletAddress", mint
      FROM "SwapAnalysisInput"
      GROUP BY "walletAddress", mint
    ) t
  `;
  return Number(rows[0]?.count ?? 0);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
