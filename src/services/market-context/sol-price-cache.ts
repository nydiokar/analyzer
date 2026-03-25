import { PrismaClient } from "@prisma/client";

const DEFILLAMA_BASE = "https://coins.llama.fi";
const ONE_DAY = 86400;

/**
 * Fetch SOL/USD price at a specific unix timestamp from DeFiLlama.
 * FREE — no API key needed.
 */
export async function fetchSolPriceAtTimestamp(
  unixTimestamp: number
): Promise<number | null> {
  const url = `${DEFILLAMA_BASE}/prices/historical/${unixTimestamp}/coingecko:solana`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`DeFiLlama returned ${res.status} for timestamp ${unixTimestamp}`);
    return null;
  }

  const data = await res.json() as { coins?: Record<string, { price?: number }> };
  return data.coins?.["coingecko:solana"]?.price ?? null;
}

/**
 * Backfill SOL daily prices for the last N days.
 * Skips dates that already exist in the database.
 */
export async function backfillSolPrices(
  prisma: PrismaClient,
  lookbackDays: number = 90
): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  let inserted = 0;

  // Get existing dates to skip them — one query, not per-day
  const existing = await prisma.solDailyPrice.findMany({
    select: { date: true },
  });
  const existingDates = new Set(existing.map((r) => r.date));

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

    // Respect the free API — 200ms delay
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`SOL price cache: inserted ${inserted} new days.`);
  return inserted;
}

/**
 * Append today's SOL price. Call on startup or via daily cron.
 *
 * NOTE: If you are inside the NestJS app, prefer calling
 * `TokenInfoService.getSolPrice()` for the live price and only use
 * this function to persist a daily snapshot to `SolDailyPrice`.
 */
export async function appendTodaySolPrice(
  prisma: PrismaClient
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const dateKey = timestampToDateKey(now);

  const exists = await prisma.solDailyPrice.findUnique({
    where: { date: dateKey },
  });
  if (exists) return;

  const price = await fetchSolPriceAtTimestamp(now);
  if (price !== null) {
    await prisma.solDailyPrice.create({
      data: { date: dateKey, priceUsd: price },
    });
    console.log(`Appended SOL price for ${dateKey}: $${price.toFixed(2)}`);
  }
}

/**
 * Look up SOL/USD price for a given transaction timestamp from the DB cache.
 * Returns the exact day's price, or the nearest available day within ±3 days.
 *
 * For the enrichment engine, prefer `buildSolPriceMap()` to avoid N+1 DB queries.
 */
export async function getSolPrice(
  prisma: PrismaClient,
  unixTimestamp: number
): Promise<number | null> {
  const dateKey = timestampToDateKey(unixTimestamp);

  // Try exact date first
  const exact = await prisma.solDailyPrice.findUnique({
    where: { date: dateKey },
  });
  if (exact) return exact.priceUsd;

  // Fallback: nearest date within ±3 days, preferring the closest one
  const nearbyDate = new Date(unixTimestamp * 1000);
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const minDate = new Date(nearbyDate.getTime() - threeDaysMs)
    .toISOString()
    .split("T")[0];
  const maxDate = new Date(nearbyDate.getTime() + threeDaysMs)
    .toISOString()
    .split("T")[0];

  const candidates = await prisma.solDailyPrice.findMany({
    where: { date: { gte: minDate, lte: maxDate } },
  });

  if (candidates.length === 0) return null;

  // Pick the candidate whose date is closest to dateKey
  candidates.sort((a, b) => {
    const distA = Math.abs(dateDiffDays(a.date, dateKey));
    const distB = Math.abs(dateDiffDays(b.date, dateKey));
    return distA - distB;
  });

  return candidates[0].priceUsd;
}

/**
 * Load all SOL prices for a set of unix timestamps in a single DB query.
 * Returns a Map<dateKey, priceUsd>. Use this inside batch loops to avoid N+1.
 */
export async function buildSolPriceMap(
  prisma: PrismaClient,
  unixTimestamps: number[]
): Promise<Map<string, number>> {
  if (unixTimestamps.length === 0) return new Map();

  const dateKeys = [...new Set(unixTimestamps.map(timestampToDateKey))];

  // Widen the range by ±3 days to cover the fallback window in one query
  const allTimes = unixTimestamps.map((t) => t * 1000);
  const minDate = new Date(Math.min(...allTimes) - 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const maxDate = new Date(Math.max(...allTimes) + 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  const rows = await prisma.solDailyPrice.findMany({
    where: { date: { gte: minDate, lte: maxDate } },
  });

  const dbMap = new Map(rows.map((r) => [r.date, r.priceUsd]));
  const result = new Map<string, number>();

  for (const dateKey of dateKeys) {
    if (dbMap.has(dateKey)) {
      result.set(dateKey, dbMap.get(dateKey)!);
      continue;
    }
    // Nearest fallback within the loaded rows
    let best: { date: string; priceUsd: number } | null = null;
    let bestDist = Infinity;
    for (const row of rows) {
      const dist = Math.abs(dateDiffDays(row.date, dateKey));
      if (dist < bestDist) {
        bestDist = dist;
        best = row;
      }
    }
    if (best) result.set(dateKey, best.priceUsd);
  }

  return result;
}

export function timestampToDateKey(unixTimestamp: number): string {
  return new Date(unixTimestamp * 1000).toISOString().split("T")[0];
}

function dateDiffDays(dateA: string, dateB: string): number {
  return (new Date(dateA).getTime() - new Date(dateB).getTime()) / (1000 * 60 * 60 * 24);
}
