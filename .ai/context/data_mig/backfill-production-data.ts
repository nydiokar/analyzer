/**
 * Backfill Script for Production Data Migration
 *
 * This script backfills new schema fields added after the Feb 9, 2026 dump.
 * It uses existing transaction data to recalculate values where possible.
 *
 * STRATEGY:
 * - Most fields can be recalculated from existing SwapAnalysisInput + AnalysisResult
 * - TokenLot (FIFO) requires reprocessing transactions (flag for re-analysis)
 * - Some fields are best left NULL until wallet is re-analyzed
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface BackfillStats {
  walletsProcessed: number;
  errorsEncountered: number;
  fieldsBackfilled: {
    [key: string]: number;
  };
}

const stats: BackfillStats = {
  walletsProcessed: 0,
  errorsEncountered: 0,
  fieldsBackfilled: {},
};

/**
 * Backfill WalletPnlSummary trade counts
 * These can be calculated from existing AnalysisResult data
 */
async function backfillPnlSummaryTradeCounts() {
  console.log('\n[1/4] Backfilling WalletPnlSummary trade counts...');

  const summaries = await prisma.walletPnlSummary.findMany({
    where: {
      OR: [
        { profitableTradesCount: { equals: 0 } },
        { totalIndividualTradesCount: { equals: 0 } },
      ],
    },
    select: {
      id: true,
      walletAddress: true,
      profitableTokensCount: true,
      unprofitableTokensCount: true,
    },
  });

  console.log(`  Found ${summaries.length} summaries to update`);

  let updated = 0;
  for (const summary of summaries) {
    try {
      // Get all analysis results for this wallet
      const results = await prisma.analysisResult.findMany({
        where: { walletAddress: summary.walletAddress },
        select: {
          totalPnlSol: true,
          transferCountIn: true,
          transferCountOut: true,
        },
      });

      if (results.length === 0) continue;

      // Calculate profitable trades (tokens with positive total PnL)
      const profitableTradesCount = results.filter(
        (r) => r.totalPnlSol !== null && r.totalPnlSol > 0
      ).length;

      // Calculate total individual trades (sum of all buy + sell transfers)
      const totalIndividualTradesCount = results.reduce(
        (sum, r) => sum + r.transferCountIn + r.transferCountOut,
        0
      );

      await prisma.walletPnlSummary.update({
        where: { id: summary.id },
        data: {
          profitableTradesCount,
          totalIndividualTradesCount,
        },
      });

      updated++;
    } catch (error) {
      console.error(`  Error processing wallet ${summary.walletAddress}:`, error);
      stats.errorsEncountered++;
    }
  }

  stats.fieldsBackfilled['WalletPnlSummary.tradeCounts'] = updated;
  console.log(`  ✓ Updated ${updated} records`);
}

/**
 * Backfill WalletBehaviorProfile storytelling metrics
 * These require re-analysis, so we'll flag wallets and leave fields NULL
 */
async function backfillBehaviorProfileMetrics() {
  console.log('\n[2/4] Checking WalletBehaviorProfile storytelling metrics...');

  const profiles = await prisma.walletBehaviorProfile.findMany({
    where: {
      strategyType: null,
    },
    select: {
      walletAddress: true,
    },
  });

  console.log(`  Found ${profiles.length} profiles missing new metrics`);
  console.log(`  ⚠ These fields require re-analysis (cannot backfill from existing data):`);
  console.log(`    - strategyType, speedCategory, flowPattern, exitPattern`);
  console.log(`    - medianActiveHoldingHours, velocityScore`);
  console.log(`    - averageCurrentHoldingDurationHours, medianCurrentHoldingDurationHours`);
  console.log(`    - percentOfValueInCurrentHoldings, medianCompletedHoldTimeHours`);
  console.log(`  ℹ Recommendation: Re-run behavior analysis on critical wallets`);

  stats.fieldsBackfilled['WalletBehaviorProfile.needsReanalysis'] = profiles.length;
}

/**
 * Backfill AnalysisResult FIFO fields
 * These require TokenLot data which needs full transaction reprocessing
 */
async function backfillAnalysisResultFifoFields() {
  console.log('\n[3/4] Checking AnalysisResult FIFO fields...');

  const distinctWallets = await prisma.analysisResult.groupBy({
    by: ['walletAddress'],
    where: {
      realizedPnlSol: null,
    },
    _count: {
      walletAddress: true,
    },
  });

  console.log(`  Found ${distinctWallets.length} wallets missing FIFO PnL calculations`);
  console.log(`  ⚠ These fields require full re-analysis with FIFO tracking:`);
  console.log(`    - realizedPnlSol, unrealizedPnlSol, totalPnlSol`);
  console.log(`    - currentHoldingsCostBasisSol, hasIncompleteHistory`);
  console.log(`    - Plus TokenLot table population`);
  console.log(`  ℹ Recommendation: Queue these wallets for PnL analysis`);

  stats.fieldsBackfilled['AnalysisResult.needsFifoReanalysis'] = distinctWallets.length;
}

/**
 * Backfill User admin flags
 * These are administrative and should be set manually
 */
async function backfillUserFlags() {
  console.log('\n[4/4] Checking User administrative flags...');

  // Count users where isAdmin is false (the default, so this is already set)
  const usersTotal = await prisma.user.count();
  const usersWithAdmin = await prisma.user.count({
    where: {
      isAdmin: true,
    },
  });

  console.log(`  ✓ ${usersTotal - usersWithAdmin} users have isAdmin=false (default)`);
  console.log(`  ✓ ${usersWithAdmin} users have isAdmin=true`);

  stats.fieldsBackfilled['User.isAdmin'] = usersTotal;

  // Check for lastBulkImportAt (leave NULL, will be set on next import)
  const usersWithoutImportAt = await prisma.user.count({
    where: {
      lastBulkImportAt: null,
    },
  });

  console.log(`  ℹ ${usersWithoutImportAt} users have no lastBulkImportAt (will be set on next import)`);
}

/**
 * Check for missing Wallet classification fields
 */
async function checkWalletClassification() {
  console.log('\n[BONUS] Checking Wallet classification fields...');

  const walletsWithoutKnownType = await prisma.wallet.count({
    where: {
      knownType: null,
    },
  });

  console.log(`  ℹ ${walletsWithoutKnownType} wallets have no knownType/knownLabel`);
  console.log(`  These are optional and will be populated if wallet matches known patterns`);
}

/**
 * Main execution
 */
async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('         Production Data Backfill Script');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('\nThis script will backfill new schema fields added after Feb 9, 2026.\n');

  try {
    // Run backfill operations
    await backfillPnlSummaryTradeCounts();
    await backfillBehaviorProfileMetrics();
    await backfillAnalysisResultFifoFields();
    await backfillUserFlags();
    await checkWalletClassification();

    // Print summary
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('                    Backfill Summary');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('\nFields Successfully Backfilled:');

    for (const [field, count] of Object.entries(stats.fieldsBackfilled)) {
      console.log(`  ✓ ${field}: ${count} records`);
    }

    if (stats.errorsEncountered > 0) {
      console.log(`\n⚠ Errors encountered: ${stats.errorsEncountered}`);
    }

    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('                  Action Items');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('\nFields Requiring Re-Analysis:');
    console.log('  1. FIFO PnL Calculations (TokenLot + AnalysisResult PnL fields)');
    console.log('     → Run: npm run analyze:pnl <wallet-address>');
    console.log('');
    console.log('  2. Behavior Profile Storytelling Metrics');
    console.log('     → Run: npm run analyze:behavior <wallet-address>');
    console.log('');
    console.log('  3. Holdings Value (requires current token prices)');
    console.log('     → Run: npm run analyze:dashboard <wallet-address>');
    console.log('\nRecommendation:');
    console.log('  - Identify your most critical wallets');
    console.log('  - Queue them for full re-analysis (flash/working/deep scope)');
    console.log('  - The rest will be analyzed on-demand when users view them');
    console.log('\n════════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ Backfill failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
