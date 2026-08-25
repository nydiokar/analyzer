/**
 * CAPHIST-1 (SPEC-003 substrate) - WalletCapitalVectorHistory backfill.
 *
 * Snapshots current AGENT_11 WalletCapitalVector rows into append-only temporal
 * history, so each wallet's capital trajectory has a t0 baseline point BEFORE the
 * next backfill. Mirrors spec002-backfill-wallet-vector-history.ts; additive and
 * idempotent on (wallet, schemaVersion, sourceVectorHash). Carries dataQuality
 * because a capital drift built on transfer-distorted PnL is not signal.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/spec003-backfill-wallet-capital-vector-history.ts
 */

import { createHash } from 'crypto';
import { prisma } from '../src/core/services/database-service';

const BATCH_SIZE = 250;

interface CurrentCapitalVectorRow {
  walletAddress: string;
  schemaVersion: number;
  vectorLiteral: string;
  sourceVector: unknown;
  dataQuality: number;
  builtAt: Date;
}

async function main(): Promise<void> {
  let lastWalletAddress: string | null = null;
  let scanned = 0;
  let inserted = 0;

  while (true) {
    const rows = lastWalletAddress
      ? await prisma.$queryRaw<CurrentCapitalVectorRow[]>`
          SELECT
            "walletAddress",
            "schemaVersion",
            "vector"::text AS "vectorLiteral",
            "sourceVector",
            "dataQuality",
            "builtAt"
          FROM "WalletCapitalVector"
          WHERE "walletAddress" > ${lastWalletAddress}
          ORDER BY "walletAddress" ASC
          LIMIT ${BATCH_SIZE}
        `
      : await prisma.$queryRaw<CurrentCapitalVectorRow[]>`
          SELECT
            "walletAddress",
            "schemaVersion",
            "vector"::text AS "vectorLiteral",
            "sourceVector",
            "dataQuality",
            "builtAt"
          FROM "WalletCapitalVector"
          ORDER BY "walletAddress" ASC
          LIMIT ${BATCH_SIZE}
        `;

    if (rows.length === 0) break;

    const insertedInBatch = await prisma.$transaction(
      rows.map((row) => {
        const sourceVectorJson = JSON.stringify(row.sourceVector);
        const sourceVectorHash = createHash('sha256')
          .update(`${row.schemaVersion}:${sourceVectorJson}`)
          .digest('hex');

        return prisma.$executeRaw`
          INSERT INTO "WalletCapitalVectorHistory" (
            "walletAddress",
            "schemaVersion",
            "vector",
            "sourceVector",
            "sourceVectorHash",
            "dataQuality",
            "driftFromPrevious",
            "sourceProfileUpdatedAt",
            "builtAt"
          )
          VALUES (
            ${row.walletAddress},
            ${row.schemaVersion},
            ${row.vectorLiteral}::vector,
            ${sourceVectorJson}::jsonb,
            ${sourceVectorHash},
            ${row.dataQuality},
            (
              -- Drift over the RAW capital source vector (population-invariant), not
              -- the standardized storage vector. Matches the live write-path and the
              -- tested computeWalletVectorDrift helper. On the t0 backfill this yields
              -- NULL (no prior row) — the correct baseline for a new trajectory.
              SELECT ("sourceVector"::text::vector <-> ${sourceVectorJson}::jsonb::text::vector)::float
              FROM "WalletCapitalVectorHistory"
              WHERE "walletAddress" = ${row.walletAddress}
                AND "schemaVersion" = ${row.schemaVersion}
              ORDER BY "builtAt" DESC, "id" DESC
              LIMIT 1
            ),
            ${row.builtAt},
            NOW()
          )
          ON CONFLICT ("walletAddress", "schemaVersion", "sourceVectorHash") DO NOTHING
        `;
      }),
    );

    scanned += rows.length;
    inserted += insertedInBatch.reduce((sum, count) => sum + count, 0);
    lastWalletAddress = rows[rows.length - 1].walletAddress;
    console.log(`WalletCapitalVectorHistory backfill: scanned=${scanned} inserted=${inserted}`);
  }

  console.log(JSON.stringify({ scanned, inserted }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
