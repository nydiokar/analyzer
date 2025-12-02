/**
 * Comprehensive Behavior Metrics Validation Script
 *
 * Tests the complete behavior analysis response to ensure:
 * 1. All new metrics (historicalPattern, tradingInterpretation) are present and calculated
 * 2. No fallbacks are being used (different values for typical vs economic hold time)
 * 3. Data consistency and correctness
 * 4. Deprecated metrics are still present for backward compatibility
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/validate-behavior-metrics.ts <WALLET_ADDRESS>
 */

import { createLogger } from 'core/utils/logger';
import { DatabaseService } from 'core/services/database-service';
import { BehaviorService } from 'core/analysis/behavior/behavior-service';
import { BehaviorAnalysisConfig } from '@/types/analysis';

const logger = createLogger('BehaviorMetricsValidator');

interface ValidationResult {
  testName: string;
  passed: boolean;
  details: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
}

async function validateBehaviorMetrics(walletAddress: string): Promise<void> {
  logger.info(`\n${'='.repeat(80)}`);
  logger.info(`BEHAVIOR METRICS VALIDATION - Wallet: ${walletAddress}`);
  logger.info(`${'='.repeat(80)}\n`);

  const results: ValidationResult[] = [];

  try {
    // Initialize services
    const databaseService = new DatabaseService();
    const config: BehaviorAnalysisConfig = {
      historicalPatternConfig: {
        minimumCompletedCycles: 3,
        maximumDataAgeDays: 90,
      },
    };
    const behaviorService = new BehaviorService(databaseService, config);

    // Fetch behavior analysis
    logger.info('Fetching behavior analysis...\n');
    const metrics = await behaviorService.analyzeWalletBehavior(walletAddress);

    if (!metrics) {
      logger.error('❌ CRITICAL: No metrics returned (wallet may have no swap data)');
      process.exit(1);
    }

    logger.info('✅ Metrics retrieved successfully\n');
    logger.info(`${'='.repeat(80)}`);
    logger.info('SECTION 1: NEW METRICS VALIDATION');
    logger.info(`${'='.repeat(80)}\n`);

    // ========================================
    // TEST 1: historicalPattern presence
    // ========================================
    if (metrics.historicalPattern) {
      results.push({
        testName: 'historicalPattern - Field Present',
        passed: true,
        details: `✅ historicalPattern exists (${metrics.historicalPattern.completedCycleCount} completed cycles)`,
        severity: 'CRITICAL',
      });

      // Sub-test: All required fields present
      const requiredFields = [
        'walletAddress',
        'historicalAverageHoldTimeHours',
        'completedCycleCount',
        'medianCompletedHoldTimeHours',
        'behaviorType',
        'exitPattern',
        'dataQuality',
        'observationPeriodDays',
      ];

      const missingFields = requiredFields.filter(
        (field) => !(field in metrics.historicalPattern!)
      );

      if (missingFields.length === 0) {
        results.push({
          testName: 'historicalPattern - All Fields Present',
          passed: true,
          details: `✅ All ${requiredFields.length} required fields present`,
          severity: 'CRITICAL',
        });
      } else {
        results.push({
          testName: 'historicalPattern - All Fields Present',
          passed: false,
          details: `❌ Missing fields: ${missingFields.join(', ')}`,
          severity: 'CRITICAL',
        });
      }

      // Display historicalPattern details
      logger.info('Historical Pattern Details:');
      logger.info(`  Wallet Address:          ${metrics.historicalPattern.walletAddress}`);
      logger.info(`  Completed Cycles:        ${metrics.historicalPattern.completedCycleCount}`);
      logger.info(`  Median Hold Time:        ${metrics.historicalPattern.medianCompletedHoldTimeHours.toFixed(3)} hours`);
      logger.info(`  Weighted Avg Hold Time:  ${metrics.historicalPattern.historicalAverageHoldTimeHours.toFixed(3)} hours`);
      logger.info(`  Behavior Type:           ${metrics.historicalPattern.behaviorType}`);
      logger.info(`  Exit Pattern:            ${metrics.historicalPattern.exitPattern}`);
      logger.info(`  Data Quality:            ${(metrics.historicalPattern.dataQuality * 100).toFixed(1)}%`);
      logger.info(`  Observation Period:      ${metrics.historicalPattern.observationPeriodDays.toFixed(1)} days\n`);

      // Sub-test: Median vs Weighted Average should be different (unless all positions same size)
      const medianHold = metrics.historicalPattern.medianCompletedHoldTimeHours;
      const weightedHold = metrics.historicalPattern.historicalAverageHoldTimeHours;
      const difference = Math.abs(medianHold - weightedHold);
      const percentDiff = medianHold > 0 ? (difference / medianHold) * 100 : 0;

      if (medianHold === weightedHold) {
        results.push({
          testName: 'historicalPattern - Median vs Weighted',
          passed: false,
          details: `⚠️  Median (${medianHold.toFixed(3)}h) === Weighted (${weightedHold.toFixed(3)}h) - may indicate fallback or uniform position sizes`,
          severity: 'WARNING',
        });
      } else {
        results.push({
          testName: 'historicalPattern - Median vs Weighted',
          passed: true,
          details: `✅ Median (${medianHold.toFixed(3)}h) ≠ Weighted (${weightedHold.toFixed(3)}h) - ${percentDiff.toFixed(1)}% difference`,
          severity: 'INFO',
        });
      }

      // Sub-test: Data quality validation
      if (metrics.historicalPattern.dataQuality >= 0.7) {
        results.push({
          testName: 'historicalPattern - Data Quality',
          passed: true,
          details: `✅ High data quality: ${(metrics.historicalPattern.dataQuality * 100).toFixed(1)}%`,
          severity: 'INFO',
        });
      } else if (metrics.historicalPattern.dataQuality >= 0.4) {
        results.push({
          testName: 'historicalPattern - Data Quality',
          passed: true,
          details: `⚠️  Medium data quality: ${(metrics.historicalPattern.dataQuality * 100).toFixed(1)}%`,
          severity: 'WARNING',
        });
      } else {
        results.push({
          testName: 'historicalPattern - Data Quality',
          passed: true,
          details: `⚠️  Low data quality: ${(metrics.historicalPattern.dataQuality * 100).toFixed(1)}%`,
          severity: 'WARNING',
        });
      }
    } else {
      results.push({
        testName: 'historicalPattern - Field Present',
        passed: false,
        details: `❌ CRITICAL: historicalPattern is NULL/undefined - calculation not wired up or insufficient completed cycles`,
        severity: 'CRITICAL',
      });
    }

    // ========================================
    // TEST 2: tradingInterpretation presence
    // ========================================
    if (metrics.tradingInterpretation) {
      results.push({
        testName: 'tradingInterpretation - Field Present',
        passed: true,
        details: `✅ tradingInterpretation exists (${metrics.tradingInterpretation.speedCategory})`,
        severity: 'CRITICAL',
      });

      // Sub-test: All required fields
      const requiredFields = [
        'speedCategory',
        'typicalHoldTimeHours',
        'economicHoldTimeHours',
        'economicRisk',
        'behavioralPattern',
        'interpretation',
      ];

      const missingFields = requiredFields.filter(
        (field) => !(field in metrics.tradingInterpretation!)
      );

      if (missingFields.length === 0) {
        results.push({
          testName: 'tradingInterpretation - All Fields Present',
          passed: true,
          details: `✅ All ${requiredFields.length} required fields present`,
          severity: 'CRITICAL',
        });
      } else {
        results.push({
          testName: 'tradingInterpretation - All Fields Present',
          passed: false,
          details: `❌ Missing fields: ${missingFields.join(', ')}`,
          severity: 'CRITICAL',
        });
      }

      // Display tradingInterpretation details
      logger.info('Trading Interpretation Details:');
      logger.info(`  Speed Category:          ${metrics.tradingInterpretation.speedCategory}`);
      logger.info(`  Typical Hold Time:       ${metrics.tradingInterpretation.typicalHoldTimeHours.toFixed(3)} hours`);
      logger.info(`  Economic Hold Time:      ${metrics.tradingInterpretation.economicHoldTimeHours.toFixed(3)} hours`);
      logger.info(`  Economic Risk:           ${metrics.tradingInterpretation.economicRisk}`);
      logger.info(`  Behavioral Pattern:      ${metrics.tradingInterpretation.behavioralPattern}`);
      logger.info(`  Interpretation:          ${metrics.tradingInterpretation.interpretation}\n`);

      // Sub-test: Typical vs Economic should be different (unless using fallback)
      const typical = metrics.tradingInterpretation.typicalHoldTimeHours;
      const economic = metrics.tradingInterpretation.economicHoldTimeHours;

      if (typical === economic) {
        results.push({
          testName: 'tradingInterpretation - Typical vs Economic',
          passed: false,
          details: `❌ CRITICAL: Typical (${typical.toFixed(3)}h) === Economic (${economic.toFixed(3)}h) - historicalPattern likely missing, using fallback!`,
          severity: 'CRITICAL',
        });
      } else {
        const percentDiff = typical > 0 ? (Math.abs(typical - economic) / typical) * 100 : 0;
        results.push({
          testName: 'tradingInterpretation - Typical vs Economic',
          passed: true,
          details: `✅ Typical (${typical.toFixed(3)}h) ≠ Economic (${economic.toFixed(3)}h) - ${percentDiff.toFixed(1)}% difference`,
          severity: 'INFO',
        });
      }

      // Sub-test: Values should match historicalPattern
      if (metrics.historicalPattern) {
        const medianMatch =
          metrics.tradingInterpretation.typicalHoldTimeHours ===
          metrics.historicalPattern.medianCompletedHoldTimeHours;
        const weightedMatch =
          metrics.tradingInterpretation.economicHoldTimeHours ===
          metrics.historicalPattern.historicalAverageHoldTimeHours;

        if (medianMatch && weightedMatch) {
          results.push({
            testName: 'tradingInterpretation - Matches historicalPattern',
            passed: true,
            details: `✅ Values correctly sourced from historicalPattern`,
            severity: 'CRITICAL',
          });
        } else {
          results.push({
            testName: 'tradingInterpretation - Matches historicalPattern',
            passed: false,
            details: `❌ Values don't match historicalPattern (median: ${medianMatch}, weighted: ${weightedMatch})`,
            severity: 'CRITICAL',
          });
        }
      }
    } else {
      results.push({
        testName: 'tradingInterpretation - Field Present',
        passed: false,
        details: `❌ CRITICAL: tradingInterpretation is NULL/undefined - calculation not wired up`,
        severity: 'CRITICAL',
      });
    }

    // ========================================
    // SECTION 2: DEPRECATED METRICS (Backward Compatibility)
    // ========================================
    logger.info(`\n${'='.repeat(80)}`);
    logger.info('SECTION 2: DEPRECATED METRICS (Backward Compatibility)');
    logger.info(`${'='.repeat(80)}\n`);

    const deprecatedFields = [
      'averageFlipDurationHours',
      'medianHoldTime',
      'weightedAverageHoldingDurationHours',
    ];

    deprecatedFields.forEach((field) => {
      const value = (metrics as any)[field];
      if (value !== undefined && value !== null) {
        results.push({
          testName: `Deprecated Metric - ${field}`,
          passed: true,
          details: `✅ ${field} = ${typeof value === 'number' ? value.toFixed(3) : value} (backward compatibility maintained)`,
          severity: 'INFO',
        });
      } else {
        results.push({
          testName: `Deprecated Metric - ${field}`,
          passed: false,
          details: `⚠️  ${field} is missing (breaks backward compatibility)`,
          severity: 'WARNING',
        });
      }
    });

    // ========================================
    // SECTION 3: CONSISTENCY CHECKS
    // ========================================
    logger.info(`\n${'='.repeat(80)}`);
    logger.info('SECTION 3: CONSISTENCY CHECKS');
    logger.info(`${'='.repeat(80)}\n`);

    // Test: tradingStyle should match pattern
    if (metrics.tradingStyle && metrics.tradingInterpretation) {
      const expectedStyle = `${metrics.tradingInterpretation.speedCategory} (${metrics.tradingInterpretation.behavioralPattern})`;
      if (metrics.tradingStyle === expectedStyle) {
        results.push({
          testName: 'Consistency - tradingStyle Format',
          passed: true,
          details: `✅ tradingStyle matches expected format: "${metrics.tradingStyle}"`,
          severity: 'INFO',
        });
      } else {
        results.push({
          testName: 'Consistency - tradingStyle Format',
          passed: false,
          details: `⚠️  tradingStyle "${metrics.tradingStyle}" doesn't match expected "${expectedStyle}"`,
          severity: 'WARNING',
        });
      }
    }

    // Test: Confidence score should reflect data quality
    if (metrics.historicalPattern && metrics.confidenceScore !== undefined) {
      const dataQuality = metrics.historicalPattern.dataQuality;
      const confidence = metrics.confidenceScore;

      if (confidence >= dataQuality * 0.4) {
        results.push({
          testName: 'Consistency - Confidence vs Data Quality',
          passed: true,
          details: `✅ Confidence (${confidence.toFixed(2)}) reflects data quality (${(dataQuality * 100).toFixed(1)}%)`,
          severity: 'INFO',
        });
      } else {
        results.push({
          testName: 'Consistency - Confidence vs Data Quality',
          passed: false,
          details: `⚠️  Confidence (${confidence.toFixed(2)}) seems low for data quality (${(dataQuality * 100).toFixed(1)}%)`,
          severity: 'WARNING',
        });
      }
    }

    // ========================================
    // FINAL REPORT
    // ========================================
    logger.info(`\n${'='.repeat(80)}`);
    logger.info('VALIDATION RESULTS SUMMARY');
    logger.info(`${'='.repeat(80)}\n`);

    const critical = results.filter((r) => r.severity === 'CRITICAL');
    const warnings = results.filter((r) => r.severity === 'WARNING');
    const info = results.filter((r) => r.severity === 'INFO');

    const criticalPassed = critical.filter((r) => r.passed).length;
    const criticalFailed = critical.filter((r) => !r.passed).length;
    const warningsFailed = warnings.filter((r) => !r.passed).length;

    logger.info(`Total Tests: ${results.length}`);
    logger.info(`  CRITICAL: ${criticalPassed}/${critical.length} passed`);
    logger.info(`  WARNINGS: ${warningsFailed} warnings`);
    logger.info(`  INFO: ${info.length} informational checks\n`);

    // Print failed critical tests
    if (criticalFailed > 0) {
      logger.error(`\n🔴 CRITICAL FAILURES (${criticalFailed}):\n`);
      critical
        .filter((r) => !r.passed)
        .forEach((r) => {
          logger.error(`  ${r.testName}:`);
          logger.error(`    ${r.details}\n`);
        });
    }

    // Print warnings
    if (warningsFailed > 0) {
      logger.warn(`\n⚠️  WARNINGS (${warningsFailed}):\n`);
      warnings
        .filter((r) => !r.passed)
        .forEach((r) => {
          logger.warn(`  ${r.testName}:`);
          logger.warn(`    ${r.details}\n`);
        });
    }

    // Print successful critical tests
    if (criticalPassed > 0) {
      logger.info(`\n✅ CRITICAL TESTS PASSED (${criticalPassed}):\n`);
      critical
        .filter((r) => r.passed)
        .forEach((r) => {
          logger.info(`  ${r.testName}: ${r.details}`);
        });
    }

    // Final verdict
    logger.info(`\n${'='.repeat(80)}`);
    if (criticalFailed === 0) {
      logger.info('🎉 VERDICT: ALL CRITICAL TESTS PASSED');
      logger.info(`${'='.repeat(80)}\n`);
      process.exit(0);
    } else {
      logger.error('❌ VERDICT: CRITICAL FAILURES DETECTED');
      logger.info(`${'='.repeat(80)}\n`);
      process.exit(1);
    }
  } catch (error) {
    logger.error(`\n❌ VALIDATION FAILED WITH ERROR:`);
    logger.error(error);
    process.exit(1);
  }
}

// Main execution
const walletAddress = process.argv[2];

if (!walletAddress) {
  console.error('Usage: npx ts-node -r tsconfig-paths/register src/scripts/validate-behavior-metrics.ts <WALLET_ADDRESS>');
  process.exit(1);
}

validateBehaviorMetrics(walletAddress);
