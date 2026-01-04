/**
 * Comprehensive FIFO diagnostic script for any wallet
 *
 * Usage: npx ts-node -r tsconfig-paths/register scripts/diagnose-wallet-fifo.ts <WALLET_ADDRESS>
 *
 * Shows:
 * - Tokens with incomplete history
 * - Balance mismatches (currentUiBalance vs calculated)
 * - Recent analysis runs and their scopes
 * - FIFO lot state
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const walletAddress = process.argv[2];

if (!walletAddress) {
  console.error('Usage: npx ts-node -r tsconfig-paths/register scripts/diagnose-wallet-fifo.ts <WALLET_ADDRESS>');
  process.exit(1);
}

async function main() {
  console.log('\n🔍 FIFO DIAGNOSTIC FOR WALLET\n');
  console.log(`Wallet: ${walletAddress}\n`);
  console.log('═'.repeat(120));

  // 1. Check for incomplete history tokens
  console.log('\n📊 TOKENS WITH INCOMPLETE HISTORY:\n');
  const incompleteTokens = await prisma.analysisResult.findMany({
    where: {
      walletAddress,
      hasIncompleteHistory: true,
    },
    select: {
      tokenAddress: true,
      totalAmountIn: true,
      totalAmountOut: true,
      currentUiBalance: true,
      realizedPnlSol: true,
      hasIncompleteHistory: true,
      updatedAt: true,
    },
  });

  if (incompleteTokens.length === 0) {
    console.log('   ✅ No tokens with incomplete history!');
  } else {
    console.log(`   ❌ Found ${incompleteTokens.length} tokens with incomplete history:\n`);
    for (const token of incompleteTokens) {
      const diff = token.totalAmountIn - token.totalAmountOut;
      console.log(`   Token: ${token.tokenAddress.substring(0, 40)}...`);
      console.log(`      totalAmountIn:  ${token.totalAmountIn.toLocaleString()}`);
      console.log(`      totalAmountOut: ${token.totalAmountOut.toLocaleString()}`);
      console.log(`      Difference:     ${diff.toLocaleString()} (should be ≈0 for fully sold)`);
      console.log(`      realizedPnlSol: ${token.realizedPnlSol ?? 'NULL'}`);
      console.log(`      updatedAt:      ${token.updatedAt.toISOString()}`);
      console.log('');
    }
  }

  // 2. Check for balance mismatches
  console.log('\n💰 BALANCE CONSISTENCY CHECK:\n');
  const allTokens = await prisma.analysisResult.findMany({
    where: { walletAddress },
    select: {
      tokenAddress: true,
      totalAmountIn: true,
      totalAmountOut: true,
      currentUiBalance: true,
    },
  });

  const balanceMismatches = allTokens.filter(t => {
    const calculated = t.totalAmountIn - t.totalAmountOut;
    const current = t.currentUiBalance ?? 0;
    return Math.abs(calculated - current) > 100; // Tolerance
  });

  if (balanceMismatches.length === 0) {
    console.log('   ✅ All token balances match (IN - OUT = currentUiBalance)');
  } else {
    console.log(`   ⚠️  Found ${balanceMismatches.length} tokens with balance mismatches:\n`);
    for (const token of balanceMismatches) {
      const calculated = token.totalAmountIn - token.totalAmountOut;
      const current = token.currentUiBalance ?? 0;
      const diff = calculated - current;
      console.log(`   Token: ${token.tokenAddress.substring(0, 40)}...`);
      console.log(`      Calculated (IN - OUT): ${calculated.toLocaleString()}`);
      console.log(`      Current balance:       ${current.toLocaleString()}`);
      console.log(`      Mismatch:              ${diff.toLocaleString()} ❌`);
      console.log('');
    }
  }

  // 3. Check recent analysis runs
  console.log('\n📅 RECENT ANALYSIS RUNS:\n');
  const recentRuns = await prisma.analysisRun.findMany({
    where: { walletAddress },
    orderBy: { runTimestamp: 'desc' },
    take: 5,
    select: {
      id: true,
      serviceInvoked: true,
      status: true,
      runTimestamp: true,
      inputDataStartTs: true,
      inputDataEndTs: true,
    },
  });

  if (recentRuns.length === 0) {
    console.log('   ⚠️  No analysis runs found for this wallet');
  } else {
    for (const run of recentRuns) {
      const hasTimeRange = run.inputDataStartTs || run.inputDataEndTs;
      const scope = hasTimeRange ? 'time-ranged (flash/working)' : 'deep (full history)';
      console.log(`   ${run.runTimestamp.toISOString()} - ${run.serviceInvoked}`);
      console.log(`      Status: ${run.status}, Scope: ${scope}`);
    }
  }

  // 4. Check wallet PnL summary
  console.log('\n💵 WALLET PNL SUMMARY:\n');
  const pnlSummary = await prisma.walletPnlSummary.findUnique({
    where: { walletAddress },
    select: {
      realizedPnl: true,
      unrealizedPnl: true,
      netPnl: true,
      updatedAt: true,
    },
  });

  if (pnlSummary) {
    console.log(`   Realized PnL:   ${pnlSummary.realizedPnl.toFixed(4)} SOL`);
    console.log(`   Unrealized PnL: ${pnlSummary.unrealizedPnl.toFixed(4)} SOL`);
    console.log(`   Net PnL:        ${pnlSummary.netPnl.toFixed(4)} SOL`);
    console.log(`   Updated:        ${pnlSummary.updatedAt.toISOString()}`);
  } else {
    console.log('   ⚠️  No PnL summary found for this wallet');
  }

  // 5. Check TokenLots
  console.log('\n📦 FIFO LOTS SUMMARY:\n');
  const lots = await prisma.tokenLot.findMany({
    where: { walletAddress },
    select: {
      tokenAddress: true,
      status: true,
    },
  });

  if (lots.length === 0) {
    console.log('   ⚠️  No FIFO lots found (wallet may need re-analysis)');
  } else {
    const lotsByStatus = lots.reduce((acc, lot) => {
      acc[lot.status] = (acc[lot.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log(`   Total lots: ${lots.length}`);
    for (const [status, count] of Object.entries(lotsByStatus)) {
      console.log(`      ${status}: ${count}`);
    }

    const uniqueTokens = new Set(lots.map(l => l.tokenAddress)).size;
    console.log(`   Unique tokens with lots: ${uniqueTokens}`);
  }

  console.log('\n═'.repeat(120));
  console.log('\n💡 RECOMMENDATIONS:\n');

  if (incompleteTokens.length > 0) {
    console.log('   ❌ Incomplete history detected - these tokens show wrong PnL!');
    console.log('   → Re-run full analysis to regenerate FIFO lots\n');
  }

  if (balanceMismatches.length > 0) {
    console.log('   ⚠️  Balance mismatches detected - stale balance data!');
    console.log('   → Trigger dashboard refresh to fetch fresh balances\n');
  }

  if (incompleteTokens.length === 0 && balanceMismatches.length === 0) {
    console.log('   ✅ Wallet looks healthy! FIFO and balances are consistent.\n');
  }

  console.log('═'.repeat(120) + '\n');

  await prisma.$disconnect();
}

main().catch(console.error);
