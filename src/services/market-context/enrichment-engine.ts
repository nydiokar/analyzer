import { PrismaClient } from "@prisma/client";
import { getSolPrice } from "./sol-price-cache";
import { getTokenSupply, ensureSuppliesCached } from "./token-supply-cache";

const MCAP_BUCKETS = [
  { label: "micro", max: 1_000_000 },
  { label: "small", max: 10_000_000 },
  { label: "mid", max: 100_000_000 },
  { label: "large", max: 1_000_000_000 },
  { label: "mega", max: Infinity },
] as const;

function classifyMcap(mcapUsd: number): string {
  for (const bucket of MCAP_BUCKETS) {
    if (mcapUsd < bucket.max) return bucket.label;
  }
  return "mega";
}

/**
 * Enrich a batch of SwapAnalysisInput rows with market context.
 *
 * @param batchSize - How many rows to process per run. Default 500.
 *                    Use smaller batches if running alongside other workloads.
 * @returns Number of rows successfully enriched.
 */
export async function enrichSwapBatch(
  prisma: PrismaClient,
  batchSize: number = 500
): Promise<number> {
  // 1. Get un-enriched rows
  const rows = await prisma.swapAnalysisInput.findMany({
    where: { enrichedAt: null },
    orderBy: { timestamp: "desc" }, // newest first — most useful
    take: batchSize,
  });

  if (rows.length === 0) {
    console.log("No un-enriched swaps found.");
    return 0;
  }

  console.log(`Enriching ${rows.length} swap records...`);

  // 2. Pre-fetch all needed token supplies in one pass
  const uniqueMints = [...new Set(rows.map((r) => r.mint))];
  await ensureSuppliesCached(prisma, uniqueMints);

  // 3. Enrich each row
  let enriched = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      // Get SOL price for the trade's day
      const solPriceUsd = await getSolPrice(prisma, row.timestamp);
      if (!solPriceUsd) {
        errors++;
        continue;
      }

      // Calculate USD value of the trade
      let usdValue: number;
      if (row.associatedSolValue > 0) {
        usdValue = row.associatedSolValue * solPriceUsd;
      } else if (row.associatedUsdcValue && row.associatedUsdcValue > 0) {
        // USDC-routed trade: USDC value IS the USD value
        usdValue = row.associatedUsdcValue;
      } else {
        // No value to derive price from
        errors++;
        continue;
      }

      // Derive token price
      if (row.amount <= 0) {
        errors++;
        continue;
      }
      const tokenPriceUsd = usdValue / row.amount;

      // Get supply and derive market cap
      const totalSupply = await getTokenSupply(prisma, row.mint);
      const marketCapUsd = totalSupply ? tokenPriceUsd * totalSupply : null;
      const mcapBucket = marketCapUsd ? classifyMcap(marketCapUsd) : null;

      // Write back
      await prisma.swapAnalysisInput.update({
        where: { id: row.id },
        data: {
          solPriceUsd,
          usdValue,
          tokenPriceUsd,
          marketCapUsd,
          mcapBucket,
          enrichedAt: new Date(),
        },
      });

      enriched++;
    } catch (err: any) {
      console.warn(`Error enriching row ${row.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`Enriched: ${enriched} | Errors: ${errors} | Remaining: ${rows.length - enriched - errors}`);
  return enriched;
}

/**
 * Run enrichment until all rows are processed.
 * Processes in batches to avoid memory issues.
 */
export async function enrichAll(
  prisma: PrismaClient,
  batchSize: number = 500
): Promise<number> {
  let totalEnriched = 0;
  let batchResult: number;

  do {
    batchResult = await enrichSwapBatch(prisma, batchSize);
    totalEnriched += batchResult;

    // Small pause between batches
    if (batchResult > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  } while (batchResult > 0);

  console.log(`\nTotal enriched: ${totalEnriched} swap records.`);
  return totalEnriched;
}
