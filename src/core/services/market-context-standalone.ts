/**
 * Standalone market context utilities — pure functions, no NestJS decorators.
 * Used by:
 *   - scripts/  (via prisma singleton from database-service.ts)
 *   - MarketContextService (imports shared logic to avoid duplication)
 */

import { PrismaClient } from '@prisma/client';

const DEFILLAMA_BASE = 'https://coins.llama.fi';
const ONE_DAY = 86400;
const MAX_SOL_PRICE_FALLBACK_DAYS = 3;

export const MCAP_BUCKETS = [
  { label: 'nano', max: 3000 },
  { label: 'ultra-micro', max: 30_000 },
  { label: 'micro', max: 100_000 },
  { label: 'small', max: 1_000_000 },
  { label: 'mid', max: 10_000_000 },
  { label: 'large', max: 100_000_000 },
  { label: 'mega', max: Infinity },
] as const;

export function classifyMcap(mcapUsd: number): string {
  for (const bucket of MCAP_BUCKETS) {
    if (mcapUsd < bucket.max) return bucket.label;
  }
  return 'mega';
}

export function timestampToDateKey(unixTimestamp: number): string {
  return new Date(unixTimestamp * 1000).toISOString().split('T')[0];
}

function dateDiffDays(dateA: string, dateB: string): number {
  return (new Date(dateA).getTime() - new Date(dateB).getTime()) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// SOL price cache
// ---------------------------------------------------------------------------

async function fetchSolPriceAtTimestamp(unixTimestamp: number): Promise<number | null> {
  const url = `${DEFILLAMA_BASE}/prices/historical/${unixTimestamp}/coingecko:solana`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`DeFiLlama returned ${res.status} for timestamp ${unixTimestamp}`);
    return null;
  }
  const data = await res.json() as { coins?: Record<string, { price?: number }> };
  return data.coins?.['coingecko:solana']?.price ?? null;
}

export async function appendTodaySolPrice(prisma: PrismaClient): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const dateKey = timestampToDateKey(now);
  const exists = await prisma.solDailyPrice.findUnique({ where: { date: dateKey } });
  if (exists) return;
  const price = await fetchSolPriceAtTimestamp(now);
  if (price !== null) {
    await prisma.solDailyPrice.create({ data: { date: dateKey, priceUsd: price } });
    console.log(`Appended SOL price for ${dateKey}: $${price.toFixed(2)}`);
  }
}

export async function backfillSolPrices(prisma: PrismaClient, lookbackDays = 90): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  let inserted = 0;

  const existing = await prisma.solDailyPrice.findMany({ select: { date: true } });
  const existingDates = new Set(existing.map(r => r.date));

  for (let i = 0; i < lookbackDays; i++) {
    const dayTimestamp = now - i * ONE_DAY;
    const dateKey = timestampToDateKey(dayTimestamp);
    if (existingDates.has(dateKey)) continue;

    const price = await fetchSolPriceAtTimestamp(dayTimestamp);
    if (price !== null) {
      await prisma.solDailyPrice.upsert({
        where: { date: dateKey },
        update: { priceUsd: price },
        create: { date: dateKey, priceUsd: price },
      });
      inserted++;
      console.log(`  SOL ${dateKey}: $${price.toFixed(2)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`SOL price cache: inserted ${inserted} new days.`);
  return inserted;
}

async function ensureSolPriceCoverage(
  prisma: PrismaClient,
  unixTimestamps: number[],
): Promise<void> {
  if (unixTimestamps.length === 0) return;

  const oldestTimestamp = Math.min(...unixTimestamps);
  const oldestNeededDate = timestampToDateKey(oldestTimestamp);
  const oldestCached = await prisma.solDailyPrice.findFirst({
    orderBy: { date: 'asc' },
    select: { date: true },
  });

  if (oldestCached && oldestCached.date <= oldestNeededDate) {
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const lookbackDays = Math.ceil((now - oldestTimestamp) / ONE_DAY) + MAX_SOL_PRICE_FALLBACK_DAYS;
  console.log(
    `[SOL] Cache coverage missing for ${oldestNeededDate}. Backfilling ${lookbackDays} day(s) before enrichment...`,
  );
  await backfillSolPrices(prisma, lookbackDays);
}

/**
 * Bulk-load SOL prices for a set of unix timestamps. One DB query,
 * nearest-day fallback within ±3 days. Avoids N+1 in batch loops.
 */
export async function buildSolPriceMap(
  prisma: PrismaClient,
  unixTimestamps: number[],
): Promise<Map<string, number>> {
  if (unixTimestamps.length === 0) return new Map();

  await ensureSolPriceCoverage(prisma, unixTimestamps);

  const dateKeys = [...new Set(unixTimestamps.map(timestampToDateKey))];
  const allTimes = unixTimestamps.map(t => t * 1000);
  const minDate = new Date(Math.min(...allTimes) - MAX_SOL_PRICE_FALLBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const maxDate = new Date(Math.max(...allTimes) + MAX_SOL_PRICE_FALLBACK_DAYS * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const rows = await prisma.solDailyPrice.findMany({
    where: { date: { gte: minDate, lte: maxDate } },
  });

  const dbMap = new Map(rows.map(r => [r.date, r.priceUsd]));
  const result = new Map<string, number>();

  for (const dateKey of dateKeys) {
    if (dbMap.has(dateKey)) {
      result.set(dateKey, dbMap.get(dateKey)!);
      continue;
    }
    let best: { date: string; priceUsd: number } | null = null;
    let bestDist = Infinity;
    for (const row of rows) {
      const dist = Math.abs(dateDiffDays(row.date, dateKey));
      if (dist < bestDist) { bestDist = dist; best = row; }
    }
    if (best && bestDist <= MAX_SOL_PRICE_FALLBACK_DAYS) {
      result.set(dateKey, best.priceUsd);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Token supply — reads from TokenInfo.totalSupply (DB persistent cache).
// Scripts use this directly. No raw RPC calls from scripts.
// ---------------------------------------------------------------------------

/**
 * Bulk-load token supplies from TokenInfo rows.
 * Returns only mints that have totalSupply already persisted.
 * Missing mints are logged — run the app once to populate them via TokenInfoService.
 */
export async function buildSupplyMap(
  prisma: PrismaClient,
  mints: string[],
): Promise<Map<string, number>> {
  if (mints.length === 0) return new Map();

  const uniqueMints = [...new Set(mints)];
  const rows = await prisma.tokenInfo.findMany({
    where: { tokenAddress: { in: uniqueMints }, totalSupply: { not: null } },
    select: { tokenAddress: true, totalSupply: true },
  });

  const result = new Map<string, number>();
  for (const row of rows) {
    if (row.totalSupply != null) result.set(row.tokenAddress, row.totalSupply);
  }

  const missing = uniqueMints.length - result.size;
  if (missing > 0) {
    console.warn(`[Supply] ${missing} mints have no cached supply in TokenInfo — marketCap will be null for those rows.`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Enrichment engine — for standalone scripts
// ---------------------------------------------------------------------------

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export async function enrichSwapBatch(
  prisma: PrismaClient,
  batchSize = 500,
  walletAddress?: string,
): Promise<number> {
  await prisma.swapAnalysisInput.updateMany({
    where: { enrichedAt: null, mint: SOL_MINT, ...(walletAddress ? { walletAddress } : {}) },
    data: { enrichedAt: new Date() },
  });

  const rows = await prisma.swapAnalysisInput.findMany({
    where: { enrichedAt: null, NOT: { mint: SOL_MINT }, ...(walletAddress ? { walletAddress } : {}) },
    orderBy: { timestamp: 'desc' },
    take: batchSize,
  });

  if (rows.length === 0) {
    console.log('No un-enriched swaps found.');
    return 0;
  }

  console.log(`Enriching ${rows.length} swap records...`);

  const uniqueMints = [...new Set(rows.map(r => r.mint))];

  const [solPriceMap, supplyMap] = await Promise.all([
    buildSolPriceMap(prisma, rows.map(r => r.timestamp)),
    buildSupplyMap(prisma, uniqueMints),
  ]);

  let enriched = 0;
  let skipped = 0;
  let deferred = 0;

  const now = new Date();
  type UpdatePayload = { solPriceUsd: number | null; usdValue: number; tokenPriceUsd: number; marketCapUsd: number | null; mcapBucket: string | null };
  const enrichUpdates = new Map<number, UpdatePayload>();
  const skipIds: number[] = [];

  for (const row of rows) {
    const dateKey = timestampToDateKey(row.timestamp);
    const solPriceUsd = solPriceMap.get(dateKey) ?? null;

    if (row.amount <= 0) {
      skipIds.push(row.id);
      skipped++;
      continue;
    }

    let usdValue: number | null = null;
    if (row.associatedSolValue > 0 && solPriceUsd) {
      usdValue = row.associatedSolValue * solPriceUsd;
    } else if (row.associatedUsdcValue && row.associatedUsdcValue > 0) {
      usdValue = row.associatedUsdcValue;
    }

    if (usdValue === null) {
      if (row.associatedSolValue > 0 && solPriceUsd === null) {
        deferred++;
        continue;
      }
      skipIds.push(row.id);
      skipped++;
      continue;
    }

    const tokenPriceUsd = usdValue / row.amount;
    const totalSupply = supplyMap.get(row.mint) ?? null;
    const marketCapUsd = totalSupply !== null ? tokenPriceUsd * totalSupply : null;
    const mcapBucket = marketCapUsd !== null ? classifyMcap(marketCapUsd) : null;
    enrichUpdates.set(row.id, { solPriceUsd, usdValue, tokenPriceUsd, marketCapUsd, mcapBucket });
    enriched++;
  }

  // Batch writes: skips (updateMany by ids), enriched (individual but in parallel chunks)
  if (skipIds.length > 0) {
    await prisma.swapAnalysisInput.updateMany({
      where: { id: { in: skipIds } },
      data: { enrichedAt: now },
    });
  }

  if (enrichUpdates.size > 0) {
    const CHUNK = 50;
    const entries = [...enrichUpdates.entries()];
    for (let i = 0; i < entries.length; i += CHUNK) {
      await Promise.all(
        entries.slice(i, i + CHUNK).map(([id, data]) =>
          prisma.swapAnalysisInput.update({ where: { id }, data: { ...data, enrichedAt: now } }),
        ),
      );
    }
  }

  const errors = rows.length - enriched - skipped - deferred;
  console.log(
    `Enriched: ${enriched} | Skipped (permanent): ${skipped} | Deferred (retry later): ${deferred} | Transient errors: ${errors}`,
  );
  return enriched + skipped;
}

export async function enrichAll(prisma: PrismaClient, batchSize = 500): Promise<number> {
  let totalProcessed = 0;
  let batchResult: number;
  do {
    batchResult = await enrichSwapBatch(prisma, batchSize);
    totalProcessed += batchResult;
    if (batchResult > 0) await new Promise(r => setTimeout(r, 100));
  } while (batchResult > 0);

  console.log(`\nTotal processed: ${totalProcessed} swap records.`);
  return totalProcessed;
}

// ---------------------------------------------------------------------------
// Sanity check (dev/validation tool)
// ---------------------------------------------------------------------------

export async function runSanityCheck(prisma: PrismaClient): Promise<void> {
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;

  const recentEnriched = await prisma.swapAnalysisInput.findMany({
    where: {
      enrichedAt: { not: null },
      timestamp: { gte: oneDayAgo },
      tokenPriceUsd: { not: null },
    },
    take: 50,
    orderBy: { timestamp: 'desc' },
  });

  if (recentEnriched.length === 0) {
    console.log('No recent enriched transactions to validate.');
    return;
  }

  console.log('=== SANITY CHECK: Derived vs DexScreener ===\n');

  let matches = 0;
  let mismatches = 0;
  let noReference = 0;

  for (const tx of recentEnriched) {
    const tokenInfo = await prisma.tokenInfo.findUnique({ where: { tokenAddress: tx.mint } });

    if (!tokenInfo?.priceUsd) {
      noReference++;
      continue;
    }

    const dexPrice = parseFloat(tokenInfo.priceUsd);
    const derivedPrice = tx.tokenPriceUsd!;
    const variance = Math.abs(derivedPrice - dexPrice) / dexPrice;

    if (variance < 0.25) {
      matches++;
    } else {
      mismatches++;
      console.log(
        `  MISMATCH | ${tx.mint.slice(0, 12)}... | ` +
        `Derived: $${derivedPrice.toExponential(3)} | ` +
        `DexScreener: $${dexPrice.toExponential(3)} | ` +
        `Variance: ${(variance * 100).toFixed(1)}%`,
      );
    }
  }

  console.log(`\nResults: ${matches} OK | ${mismatches} mismatch | ${noReference} no reference`);
  console.log(
    mismatches === 0
      ? 'All checks passed.'
      : 'Some mismatches — check USDC-routed swaps or multi-hop Jupiter routes.',
  );
}
