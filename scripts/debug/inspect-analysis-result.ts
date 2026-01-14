import * as dotenv from 'dotenv';
import { DatabaseService } from '../../src/api/services/database.service';

dotenv.config();

async function main() {
  const wallet = process.argv[2];
  const mint = process.argv[3];

  if (!wallet || !mint) {
    console.error('Usage: npx ts-node -r tsconfig-paths/register scripts/debug/inspect-analysis-result.ts <WALLET> <MINT>');
    process.exit(1);
  }

  const db = new DatabaseService();
  const result = await db.getAnalysisResults({
    where: { walletAddress: wallet, tokenAddress: mint },
  });

  if (result.length === 0) {
    console.log('No AnalysisResult found for that wallet+mint.');
    return;
  }

  const r = result[0];
  console.log(JSON.stringify({
    walletAddress: r.walletAddress,
    tokenAddress: r.tokenAddress,
    hasIncompleteHistory: r.hasIncompleteHistory,
    realizedPnlSol: r.realizedPnlSol,
    unrealizedPnlSol: r.unrealizedPnlSol,
    totalPnlSol: r.totalPnlSol,
    netSolProfitLoss: r.netSolProfitLoss,
    totalSolSpent: r.totalSolSpent,
    totalSolReceived: r.totalSolReceived,
    totalFeesPaidInSol: r.totalFeesPaidInSol,
    totalAmountIn: r.totalAmountIn,
    totalAmountOut: r.totalAmountOut,
    netAmountChange: r.netAmountChange,
    transferCountIn: r.transferCountIn,
    transferCountOut: r.transferCountOut,
    firstTransferTimestamp: r.firstTransferTimestamp,
    lastTransferTimestamp: r.lastTransferTimestamp,
    currentHoldingsCostBasisSol: r.currentHoldingsCostBasisSol,
    currentUiBalance: r.currentUiBalance,
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
