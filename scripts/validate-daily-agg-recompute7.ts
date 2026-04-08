/**
 * Recompute last 7 days of WalletDailyPnl for a wallet using the full swap history.
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/validate-daily-agg-recompute7.ts [WALLET]
 */
import { prisma } from '../src/core/services/database-service';
import { DailyAggregationService } from '../src/core/services/daily-aggregation.service';
import * as dotenv from 'dotenv';
dotenv.config();

const WALLET = process.argv[2] || 'Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7';
const N_DAYS = parseInt(process.argv[3] || '7', 10);

async function main() {
  const dates: string[] = [];
  for (let i = 0; i < N_DAYS; i++) {
    dates.push(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10));
  }

  console.log(`\nRecomputing ${N_DAYS} days for ${WALLET}`);
  console.log('Dates:', dates.join(', '), '\n');

  const swapCount = await prisma.swapAnalysisInput.count({ where: { walletAddress: WALLET } });
  console.log(`Total swaps in DB: ${swapCount}`);

  const svc = new DailyAggregationService();
  await svc.recomputeDays(WALLET, dates);

  const rows = await prisma.walletDailyPnl.findMany({
    where: { walletAddress: WALLET },
    orderBy: { date: 'asc' },
  });

  console.log(`\nWalletDailyPnl rows (${rows.length} total):\n`);
  console.log(['date', 'trades', 'buys', 'sells', 'volSOL', 'realPnL', 'profSells/totSells', 'mints', 'incompHist'].join('\t'));
  for (const r of rows) {
    console.log([
      r.date,
      r.tradeCount,
      r.buyCount,
      r.sellCount,
      r.volumeSol.toFixed(4),
      r.realizedPnlSol.toFixed(4),
      `${r.profitableSellsCount}/${r.totalSellsCount}`,
      r.uniqueMintsTradedCount,
      r.hasIncompleteHistory ? 'YES' : 'no',
    ].join('\t'));
  }

  const totalPnl = rows.reduce((s, r) => s + r.realizedPnlSol, 0);
  console.log(`\nSUM realizedPnlSol: ${totalPnl.toFixed(6)} SOL`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
