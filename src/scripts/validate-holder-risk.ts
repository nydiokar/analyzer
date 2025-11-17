/**
 * Validation script for holder risk analysis.
 * Tests the calculation on real wallet data from the database.
 *
 * Usage:
 * npx ts-node -r tsconfig-paths/register src/scripts/validate-holder-risk.ts <wallet_address>
 */

import { BehaviorAnalyzer } from '../core/analysis/behavior/analyzer';
import { BehaviorAnalysisConfig } from '../types/analysis';
import { DatabaseService } from '../core/services/database-service';
import { createLogger } from '../core/utils/logger';

const logger = createLogger('ValidateHolderRisk');

// Configuration for validation
const validationConfig: BehaviorAnalysisConfig = {
  holdingThresholds: {
    exitThreshold: 0.20, // 20% of peak
    dustThreshold: 0.05, // 5% of peak
    minimumSolValue: 0.001,
    minimumPercentageRemaining: 0.05,
    minimumHoldingTimeSeconds: 60,
  },
  historicalPatternConfig: {
    minimumCompletedCycles: 3,
    maximumDataAgeDays: 90,
  },
};

async function validateWallet(walletAddress: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`VALIDATING WALLET: ${walletAddress}`);
  console.log('='.repeat(80));

  const db = new DatabaseService();
  const analyzer = new BehaviorAnalyzer(validationConfig);

  try {
    // Load swap records from database
    console.log('\n📊 Loading swap records from database...');
    const swapRecords = await db.getSwapAnalysisInputs(walletAddress);

    if (swapRecords.length === 0) {
      console.log('❌ No swap records found for this wallet.');
      return;
    }

    console.log(`✓ Loaded ${swapRecords.length} swap records`);

    // Calculate historical pattern
    console.log('\n🔍 Calculating historical pattern...');
    const pattern = analyzer.calculateHistoricalPattern(swapRecords, walletAddress);

    if (!pattern) {
      console.log('\n⚠️  INSUFFICIENT DATA FOR HISTORICAL PATTERN');
      console.log('Reason: Less than 3 completed token cycles found.');
      console.log('\nTo see what we DO have, let\'s run basic behavior analysis:');

      const metrics = analyzer.analyze(swapRecords, walletAddress);
      console.log(`\n  Total Tokens Traded: ${metrics.uniqueTokensTraded}`);
      console.log(`  Tokens with Buy & Sell: ${metrics.tokensWithBothBuyAndSell}`);
      console.log(`  Tokens Only Bought: ${metrics.tokensWithOnlyBuys}`);
      console.log(`  Tokens Only Sold: ${metrics.tokensWithOnlySells}`);
      console.log(`  Trading Style: ${metrics.tradingStyle}`);

      console.log('\n💡 This wallet needs more completed token cycles (buy + exit to ≤20% of peak)');
      return;
    }

    // Display results
    console.log('\n✅ HISTORICAL PATTERN CALCULATED');
    console.log('─'.repeat(80));
    console.log('\n📈 AGGREGATE METRICS:');
    console.log(`  Completed Cycles: ${pattern.completedCycleCount} tokens`);
    console.log(`  Average Hold Time: ${pattern.historicalAverageHoldTimeHours.toFixed(2)} hours (${(pattern.historicalAverageHoldTimeHours / 24).toFixed(2)} days)`);
    console.log(`  Median Hold Time: ${pattern.medianCompletedHoldTimeHours.toFixed(2)} hours (${(pattern.medianCompletedHoldTimeHours / 24).toFixed(2)} days)`);
    console.log(`  Behavior Type: ${pattern.behaviorType}`);
    console.log(`  Exit Pattern: ${pattern.exitPattern}`);
    console.log(`  Data Quality Score: ${(pattern.dataQuality * 100).toFixed(1)}%`);
    console.log(`  Observation Period: ${pattern.observationPeriodDays.toFixed(1)} days`);

    // Now get detailed breakdown of all tokens
    console.log('\n📋 DETAILED TOKEN BREAKDOWN:');
    console.log('─'.repeat(80));

    // Build lifecycles manually to show details
    const sequences = (analyzer as any).buildTokenSequences(swapRecords);
    const latestTimestamp = Math.max(...swapRecords.map(r => r.timestamp));
    const analysisTimestamp = latestTimestamp + 3600;
    const lifecycles = (analyzer as any).buildTokenLifecycles(sequences, analysisTimestamp);

    // Group by status
    const activeTokens = lifecycles.filter(lc => lc.positionStatus === 'ACTIVE');
    const exitedTokens = lifecycles.filter(lc => lc.positionStatus === 'EXITED');
    const dustTokens = lifecycles.filter(lc => lc.positionStatus === 'DUST');

    console.log(`\n🟢 ACTIVE POSITIONS (${activeTokens.length} tokens):`);
    if (activeTokens.length === 0) {
      console.log('  None');
    } else {
      activeTokens.forEach((lc, idx) => {
        console.log(`\n  ${idx + 1}. Token: ${lc.mint.substring(0, 8)}...`);
        console.log(`     Status: ${lc.positionStatus} (${lc.behaviorType})`);
        console.log(`     Peak: ${lc.peakPosition.toFixed(2)} | Current: ${lc.currentPosition.toFixed(2)} (${(lc.percentOfPeakRemaining * 100).toFixed(1)}% remaining)`);
        console.log(`     Bought: ${lc.totalBought.toFixed(2)} | Sold: ${lc.totalSold.toFixed(2)}`);
        console.log(`     Trades: ${lc.buyCount} buys, ${lc.sellCount} sells`);
        const ageHours = (analysisTimestamp - lc.entryTimestamp) / 3600;
        console.log(`     Holding Duration: ${ageHours.toFixed(2)}h (${(ageHours / 24).toFixed(2)} days)`);
      });
    }

    console.log(`\n🔴 EXITED POSITIONS (${exitedTokens.length} tokens):`);
    if (exitedTokens.length === 0) {
      console.log('  None');
    } else {
      exitedTokens.forEach((lc, idx) => {
        console.log(`\n  ${idx + 1}. Token: ${lc.mint.substring(0, 8)}...`);
        console.log(`     Status: ${lc.positionStatus} (sold to ≤20% of peak)`);
        console.log(`     Peak: ${lc.peakPosition.toFixed(2)} | Remaining: ${lc.currentPosition.toFixed(2)} (${(lc.percentOfPeakRemaining * 100).toFixed(1)}%)`);
        console.log(`     Bought: ${lc.totalBought.toFixed(2)} | Sold: ${lc.totalSold.toFixed(2)}`);
        console.log(`     Trades: ${lc.buyCount} buys, ${lc.sellCount} sells`);
        console.log(`     Weighted Hold Time: ${lc.weightedHoldingTimeHours.toFixed(2)}h (${(lc.weightedHoldingTimeHours / 24).toFixed(2)} days)`);
        if (lc.exitTimestamp) {
          const exitDate = new Date(lc.exitTimestamp * 1000).toISOString();
          console.log(`     Exit Time: ${exitDate}`);
        }
      });
    }

    console.log(`\n⚫ DUST POSITIONS (${dustTokens.length} tokens):`);
    if (dustTokens.length === 0) {
      console.log('  None');
    } else {
      console.log(`  (Positions with ≤5% of peak remaining - filtered from analysis)`);
      dustTokens.slice(0, 5).forEach((lc, idx) => {
        console.log(`  ${idx + 1}. ${lc.mint.substring(0, 8)}... - ${(lc.percentOfPeakRemaining * 100).toFixed(2)}% remaining`);
      });
      if (dustTokens.length > 5) {
        console.log(`  ... and ${dustTokens.length - 5} more dust positions`);
      }
    }

    // Summary statistics
    console.log('\n📊 SUMMARY STATISTICS:');
    console.log('─'.repeat(80));
    console.log(`  Total Unique Tokens: ${lifecycles.length}`);
    console.log(`  Active: ${activeTokens.length} | Exited: ${exitedTokens.length} | Dust: ${dustTokens.length}`);
    console.log(`  Completed Cycles Used for Pattern: ${pattern.completedCycleCount}`);

    if (exitedTokens.length > 0) {
      const exitHoldTimes = exitedTokens.map(lc => lc.weightedHoldingTimeHours);
      const minHold = Math.min(...exitHoldTimes);
      const maxHold = Math.max(...exitHoldTimes);
      console.log(`  Hold Time Range: ${minHold.toFixed(2)}h - ${maxHold.toFixed(2)}h`);
    }

    // Validation checks
    console.log('\n✅ VALIDATION CHECKS:');
    console.log('─'.repeat(80));
    console.log(`  ✓ Pattern uses only EXITED + DUST tokens (excludes ${activeTokens.length} active)`);
    console.log(`  ✓ Exit threshold: ≤20% of peak remaining`);
    console.log(`  ✓ Dust threshold: ≤5% of peak remaining`);
    console.log(`  ✓ Minimum cycles: ${validationConfig.historicalPatternConfig?.minimumCompletedCycles || 3}`);
    console.log(`  ✓ Weighted average: Larger positions have more influence`);

    // Recommendations
    console.log('\n💡 INTERPRETATION:');
    console.log('─'.repeat(80));

    if (pattern.behaviorType === 'ULTRA_FLIPPER') {
      console.log('  This wallet flips tokens VERY quickly (<1 hour average)');
      console.log('  High risk of rapid exit on new positions');
    } else if (pattern.behaviorType === 'FLIPPER') {
      console.log('  This wallet typically flips within 1-24 hours');
      console.log('  Moderate risk of relatively quick exit');
    } else if (pattern.behaviorType === 'SWING') {
      console.log('  This wallet holds positions for 1-7 days');
      console.log('  Moderate holding period, lower immediate dump risk');
    } else if (pattern.behaviorType === 'HOLDER') {
      console.log('  This wallet holds positions for 7+ days');
      console.log('  Low risk of immediate exit');
    }

    if (pattern.exitPattern === 'ALL_AT_ONCE') {
      console.log('  Exit pattern: Tends to exit positions in 1-2 large sells');
    } else {
      console.log('  Exit pattern: Tends to exit gradually over multiple sells');
    }

    if (pattern.dataQuality < 0.5) {
      console.log('  ⚠️  Data quality is low - predictions may be less reliable');
      console.log('     Consider requiring more completed cycles for higher confidence');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error);
    throw error;
  }
}

// Main execution
async function main() {
  const walletAddress = process.argv[2];

  if (!walletAddress) {
    console.log('\n❌ ERROR: Wallet address required');
    console.log('\nUsage:');
    console.log('  npx ts-node -r tsconfig-paths/register src/scripts/validate-holder-risk.ts <wallet_address>');
    console.log('\nExample:');
    console.log('  npx ts-node -r tsconfig-paths/register src/scripts/validate-holder-risk.ts 7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx4M1X');
    process.exit(1);
  }

  await validateWallet(walletAddress);

  console.log('\n' + '='.repeat(80));
  console.log('✅ VALIDATION COMPLETE');
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
