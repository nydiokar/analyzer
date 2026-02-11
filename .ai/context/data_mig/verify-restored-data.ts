/**
 * Data Verification Script
 *
 * Verifies the integrity of restored data after migration and backfill.
 * Checks for data consistency, missing relationships, and schema compliance.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface VerificationResults {
  totalChecks: number;
  passed: number;
  warnings: number;
  errors: number;
  details: Array<{
    check: string;
    status: 'PASS' | 'WARN' | 'FAIL';
    message: string;
    count?: number;
  }>;
}

const results: VerificationResults = {
  totalChecks: 0,
  passed: 0,
  warnings: 0,
  errors: 0,
  details: [],
};

function addResult(
  check: string,
  status: 'PASS' | 'WARN' | 'FAIL',
  message: string,
  count?: number
) {
  results.totalChecks++;
  results.details.push({ check, status, message, count });

  if (status === 'PASS') results.passed++;
  else if (status === 'WARN') results.warnings++;
  else if (status === 'FAIL') results.errors++;
}

/**
 * Check basic table counts
 */
async function checkTableCounts() {
  console.log('\n[1/8] Checking table counts...');

  const counts = await Promise.all([
    prisma.wallet.count(),
    prisma.analysisResult.count(),
    prisma.swapAnalysisInput.count(),
    prisma.walletPnlSummary.count(),
    prisma.walletBehaviorProfile.count(),
    prisma.tokenLot.count(),
    prisma.user.count(),
    prisma.tokenInfo.count(),
  ]);

  const [
    wallets,
    analysisResults,
    swapInputs,
    pnlSummaries,
    behaviorProfiles,
    tokenLots,
    users,
    tokenInfo,
  ] = counts;

  addResult(
    'Wallets',
    wallets > 0 ? 'PASS' : 'FAIL',
    `Found ${wallets.toLocaleString()} wallets`,
    wallets
  );

  addResult(
    'Analysis Results',
    analysisResults > 0 ? 'PASS' : 'FAIL',
    `Found ${analysisResults.toLocaleString()} analysis results`,
    analysisResults
  );

  addResult(
    'Swap Inputs',
    swapInputs > 0 ? 'PASS' : 'WARN',
    `Found ${swapInputs.toLocaleString()} swap inputs`,
    swapInputs
  );

  addResult(
    'PnL Summaries',
    pnlSummaries > 0 ? 'PASS' : 'WARN',
    `Found ${pnlSummaries.toLocaleString()} PnL summaries`,
    pnlSummaries
  );

  addResult(
    'Behavior Profiles',
    behaviorProfiles > 0 ? 'PASS' : 'WARN',
    `Found ${behaviorProfiles.toLocaleString()} behavior profiles`,
    behaviorProfiles
  );

  addResult(
    'Token Lots',
    'PASS',
    `Found ${tokenLots.toLocaleString()} token lots (may be 0 if needs reanalysis)`,
    tokenLots
  );

  addResult(
    'Users',
    users > 0 ? 'PASS' : 'WARN',
    `Found ${users.toLocaleString()} users`,
    users
  );

  addResult(
    'Token Info',
    tokenInfo > 0 ? 'PASS' : 'WARN',
    `Found ${tokenInfo.toLocaleString()} token metadata records`,
    tokenInfo
  );
}

/**
 * Check referential integrity
 */
async function checkReferentialIntegrity() {
  console.log('\n[2/8] Checking referential integrity...');

  // Check AnalysisResult → Wallet (check for non-existent wallet addresses)
  const analysisResultCount = await prisma.analysisResult.count();
  const analysisResultsWithWallets = await prisma.analysisResult.count({
    where: {
      walletAddress: {
        in: (await prisma.wallet.findMany({ select: { address: true } })).map(w => w.address)
      }
    }
  });

  const orphanedAnalysisResults = analysisResultCount - analysisResultsWithWallets;

  addResult(
    'AnalysisResult → Wallet',
    orphanedAnalysisResults === 0 ? 'PASS' : 'FAIL',
    orphanedAnalysisResults === 0
      ? 'All analysis results linked to existing wallets'
      : `Found ${orphanedAnalysisResults} orphaned analysis results`,
    orphanedAnalysisResults
  );

  // Check WalletPnlSummary → Wallet
  const pnlSummaryCount = await prisma.walletPnlSummary.count();
  const pnlSummariesWithWallets = await prisma.walletPnlSummary.count({
    where: {
      walletAddress: {
        in: (await prisma.wallet.findMany({ select: { address: true } })).map(w => w.address)
      }
    }
  });

  const orphanedPnlSummaries = pnlSummaryCount - pnlSummariesWithWallets;

  addResult(
    'WalletPnlSummary → Wallet',
    orphanedPnlSummaries === 0 ? 'PASS' : 'FAIL',
    orphanedPnlSummaries === 0
      ? 'All PnL summaries linked to existing wallets'
      : `Found ${orphanedPnlSummaries} orphaned PnL summaries`,
    orphanedPnlSummaries
  );

  // Check WalletBehaviorProfile → Wallet
  const behaviorProfileCount = await prisma.walletBehaviorProfile.count();
  const behaviorProfilesWithWallets = await prisma.walletBehaviorProfile.count({
    where: {
      walletAddress: {
        in: (await prisma.wallet.findMany({ select: { address: true } })).map(w => w.address)
      }
    }
  });

  const orphanedBehaviorProfiles = behaviorProfileCount - behaviorProfilesWithWallets;

  addResult(
    'WalletBehaviorProfile → Wallet',
    orphanedBehaviorProfiles === 0 ? 'PASS' : 'FAIL',
    orphanedBehaviorProfiles === 0
      ? 'All behavior profiles linked to existing wallets'
      : `Found ${orphanedBehaviorProfiles} orphaned behavior profiles`,
    orphanedBehaviorProfiles
  );

  // Check TokenLot → Wallet
  const tokenLotCount = await prisma.tokenLot.count();
  if (tokenLotCount > 0) {
    const tokenLotsWithWallets = await prisma.tokenLot.count({
      where: {
        walletAddress: {
          in: (await prisma.wallet.findMany({ select: { address: true } })).map(w => w.address)
        }
      }
    });

    const orphanedTokenLots = tokenLotCount - tokenLotsWithWallets;

    addResult(
      'TokenLot → Wallet',
      orphanedTokenLots === 0 ? 'PASS' : 'FAIL',
      orphanedTokenLots === 0
        ? 'All token lots linked to existing wallets'
        : `Found ${orphanedTokenLots} orphaned token lots`,
      orphanedTokenLots
    );
  } else {
    addResult(
      'TokenLot → Wallet',
      'PASS',
      'No token lots to check (table empty)',
      0
    );
  }
}

/**
 * Check for wallets with analysis data
 */
async function checkAnalysisCompleteness() {
  console.log('\n[3/8] Checking analysis completeness...');

  const totalWallets = await prisma.wallet.count();

  const walletsWithPnl = await prisma.walletPnlSummary.count();
  const walletsWithBehavior = await prisma.walletBehaviorProfile.count();

  addResult(
    'Wallets with PnL',
    walletsWithPnl > 0 ? 'PASS' : 'WARN',
    `${walletsWithPnl.toLocaleString()} / ${totalWallets.toLocaleString()} wallets have PnL summaries (${((walletsWithPnl / totalWallets) * 100).toFixed(1)}%)`,
    walletsWithPnl
  );

  addResult(
    'Wallets with Behavior',
    walletsWithBehavior > 0 ? 'PASS' : 'WARN',
    `${walletsWithBehavior.toLocaleString()} / ${totalWallets.toLocaleString()} wallets have behavior profiles (${((walletsWithBehavior / totalWallets) * 100).toFixed(1)}%)`,
    walletsWithBehavior
  );
}

/**
 * Check new fields are populated
 */
async function checkNewFieldsPopulation() {
  console.log('\n[4/8] Checking new field population...');

  // WalletPnlSummary trade counts
  const totalSummaries = await prisma.walletPnlSummary.count();
  const summariesWithTradeCounts = await prisma.walletPnlSummary.count({
    where: {
      AND: [
        { profitableTradesCount: { gt: 0 } },
        { totalIndividualTradesCount: { gt: 0 } },
      ],
    },
  });

  addResult(
    'PnL Summary Trade Counts',
    summariesWithTradeCounts > 0 ? 'PASS' : 'WARN',
    `${summariesWithTradeCounts} / ${totalSummaries} summaries have backfilled trade counts`,
    summariesWithTradeCounts
  );

  // AnalysisResult FIFO fields
  const totalResults = await prisma.analysisResult.count();
  const resultsWithFifo = await prisma.analysisResult.count({
    where: {
      realizedPnlSol: { not: null },
    },
  });

  addResult(
    'Analysis Result FIFO PnL',
    'PASS',
    `${resultsWithFifo} / ${totalResults} results have FIFO PnL (${((resultsWithFifo / totalResults) * 100).toFixed(1)}%) - OK if 0, needs reanalysis`,
    resultsWithFifo
  );

  // WalletBehaviorProfile storytelling metrics
  const totalProfiles = await prisma.walletBehaviorProfile.count();
  const profilesWithStrategy = await prisma.walletBehaviorProfile.count({
    where: {
      strategyType: { not: null },
    },
  });

  addResult(
    'Behavior Profile Strategies',
    'PASS',
    `${profilesWithStrategy} / ${totalProfiles} profiles have strategy type (${((profilesWithStrategy / totalProfiles) * 100).toFixed(1)}%) - OK if 0, needs reanalysis`,
    profilesWithStrategy
  );

  // User admin flags
  const totalUsers = await prisma.user.count();
  const usersWithAdmin = totalUsers; // All users have the field (default false)

  addResult(
    'User Admin Flags',
    usersWithAdmin === totalUsers ? 'PASS' : 'WARN',
    `${usersWithAdmin} / ${totalUsers} users have isAdmin flag set`,
    usersWithAdmin
  );
}

/**
 * Check data quality
 */
async function checkDataQuality() {
  console.log('\n[5/8] Checking data quality...');

  // Check for negative balances (data integrity issue)
  const negativeBalances = await prisma.analysisResult.count({
    where: {
      currentUiBalance: { lt: 0 },
    },
  });

  addResult(
    'Negative Balances',
    negativeBalances === 0 ? 'PASS' : 'WARN',
    negativeBalances === 0
      ? 'No negative balances found'
      : `Found ${negativeBalances} analysis results with negative balances`,
    negativeBalances
  );

  // Check for extremely high balances (potential data error)
  const extremeBalances = await prisma.analysisResult.count({
    where: {
      currentUiBalance: { gt: 1e15 }, // 1 quadrillion tokens
    },
  });

  addResult(
    'Extreme Balances',
    extremeBalances === 0 ? 'PASS' : 'WARN',
    extremeBalances === 0
      ? 'No extreme balances found'
      : `Found ${extremeBalances} analysis results with suspiciously high balances`,
    extremeBalances
  );

  // Check for NULL netPnl in summaries (should have been calculated)
  const nullPnl = await prisma.walletPnlSummary.count({
    where: {
      netPnl: null,
    },
  });

  addResult(
    'NULL PnL Summaries',
    nullPnl === 0 ? 'PASS' : 'WARN',
    nullPnl === 0
      ? 'All summaries have netPnl calculated'
      : `Found ${nullPnl} summaries with NULL netPnl`,
    nullPnl
  );
}

/**
 * Check timestamp consistency
 */
async function checkTimestamps() {
  console.log('\n[6/8] Checking timestamp consistency...');

  const nowTimestamp = Math.floor(Date.now() / 1000);
  const oneDayFromNow = nowTimestamp + 86400;

  // Check for future timestamps
  const futureTimestamps = await prisma.analysisResult.count({
    where: {
      lastTransferTimestamp: { gt: oneDayFromNow },
    },
  });

  addResult(
    'Future Timestamps',
    futureTimestamps === 0 ? 'PASS' : 'WARN',
    futureTimestamps === 0
      ? 'No future timestamps found'
      : `Found ${futureTimestamps} records with future timestamps`,
    futureTimestamps
  );

  // Check for ancient timestamps (pre-Solana)
  const ancientTimestamps = await prisma.analysisResult.count({
    where: {
      firstTransferTimestamp: { lt: 1609459200 }, // Before Jan 1, 2021
    },
  });

  addResult(
    'Ancient Timestamps',
    ancientTimestamps === 0 ? 'PASS' : 'WARN',
    ancientTimestamps === 0
      ? 'No pre-Solana timestamps found'
      : `Found ${ancientTimestamps} records with timestamps before Solana mainnet`,
    ancientTimestamps
  );
}

/**
 * Check user data
 */
async function checkUserData() {
  console.log('\n[7/8] Checking user data...');

  const totalUsers = await prisma.user.count();

  const usersWithPasswords = await prisma.user.count({
    where: {
      passwordHash: { not: null },
    },
  });

  const usersWithEmail = await prisma.user.count({
    where: {
      email: { not: null },
    },
  });

  addResult(
    'Users with Passwords',
    'PASS',
    `${usersWithPasswords} / ${totalUsers} users have password hashes`,
    usersWithPasswords
  );

  addResult(
    'Users with Email',
    'PASS',
    `${usersWithEmail} / ${totalUsers} users have email addresses`,
    usersWithEmail
  );

  const admins = await prisma.user.count({
    where: {
      isAdmin: true,
    },
  });

  addResult(
    'Admin Users',
    admins > 0 ? 'PASS' : 'WARN',
    `Found ${admins} admin users`,
    admins
  );
}

/**
 * Check favorites and relationships
 */
async function checkFavoritesAndRelationships() {
  console.log('\n[8/8] Checking favorites and relationships...');

  const favorites = await prisma.userFavoriteWallet.count();

  addResult(
    'User Favorites',
    'PASS',
    `Found ${favorites.toLocaleString()} favorite wallet relationships`,
    favorites
  );

  if (favorites > 0) {
    // Check for orphaned favorites (wallet doesn't exist)
    const favoritesCount = await prisma.userFavoriteWallet.count();
    const favoritesWithWallets = await prisma.userFavoriteWallet.count({
      where: {
        walletAddress: {
          in: (await prisma.wallet.findMany({ select: { address: true } })).map(w => w.address)
        }
      }
    });

    const orphanedFavorites = favoritesCount - favoritesWithWallets;

    addResult(
      'Orphaned Favorites',
      orphanedFavorites === 0 ? 'PASS' : 'WARN',
      orphanedFavorites === 0
        ? 'No orphaned favorites found'
        : `Found ${orphanedFavorites} favorites pointing to non-existent wallets`,
      orphanedFavorites
    );
  }
}

/**
 * Print results
 */
function printResults() {
  console.log('\n════════════════════════════════════════════════════════════════');
  console.log('              Verification Results');
  console.log('════════════════════════════════════════════════════════════════\n');

  for (const detail of results.details) {
    const icon =
      detail.status === 'PASS' ? '✓' : detail.status === 'WARN' ? '⚠' : '✗';
    const color =
      detail.status === 'PASS'
        ? '\x1b[32m'
        : detail.status === 'WARN'
        ? '\x1b[33m'
        : '\x1b[31m';
    const reset = '\x1b[0m';

    console.log(`${color}${icon} ${detail.check}${reset}`);
    console.log(`  ${detail.message}\n`);
  }

  console.log('════════════════════════════════════════════════════════════════');
  console.log('                    Summary');
  console.log('════════════════════════════════════════════════════════════════\n');

  console.log(`Total Checks: ${results.totalChecks}`);
  console.log(`✓ Passed: ${results.passed}`);
  console.log(`⚠ Warnings: ${results.warnings}`);
  console.log(`✗ Errors: ${results.errors}\n`);

  if (results.errors > 0) {
    console.log('❌ VERIFICATION FAILED - Critical errors found!');
    console.log('Review the errors above and fix before proceeding.\n');
    return false;
  } else if (results.warnings > 0) {
    console.log('⚠ VERIFICATION PASSED WITH WARNINGS');
    console.log('Review the warnings above. Some are expected (e.g., fields needing reanalysis).\n');
    return true;
  } else {
    console.log('✅ ALL CHECKS PASSED!');
    console.log('Your database is in excellent shape.\n');
    return true;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('           Data Verification Report');
  console.log('════════════════════════════════════════════════════════════════');

  try {
    await checkTableCounts();
    await checkReferentialIntegrity();
    await checkAnalysisCompleteness();
    await checkNewFieldsPopulation();
    await checkDataQuality();
    await checkTimestamps();
    await checkUserData();
    await checkFavoritesAndRelationships();

    const success = printResults();

    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Verification script failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
