/**
 * KOL Import Script
 *
 * Reads .ai/context/KOL_proj/kol_top_470_cleaned.json and upserts:
 *   1. Wallet row with knownType='KOL' and knownLabel=name
 *   2. KolProfile row with name, twitter, telegram
 *
 * No analysis is triggered. Safe to run multiple times (idempotent).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/import-kols.ts
 *   -- or --
 *   pnpm tsx src/scripts/import-kols.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

interface KolEntry {
  wallet_address: string;
  name: string;
  twitter: string | null;
  telegram: string | null;
}

interface KolFile {
  data: KolEntry[];
}

async function main() {
  const filePath = path.resolve(
    process.cwd(),
    '.ai/context/KOL_proj/kol_top_470_cleaned.json',
  );

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed: KolFile = JSON.parse(raw);
  const entries = parsed.data;

  console.log(`Loaded ${entries.length} KOL entries from file`);

  const prisma = new PrismaClient();

  let walletUpserted = 0;
  let kolUpserted = 0;
  let skipped = 0;

  try {
    for (const entry of entries) {
      const { wallet_address, name, twitter, telegram } = entry;

      if (!wallet_address || !name) {
        console.warn(`Skipping entry with missing wallet_address or name:`, entry);
        skipped++;
        continue;
      }

      // Both upserts in a single transaction — avoids partial state if interrupted
      await prisma.$transaction([
        // 1. Upsert Wallet row — knownType='KOL', knownLabel=name
        //    Do NOT set classification='SYSTEM' — KOLs are analyzed normally.
        prisma.wallet.upsert({
          where: { address: wallet_address },
          create: {
            address: wallet_address,
            knownType: 'KOL',
            knownLabel: name,
            classification: 'unknown',
          },
          update: {
            knownType: 'KOL',
            knownLabel: name,
            // Preserve existing classification (may have analysis data from before)
          },
        }),
        // 2. Upsert KolProfile row
        prisma.kolProfile.upsert({
          where: { walletAddress: wallet_address },
          create: {
            walletAddress: wallet_address,
            name,
            twitter: twitter ?? null,
            telegram: telegram ?? null,
          },
          update: {
            name,
            twitter: twitter ?? null,
            telegram: telegram ?? null,
          },
        }),
      ]);

      walletUpserted++;
      kolUpserted++;

      if (kolUpserted % 50 === 0) {
        console.log(`  Progress: ${kolUpserted}/${entries.length}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n=== Import complete ===');
  console.log(`  Wallet rows upserted : ${walletUpserted}`);
  console.log(`  KolProfile rows      : ${kolUpserted}`);
  console.log(`  Skipped              : ${skipped}`);
  console.log('\nKOL wallets are tagged with knownType=KOL and will be:');
  console.log('  - Analyzed normally (NOT skipped by any pipeline)');
  console.log('  - Labelled with their real name in all API responses');
  console.log('  - Synced via helius-sync-service like any other trader');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
