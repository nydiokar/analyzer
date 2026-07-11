/**
 * SPEC-001 Phase 1 vector backfill.
 *
 * Computes source vectors from WalletBehaviorProfile + AdvancedTradeStats,
 * writes PopulationStats singleton, then upserts standardized pgvector rows.
 * Additive-only: writes WalletVector and PopulationStats.
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

  console.log(JSON.stringify({ walletProfiles: sources.length, vectorsWritten: written, schemaVersion: WALLET_VECTOR_SCHEMA_VERSION }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
