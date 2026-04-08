/**
 * DA-6 — One-time backfill of WalletDailyPnl for all wallets with SwapAnalysisInput rows.
 *
 * No Helius calls. No Nest bootstrap. Reads existing SwapAnalysisInput rows from DB,
 * runs the full-history FIFO pass per wallet, upserts WalletDailyPnl rows.
 *
 * Wallets processed sequentially (spec §9 / R6) — full history FIFO is memory-bounded
 * per wallet, so parallel runs multiply peak memory.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-daily-agg.ts
 *
 * Safe to rerun — all writes are upserts (@@unique walletAddress+date).
 */

import { prisma } from '../src/core/services/database-service';
import { DailyAggregationService } from '../src/core/services/daily-aggregation.service';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  console.log('\n=== DA-6 Daily Aggregate Backfill ===\n');

  // All distinct wallets that have swap data AND exist in the Wallet table (FK required), heaviest first
  const allSwapWallets = await prisma.swapAnalysisInput.groupBy({
    by: ['walletAddress'],
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
  });

  // Filter to only wallets that have a Wallet row (WalletDailyPnl has FK to Wallet)
  const walletAddressSet = new Set(
    (await prisma.wallet.findMany({ select: { address: true } })).map(w => w.address),
  );
  const wallets = allSwapWallets.filter(w => walletAddressSet.has(w.walletAddress));

  console.log(`Wallets to process: ${wallets.length}\n`);

  const svc = new DailyAggregationService();

  let done = 0;
  let failed = 0;

  for (const { walletAddress, _count } of wallets) {
    const swapCount = _count.id;
    process.stdout.write(`[${done + failed + 1}/${wallets.length}] ${walletAddress.slice(0, 8)}… (${swapCount} swaps) → `);

    try {
      // Get the full date range for this wallet from its swap history
      const span = await prisma.swapAnalysisInput.aggregate({
        where: { walletAddress },
        _min: { timestamp: true },
        _max: { timestamp: true },
      });

      const minTs = span._min.timestamp;
      const maxTs = span._max.timestamp;
      if (!minTs || !maxTs) {
        console.log('no swaps, skip');
        done++;
        continue;
      }

      // Build the full list of UTC calendar days covered by this wallet's swaps
      const dates: string[] = [];
      const start = new Date(minTs * 1000);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(maxTs * 1000);
      end.setUTCHours(0, 0, 0, 0);

      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        dates.push(d.toISOString().slice(0, 10));
      }

      await svc.recomputeDays(walletAddress, dates);
      console.log(`${dates.length} days OK`);
      done++;
    } catch (err: any) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n=== Backfill complete: ${done} OK / ${failed} failed ===\n`);

  // §9 cross-check summary
  console.log('Running §9 cross-check (top 20 deltas)...\n');

  const crossCheck = await prisma.$queryRaw<{
    walletAddress: string;
    lifetime_pnl: number;
    summed_daily_pnl: number;
    delta: number;
    has_incomplete: boolean;
  }[]>`
    SELECT
      w."walletAddress",
      w."realizedPnl"::float                                AS lifetime_pnl,
      SUM(d."realizedPnlSol")::float                       AS summed_daily_pnl,
      ABS(w."realizedPnl" - SUM(d."realizedPnlSol"))::float AS delta,
      BOOL_OR(d."hasIncompleteHistory")                    AS has_incomplete
    FROM "WalletPnlSummary" w
    JOIN "WalletDailyPnl" d ON d."walletAddress" = w."walletAddress"
    GROUP BY w."walletAddress", w."realizedPnl"
    ORDER BY delta DESC
    LIMIT 20
  `;

  console.log(['wallet', 'lifetime_pnl', 'summed_daily', 'delta', 'incomplete?', 'status'].join('\t'));
  let okCount = 0;
  let warnCount = 0;
  for (const row of crossCheck) {
    const needsInvestigation = row.delta > 0.01 && !row.has_incomplete;
    const status = needsInvestigation ? '*** INVESTIGATE' : 'ok';
    console.log([
      row.walletAddress.slice(0, 8) + '…',
      row.lifetime_pnl.toFixed(4),
      row.summed_daily_pnl.toFixed(4),
      row.delta.toFixed(4),
      row.has_incomplete ? 'yes' : 'no',
      status,
    ].join('\t'));
    if (needsInvestigation) warnCount++; else okCount++;
  }

  console.log(`\nCross-check: ${okCount} OK / ${warnCount} need investigation\n`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
