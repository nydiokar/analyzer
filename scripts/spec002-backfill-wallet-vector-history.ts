/**
 * SPEC002_T01 - WalletVectorHistory backfill.
 *
 * Snapshots current SPEC-001 WalletVector rows into append-only temporal history.
 * Additive and idempotent: existing (wallet, schemaVersion, sourceVectorHash) rows
 * are left untouched.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/spec002-backfill-wallet-vector-history.ts
 */

import { createHash } from 'crypto';
import { prisma } from '../src/core/services/database-service';

const BATCH_SIZE = 250;

interface CurrentWalletVectorRow {
  walletAddress: string;
  schemaVersion: number;
  vectorLiteral: string;
  sourceVector: unknown;
  builtAt: Date;
}

async function main(): Promise<void> {
  let lastWalletAddress: string | null = null;
  let scanned = 0;
  let inserted = 0;

  while (true) {
    const rows = lastWalletAddress
      ? await prisma.$queryRaw<CurrentWalletVectorRow[]>`
          SELECT
            "walletAddress",
            "schemaVersion",
            "vector"::text AS "vectorLiteral",
            "sourceVector",
            "builtAt"
          FROM "WalletVector"
          WHERE "walletAddress" > ${lastWalletAddress}
          ORDER BY "walletAddress" ASC
          LIMIT ${BATCH_SIZE}
        `
      : await prisma.$queryRaw<CurrentWalletVectorRow[]>`
          SELECT
            "walletAddress",
            "schemaVersion",
            "vector"::text AS "vectorLiteral",
            "sourceVector",
            "builtAt"
          FROM "WalletVector"
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
          INSERT INTO "WalletVectorHistory" (
            "walletAddress",
            "schemaVersion",
            "vector",
            "sourceVector",
            "sourceVectorHash",
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
            (
              -- Drift over the RAW behavioral source vector (population-invariant),
              -- not the standardized storage vector. Matches the live write-path
              -- and the tested computeWalletVectorDrift helper. jsonb::text::vector
              -- reuses pgvector's euclidean operator without a numeric-array UDF.
              SELECT ("sourceVector"::text::vector <-> ${sourceVectorJson}::jsonb::text::vector)::float
              FROM "WalletVectorHistory"
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
    console.log(`WalletVectorHistory backfill: scanned=${scanned} inserted=${inserted}`);
  }

  console.log(JSON.stringify({ scanned, inserted }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });