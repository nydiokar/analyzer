/**
 * Step 2-4 — DA validation: cross-check WalletDailyPnl rows against
 * WalletPnlSummary (spec §9 validation query) and inspect flags.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/validate-daily-agg-check.ts [WALLET_ADDRESS]
 *
 * Without a wallet address: runs the cross-check across ALL wallets (top 20 by delta).
 */

import { prisma } from '../src/core/services/database-service';
import * as dotenv from 'dotenv';
dotenv.config();

const WALLET = process.argv[2] || null;

async function main() {
  console.log('\n=== DA Validation — Steps 2-4: Cross-check & Flags ===\n');

  // ── Step 2: Show daily rows for this wallet ──────────────────────────────
  if (WALLET) {
    console.log(`Wallet: ${WALLET}\n`);

    const rows = await prisma.walletDailyPnl.findMany({
      where: { walletAddress: WALLET },
      orderBy: { date: 'asc' },
    });

    if (rows.length === 0) {
      console.log('No WalletDailyPnl rows found. Run validate-daily-agg-trigger.ts first.\n');
    } else {
      console.log(`--- Daily PnL rows (${rows.length} days) ---`);
      console.log(
        ['date', 'trades', 'buys', 'sells', 'volSOL', 'realPnL', 'profSells', 'totSells', 'mints', 'incompHist', 'incompEnr', 'lastComputed']
          .join('\t'),
      );
      for (const r of rows) {
        console.log(
          [
            r.date,
            r.tradeCount,
            r.buyCount,
            r.sellCount,
            r.volumeSol.toFixed(4),
            r.realizedPnlSol.toFixed(4),
            r.profitableSellsCount,
            r.totalSellsCount,
            r.uniqueMintsTradedCount,
            r.hasIncompleteHistory ? 'YES' : 'no',
            r.hasIncompleteEnrichment ? 'YES' : 'no',
            r.lastComputedAt.toISOString(),
          ].join('\t'),
        );
      }

      const totalPnl = rows.reduce((s, r) => s + r.realizedPnlSol, 0);
      const totalTrades = rows.reduce((s, r) => s + r.tradeCount, 0);
      const totalVol = rows.reduce((s, r) => s + r.volumeSol, 0);
      console.log(`\nSUM: realizedPnlSol=${totalPnl.toFixed(6)} SOL | trades=${totalTrades} | volumeSol=${totalVol.toFixed(4)} SOL\n`);
    }
  }

  // ── Step 3: Spec §9 SQL cross-check (SUM daily vs lifetime) ─────────────
  console.log('--- §9 Cross-check: SUM(WalletDailyPnl.realizedPnlSol) vs WalletPnlSummary.realizedPnl ---\n');

  const crossCheck = await (WALLET
    ? prisma.$queryRaw<{
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
        WHERE w."walletAddress" = ${WALLET}
        GROUP BY w."walletAddress", w."realizedPnl"
        ORDER BY delta DESC
        LIMIT 20
      `
    : prisma.$queryRaw<{
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
      `);

  if (crossCheck.length === 0) {
    console.log('No rows matched — either WalletPnlSummary or WalletDailyPnl is empty for this wallet.\n');
  } else {
    console.log(['wallet (first 8)', 'lifetime_pnl', 'summed_daily', 'delta', 'incomplete?'].join('\t'));
    let ok = 0;
    let warn = 0;
    for (const row of crossCheck) {
      const flag = row.delta > 0.01 && !row.has_incomplete ? ' *** INVESTIGATE' : '';
      console.log(
        [
          row.walletAddress.slice(0, 8) + '…',
          row.lifetime_pnl.toFixed(6),
          row.summed_daily_pnl.toFixed(6),
          row.delta.toFixed(6),
          row.has_incomplete ? 'yes' : 'no',
        ].join('\t') + flag,
      );
      if (row.delta > 0.01 && !row.has_incomplete) warn++;
      else ok++;
    }
    console.log(`\nResult: ${ok} OK / ${warn} need investigation (delta > 0.01 SOL on complete-history wallets)\n`);
  }

  // ── Step 4: Flag check ───────────────────────────────────────────────────
  console.log('--- Step 4: Flag check (most recent 20 rows by lastComputedAt) ---\n');

  const flagRows = await prisma.walletDailyPnl.findMany({
    where: WALLET ? { walletAddress: WALLET } : undefined,
    orderBy: { lastComputedAt: 'desc' },
    take: 20,
    select: {
      walletAddress: true,
      date: true,
      hasIncompleteHistory: true,
      hasIncompleteEnrichment: true,
      lastComputedAt: true,
    },
  });

  if (flagRows.length === 0) {
    console.log('No rows found.\n');
  } else {
    console.log(['wallet (first 8)', 'date', 'incompHist', 'incompEnr', 'lastComputedAt'].join('\t'));
    for (const r of flagRows) {
      const age = Math.round((Date.now() - r.lastComputedAt.getTime()) / 1000);
      console.log(
        [
          r.walletAddress.slice(0, 8) + '…',
          r.date,
          r.hasIncompleteHistory ? 'YES' : 'no',
          r.hasIncompleteEnrichment ? 'YES' : 'no',
          `${r.lastComputedAt.toISOString()} (${age}s ago)`,
        ].join('\t'),
      );
    }
    console.log();
  }

  console.log('=== Validation complete ===\n');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
