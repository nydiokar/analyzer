/**
 * SPEC-001 Phase 2 wallet-wallet edge materializer.
 *
 * Builds pruned wallet-wallet edges from WalletTokenEdge, then scores candidate
 * pairs with the same shared-token + synchronized-event components used by the
 * current correlation analyzer. Source tables are not modified.
 *
 * Run after spec001-materialize-wallet-token-edges.ts:
 *   npx ts-node -r tsconfig-paths/register scripts/spec001-materialize-wallet-wallet-edges.ts
 */

import { Prisma } from '@prisma/client';
import { CLUSTERING_CONFIG } from '../src/config/constants';
import { prisma } from '../src/core/services/database-service';

async function main(): Promise<void> {
  const runStartedAt = new Date();
  const excludedMints = CLUSTERING_CONFIG.excludedMints.length > 0
    ? Prisma.sql`AND "mint" NOT IN (${Prisma.join(CLUSTERING_CONFIG.excludedMints)})`
    : Prisma.empty;

  const { result, stale } = await prisma.$transaction(async (tx) => {
    const result = await tx.$executeRaw`
      WITH mint_counts AS (
        SELECT
          mint,
          COUNT(*)::int AS occurrence_count,
          ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, mint ASC)::int AS rn,
          COUNT(*) OVER ()::int AS total_mints
        FROM "SwapAnalysisInput"
        WHERE 1 = 1
        ${excludedMints}
        GROUP BY mint
      ),
      non_obvious_mints AS (
        SELECT mint
        FROM mint_counts
        WHERE rn > FLOOR(total_mints * ${CLUSTERING_CONFIG.nonObviousTokenThresholdPercent})::int
          AND occurrence_count <= ${CLUSTERING_CONFIG.minOccurrencesForPopular}
      ),
      candidate_pairs AS (
        SELECT
          LEAST(a."walletAddress", b."walletAddress") AS a,
          GREATEST(a."walletAddress", b."walletAddress") AS b,
          COUNT(DISTINCT a.mint)::int AS "sharedNonObvious"
        FROM "WalletTokenEdge" a
        JOIN "WalletTokenEdge" b
          ON b.mint = a.mint
         AND b."walletAddress" > a."walletAddress"
        JOIN non_obvious_mints n ON n.mint = a.mint
        GROUP BY 1, 2
      ),
      sync_events AS (
        SELECT
          c.a,
          c.b,
          COUNT(*)::int AS "syncEventCount"
        FROM candidate_pairs c
        JOIN "SwapAnalysisInput" sa
          ON sa."walletAddress" = c.a
        JOIN "SwapAnalysisInput" sb
          ON sb."walletAddress" = c.b
         AND sb.mint = sa.mint
         AND sb.direction = sa.direction
         AND ABS(sb.timestamp - sa.timestamp) <= ${CLUSTERING_CONFIG.syncTimeWindowSeconds}
        JOIN non_obvious_mints n ON n.mint = sa.mint
        GROUP BY c.a, c.b
      ),
      scored AS (
        SELECT
          c.a,
          c.b,
          c."sharedNonObvious",
          COALESCE(s."syncEventCount", 0)::int AS "syncEventCount",
          ROUND((
            c."sharedNonObvious" * ${CLUSTERING_CONFIG.weightSharedNonObvious}
            + COALESCE(s."syncEventCount", 0) * ${CLUSTERING_CONFIG.weightSyncEvents}
          )::numeric, 2)::float AS score
        FROM candidate_pairs c
        LEFT JOIN sync_events s ON s.a = c.a AND s.b = c.b
        WHERE c."sharedNonObvious" >= ${CLUSTERING_CONFIG.minSharedNonObviousTokens}
           OR COALESCE(s."syncEventCount", 0) >= ${CLUSTERING_CONFIG.minSyncEvents}
      )
      INSERT INTO "WalletWalletEdge" (a, b, "sharedNonObvious", "syncEventCount", score, "refreshedAt")
      SELECT a, b, "sharedNonObvious", "syncEventCount", score, ${runStartedAt}
      FROM scored
      WHERE score > 0
      ON CONFLICT (a, b) DO UPDATE SET
        "sharedNonObvious" = EXCLUDED."sharedNonObvious",
        "syncEventCount" = EXCLUDED."syncEventCount",
        score = EXCLUDED.score,
        "refreshedAt" = EXCLUDED."refreshedAt"
    `;
    const stale = await tx.walletWalletEdge.deleteMany({
      where: { refreshedAt: { lt: runStartedAt } },
    });
    return { result, stale };
  });

  console.log(JSON.stringify({ walletWalletEdgesUpsertedOrUpdated: Number(result), staleWalletWalletEdgesPruned: stale.count }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
