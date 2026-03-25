import { PrismaClient } from "@prisma/client";
import { buildSolPriceMap, timestampToDateKey } from "./sol-price-cache";
import { buildSupplyMap, ensureSuppliesCached } from "./token-supply-cache";

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
 * Integration hook:
 * Call this from WalletOperationsProcessor after heliusSyncService.syncWallet()
 * completes — it already has NestJS DI and the prisma singleton.
 * Do NOT call from helius-sync-service.ts (core layer, used standalone in scripts)
 * or from database-service.ts (pure DB layer). The right pattern is to dispatch
 * a BullMQ job from WalletOperationsProcessor after each sync, matching how
 * enrich-token-balances is handled in EnrichmentOperationsProcessor.
 *
 * Design:
 * - Fetches one batch of un-enriched rows.
 * - Pre-loads all needed SOL prices and token supplies in two bulk queries.
 * - Writes each enriched row individually (values differ per row).
 * - Rows that permanently cannot be enriched (zero amount, no SOL/USDC value)
 *   are marked with enrichedAt so they are never retried, preventing an
 *   infinite loop in `enrichAll`.
 *
 * @param batchSize How many rows to process per call. Default 500.
 * @returns Number of rows successfully enriched.
 */
export async function enrichSwapBatch(
  prisma: PrismaClient,
  batchSize: number = 500
): Promise<number> {
  // 1. Fetch un-enriched rows
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

  // 2. Pre-fetch all token supplies in one bulk operation
  const uniqueMints = [...new Set(rows.map((r) => r.mint))];
  await ensureSuppliesCached(prisma, uniqueMints);

  // 3. Load all required data in two queries — no N+1
  const [solPriceMap, supplyMap] = await Promise.all([
    buildSolPriceMap(prisma, rows.map((r) => r.timestamp)),
    buildSupplyMap(prisma, uniqueMints),
  ]);

  // 4. Enrich each row
  let enriched = 0;
  let skipped = 0; // rows we can derive no value from — mark done to prevent retry

  for (const row of rows) {
    try {
      const dateKey = timestampToDateKey(row.timestamp);
      const solPriceUsd = solPriceMap.get(dateKey) ?? null;

      // Calculate USD value of the trade
      let usdValue: number | null = null;

      if (row.associatedSolValue > 0 && solPriceUsd) {
        usdValue = row.associatedSolValue * solPriceUsd;
      } else if (row.associatedUsdcValue && row.associatedUsdcValue > 0) {
        // USDC-routed trade: USDC value IS the USD value (no SOL price needed)
        usdValue = row.associatedUsdcValue;
      }

      if (usdValue === null || row.amount <= 0) {
        // Cannot derive price — mark enrichedAt so this row is never retried.
        // Fields stay null, meaning downstream code knows data is unavailable.
        await prisma.swapAnalysisInput.update({
          where: { id: row.id },
          data: { enrichedAt: new Date() },
        });
        skipped++;
        continue;
      }

      const tokenPriceUsd = usdValue / row.amount;
      const totalSupply = supplyMap.get(row.mint) ?? null;
      const marketCapUsd = totalSupply !== null ? tokenPriceUsd * totalSupply : null;
      const mcapBucket = marketCapUsd !== null ? classifyMcap(marketCapUsd) : null;

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
      // Do NOT mark enrichedAt — a transient error (DB timeout, etc.) should be retried.
    }
  }

  const errors = rows.length - enriched - skipped;
  console.log(`Enriched: ${enriched} | Skipped (no data): ${skipped} | Transient errors: ${errors}`);
  return enriched + skipped; // Return total processed so enrichAll knows to continue
}

/**
 * Run enrichment until all rows are processed.
 * Processes in batches to avoid memory issues.
 * Safe against infinite loops: rows with no derivable data are marked done.
 */
export async function enrichAll(
  prisma: PrismaClient,
  batchSize: number = 500
): Promise<number> {
  let totalProcessed = 0;
  let batchResult: number;

  do {
    batchResult = await enrichSwapBatch(prisma, batchSize);
    totalProcessed += batchResult;

    if (batchResult > 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  } while (batchResult > 0);

  console.log(`\nTotal processed: ${totalProcessed} swap records.`);
  return totalProcessed;
}
