/**
 * SPEC-001 Phase 2 wallet-wallet edge materializer — VECTOR-FIRST (SPEC001_T06).
 *
 * Replaces the original O(n²) correlation self-join (candidate_pairs self-joined
 * WalletTokenEdge on shared mints, then SwapAnalysisInput self-joined per pair for
 * sync-events). On real data that scan was killed after 8+ minutes (SPEC_T05 §4).
 *
 * This version is vector-first: candidate pairs are generated from each wallet's
 * behavioral k-NN neighborhood via the HNSW index, so every expensive step is
 * bounded to <=k candidates per seed instead of the full pair space. Scoring is
 * kept COMPATIBLE with the old score so the cluster materializer's
 * `minClusterScoreThreshold` still means the same thing:
 *
 *   sharedNonObvious = # of non-obvious tokens both wallets traded (from WalletTokenEdge)
 *   syncEventCount   = 0 in this fast pass (the SwapAnalysisInput timestamp self-join
 *                      is the exact 14.9M-row cost SPEC-001 removed; left as a deferred
 *                      deep pass, never the default)
 *   score            = sharedNonObvious * weightSharedNonObvious   (same formula)
 *
 * Recall tradeoff (documented, intentional): k-NN candidate generation only surfaces
 * coordination between BEHAVIORALLY SIMILAR wallets. Coordinated wallets with divergent
 * behavioral vectors are not candidates. The practical alternative is not the all-pairs
 * scan (non-viable on real data) but nothing; this is the shippable bounded version.
 *
 * Cost on the real-data copy (~64k vectors): one set-based statement per seed batch,
 * HNSW-backed LATERAL k-NN, ~minutes total. Additive/upsert-only; source tables
 * (SwapAnalysisInput) are never modified.
 *
 * Run after spec001-materialize-wallet-token-edges.ts:
 *   npx ts-node -r tsconfig-paths/register scripts/spec001-materialize-wallet-wallet-edges.ts
 */

import { Prisma } from '@prisma/client';
import { CLUSTERING_CONFIG } from '../src/config/constants';
import { WALLET_VECTOR_SCHEMA_VERSION } from '../src/core/representations/wallet-feature-vector';
import { prisma } from '../src/core/services/database-service';

// k-NN fan-out per seed. Bounds the candidate pair space to seeds * K.
const NEIGHBORS_PER_SEED = 20;
// ef_search must be >= K for HNSW to return a full candidate set.
const EF_SEARCH = 100;
// Seed batch size per transaction; keeps each statement bounded and survivable.
const SEED_BATCH_SIZE = 2_000;

async function main(): Promise<void> {
  const runStartedAt = new Date();
  const excludedMints = CLUSTERING_CONFIG.excludedMints.length > 0
    ? Prisma.sql`AND "mint" NOT IN (${Prisma.join(CLUSTERING_CONFIG.excludedMints)})`
    : Prisma.empty;

  let lastSeed = '';
  let totalUpserted = 0;
  let batches = 0;

  // Keyset-paginate the seed scan by walletAddress so memory and per-transaction
  // work stay bounded regardless of vector count. The seed addresses for each batch
  // are read first (cheap, indexed) and drive both the statement and the cursor, so
  // there is no second-query desync.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const seedBatch = await prisma.walletVector.findMany({
      where: { schemaVersion: WALLET_VECTOR_SCHEMA_VERSION, walletAddress: { gt: lastSeed } },
      orderBy: { walletAddress: 'asc' },
      take: SEED_BATCH_SIZE,
      select: { walletAddress: true },
    });
    if (seedBatch.length === 0) break;
    const seedAddresses = seedBatch.map((s) => s.walletAddress);

    const upserted = await prisma.$transaction(async (tx) => {
      return tx.$executeRaw`
        WITH seeds AS (
          SELECT "walletAddress", "vector"
          FROM "WalletVector"
          WHERE "schemaVersion" = ${WALLET_VECTOR_SCHEMA_VERSION}
            AND "walletAddress" IN (${Prisma.join(seedAddresses)})
        ),
        set_ef AS (
          SELECT set_config('hnsw.ef_search', ${String(EF_SEARCH)}, true)
        ),
        knn AS (
          SELECT s."walletAddress" AS seed, nn."walletAddress" AS neighbor
          FROM seeds s, set_ef
          CROSS JOIN LATERAL (
            SELECT v."walletAddress"
            FROM "WalletVector" v
            WHERE v."schemaVersion" = ${WALLET_VECTOR_SCHEMA_VERSION}
              AND v."walletAddress" <> s."walletAddress"
            ORDER BY v."vector" <=> s."vector"
            LIMIT ${NEIGHBORS_PER_SEED}
          ) nn
        ),
        -- Canonical unordered pair (a < b). A pair can appear from either endpoint's
        -- neighborhood; DISTINCT collapses those into one edge.
        pairs AS (
          SELECT DISTINCT
            LEAST(seed, neighbor) AS a,
            GREATEST(seed, neighbor) AS b
          FROM knn
        ),
        -- Non-obvious mints: rare enough to be a coordination signal, matching the
        -- original correlation analyzer's definition (bottom bucket + capped occurrences).
        mint_counts AS (
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
        scored AS (
          SELECT
            p.a,
            p.b,
            COUNT(DISTINCT ea.mint)::int AS "sharedNonObvious"
          FROM pairs p
          JOIN "WalletTokenEdge" ea ON ea."walletAddress" = p.a
          JOIN "WalletTokenEdge" eb ON eb."walletAddress" = p.b AND eb.mint = ea.mint
          JOIN non_obvious_mints n ON n.mint = ea.mint
          GROUP BY p.a, p.b
        )
        INSERT INTO "WalletWalletEdge" (a, b, "sharedNonObvious", "syncEventCount", score, "refreshedAt")
        SELECT
          a,
          b,
          "sharedNonObvious",
          0 AS "syncEventCount",
          ROUND(("sharedNonObvious" * ${CLUSTERING_CONFIG.weightSharedNonObvious})::numeric, 2)::float AS score,
          ${runStartedAt}
        FROM scored
        WHERE "sharedNonObvious" >= ${CLUSTERING_CONFIG.minSharedNonObviousTokens}
        ON CONFLICT (a, b) DO UPDATE SET
          "sharedNonObvious" = EXCLUDED."sharedNonObvious",
          "syncEventCount" = EXCLUDED."syncEventCount",
          score = EXCLUDED.score,
          "refreshedAt" = EXCLUDED."refreshedAt"
      `;
    }, {
      // HNSW-backed LATERAL k-NN over a seed batch + bounded non-obvious-token
      // scoring; far under the old all-pairs cost but still beyond the 5s default.
      maxWait: 60_000,
      timeout: 600_000,
    });

    totalUpserted += Number(upserted);
    batches += 1;

    // Advance the keyset cursor to the last seed we just processed.
    lastSeed = seedAddresses[seedAddresses.length - 1];
    if (seedBatch.length < SEED_BATCH_SIZE) break;
  }

  // Prune edges not refreshed by this run (wallets whose neighborhoods changed).
  const stale = await prisma.walletWalletEdge.deleteMany({
    where: { refreshedAt: { lt: runStartedAt } },
  });

  // Distinct edge count. `totalUpserted` counts affected rows including cross-batch
  // ON CONFLICT re-touches of the same canonical (a,b) pair, so it over-counts;
  // the table row count is the true number of distinct edges.
  const distinctEdges = await prisma.walletWalletEdge.count();

  console.log(JSON.stringify({
    seedBatches: batches,
    distinctWalletWalletEdges: distinctEdges,
    affectedRowEvents: totalUpserted,
    staleWalletWalletEdgesPruned: stale.count,
    neighborsPerSeed: NEIGHBORS_PER_SEED,
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
