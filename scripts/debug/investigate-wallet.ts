import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const WALLET = 'kapD6ok2UTZsCLeqvuykmN7UE6wWBsLEfct9861esrh';
const TOKEN = '2TsmuYUrsctE57VLckZBYEEzdokUF8j8e1GavekWBAGS';

async function main() {
  const prisma = new PrismaClient();

  console.log(`\n${'='.repeat(100)}`);
  console.log(`INVESTIGATING WALLET: ${WALLET}`);
  console.log(`TOKEN: ${TOKEN}`);
  console.log(`${'='.repeat(100)}\n`);

  // 1. Get SwapAnalysisInput records
  console.log('📦 SwapAnalysisInput Records:\n');
  const swapInputs = await prisma.swapAnalysisInput.findMany({
    where: { walletAddress: WALLET, mint: TOKEN },
    orderBy: { timestamp: 'asc' },
  });

  console.log(`Found ${swapInputs.length} records\n`);

  let totalSolIn = 0;
  let totalSolOut = 0;
  let totalUsdcIn = 0;
  let totalUsdcOut = 0;
  let totalTokenIn = 0;
  let totalTokenOut = 0;

  for (const input of swapInputs) {
    const dir = input.direction.toUpperCase().padEnd(3);
    const type = (input.interactionType || 'NULL').padEnd(12);
    const tokens = Math.abs(input.amount).toLocaleString().padStart(22);
    const sol = input.associatedSolValue.toFixed(6).padStart(12);
    const usdc = (input.associatedUsdcValue ?? 0).toFixed(6).padStart(12);
    const ts = new Date(input.timestamp * 1000).toISOString();

    console.log(`${dir} | ${type} | ${tokens} tokens | ${sol} SOL | ${usdc} USDC | ${ts}`);
    console.log(`     sig: ${input.signature}\n`);

    if (input.direction === 'in') {
      totalSolIn += Math.abs(input.associatedSolValue);
      totalUsdcIn += Math.abs(input.associatedUsdcValue ?? 0);
      totalTokenIn += Math.abs(input.amount);
    } else {
      totalSolOut += Math.abs(input.associatedSolValue);
      totalUsdcOut += Math.abs(input.associatedUsdcValue ?? 0);
      totalTokenOut += Math.abs(input.amount);
    }
  }

  console.log(`\n📊 SwapAnalysisInput Summary:`);
  console.log(`   SOL:    IN ${totalSolIn.toFixed(6)} | OUT ${totalSolOut.toFixed(6)} | NET ${(totalSolOut - totalSolIn).toFixed(6)}`);
  console.log(`   USDC:   IN ${totalUsdcIn.toFixed(6)} | OUT ${totalUsdcOut.toFixed(6)} | NET ${(totalUsdcOut - totalUsdcIn).toFixed(6)}`);
  console.log(`   Tokens: IN ${totalTokenIn.toLocaleString()} | OUT ${totalTokenOut.toLocaleString()} | NET ${(totalTokenIn - totalTokenOut).toLocaleString()}`);

  // 2. Get AnalysisResult
  console.log(`\n${'='.repeat(100)}`);
  console.log('📈 AnalysisResult Record:\n');

  const analysisResult = await prisma.analysisResult.findFirst({
    where: { walletAddress: WALLET, tokenAddress: TOKEN },
  });

  if (analysisResult) {
    console.log(`   totalAmountIn:        ${analysisResult.totalAmountIn}`);
    console.log(`   totalAmountOut:       ${analysisResult.totalAmountOut}`);
    console.log(`   netAmountChange:      ${analysisResult.netAmountChange}`);
    console.log(`   totalSolSpent:        ${analysisResult.totalSolSpent}`);
    console.log(`   totalSolReceived:     ${analysisResult.totalSolReceived}`);
    console.log(`   netSolProfitLoss:     ${analysisResult.netSolProfitLoss}`);
    console.log(`   realizedPnlSol:       ${analysisResult.realizedPnlSol}`);
    console.log(`   unrealizedPnlSol:     ${analysisResult.unrealizedPnlSol}`);
    console.log(`   totalPnlSol:          ${analysisResult.totalPnlSol}`);
    console.log(`   hasIncompleteHistory: ${analysisResult.hasIncompleteHistory}`);
    console.log(`   transferCountIn:      ${analysisResult.transferCountIn}`);
    console.log(`   transferCountOut:     ${analysisResult.transferCountOut}`);
    console.log(`   isValuePreservation:  ${analysisResult.isValuePreservation}`);
    console.log(`   preservationType:     ${analysisResult.preservationType}`);
  } else {
    console.log('   No AnalysisResult found!');
  }

  // 3. Check TokenLot records (FIFO lots)
  console.log(`\n${'='.repeat(100)}`);
  console.log('🗃️ TokenLot Records (FIFO):\n');

  const tokenLots = await prisma.tokenLot.findMany({
    where: { walletAddress: WALLET, tokenAddress: TOKEN },
    orderBy: { purchaseTimestamp: 'asc' },
  });

  console.log(`Found ${tokenLots.length} lots\n`);

  for (const lot of tokenLots) {
    console.log(`   Lot ID: ${lot.id}`);
    console.log(`   Original: ${lot.amountBought} | Remaining: ${lot.amountRemaining}`);
    console.log(`   Cost Basis: ${lot.costBasisSol} SOL`);
    console.log(`   Acquired: ${new Date(lot.purchaseTimestamp * 1000).toISOString()}`);
    console.log(`   Signature: ${lot.sourceSignature}\n`);
  }

  // 4. Check WalletPnlSummary
  console.log(`\n${'='.repeat(100)}`);
  console.log('💰 WalletPnlSummary:\n');

  const pnlSummary = await prisma.walletPnlSummary.findFirst({
    where: { walletAddress: WALLET },
  });

  if (pnlSummary) {
    console.log(`   realizedPnl:                ${pnlSummary.realizedPnl}`);
    console.log(`   unrealizedPnl:              ${pnlSummary.unrealizedPnl}`);
    console.log(`   netPnl:                     ${pnlSummary.netPnl}`);
    console.log(`   totalVolume:                ${pnlSummary.totalVolume}`);
    console.log(`   totalFees:                  ${pnlSummary.totalFees}`);
    console.log(`   profitableTokensCount:      ${pnlSummary.profitableTokensCount}`);
    console.log(`   unprofitableTokensCount:    ${pnlSummary.unprofitableTokensCount}`);
    console.log(`   totalExecutedSwapsCount:    ${pnlSummary.totalExecutedSwapsCount}`);
  } else {
    console.log('   No WalletPnlSummary found!');
  }

  // 5. Check all tokens for this wallet to see pattern
  console.log(`\n${'='.repeat(100)}`);
  console.log('🔍 All AnalysisResults for this wallet:\n');

  const allResults = await prisma.analysisResult.findMany({
    where: { walletAddress: WALLET },
    orderBy: { totalSolSpent: 'desc' },
    take: 10,
  });

  console.log(`Total tokens: ${allResults.length} (showing top 10 by SOL spent)\n`);

  for (const r of allResults) {
    const spent = r.totalSolSpent.toFixed(4).padStart(10);
    const received = r.totalSolReceived.toFixed(4).padStart(10);
    const pnl = (r.realizedPnlSol ?? 0).toFixed(4).padStart(10);
    console.log(`   ${r.tokenAddress.slice(0, 20)}... | Spent: ${spent} | Received: ${received} | PnL: ${pnl}`);
  }

  // 6. Analysis of the issue
  console.log(`\n${'='.repeat(100)}`);
  console.log('🔬 ISSUE ANALYSIS:\n');

  if (analysisResult) {
    const hasZeroBuySell = analysisResult.totalSolSpent === 0 && analysisResult.totalSolReceived === 0;
    const hasNonZeroPnl = (analysisResult.realizedPnlSol ?? 0) !== 0;
    const hasUsdcValue = totalUsdcIn > 0 || totalUsdcOut > 0;
    const hasNoSolValue = totalSolIn === 0 && totalSolOut === 0;

    console.log(`   Zero buy/sell amounts:      ${hasZeroBuySell}`);
    console.log(`   Non-zero PnL:               ${hasNonZeroPnl}`);
    console.log(`   Has USDC values in inputs:  ${hasUsdcValue}`);
    console.log(`   Has NO SOL values in inputs: ${hasNoSolValue}`);

    if (hasZeroBuySell && hasUsdcValue && hasNoSolValue) {
      console.log(`\n   ⚠️  ROOT CAUSE IDENTIFIED:`);
      console.log(`   The transactions have USDC values but NO SOL values.`);
      console.log(`   The system is NOT converting USDC to SOL when computing totalSolSpent/totalSolReceived.`);
      console.log(`   This happens when swaps are done with USDC instead of SOL.`);
    }

    // Simulate the fix
    console.log(`\n${'='.repeat(100)}`);
    console.log('🔧 SIMULATED FIX (with USDC→SOL conversion):\n');

    const SOL_PRICE_USD = 200; // Approximate current price
    let fixedSolSpent = 0;
    let fixedSolReceived = 0;

    for (const input of swapInputs) {
      let solValue = Math.abs(input.associatedSolValue);
      if (solValue === 0 && input.associatedUsdcValue) {
        solValue = Math.abs(input.associatedUsdcValue) / SOL_PRICE_USD;
      }
      if (input.direction === 'in') {
        fixedSolSpent += solValue;
      } else {
        fixedSolReceived += solValue;
      }
    }

    console.log(`   Using SOL price: $${SOL_PRICE_USD}`);
    console.log(`   Fixed totalSolSpent:    ${fixedSolSpent.toFixed(6)} SOL (was ${analysisResult.totalSolSpent})`);
    console.log(`   Fixed totalSolReceived: ${fixedSolReceived.toFixed(6)} SOL (was ${analysisResult.totalSolReceived})`);
    console.log(`   Fixed net:              ${(fixedSolReceived - fixedSolSpent).toFixed(6)} SOL`);
    console.log(`   Stored realizedPnlSol:  ${analysisResult.realizedPnlSol?.toFixed(6)} SOL`);

    const diff = Math.abs((fixedSolReceived - fixedSolSpent) - (analysisResult.realizedPnlSol ?? 0));
    if (diff < 0.01) {
      console.log(`\n   ✅ FIX VALIDATED: Net matches realizedPnlSol (diff: ${diff.toFixed(6)} SOL)`);
    } else {
      console.log(`\n   ⚠️  Difference from realizedPnlSol: ${diff.toFixed(6)} SOL (may be due to fees or SOL price variance)`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
