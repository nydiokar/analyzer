/**
 * Debug script to investigate whale wallet HUD data inconsistency
 *
 * Issue: Whale wallet shows "Portfolio: -218.8 SOL / $22,528"
 * - Negative SOL value doesn't make sense for "current holdings value"
 * - Need to verify what's actually stored in the database
 */

import { prisma } from '../../src/core/services/database-service';

async function main() {
  // The whale wallet from HUD demo (you can change this to the actual wallet you're seeing)
  const walletAddress = process.argv[2] || 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm';

  console.log(`\n🔍 Investigating HUD data for wallet: ${walletAddress}\n`);

  // 1. Check what's in AnalysisResult
  console.log('📊 AnalysisResult records:');
  const analysisResults = await prisma.analysisResult.findMany({
    where: { walletAddress },
    select: {
      tokenAddress: true,
      currentUiBalance: true,
      currentHoldingsValueSol: true,
      currentHoldingsValueUsd: true,
      currentHoldingsCostBasisSol: true,
      unrealizedPnlSol: true,
      realizedPnlSol: true,
      totalPnlSol: true,
    },
    orderBy: {
      currentHoldingsValueSol: 'desc',
    },
  });

  console.log(`Found ${analysisResults.length} analysis results\n`);

  // Show top 10 holdings
  console.log('Top 10 holdings by currentHoldingsValueSol:');
  analysisResults.slice(0, 10).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.tokenAddress.slice(0, 8)}...`);
    console.log(`     Balance: ${r.currentUiBalance}`);
    console.log(`     Holdings Value SOL: ${r.currentHoldingsValueSol}`);
    console.log(`     Holdings Value USD: ${r.currentHoldingsValueUsd}`);
    console.log(`     Cost Basis SOL: ${r.currentHoldingsCostBasisSol}`);
    console.log(`     Unrealized P/L SOL: ${r.unrealizedPnlSol}`);
    console.log('');
  });

  // 2. Aggregate exactly as HUD service does
  console.log('📈 HUD Service Query (gt: 0 filter):');
  const hudAggregatePositive = await prisma.analysisResult.aggregate({
    where: {
      walletAddress,
      currentHoldingsValueSol: { not: null, gt: 0 },
    },
    _sum: {
      currentHoldingsValueSol: true,
      currentHoldingsValueUsd: true,
    },
    _count: true,
  });

  console.log('  Records included (gt: 0):', hudAggregatePositive._count);
  console.log('  Sum SOL:', hudAggregatePositive._sum.currentHoldingsValueSol);
  console.log('  Sum USD:', hudAggregatePositive._sum.currentHoldingsValueUsd);
  console.log('');

  // 3. Aggregate WITHOUT the gt: 0 filter
  console.log('📈 All records (no filter):');
  const hudAggregateAll = await prisma.analysisResult.aggregate({
    where: {
      walletAddress,
      currentHoldingsValueSol: { not: null },
    },
    _sum: {
      currentHoldingsValueSol: true,
      currentHoldingsValueUsd: true,
    },
    _count: true,
  });

  console.log('  Records included (all):', hudAggregateAll._count);
  console.log('  Sum SOL:', hudAggregateAll._sum.currentHoldingsValueSol);
  console.log('  Sum USD:', hudAggregateAll._sum.currentHoldingsValueUsd);
  console.log('');

  // 4. Check for NEGATIVE values
  console.log('⚠️  Records with NEGATIVE currentHoldingsValueSol:');
  const negativeRecords = await prisma.analysisResult.findMany({
    where: {
      walletAddress,
      currentHoldingsValueSol: { lt: 0 },
    },
    select: {
      tokenAddress: true,
      currentUiBalance: true,
      currentHoldingsValueSol: true,
      currentHoldingsValueUsd: true,
      currentHoldingsCostBasisSol: true,
      unrealizedPnlSol: true,
    },
  });

  console.log(`Found ${negativeRecords.length} records with negative holdings value`);
  negativeRecords.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.tokenAddress.slice(0, 8)}...`);
    console.log(`     Holdings Value SOL: ${r.currentHoldingsValueSol} ❌ NEGATIVE!`);
    console.log(`     Holdings Value USD: ${r.currentHoldingsValueUsd}`);
    console.log(`     Unrealized P/L SOL: ${r.unrealizedPnlSol}`);
    console.log('');
  });

  // 5. Check for ZERO or NULL values
  console.log('📊 Records with ZERO or NULL currentHoldingsValueSol:');
  const zeroOrNullRecords = await prisma.analysisResult.findMany({
    where: {
      walletAddress,
      OR: [
        { currentHoldingsValueSol: null },
        { currentHoldingsValueSol: 0 },
      ],
    },
    select: {
      tokenAddress: true,
      currentUiBalance: true,
      currentHoldingsValueSol: true,
      currentHoldingsValueUsd: true,
    },
  });

  console.log(`Found ${zeroOrNullRecords.length} records with zero/null holdings value`);
  console.log('');

  // 6. Sum unrealized P/L (to see if that matches the -218.8 SOL)
  console.log('📉 Unrealized P/L aggregate:');
  const unrealizedPnlAggregate = await prisma.analysisResult.aggregate({
    where: {
      walletAddress,
      unrealizedPnlSol: { not: null },
    },
    _sum: {
      unrealizedPnlSol: true,
      realizedPnlSol: true,
      totalPnlSol: true,
    },
  });

  console.log('  Sum Unrealized P/L SOL:', unrealizedPnlAggregate._sum.unrealizedPnlSol);
  console.log('  Sum Realized P/L SOL:', unrealizedPnlAggregate._sum.realizedPnlSol);
  console.log('  Sum Total P/L SOL:', unrealizedPnlAggregate._sum.totalPnlSol);
  console.log('');

  // 7. Get PnL summary for comparison
  console.log('📊 PnL Summary (wallet-level):');
  const pnlSummary = await prisma.walletPnlSummary.findUnique({
    where: { walletAddress },
    select: {
      realizedPnl: true,
      unrealizedPnl: true,
      netPnl: true,
    },
  });

  if (pnlSummary) {
    console.log('  Realized PnL:', pnlSummary.realizedPnl);
    console.log('  Unrealized PnL:', pnlSummary.unrealizedPnl);
    console.log('  Net PnL:', pnlSummary.netPnl);
  } else {
    console.log('  No PnL summary found');
  }

  console.log('\n✅ Investigation complete!\n');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
