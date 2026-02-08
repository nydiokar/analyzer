/**
 * Investigate transfer-related FIFO issues
 * Shows tokens with TRANSFER interactions and their PnL impact
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const wallet = process.argv[2] || '6SKSZh15zbwcoZicLioCdAxsQsStnd7y2QixVNEzs3So';

async function main() {
  console.log(`\n🔍 INVESTIGATING TRANSFER ISSUES FOR WALLET\n`);
  console.log(`Wallet: ${wallet}\n`);
  console.log('═'.repeat(120));

  // 1. Find tokens with negative PnL but low SOL spent/received
  console.log('\n🚨 TOKENS WITH SUSPICIOUS PNL (likely transfer issues):\n');

  const suspiciousTokens = await prisma.analysisResult.findMany({
    where: {
      walletAddress: wallet,
      OR: [
        { realizedPnlSol: { lt: -1000 } }, // Large negative PnL
        {
          AND: [
            { totalSolSpent: { lt: 1 } }, // Spent < 1 SOL
            { totalSolReceived: { lt: 1 } }, // Received < 1 SOL
            { realizedPnlSol: { not: null } },
          ]
        }
      ]
    },
    orderBy: { realizedPnlSol: 'asc' },
  });

  if (suspiciousTokens.length === 0) {
    console.log('   ✅ No suspicious tokens found!');
  } else {
    for (const token of suspiciousTokens) {
      console.log(`\nToken: ${token.tokenAddress}`);
      console.log(`   Realized PnL:      ${token.realizedPnlSol?.toFixed(2) ?? 'null'} SOL`);
      console.log(`   Total SOL Spent:   ${token.totalSolSpent.toFixed(4)} SOL`);
      console.log(`   Total SOL Received: ${token.totalSolReceived.toFixed(4)} SOL`);
      console.log(`   Total Amount In:   ${token.totalAmountIn.toLocaleString()}`);
      console.log(`   Total Amount Out:  ${token.totalAmountOut.toLocaleString()}`);
      console.log(`   Net Amount Change: ${token.netAmountChange.toLocaleString()}`);

      // Check SwapAnalysisInputs for this token
      const inputs = await prisma.swapAnalysisInput.findMany({
        where: {
          walletAddress: wallet,
          mint: token.tokenAddress,
        },
        select: {
          interactionType: true,
          direction: true,
          amount: true,
          associatedSolValue: true,
          associatedUsdcValue: true,
        },
      });

      // Count by interaction type
      const byType: Record<string, { count: number; totalAmount: number; totalSol: number }> = {};
      for (const input of inputs) {
        const type = input.interactionType || 'UNKNOWN';
        if (!byType[type]) {
          byType[type] = { count: 0, totalAmount: 0, totalSol: 0 };
        }
        byType[type].count++;
        byType[type].totalAmount += Math.abs(input.amount);
        byType[type].totalSol += Math.abs(input.associatedSolValue);
      }

      console.log(`\n   Transaction breakdown:`);
      for (const [type, stats] of Object.entries(byType)) {
        console.log(`      ${type.padEnd(15)}: ${stats.count.toString().padStart(3)} txs, ${stats.totalAmount.toFixed(2).padStart(15)} tokens, ${stats.totalSol.toFixed(4).padStart(10)} SOL`);
      }

      // Check for TRANSFERs with no SOL value
      const transfersWithNoSol = inputs.filter(
        i => i.interactionType === 'TRANSFER' &&
             Math.abs(i.associatedSolValue) < 0.01 &&
             (i.associatedUsdcValue === null || Math.abs(i.associatedUsdcValue) < 0.01)
      );

      if (transfersWithNoSol.length > 0) {
        console.log(`\n   ⚠️  Found ${transfersWithNoSol.length} TRANSFER transactions with NO SOL/USDC value!`);
        console.log(`      These are wallet-to-wallet transfers and should NOT affect PnL!`);

        const transferOut = transfersWithNoSol.filter(t => t.direction === 'out');
        const transferIn = transfersWithNoSol.filter(t => t.direction === 'in');

        console.log(`      Transfer OUT: ${transferOut.length} (total: ${transferOut.reduce((sum, t) => sum + Math.abs(t.amount), 0).toFixed(2)} tokens)`);
        console.log(`      Transfer IN:  ${transferIn.length} (total: ${transferIn.reduce((sum, t) => sum + Math.abs(t.amount), 0).toFixed(2)} tokens)`);
      }
    }
  }

  console.log('\n═'.repeat(120));
  console.log('\n💡 DIAGNOSIS:\n');

  const hasTransferIssue = suspiciousTokens.some(t =>
    t.totalSolSpent < 1 && t.totalSolReceived < 1 && (t.realizedPnlSol ?? 0) < -1000
  );

  if (hasTransferIssue) {
    console.log('   🚨 TRANSFER ISSUE DETECTED!');
    console.log('   ');
    console.log('   Problem: Wallet-to-wallet transfers are being treated as sells with 0 proceeds,');
    console.log('   creating massive negative PnL when the tokens were actually just moved.');
    console.log('');
    console.log('   Expected behavior:');
    console.log('   - Transfer OUT (no SOL): Remove from lots, but NO realized PnL');
    console.log('   - Transfer IN (no SOL): Add to lots with 0 cost basis');
    console.log('');
    console.log('   Current behavior (BUG):');
    console.log('   - Transfer OUT: Treated as SELL with 0 proceeds → huge negative PnL! ❌');
    console.log('');
  } else {
    console.log('   ✅ No obvious transfer issues detected.');
  }

  console.log('\n═'.repeat(120) + '\n');

  await prisma.$disconnect();
}

main().catch(console.error);
