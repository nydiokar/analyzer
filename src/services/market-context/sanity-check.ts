import { PrismaClient } from "@prisma/client";

/**
 * Compare our derived current price with DexScreener's price
 * for recent transactions (last 24h).
 *
 * Acceptable variance: ±10% for liquid tokens, ±25% for microcaps.
 * Larger variance is expected for low-liquidity tokens with high spread.
 */
export async function runSanityCheck(prisma: PrismaClient): Promise<void> {
  // Get recently enriched transactions (last 24h)
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;

  const recentEnriched = await prisma.swapAnalysisInput.findMany({
    where: {
      enrichedAt: { not: null },
      timestamp: { gte: oneDayAgo },
      tokenPriceUsd: { not: null },
    },
    take: 50,
    orderBy: { timestamp: "desc" },
  });

  if (recentEnriched.length === 0) {
    console.log("No recent enriched transactions to validate.");
    return;
  }

  console.log("=== SANITY CHECK: Derived vs DexScreener ===\n");

  let matches = 0;
  let mismatches = 0;
  let noReference = 0;

  for (const tx of recentEnriched) {
    const tokenInfo = await prisma.tokenInfo.findUnique({
      where: { tokenAddress: tx.mint },
    });

    if (!tokenInfo?.priceUsd) {
      noReference++;
      continue;
    }

    const dexPrice = parseFloat(tokenInfo.priceUsd);
    const derivedPrice = tx.tokenPriceUsd!;
    const variance = Math.abs(derivedPrice - dexPrice) / dexPrice;

    const status = variance < 0.25 ? "OK" : "MISMATCH";

    if (variance < 0.25) {
      matches++;
    } else {
      mismatches++;
      console.log(
        `  ${status} | ${tx.mint.slice(0, 12)}... | ` +
          `Derived: $${derivedPrice.toExponential(3)} | ` +
          `DexScreener: $${dexPrice.toExponential(3)} | ` +
          `Variance: ${(variance * 100).toFixed(1)}%`
      );
    }
  }

  console.log(`\nResults: ${matches} OK | ${mismatches} mismatch | ${noReference} no reference`);
  console.log(
    mismatches === 0
      ? "All checks passed."
      : "Some mismatches detected — check USDC-routed swaps or multi-hop Jupiter routes."
  );
}
