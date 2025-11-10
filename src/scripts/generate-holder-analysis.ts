#!/usr/bin/env node
/**
 * Consolidated Holder Risk Analysis & Prediction Report Generator
 *
 * Combines functionality from multiple report scripts into one with flags:
 * - Predictions with outlier detection
 * - Time bucket distributions
 * - Historical pattern analysis
 *
 * Usage:
 *
 * 1. Predictions Report (with outliers):
 *    npx ts-node -r tsconfig-paths/register src/scripts/generate-holder-analysis.ts \
 *      --wallets wallet1,wallet2,wallet3 \
 *      --report-type predictions \
 *      --output reports/predictions.md
 *
 * 2. Time Buckets Report (granular distribution):
 *    npx ts-node -r tsconfig-paths/register src/scripts/generate-holder-analysis.ts \
 *      --wallets wallet1,wallet2 \
 *      --report-type time-buckets \
 *      --output reports/time-buckets.md
 *
 * 3. Combined Report (everything):
 *    npx ts-node -r tsconfig-paths/register src/scripts/generate-holder-analysis.ts \
 *      --wallets wallet1,wallet2 \
 *      --report-type combined \
 *      --output reports/full-analysis.md
 *
 * 4. Read from wallets file:
 *    npx ts-node -r tsconfig-paths/register src/scripts/generate-holder-analysis.ts \
 *      --wallets-file new-wallets.txt \
 *      --report-type predictions
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { DatabaseService } from '../core/services/database-service';
import { BehaviorAnalyzer } from '../core/analysis/behavior/analyzer';
import { BehaviorAnalysisConfig } from '../types/analysis';

dotenv.config();

const ANALYSIS_CONFIG: BehaviorAnalysisConfig = {
  holdingThresholds: {
    exitThreshold: 0.20,
    dustThreshold: 0.05,
    minimumSolValue: 0.001,
    minimumPercentageRemaining: 0.05,
    minimumHoldingTimeSeconds: 60,
  },
  historicalPatternConfig: {
    minimumCompletedCycles: 3,
    maximumDataAgeDays: 90,
  },
};

// Time buckets for granular analysis
const TIME_BUCKETS = [
  { label: '< 1 min', minMinutes: 0, maxMinutes: 1 },
  { label: '1-3 min', minMinutes: 1, maxMinutes: 3 },
  { label: '3-5 min', minMinutes: 3, maxMinutes: 5 },
  { label: '5-10 min', minMinutes: 5, maxMinutes: 10 },
  { label: '10-30 min', minMinutes: 10, maxMinutes: 30 },
  { label: '30-60 min', minMinutes: 30, maxMinutes: 60 },
  { label: '1-6 hours', minMinutes: 60, maxMinutes: 360 },
  { label: '6-24 hours', minMinutes: 360, maxMinutes: 1440 },
  { label: '1-7 days', minMinutes: 1440, maxMinutes: 10080 },
  { label: '> 7 days', minMinutes: 10080, maxMinutes: Infinity },
];

interface WalletAnalysis {
  walletAddress: string;
  totalSwaps: number;
  calculatedMedianMinutes: number | null;
  calculatedAverageMinutes: number | null;
  behaviorType: string | null;
  exitPattern: string | null;
  sampleSize: number;
  activePositions: number;
  dataQuality: number;
  observationPeriodDays: number;
  timeBuckets?: Array<{ label: string; count: number; percentage: number }>;
  predictions: Array<{
    tokenMint: string;
    positionAgeMinutes: number;
    estimatedExitMinutes: number;
    riskLevel: string;
    percentSold: number;
    isOutlier: boolean;
    outlierReason?: string;
  }>;
}

function formatTime(minutes: number): string {
  if (minutes < 1) {
    return `${Math.round(minutes * 60)}s`;
  } else if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  } else if (minutes < 1440) {
    return `${(minutes / 60).toFixed(1)}h`;
  } else {
    return `${(minutes / 1440).toFixed(1)}d`;
  }
}

async function analyzeWallet(
  walletAddress: string,
  dbService: DatabaseService,
  analyzer: BehaviorAnalyzer,
  includeTimeBuckets: boolean
): Promise<WalletAnalysis | null> {
  console.log(`\n📊 Analyzing ${walletAddress.substring(0, 8)}...`);

  const swapRecords = await dbService.getSwapAnalysisInputs(walletAddress);
  if (swapRecords.length === 0) {
    console.log('   ❌ No swap data found');
    return null;
  }

  console.log(`   ✓ Loaded ${swapRecords.length} swaps`);

  const pattern = analyzer.calculateHistoricalPattern(swapRecords, walletAddress);

  if (!pattern) {
    console.log('   ❌ Insufficient historical data');
    return {
      walletAddress,
      totalSwaps: swapRecords.length,
      calculatedMedianMinutes: null,
      calculatedAverageMinutes: null,
      behaviorType: null,
      exitPattern: null,
      sampleSize: 0,
      activePositions: 0,
      dataQuality: 0,
      observationPeriodDays: 0,
      predictions: [],
    };
  }

  // Get active positions
  const sequences = (analyzer as any).buildTokenSequences(swapRecords);
  const lifecycles = (analyzer as any).buildTokenLifecycles(sequences, Date.now() / 1000);
  const activeTokens = lifecycles.filter((lc: any) => lc.positionStatus === 'ACTIVE');
  const completedTokens = lifecycles.filter((lc: any) => lc.positionStatus === 'EXITED');

  const medianMinutes = pattern.medianCompletedHoldTimeHours * 60;
  const averageMinutes = pattern.historicalAverageHoldTimeHours * 60;
  console.log(`   ✓ Median: ${formatTime(medianMinutes)} | Type: ${pattern.behaviorType} | Active: ${activeTokens.length}`);

  // Generate predictions
  const predictions = [];
  for (const lifecycle of activeTokens) {
    const prediction = analyzer.predictTokenExit(walletAddress, lifecycle.mint, swapRecords);
    if (prediction) {
      const ageMinutes = prediction.currentPositionAgeHours * 60;
      const exitMinutes = prediction.estimatedExitHours * 60;

      let isOutlier = false;
      let outlierReason = '';

      if (ageMinutes > medianMinutes * 10) {
        isOutlier = true;
        outlierReason = 'Held 10x+ longer than typical';
      } else if (ageMinutes > medianMinutes * 2 && ageMinutes < medianMinutes * 5) {
        isOutlier = true;
        outlierReason = 'Overdue to exit (2-5x typical hold time)';
      } else if (prediction.percentAlreadySold > 20 && prediction.percentAlreadySold < 80) {
        isOutlier = true;
        outlierReason = `Actively exiting (${prediction.percentAlreadySold.toFixed(0)}% sold)`;
      }

      predictions.push({
        tokenMint: lifecycle.mint,
        positionAgeMinutes: ageMinutes,
        estimatedExitMinutes: exitMinutes,
        riskLevel: prediction.riskLevel,
        percentSold: prediction.percentAlreadySold,
        isOutlier,
        outlierReason,
      });
    }
  }

  // Calculate time buckets if requested
  let timeBuckets = undefined;
  if (includeTimeBuckets) {
    const holdingTimes = completedTokens.map((lc: any) =>
      lc.weightedHoldingTimeHours * 60
    );

    timeBuckets = TIME_BUCKETS.map(bucket => {
      const count = holdingTimes.filter(
        t => t >= bucket.minMinutes && t < bucket.maxMinutes
      ).length;
      return {
        label: bucket.label,
        count,
        percentage: holdingTimes.length > 0 ? (count / holdingTimes.length) * 100 : 0,
      };
    });
  }

  return {
    walletAddress,
    totalSwaps: swapRecords.length,
    calculatedMedianMinutes: medianMinutes,
    calculatedAverageMinutes: averageMinutes,
    behaviorType: pattern.behaviorType,
    exitPattern: pattern.exitPattern,
    sampleSize: pattern.completedCycleCount,
    activePositions: activeTokens.length,
    dataQuality: pattern.dataQuality,
    observationPeriodDays: pattern.observationPeriodDays,
    timeBuckets,
    predictions,
  };
}

function generateMarkdownReport(
  reports: WalletAnalysis[],
  reportType: 'predictions' | 'time-buckets' | 'combined'
): string {
  let md = `# Holder Risk Analysis Report\n\n`;
  md += `**Generated**: ${new Date().toLocaleString()}\n`;
  md += `**Report Type**: ${reportType}\n`;
  md += `**Wallets Analyzed**: ${reports.length}\n\n`;
  md += `---\n\n`;

  // Summary table
  md += `## Summary\n\n`;
  md += `| Wallet | Median Hold | Type | Active | Outliers | Sample Size |\n`;
  md += `|--------|-------------|------|--------|----------|-------------|\n`;

  reports.forEach(r => {
    const wallet = `\`${r.walletAddress.substring(0, 6)}...\``;
    const median = r.calculatedMedianMinutes !== null ? formatTime(r.calculatedMedianMinutes) : 'N/A';
    const type = r.behaviorType || 'N/A';
    const active = r.activePositions;
    const outliers = r.predictions.filter(p => p.isOutlier).length;
    const sample = r.sampleSize;

    md += `| ${wallet} | ${median} | ${type} | ${active} | ${outliers} | ${sample} |\n`;
  });

  md += `\n---\n\n`;

  // Detailed reports
  reports.forEach((report, idx) => {
    md += `## ${idx + 1}. ${report.behaviorType || 'INSUFFICIENT_DATA'} - \`${report.walletAddress.substring(0, 4)}...${report.walletAddress.substring(report.walletAddress.length - 4)}\`\n\n`;
    md += `**Full Address**: \`${report.walletAddress}\`\n\n`;

    if (report.calculatedMedianMinutes === null) {
      md += `❌ **Insufficient Data**: Need at least 3 completed position cycles.\n\n`;
      md += `---\n\n`;
      return;
    }

    md += `### Historical Pattern\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Median Hold Time | ${formatTime(report.calculatedMedianMinutes)} |\n`;
    md += `| Average Hold Time | ${formatTime(report.calculatedAverageMinutes!)} |\n`;
    md += `| Behavior Type | ${report.behaviorType} |\n`;
    md += `| Exit Pattern | ${report.exitPattern} |\n`;
    md += `| Sample Size | ${report.sampleSize} completed positions |\n`;
    md += `| Active Positions | ${report.activePositions} |\n`;
    md += `| Data Quality | ${(report.dataQuality * 100).toFixed(0)}% |\n\n`;

    // Time buckets (if requested)
    if ((reportType === 'time-buckets' || reportType === 'combined') && report.timeBuckets) {
      md += `### Time Distribution (Completed Positions)\n\n`;
      md += `| Time Range | Count | Percentage |\n`;
      md += `|------------|-------|------------|\n`;
      report.timeBuckets.forEach(bucket => {
        md += `| ${bucket.label.padEnd(12)} | ${bucket.count.toString().padStart(5)} | ${bucket.percentage.toFixed(1)}% |\n`;
      });
      md += `\n`;
    }

    // Predictions (if requested)
    if ((reportType === 'predictions' || reportType === 'combined') && report.predictions.length > 0) {
      md += `### Currently Held Tokens - Predictions\n\n`;
      md += `| Token | Position Age | Est. Exit | Risk | Sold | Status |\n`;
      md += `|-------|--------------|-----------|------|------|--------|\n`;

      const sorted = [...report.predictions].sort((a, b) => {
        if (a.isOutlier && !b.isOutlier) return -1;
        if (!a.isOutlier && b.isOutlier) return 1;
        return 0;
      });

      sorted.forEach(pred => {
        const token = `\`${pred.tokenMint.substring(0, 8)}...\``;
        const age = formatTime(pred.positionAgeMinutes);
        const exit = pred.estimatedExitMinutes > 0 ? formatTime(pred.estimatedExitMinutes) : '**NOW**';
        const risk = pred.riskLevel === 'CRITICAL' ? '🔴 CRITICAL' :
                     pred.riskLevel === 'HIGH' ? '🟡 HIGH' :
                     pred.riskLevel === 'MEDIUM' ? '🟢 MEDIUM' : '✅ LOW';
        const sold = `${pred.percentSold.toFixed(0)}%`;
        const status = pred.isOutlier ? `⚠️ ${pred.outlierReason}` : '-';

        md += `| ${token} | ${age} | ${exit} | ${risk} | ${sold} | ${status} |\n`;
      });

      const outliers = report.predictions.filter(p => p.isOutlier);
      if (outliers.length > 0) {
        md += `\n**⚠️ Outliers**: ${outliers.length}/${report.predictions.length} positions\n`;
      }

      const avgAge = report.predictions.reduce((sum, p) => sum + p.positionAgeMinutes, 0) / report.predictions.length;
      const overdue = report.predictions.filter(p => p.positionAgeMinutes > report.calculatedMedianMinutes).length;

      md += `\n**Stats**: Avg age ${formatTime(avgAge)} | ${overdue}/${report.predictions.length} overdue\n\n`;
    }

    md += `---\n\n`;
  });

  return md;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('wallets', {
      type: 'string',
      description: 'Comma-separated wallet addresses',
    })
    .option('wallets-file', {
      type: 'string',
      description: 'File containing wallet addresses (one per line)',
    })
    .option('report-type', {
      type: 'string',
      choices: ['predictions', 'time-buckets', 'combined'] as const,
      default: 'predictions',
      description: 'Type of report to generate',
    })
    .option('output', {
      type: 'string',
      default: 'reports/holder-analysis.md',
      description: 'Output file path',
    })
    .check((argv) => {
      if (!argv.wallets && !argv['wallets-file']) {
        throw new Error('Must provide either --wallets or --wallets-file');
      }
      return true;
    })
    .argv;

  // Parse wallet addresses
  let walletAddresses: string[] = [];
  if (argv.wallets) {
    walletAddresses = argv.wallets.split(',').map(w => w.trim());
  } else if (argv['wallets-file']) {
    const fileContent = fs.readFileSync(argv['wallets-file'], 'utf-8');
    walletAddresses = fileContent.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  }

  console.log(`\n🔮 Generating ${argv['report-type']} report for ${walletAddresses.length} wallets...\n`);

  const dbService = new DatabaseService();
  const analyzer = new BehaviorAnalyzer(ANALYSIS_CONFIG);

  const reports: WalletAnalysis[] = [];
  const includeTimeBuckets = argv['report-type'] === 'time-buckets' || argv['report-type'] === 'combined';

  for (const address of walletAddresses) {
    const report = await analyzeWallet(address, dbService, analyzer, includeTimeBuckets);
    if (report) {
      reports.push(report);
    }
  }

  console.log(`\n✅ Analyzed ${reports.length} wallets\n`);

  const markdown = generateMarkdownReport(reports, argv['report-type']);

  fs.mkdirSync(argv.output.substring(0, argv.output.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(argv.output, markdown);

  console.log(`📄 Report saved to: ${argv.output}\n`);
}

main().catch(console.error);
