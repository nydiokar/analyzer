/**
 * SPEC-001 Phase 1 vector backfill.
 *
 * Computes source vectors from WalletBehaviorProfile + AdvancedTradeStats,
 * upserts standardized pgvector rows, then flips the PopulationStats singleton
 * to the current schema version LAST. Additive-only: writes WalletVector and
 * PopulationStats.
 *
 * CUTOVER ORDERING (portable to the live/production DB — read this):
 *   `WalletVector` has ONE row per wallet (PK walletAddress, ON CONFLICT), so a
 *   row cannot hold the old and new schema at once — an in-place backfill replaces
 *   old->new per wallet as it goes. There is therefore a bounded window during
 *   which readers filtering the NEW schemaVersion see a partially-populated table.
 *   The exact same instrumentation ports to production unchanged; run it like so:
 *
 *     1. Run this script FIRST, before deploying the new-schema code. Compute uses
 *        the new schema's means/scales, but PopulationStats is flipped to the new
 *        version only at the very END (below), so the live write-path (which gates
 *        on PopulationStats.schemaVersion == code const) does NOT start emitting
 *        half-populated new-schema vectors mid-run.
 *     2. Each row swaps old->new ATOMICALLY via ON CONFLICT (always exactly one
 *        readable row). Safe to interrupt/resume: compute is deterministic and the
 *        upsert is idempotent, so a re-run just re-writes identical rows.
 *     3. Deploy the new-schema code LAST. By then every wallet already has its
 *        new-schema row, so the deployed reader sees a fully-populated table
 *        immediately -> the switch is effectively instant.
 *
 *   The only unavoidable window is between the FIRST row rewritten here and the
 *   deploy: a reader already on the new const would see rows appear incrementally.
 *   Because the deploy happens AFTER this completes, no such reader exists yet, so
 *   in practice the window is invisible. A truly zero-window prod cutover (if ever
 *   needed) is the shadow-table path: build WalletVector_v<n> alongside, then
 *   atomic rename — not built, because this ordering already gives a clean switch.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/spec001-backfill-wallet-vectors.ts
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../src/core/services/database-service';
import {
  WALLET_VECTOR_SCHEMA_VERSION,
  buildWalletSourceVector,
  computePopulationStats,
  standardizeWalletVector,
  vectorToSqlLiteral,
} from '../src/core/representations/wallet-feature-vector';

const BATCH_SIZE = 250;
const READ_PAGE_SIZE = 2000;

async function main(): Promise<void> {
  // Keyset-paginate the read. A single unbounded findMany over the full profile
  // population (~64k rows on production data) exceeds the Prisma query-engine
  // response buffer and fails with "Failed to convert rust String into napi
  // string"; paging by walletAddress keeps each response bounded. Population
  // stats still require every source vector, but those are tiny in memory.
  const sources: Array<{ walletAddress: string; sourceVector: number[] }> = [];
  let cursorAddress: string | null = null;
  for (;;) {
    const page = await prisma.walletBehaviorProfile.findMany({
      include: {
        wallet: {
          include: {
            pnlSummary: {
              include: { advancedStats: true },
            },
          },
        },
      },
      orderBy: { walletAddress: 'asc' },
      take: READ_PAGE_SIZE,
      ...(cursorAddress
        ? { skip: 1, cursor: { walletAddress: cursorAddress } }
        : {}),
    });
    if (page.length === 0) {
      break;
    }
    for (const row of page) {
      sources.push({
        walletAddress: row.walletAddress,
        sourceVector: buildWalletSourceVector({
          behavior: row,
          advancedStats: row.wallet.pnlSummary?.advancedStats ?? null,
        }),
      });
    }
    cursorAddress = page[page.length - 1].walletAddress;
    if (page.length < READ_PAGE_SIZE) {
      break;
    }
  }
  const stats = computePopulationStats(sources.map((row) => row.sourceVector));

  // Write every vector FIRST (see cutover ordering in the file header). Compute
  // uses the new-schema means/scales; PopulationStats is flipped only after all
  // rows land, so the live write-path never emits half-populated vectors mid-run.
  let written = 0;
  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((row) => {
        const vectorLiteral = vectorToSqlLiteral(standardizeWalletVector(row.sourceVector, stats));
        const sourceVectorJson = JSON.stringify(row.sourceVector);
        return prisma.$executeRaw`
          INSERT INTO "WalletVector" ("walletAddress", "schemaVersion", "vector", "sourceVector", "builtAt")
          VALUES (${row.walletAddress}, ${WALLET_VECTOR_SCHEMA_VERSION}, ${vectorLiteral}::vector, ${sourceVectorJson}::jsonb, NOW())
          ON CONFLICT ("walletAddress") DO UPDATE SET
            "schemaVersion" = EXCLUDED."schemaVersion",
            "vector" = EXCLUDED."vector",
            "sourceVector" = EXCLUDED."sourceVector",
            "builtAt" = NOW()
        `;
      }),
    );
    written += batch.length;
    console.log(`WalletVector backfill: ${written}/${sources.length}`);
  }

  // Flip PopulationStats LAST — now that every wallet has its new-schema row.
  await prisma.populationStats.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      schemaVersion: WALLET_VECTOR_SCHEMA_VERSION,
      means: stats.means as Prisma.InputJsonValue,
      scales: stats.scales as Prisma.InputJsonValue,
      walletCount: stats.walletCount,
    },
    update: {
      schemaVersion: WALLET_VECTOR_SCHEMA_VERSION,
      means: stats.means as Prisma.InputJsonValue,
      scales: stats.scales as Prisma.InputJsonValue,
      walletCount: stats.walletCount,
    },
  });

  console.log(JSON.stringify({ walletProfiles: sources.length, vectorsWritten: written, schemaVersion: WALLET_VECTOR_SCHEMA_VERSION }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
