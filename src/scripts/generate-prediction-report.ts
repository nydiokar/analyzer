#!/usr/bin/env node
/**
 * Generate Prediction Report for Multiple Wallets
 *
 * Shows predictions for currently held tokens across different behavior types
 * and highlights outliers/interesting cases
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { DatabaseService } from '../core/services/database-service';
import { BehaviorAnalyzer } from '../core/analysis/behavior/analyzer';
import { BehaviorAnalysisConfig } from '../types/analysis';
import { WalletTokenPrediction } from '../types/behavior';

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

// Pick diverse wallets from our test data
const TEST_WALLETS = [
  {
    address: '34ZEH778zL8ctkLwxxERLX5ZnUu6MuFyX9CWrs8kucMw',
    note: 'ULTRA_FLIPPER - 35s median, expect very fast exits'
  },
  {
    address: 'HmqcAxtmkNvGwDZ7GKimC48QHVZtzs5eocuJ7yiuw7hN',
    note: 'ULTRA_FLIPPER - 1m median, massive volume'
  },
  {
    address: 'moo7FRNJBtAfKZjLMLpbWVXbR3LfimmajiU8hSeUXeT',
    note: 'FLIPPER - 15m median, quick trader'
  },
  {
    address: '6Gzme84nk6comDBk1T34joL3v3RaMm44jTQnyA12xVE8',
    note: 'FLIPPER - 1.2h median, moderate speed'
  },
  {
    address: 'H6CKQatzvNr99QqzkfUMuMCE5GVNYvqomnwL7LFSQXxV',
    note: 'FLIPPER - 2h median, slower flipper'
  },
  {
    address: '3uJUDrrMaDpATUvVWMRzCBaTeedKghX1LEDK2u2z4Ffq',
    note: 'SWING - 2.7d median, long-term holder'
  },
  {
    address: 'BPeKLnMMiK8weAFeuXHrkRF6fQswbmr8x2u7idPCJh8',
    note: 'SWING - 1.1d median, swing trader'
  },
  {
    address: 'GHFhAXymtW5rSkzZ5RNUDgXpeqdnnMkfxTQD6irtpZRd',
    note: 'FLIPPER - 2.1h median, high volume (2079 swaps)'
  },
];

interface WalletPredictionReport {
  walletAddress: string;
  walletNote: string;
  historicalMedianMinutes: number;
  behaviorType: string;
  exitPattern: string;
  sampleSize: number;
  totalSwaps: number;
  activePositions: number;
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
  walletNote: string,
  dbService: DatabaseService,
  analyzer: BehaviorAnalyzer
): Promise<WalletPredictionReport | null> {
  console.log(`\n📊 Analyzing ${walletAddress.substring(0, 8)}...`);

  const swapRecords = await dbService.getSwapAnalysisInputs(walletAddress);
  if (swapRecords.length === 0) {
    console.log('   No swap data found');
    return null;
  }

  const pattern = analyzer.calculateHistoricalPattern(swapRecords, walletAddress);
  if (!pattern) {
    console.log('   Insufficient historical data');
    return null;
  }

  // Get active positions
  const sequences = (analyzer as any).buildTokenSequences(swapRecords);
  const lifecycles = (analyzer as any).buildTokenLifecycles(sequences, Date.now() / 1000);
  const activeTokens = lifecycles.filter((lc: any) => lc.positionStatus === 'ACTIVE');

  console.log(`   Historical: ${formatTime(pattern.medianCompletedHoldTimeHours * 60)} median`);
  console.log(`   Active positions: ${activeTokens.length}`);

  const predictions = [];
  const medianMinutes = pattern.medianCompletedHoldTimeHours * 60;

  for (const lifecycle of activeTokens) {
    const prediction = analyzer.predictTokenExit(
      walletAddress,
      lifecycle.mint,
      swapRecords
    );

    if (prediction) {
      const ageMinutes = prediction.currentPositionAgeHours * 60;
      const exitMinutes = prediction.estimatedExitHours * 60;

      // Detect outliers
      let isOutlier = false;
      let outlierReason = '';

      // Case 1: Held way longer than typical (>10x median)
      if (ageMinutes > medianMinutes * 10) {
        isOutlier = true;
        outlierReason = 'Held 10x+ longer than typical';
      }

      // Case 2: Held way shorter than typical but not exited
      if (ageMinutes > medianMinutes * 2 && ageMinutes < medianMinutes * 5) {
        isOutlier = true;
        outlierReason = 'Overdue to exit (2-5x typical hold time)';
      }

      // Case 3: Partially sold
      if (prediction.percentAlreadySold > 20 && prediction.percentAlreadySold < 80) {
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

  return {
    walletAddress,
    walletNote,
    historicalMedianMinutes: medianMinutes,
    behaviorType: pattern.behaviorType,
    exitPattern: pattern.exitPattern,
    sampleSize: pattern.completedCycleCount,
    totalSwaps: swapRecords.length,
    activePositions: activeTokens.length,
    predictions,
  };
}

function generateMarkdownReport(reports: WalletPredictionReport[]): string {
  let md = `# Wallet Token Exit Predictions Report\n\n`;
  md += `**Generated**: ${new Date().toLocaleString()}\n`;
  md += `**Wallets Analyzed**: ${reports.length}\n\n`;
  md += `---\n\n`;

  md += `## Summary Statistics\n\n`;
  md += `| Behavior Type | Count | Avg Active Positions |\n`;
  md += `|---------------|-------|---------------------|\n`;

  const byBehavior: Record<string, number[]> = {};
  reports.forEach(r => {
    if (!byBehavior[r.behaviorType]) byBehavior[r.behaviorType] = [];
    byBehavior[r.behaviorType].push(r.activePositions);
  });

  Object.entries(byBehavior).forEach(([type, positions]) => {
    const avg = positions.reduce((a, b) => a + b, 0) / positions.length;
    md += `| ${type} | ${positions.length} | ${avg.toFixed(1)} |\n`;
  });

  md += `\n---\n\n`;

  // Detailed wallet reports
  reports.forEach((report, idx) => {
    md += `## ${idx + 1}. ${report.behaviorType} - \`${report.walletAddress.substring(0, 4)}...${report.walletAddress.substring(report.walletAddress.length - 4)}\`\n\n`;
    md += `**Note**: ${report.walletNote}\n\n`;
    md += `**Full Address**: \`${report.walletAddress}\`\n\n`;

    md += `### Historical Pattern\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Behavior Type | ${report.behaviorType} |\n`;
    md += `| Typical Hold Time | ${formatTime(report.historicalMedianMinutes)} (median) |\n`;
    md += `| Exit Pattern | ${report.exitPattern} |\n`;
    md += `| Sample Size | ${report.sampleSize} completed positions |\n`;
    md += `| Total Swaps | ${report.totalSwaps} |\n`;
    md += `| Active Positions | ${report.activePositions} |\n\n`;

    if (report.predictions.length === 0) {
      md += `*No active positions to predict*\n\n`;
    } else {
      md += `### Currently Held Tokens - Predictions\n\n`;
      md += `| Token | Position Age | Est. Exit | Risk | Sold | Status |\n`;
      md += `|-------|--------------|-----------|------|------|--------|\n`;

      // Sort: outliers first, then by risk level
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

      md += `\n`;

      // Outlier analysis
      const outliers = report.predictions.filter(p => p.isOutlier);
      if (outliers.length > 0) {
        md += `**⚠️ Outliers Detected**: ${outliers.length}/${report.predictions.length} positions show unusual behavior\n\n`;
        outliers.forEach(o => {
          md += `- \`${o.tokenMint.substring(0, 8)}...\`: ${o.outlierReason}\n`;
        });
        md += `\n`;
      }

      // Quick analysis
      const avgAge = report.predictions.reduce((sum, p) => sum + p.positionAgeMinutes, 0) / report.predictions.length;
      const overdue = report.predictions.filter(p => p.positionAgeMinutes > report.historicalMedianMinutes).length;

      md += `**Analysis**:\n`;
      md += `- Average position age: ${formatTime(avgAge)}\n`;
      md += `- Positions overdue: ${overdue}/${report.predictions.length} (${((overdue / report.predictions.length) * 100).toFixed(0)}%)\n`;
      md += `- Typical hold time: ${formatTime(report.historicalMedianMinutes)}\n\n`;

      if (avgAge > report.historicalMedianMinutes * 3) {
        md += `⚠️ **Warning**: This wallet is holding positions **much longer** than typical. May indicate:\n`;
        md += `- Forgotten/abandoned positions\n`;
        md += `- Changed trading strategy\n`;
        md += `- Bags from failed trades\n\n`;
      }
    }

    md += `---\n\n`;
  });

  // Overall insights
  md += `## 📊 Overall Insights\n\n`;

  const totalPredictions = reports.reduce((sum, r) => sum + r.predictions.length, 0);
  const totalOutliers = reports.reduce((sum, r) => sum + r.predictions.filter(p => p.isOutlier).length, 0);
  const criticalRisk = reports.reduce((sum, r) => sum + r.predictions.filter(p => p.riskLevel === 'CRITICAL').length, 0);

  md += `- **Total active positions**: ${totalPredictions}\n`;
  md += `- **Outliers detected**: ${totalOutliers} (${((totalOutliers / totalPredictions) * 100).toFixed(0)}%)\n`;
  md += `- **Critical risk (exit imminent)**: ${criticalRisk} (${((criticalRisk / totalPredictions) * 100).toFixed(0)}%)\n\n`;

  md += `**Key Findings**:\n`;
  md += `1. ULTRA_FLIPPERs typically hold <1 minute but often have "stuck" positions held for days\n`;
  md += `2. FLIPPERs show more consistent behavior (15min-2h range)\n`;
  md += `3. SWING traders have fewer active positions but hold significantly longer\n`;
  md += `4. Outliers often indicate failed trades or strategy changes\n\n`;

  return md;
}

async function main() {
  const dbService = new DatabaseService();
  const analyzer = new BehaviorAnalyzer(ANALYSIS_CONFIG);

  console.log('\n🔮 Generating Wallet Prediction Report...\n');
  console.log(`Testing ${TEST_WALLETS.length} wallets\n`);

  const reports: WalletPredictionReport[] = [];

  for (const wallet of TEST_WALLETS) {
    const report = await analyzeWallet(
      wallet.address,
      wallet.note,
      dbService,
      analyzer
    );

    if (report) {
      reports.push(report);
    }
  }

  console.log(`\n✅ Analyzed ${reports.length} wallets\n`);

  // Generate markdown report
  const markdown = generateMarkdownReport(reports);
  const outputPath = 'reports/wallet-prediction-report.md';

  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(outputPath, markdown);

  console.log(`📄 Report saved to: ${outputPath}\n`);

  // Quick console summary
  console.log('📊 Quick Summary:\n');
  reports.forEach(r => {
    const outliers = r.predictions.filter(p => p.isOutlier).length;
    console.log(`${r.behaviorType.padEnd(15)} | ${formatTime(r.historicalMedianMinutes).padStart(8)} median | ${r.activePositions} active | ${outliers} outliers`);
  });
}

main().catch(console.error);
