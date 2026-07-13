/**
 * AGENT_11 Part B — capital / outcome vector backfill.
 *
 * Mirrors spec001-backfill-wallet-vectors.ts: keyset-paginated read, compute
 * bounded source vectors from WalletPnlSummary + AdvancedTradeStats (+
 * confidenceScore for dataQuality), batched writes, PopulationStats flipped LAST
 * (portable cutover ordering — see the behavior backfill header). Additive-only.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/spec-agent11-backfill-capital-vectors.ts
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../src/core/services/database-service';
import {
  CAPITAL_VECTOR_SCHEMA_VERSION,
  buildCapitalSourceVector,
  computeCapitalDataQuality,
  computeCapitalPopulationStats,
  standardizeCapitalVector,
  capitalVectorToSqlLiteral,
} from '../src/core/representations/capital-feature-vector';

const BATCH_SIZE = 250;
const READ_PAGE_SIZE = 2000;

async function main(): Promise<void> {
  const sources: Array<{ walletAddress: string; sourceVector: number[]; dataQuality: number }> = [];
  let cursorAddress: string | null = null;
  for (;;) {
    const page = await prisma.walletPnlSummary.findMany({
      include: {
        advancedStats: true,
        wallet: { include: { behaviorProfile: true } },
      },
      orderBy: { walletAddress: 'asc' },
      take: READ_PAGE_SIZE,
      ...(cursorAddress ? { skip: 1, cursor: { walletAddress: cursorAddress } } : {}),
    });
    if (page.length === 0) break;
    for (const row of page) {
      const featureSource = {
        pnl: row,
        advancedStats: row.advancedStats ?? null,
        confidenceScore: row.wallet.behaviorProfile?.confidenceScore ?? null,
      };
      sources.push({
        walletAddress: row.walletAddress,
        sourceVector: buildCapitalSourceVector(featureSource),
        dataQuality: computeCapitalDataQuality(featureSource),
      });
    }
    cursorAddress = page[page.length - 1].walletAddress;
    if (page.length < READ_PAGE_SIZE) break;
  }

  const stats = computeCapitalPopulationStats(sources.map((row) => row.sourceVector));

  // Write vectors FIRST; flip CapitalPopulationStats LAST (window-free cutover).
  let written = 0;
  for (let i = 0; i < sources.length; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((row) => {
        const vectorLiteral = capitalVectorToSqlLiteral(standardizeCapitalVector(row.sourceVector, stats));
        const sourceVectorJson = JSON.stringify(row.sourceVector);
        return prisma.$executeRaw`
          INSERT INTO "WalletCapitalVector" ("walletAddress", "schemaVersion", "vector", "sourceVector", "dataQuality", "builtAt")
          VALUES (${row.walletAddress}, ${CAPITAL_VECTOR_SCHEMA_VERSION}, ${vectorLiteral}::vector, ${sourceVectorJson}::jsonb, ${row.dataQuality}, NOW())
          ON CONFLICT ("walletAddress") DO UPDATE SET
            "schemaVersion" = EXCLUDED."schemaVersion",
            "vector" = EXCLUDED."vector",
            "sourceVector" = EXCLUDED."sourceVector",
            "dataQuality" = EXCLUDED."dataQuality",
            "builtAt" = NOW()
        `;
      }),
    );
    written += batch.length;
    console.log(`WalletCapitalVector backfill: ${written}/${sources.length}`);
  }

  await prisma.capitalPopulationStats.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      schemaVersion: CAPITAL_VECTOR_SCHEMA_VERSION,
      means: stats.means as Prisma.InputJsonValue,
      scales: stats.scales as Prisma.InputJsonValue,
      walletCount: stats.walletCount,
    },
    update: {
      schemaVersion: CAPITAL_VECTOR_SCHEMA_VERSION,
      means: stats.means as Prisma.InputJsonValue,
      scales: stats.scales as Prisma.InputJsonValue,
      walletCount: stats.walletCount,
    },
  });

  console.log(
    JSON.stringify(
      { pnlSummaries: sources.length, vectorsWritten: written, schemaVersion: CAPITAL_VECTOR_SCHEMA_VERSION },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
