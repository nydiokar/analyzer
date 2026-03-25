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

  const data = await res.json();
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

  // Get existing dates to skip them
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
 * Look up SOL/USD price for a given transaction timestamp.
 * Returns the exact day's price, or the nearest available day.
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

  // Fallback: nearest date within ±3 days
  const nearbyDate = new Date(unixTimestamp * 1000);
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const minDate = new Date(nearbyDate.getTime() - threeDaysMs)
    .toISOString()
    .split("T")[0];
  const maxDate = new Date(nearbyDate.getTime() + threeDaysMs)
    .toISOString()
    .split("T")[0];

  const nearest = await prisma.solDailyPrice.findFirst({
    where: { date: { gte: minDate, lte: maxDate } },
    orderBy: { date: "desc" },
  });

  return nearest?.priceUsd ?? null;
}

function timestampToDateKey(unixTimestamp: number): string {
  return new Date(unixTimestamp * 1000).toISOString().split("T")[0];
}
