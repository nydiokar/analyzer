/**
 * SPEC-001 Phase 2 wallet-token edge materializer.
 *
 * Additive/upsert-only projection from SwapAnalysisInput into WalletTokenEdge.
 * This is the mint-first graph substrate used before wallet-wallet edges.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/spec001-materialize-wallet-token-edges.ts
 */

import { prisma } from '../src/core/services/database-service';

async function main(): Promise<void> {
  const runStartedAt = new Date();
  const { result, stale } = await prisma.$transaction(async (tx) => {
    const result = await tx.$executeRaw`
      WITH wallet_buy_totals AS (
        SELECT
          "walletAddress",
          SUM(GREATEST("associatedSolValue", 0)) FILTER (WHERE direction = 'buy') AS total_buy_sol
        FROM "SwapAnalysisInput"
        GROUP BY "walletAddress"
      ),
      edges AS (
        SELECT
          s."walletAddress",
          s.mint,
          CASE
            WHEN COALESCE(t.total_buy_sol, 0) > 0
              THEN COALESCE(SUM(GREATEST(s."associatedSolValue", 0)) FILTER (WHERE s.direction = 'buy'), 0) / t.total_buy_sol
            ELSE 0
          END AS "buyWeight",
          COUNT(*) FILTER (WHERE s.direction = 'buy')::int AS "buyCount",
          COUNT(*) FILTER (WHERE s.direction = 'sell')::int AS "sellCount",
          COUNT(*)::int AS "tradeCount",
          MIN(s.timestamp)::int AS "firstTs",
          MAX(s.timestamp)::int AS "lastTs"
        FROM "SwapAnalysisInput" s
        LEFT JOIN wallet_buy_totals t ON t."walletAddress" = s."walletAddress"
        GROUP BY s."walletAddress", s.mint, t.total_buy_sol
      )
      INSERT INTO "WalletTokenEdge" (
        "walletAddress", mint, "buyWeight", "buyCount", "sellCount", "tradeCount", "firstTs", "lastTs", "refreshedAt"
      )
      SELECT "walletAddress", mint, "buyWeight", "buyCount", "sellCount", "tradeCount", "firstTs", "lastTs", ${runStartedAt}
      FROM edges
      ON CONFLICT ("walletAddress", mint) DO UPDATE SET
        "buyWeight" = EXCLUDED."buyWeight",
        "buyCount" = EXCLUDED."buyCount",
        "sellCount" = EXCLUDED."sellCount",
        "tradeCount" = EXCLUDED."tradeCount",
        "firstTs" = EXCLUDED."firstTs",
        "lastTs" = EXCLUDED."lastTs",
        "refreshedAt" = EXCLUDED."refreshedAt"
    `;
    const stale = await tx.walletTokenEdge.deleteMany({
      where: { refreshedAt: { lt: runStartedAt } },
    });
    return { result, stale };
  });

  console.log(JSON.stringify({ walletTokenEdgesUpsertedOrUpdated: Number(result), staleWalletTokenEdgesPruned: stale.count }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
