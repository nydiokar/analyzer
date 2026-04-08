import { prisma } from '../src/core/services/database-service';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  const rows = await prisma.$queryRaw<{
    walletAddress: string;
    lifetime_pnl: number;
    summed_daily: number;
    delta: number;
    has_incomplete: boolean;
  }[]>`
    SELECT
      w."walletAddress",
      w."realizedPnl"::float AS lifetime_pnl,
      SUM(d."realizedPnlSol")::float AS summed_daily,
      ABS(w."realizedPnl" - SUM(d."realizedPnlSol"))::float AS delta,
      BOOL_OR(d."hasIncompleteHistory") AS has_incomplete
    FROM "WalletPnlSummary" w
    JOIN "WalletDailyPnl" d ON d."walletAddress" = w."walletAddress"
    GROUP BY w."walletAddress", w."realizedPnl"
    HAVING ABS(w."realizedPnl" - SUM(d."realizedPnlSol")) > 0.01
      AND NOT BOOL_OR(d."hasIncompleteHistory")
    ORDER BY delta DESC
  `;

  if (rows.length === 0) {
    console.log('No outliers — all complete-history wallets within 0.01 SOL tolerance.');
  } else {
    console.log(`${rows.length} outlier(s):\n`);
    for (const r of rows) {
      console.log(`wallet:       ${r.walletAddress}`);
      console.log(`lifetime_pnl: ${r.lifetime_pnl.toFixed(4)}`);
      console.log(`summed_daily: ${r.summed_daily.toFixed(4)}`);
      console.log(`delta:        ${r.delta.toFixed(4)} SOL`);
      console.log('---');
    }
  }

  await prisma.$disconnect();
}

main().catch(async err => { console.error(err); await prisma.$disconnect(); process.exit(1); });
