import { prisma } from '../src/core/services/database-service';
import * as dotenv from 'dotenv';
dotenv.config();

const WALLET = process.argv[2] || 'CFqGrjnRXEKF3KMDaC1GrgS8S5JJGbhCnrBqFGkXzMfa';

async function main() {
  console.log('\nInvestigating outlier:', WALLET, '\n');

  const summary = await prisma.walletPnlSummary.findUnique({ where: { walletAddress: WALLET } });
  console.log('Lifetime realizedPnl (WalletPnlSummary):', summary?.realizedPnl?.toFixed(4));

  const daily = await prisma.walletDailyPnl.findMany({ where: { walletAddress: WALLET }, orderBy: { date: 'asc' } });
  const dailySum = daily.reduce((s, r) => s + r.realizedPnlSol, 0);
  console.log('Daily rows:', daily.length, '| SUM realizedPnlSol:', dailySum.toFixed(4));
  console.log('Delta:', Math.abs((summary?.realizedPnl ?? 0) - dailySum).toFixed(4));

  const incomplete = await prisma.analysisResult.count({ where: { walletAddress: WALLET, hasIncompleteHistory: true } });
  const total = await prisma.analysisResult.count({ where: { walletAddress: WALLET } });
  console.log('\nAnalysisResult rows:', total, '| hasIncompleteHistory=true:', incomplete);

  const swaps = await prisma.swapAnalysisInput.findMany({ where: { walletAddress: WALLET }, orderBy: { timestamp: 'asc' } });
  const buys = swaps.filter(s => s.direction === 'in');
  const sells = swaps.filter(s => s.direction === 'out');
  const totalSolIn = buys.reduce((s, r) => s + r.associatedSolValue, 0);
  const totalSolOut = sells.reduce((s, r) => s + r.associatedSolValue, 0);
  console.log('\nSwaps:', swaps.length, '| buys:', buys.length, '| sells:', sells.length);
  console.log('SOL in (buys):', totalSolIn.toFixed(4), '| SOL out (sells):', totalSolOut.toFixed(4));
  console.log('Raw diff (sells-buys):', (totalSolOut - totalSolIn).toFixed(4));

  // USDC swaps?
  const usdcSwaps = swaps.filter(s => s.associatedUsdcValue != null && (s.associatedUsdcValue ?? 0) > 0);
  console.log('\nSwaps with associatedUsdcValue:', usdcSwaps.length);

  // Distinct mints
  const mints = new Set(swaps.map(s => s.mint));
  console.log('Distinct mints:', mints.size);

  await prisma.$disconnect();
}

main().catch(async err => { console.error(err); await prisma.$disconnect(); process.exit(1); });
