/**
 * Quick enrichment coverage check.
 * Shows how many swaps are enriched, missing mcap, and why.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/check-enrichment-coverage.ts
 */

import { prisma } from '../src/core/services/database-service';

async function main() {
  const SKIP_MINTS = [
    'So11111111111111111111111111111111111111112',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  ];

  const [counts] = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*)                                                                                                                                           AS total,
      COUNT(*) FILTER (WHERE "enrichedAt" IS NULL)                                                                                                      AS not_enriched,
      COUNT(*) FILTER (WHERE "enrichedAt" IS NOT NULL)                                                                                                  AS enriched,
      COUNT(*) FILTER (WHERE mint = ANY(${SKIP_MINTS}))                                                                                                AS skip_mints,
      COUNT(*) FILTER (WHERE "enrichedAt" IS NOT NULL AND "marketCapUsd" IS NOT NULL)                                                                   AS has_mcap,
      COUNT(*) FILTER (WHERE "enrichedAt" IS NOT NULL AND "marketCapUsd" IS NULL AND "associatedSolValue" > 0 AND mint != ALL(${SKIP_MINTS}))           AS missing_mcap_has_sol,
      COUNT(*) FILTER (WHERE "enrichedAt" IS NOT NULL AND "marketCapUsd" IS NULL AND "associatedSolValue" = 0 AND mint != ALL(${SKIP_MINTS}))           AS missing_mcap_zero_sol
    FROM "SwapAnalysisInput"
  `;

  const total               = Number(counts.total);
  const notEnriched         = Number(counts.not_enriched);
  const enriched            = Number(counts.enriched);
  const skipMints           = Number(counts.skip_mints);
  const hasMcap             = Number(counts.has_mcap);
  const missingMcapHasSol   = Number(counts.missing_mcap_has_sol);
  const missingMcapZeroSol  = Number(counts.missing_mcap_zero_sol);
  const tokenSwaps          = total - skipMints;

  console.log('\n=== Enrichment Coverage ===\n');
  console.log(`Total swaps          : ${total.toLocaleString()}`);
  console.log(`SOL/stable swaps     : ${skipMints.toLocaleString()} (${pct(skipMints, total)}) — skipped, no mcap needed`);
  console.log(`Token swaps          : ${tokenSwaps.toLocaleString()} (${pct(tokenSwaps, total)})`);
  console.log(`Enriched             : ${enriched.toLocaleString()} (${pct(enriched, total)})`);
  console.log(`Not enriched         : ${notEnriched.toLocaleString()} (${pct(notEnriched, total)})`);
  console.log('');
  console.log(`Has marketCapUsd     : ${hasMcap.toLocaleString()} (${pct(hasMcap, tokenSwaps)} of token swaps)`);
  console.log(`Missing mcap — has SOL value (supply miss) : ${missingMcapHasSol.toLocaleString()} (${pct(missingMcapHasSol, tokenSwaps)} of token swaps)`);
  console.log(`Missing mcap — zero SOL value (expected)   : ${missingMcapZeroSol.toLocaleString()} (${pct(missingMcapZeroSol, tokenSwaps)} of token swaps)`);

  if (missingMcapHasSol > 0) {
    // Show the top mints responsible — if a few mints account for most misses it's a supply cache issue
    const topMints = await prisma.$queryRaw<{ mint: string; count: bigint }[]>`
      SELECT mint, COUNT(*) AS count
      FROM "SwapAnalysisInput"
      WHERE "enrichedAt" IS NOT NULL
        AND "marketCapUsd" IS NULL
        AND "associatedSolValue" > 0
      GROUP BY mint
      ORDER BY count DESC
      LIMIT 10
    `;

    console.log('\nTop mints with missing mcap (supply cache misses):');
    for (const row of topMints) {
      console.log(`  ${row.mint}  —  ${Number(row.count).toLocaleString()} swaps`);
    }

    // Check how many of those mints have totalSupply cached in TokenInfo
    const mints = topMints.map(r => r.mint);
    const cached = await prisma.tokenInfo.findMany({
      where: { tokenAddress: { in: mints }, totalSupply: { not: null } },
      select: { tokenAddress: true, totalSupply: true },
    });
    const cachedSet = new Set(cached.map(t => t.tokenAddress));

    console.log('\nTokenInfo supply cache status for those mints:');
    for (const row of topMints) {
      const status = cachedSet.has(row.mint) ? '\u2705 cached' : '\u274c missing';
      console.log(`  ${row.mint.slice(0, 20)}...  ${status}`);
    }

    if (cachedSet.size < mints.length) {
      console.log('\n⚠️  Some mints still missing supply in TokenInfo — re-running backfill will retry them.');
    } else {
      console.log('\n✅ All top mints have supply cached — re-running backfill should resolve mcap misses.');
    }
  } else {
    console.log('\n✅ No actionable mcap misses — all swaps with SOL value have marketCapUsd.');
  }

  console.log('');
  await prisma.$disconnect();
}

function pct(n: number, of: number): string {
  if (of === 0) return '0%';
  return `${((n / of) * 100).toFixed(1)}%`;
}

main().catch(console.error);
