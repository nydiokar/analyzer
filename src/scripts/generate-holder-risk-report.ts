#!/usr/bin/env node
/**
 * Generate Human-Friendly Holder Risk Analysis Report
 *
 * Creates a comprehensive markdown report from holder risk test results with:
 * - Executive summary with key metrics
 * - Performance analysis (sync times vs swap counts)
 * - Behavior type distribution
 * - Detailed wallet breakdowns
 * - Token holding time distribution per wallet
 * - Visual charts and insights
 *
 * Usage:
 * npx ts-node -r tsconfig-paths/register src/scripts/generate-holder-risk-report.ts \
 *   --input data/holding_time/fresh-holder-risk-test-results.json \
 *   --output reports/holder-risk-analysis-report.md
 */

import * as fs from 'fs';
import * as path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

interface WalletTestResult {
  walletAddress: string;
  totalSwaps: number;
  uniqueTokens: number;
  exitedTokens: number;
  activeTokens: number;
  completedCycles: number;
  pattern: {
    behaviorType: string;
    avgHoldTimeHours: number;
    medianHoldTimeHours: number;
    exitPattern: string;
    dataQuality: number;
  } | null;
  syncTimeSeconds: number;
  analysisTimeSeconds: number;
}

interface TestResults {
  generatedAt: string;
  config: {
    maxSignatures: number;
  };
  summary: {
    walletsTest: number;
    successfulPatterns: number;
    totalSwaps: number;
    totalUniqueTokens: number;
    totalCompletedCycles: number;
    avgSyncTimeSeconds: number;
  };
  results: WalletTestResult[];
}

function formatDuration(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes}m`;
  } else if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  } else {
    const days = hours / 24;
    return `${days.toFixed(1)}d`;
  }
}

function formatWalletAddress(address: string): string {
  return `${address.substring(0, 4)}...${address.substring(address.length - 4)}`;
}

function getBehaviorEmoji(behaviorType: string): string {
  const emojis: Record<string, string> = {
    'ULTRA_FLIPPER': '⚡',
    'FLIPPER': '🔄',
    'SWING': '📊',
    'HOLDER': '💎',
  };
  return emojis[behaviorType] || '❓';
}

function getExitPatternEmoji(exitPattern: string): string {
  return exitPattern === 'ALL_AT_ONCE' ? '💥' : '📉';
}

function generateHoldTimeDistribution(avgHours: number, medianHours: number): string {
  const buckets = [
    { label: '< 1h', max: 1 },
    { label: '1-6h', max: 6 },
    { label: '6-24h', max: 24 },
    { label: '1-7d', max: 168 },
    { label: '> 7d', max: Infinity },
  ];

  const bucket = buckets.find(b => avgHours <= b.max)?.label || '> 7d';
  return bucket;
}

function generatePerformanceChart(results: WalletTestResult[]): string {
  // Group by sync time ranges
  const ranges = [
    { label: '0-5s', min: 0, max: 5, count: 0 },
    { label: '5-10s', min: 5, max: 10, count: 0 },
    { label: '10-15s', min: 10, max: 15, count: 0 },
    { label: '15-20s', min: 15, max: 20, count: 0 },
    { label: '20-25s', min: 20, max: 25, count: 0 },
    { label: '> 25s', min: 25, max: Infinity, count: 0 },
  ];

  results.forEach(r => {
    const range = ranges.find(rng => r.syncTimeSeconds > rng.min && r.syncTimeSeconds <= rng.max);
    if (range) range.count++;
  });

  let chart = '\n```\n';
  const maxCount = Math.max(...ranges.map(r => r.count));
  ranges.forEach(range => {
    const barLength = Math.round((range.count / maxCount) * 40);
    const bar = '█'.repeat(barLength);
    chart += `${range.label.padEnd(8)} | ${bar} ${range.count}\n`;
  });
  chart += '```\n';
  return chart;
}

function generateBehaviorDistribution(results: WalletTestResult[]): string {
  const distribution: Record<string, number> = {};

  results.forEach(r => {
    if (r.pattern) {
      const type = r.pattern.behaviorType;
      distribution[type] = (distribution[type] || 0) + 1;
    }
  });

  let chart = '\n```\n';
  const maxCount = Math.max(...Object.values(distribution));
  Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      const barLength = Math.round((count / maxCount) * 40);
      const bar = '█'.repeat(barLength);
      const emoji = getBehaviorEmoji(type);
      chart += `${emoji} ${type.padEnd(14)} | ${bar} ${count}\n`;
    });
  chart += '```\n';
  return chart;
}

function generateMarkdownReport(data: TestResults): string {
  const { summary, results, config } = data;

  // Calculate additional statistics
  const syncTimes = results.map(r => r.syncTimeSeconds);
  const minSyncTime = Math.min(...syncTimes);
  const maxSyncTime = Math.max(...syncTimes);
  const medianSyncTime = syncTimes.sort((a, b) => a - b)[Math.floor(syncTimes.length / 2)];

  const avgSwapsPerWallet = summary.totalSwaps / summary.walletsTest;
  const avgTokensPerWallet = summary.totalUniqueTokens / summary.walletsTest;
  const avgCyclesPerWallet = summary.totalCompletedCycles / summary.walletsTest;

  // Sort wallets by different criteria
  const topBySwaps = [...results].sort((a, b) => b.totalSwaps - a.totalSwaps).slice(0, 10);
  const topByTokens = [...results].sort((a, b) => b.uniqueTokens - a.uniqueTokens).slice(0, 10);
  const slowestSync = [...results].sort((a, b) => b.syncTimeSeconds - a.syncTimeSeconds).slice(0, 5);
  const fastestSync = [...results].sort((a, b) => a.syncTimeSeconds - b.syncTimeSeconds).slice(0, 5);

  let report = `# 📊 Holder Risk Analysis Report

**Generated:** ${new Date(data.generatedAt).toLocaleString()}
**Configuration:** Max ${config.maxSignatures} signatures per wallet
**Wallets Analyzed:** ${summary.walletsTest}

---

## 🎯 Executive Summary

### Key Metrics

| Metric | Value |
|--------|-------|
| **Total Wallets Tested** | ${summary.walletsTest} |
| **Successful Patterns** | ${summary.successfulPatterns} (${((summary.successfulPatterns / summary.walletsTest) * 100).toFixed(1)}%) |
| **Total Swaps Processed** | ${summary.totalSwaps.toLocaleString()} |
| **Total Unique Tokens** | ${summary.totalUniqueTokens.toLocaleString()} |
| **Completed Cycles** | ${summary.totalCompletedCycles.toLocaleString()} |
| **Avg Swaps/Wallet** | ${avgSwapsPerWallet.toFixed(0)} |
| **Avg Tokens/Wallet** | ${avgTokensPerWallet.toFixed(0)} |
| **Avg Completed Cycles/Wallet** | ${avgCyclesPerWallet.toFixed(0)} |

---

## ⚡ Performance Analysis

### Sync Time Statistics

| Metric | Value |
|--------|-------|
| **Average Sync Time** | ${summary.avgSyncTimeSeconds.toFixed(1)}s |
| **Median Sync Time** | ${medianSyncTime.toFixed(1)}s |
| **Min Sync Time** | ${minSyncTime.toFixed(1)}s |
| **Max Sync Time** | ${maxSyncTime.toFixed(1)}s |
| **Total Time** | ${(syncTimes.reduce((a, b) => a + b, 0) / 60).toFixed(1)} minutes |

### Sync Time Distribution
${generatePerformanceChart(results)}

### ⚠️ Performance Insights

${slowestSync.length > 0 ? `**Slowest Syncs:**
${slowestSync.map((r, i) => `${i + 1}. \`${formatWalletAddress(r.walletAddress)}\` - ${r.syncTimeSeconds.toFixed(1)}s (${r.totalSwaps} swaps)`).join('\n')}
` : ''}
${fastestSync.length > 0 ? `**Fastest Syncs:**
${fastestSync.map((r, i) => `${i + 1}. \`${formatWalletAddress(r.walletAddress)}\` - ${r.syncTimeSeconds.toFixed(1)}s (${r.totalSwaps} swaps)`).join('\n')}
` : ''}

> **Note:** Sync time correlates with the number of transactions to fetch and process, not necessarily the number of swaps.

---

## 🔍 Behavior Analysis

### Behavior Type Distribution
${generateBehaviorDistribution(results.filter(r => r.pattern !== null))}

### Behavior Definitions

| Type | Symbol | Hold Time | Description |
|------|--------|-----------|-------------|
| **ULTRA_FLIPPER** | ⚡ | < 1 hour | Extremely fast trades, high dump risk |
| **FLIPPER** | 🔄 | 1-24 hours | Quick trades, moderate dump risk |
| **SWING** | 📊 | 1-7 days | Swing trading style, lower risk |
| **HOLDER** | 💎 | > 7 days | Long-term holder, lowest risk |

---

## 📈 Top Wallets Analysis

### Top 10 by Total Swaps

| Rank | Wallet | Swaps | Tokens | Behavior | Avg Hold | Exit Pattern |
|------|--------|-------|--------|----------|----------|--------------|
${topBySwaps.map((r, i) => {
  const behavior = r.pattern ? `${getBehaviorEmoji(r.pattern.behaviorType)} ${r.pattern.behaviorType}` : 'N/A';
  const holdTime = r.pattern ? formatDuration(r.pattern.avgHoldTimeHours) : 'N/A';
  const exitPattern = r.pattern ? `${getExitPatternEmoji(r.pattern.exitPattern)} ${r.pattern.exitPattern}` : 'N/A';
  return `| ${i + 1} | \`${formatWalletAddress(r.walletAddress)}\` | ${r.totalSwaps} | ${r.uniqueTokens} | ${behavior} | ${holdTime} | ${exitPattern} |`;
}).join('\n')}

### Top 10 by Unique Tokens Traded

| Rank | Wallet | Tokens | Swaps | Behavior | Avg Hold | Completed Cycles |
|------|--------|--------|-------|----------|----------|------------------|
${topByTokens.map((r, i) => {
  const behavior = r.pattern ? `${getBehaviorEmoji(r.pattern.behaviorType)} ${r.pattern.behaviorType}` : 'N/A';
  const holdTime = r.pattern ? formatDuration(r.pattern.avgHoldTimeHours) : 'N/A';
  return `| ${i + 1} | \`${formatWalletAddress(r.walletAddress)}\` | ${r.uniqueTokens} | ${r.totalSwaps} | ${behavior} | ${holdTime} | ${r.completedCycles} |`;
}).join('\n')}

---

## 📋 Detailed Wallet Breakdown

${results.map((r, i) => {
  const behavior = r.pattern ? r.pattern.behaviorType : 'INSUFFICIENT_DATA';
  const emoji = r.pattern ? getBehaviorEmoji(r.pattern.behaviorType) : '❓';
  const holdTime = r.pattern ? formatDuration(r.pattern.avgHoldTimeHours) : 'N/A';
  const medianHoldTime = r.pattern ? formatDuration(r.pattern.medianHoldTimeHours) : 'N/A';
  const exitPattern = r.pattern ? `${getExitPatternEmoji(r.pattern.exitPattern)} ${r.pattern.exitPattern}` : 'N/A';
  const dataQuality = r.pattern ? `${(r.pattern.dataQuality * 100).toFixed(0)}%` : 'N/A';
  const holdBucket = r.pattern ? generateHoldTimeDistribution(r.pattern.avgHoldTimeHours, r.pattern.medianHoldTimeHours) : 'N/A';

  return `### ${i + 1}. ${emoji} Wallet \`${formatWalletAddress(r.walletAddress)}\`

**Full Address:** \`${r.walletAddress}\`

| Metric | Value |
|--------|-------|
| **Behavior Type** | ${behavior} |
| **Total Swaps** | ${r.totalSwaps} |
| **Unique Tokens** | ${r.uniqueTokens} |
| **Exited Positions** | ${r.exitedTokens} |
| **Active Positions** | ${r.activeTokens} |
| **Completed Cycles** | ${r.completedCycles} |
| **Avg Hold Time** | ${holdTime} |
| **Median Hold Time** | ${medianHoldTime} |
| **Hold Time Bucket** | ${holdBucket} |
| **Exit Pattern** | ${exitPattern} |
| **Data Quality** | ${dataQuality} |
| **Sync Time** | ${r.syncTimeSeconds.toFixed(1)}s |
| **Analysis Time** | ${r.analysisTimeSeconds.toFixed(3)}s |

${r.pattern ? `**Risk Assessment:**
- ${behavior === 'ULTRA_FLIPPER' ? '🔴 **HIGH RISK** - Extremely fast trader, very likely to dump quickly' : ''}
${behavior === 'FLIPPER' ? '🟡 **MODERATE RISK** - Quick trader, may exit within 24 hours' : ''}
${behavior === 'SWING' ? '🟢 **LOW-MODERATE RISK** - Swing trader, typically holds for days' : ''}
${behavior === 'HOLDER' ? '🟢 **LOW RISK** - Long-term holder, less likely to dump quickly' : ''}
- Exit pattern: ${r.pattern.exitPattern === 'ALL_AT_ONCE' ? 'Tends to exit in 1-2 large sells' : 'Tends to exit gradually over multiple transactions'}
` : '⚠️ Insufficient data for pattern analysis (< 3 completed cycles)'}

---
`;
}).join('\n')}

## 📊 Statistical Analysis

### Hold Time Distribution Across All Wallets

${(() => {
  const holdTimeBuckets: Record<string, number> = {
    '< 1h': 0,
    '1-6h': 0,
    '6-24h': 0,
    '1-7d': 0,
    '> 7d': 0,
  };

  results.forEach(r => {
    if (r.pattern) {
      const bucket = generateHoldTimeDistribution(r.pattern.avgHoldTimeHours, r.pattern.medianHoldTimeHours);
      holdTimeBuckets[bucket]++;
    }
  });

  let chart = '```\n';
  const maxCount = Math.max(...Object.values(holdTimeBuckets));
  Object.entries(holdTimeBuckets).forEach(([bucket, count]) => {
    const barLength = Math.round((count / maxCount) * 40);
    const bar = '█'.repeat(barLength);
    chart += `${bucket.padEnd(8)} | ${bar} ${count}\n`;
  });
  chart += '```\n';
  return chart;
})()}

### Exit Pattern Distribution

${(() => {
  const exitPatterns: Record<string, number> = {
    'ALL_AT_ONCE': 0,
    'GRADUAL': 0,
  };

  results.forEach(r => {
    if (r.pattern) {
      exitPatterns[r.pattern.exitPattern]++;
    }
  });

  return `| Pattern | Count | Percentage |
|---------|-------|------------|
| 💥 ALL_AT_ONCE | ${exitPatterns.ALL_AT_ONCE} | ${((exitPatterns.ALL_AT_ONCE / results.filter(r => r.pattern).length) * 100).toFixed(1)}% |
| 📉 GRADUAL | ${exitPatterns.GRADUAL} | ${((exitPatterns.GRADUAL / results.filter(r => r.pattern).length) * 100).toFixed(1)}% |
`;
})()}

---

## 💡 Key Insights

1. **Average Sync Time:** ${summary.avgSyncTimeSeconds.toFixed(1)}s per wallet indicates ${summary.avgSyncTimeSeconds > 20 ? 'slower than expected - investigate potential bottlenecks' : summary.avgSyncTimeSeconds > 15 ? 'normal performance for fresh fetches' : 'excellent performance'}

2. **Behavior Distribution:** ${(() => {
  const patterns = results.filter(r => r.pattern);
  const ultraFlippers = patterns.filter(r => r.pattern?.behaviorType === 'ULTRA_FLIPPER').length;
  const flippers = patterns.filter(r => r.pattern?.behaviorType === 'FLIPPER').length;
  const percentage = ((ultraFlippers + flippers) / patterns.length) * 100;
  return `${percentage.toFixed(0)}% of wallets are flippers (ULTRA_FLIPPER + FLIPPER), indicating ${percentage > 70 ? 'high volatility in this cohort' : percentage > 40 ? 'moderate trading activity' : 'longer-term holding behavior'}`;
})()}

3. **Data Quality:** ${(() => {
  const avgQuality = results.filter(r => r.pattern).reduce((sum, r) => sum + (r.pattern?.dataQuality || 0), 0) / results.filter(r => r.pattern).length;
  return `Average data quality is ${(avgQuality * 100).toFixed(0)}% - ${avgQuality >= 0.9 ? 'excellent reliability' : avgQuality >= 0.7 ? 'good reliability' : 'consider requiring more completed cycles'}`;
})()}

4. **Completed Cycles:** Average of ${avgCyclesPerWallet.toFixed(0)} completed cycles per wallet provides ${avgCyclesPerWallet >= 50 ? 'very strong' : avgCyclesPerWallet >= 20 ? 'good' : 'moderate'} statistical confidence

---

## 🔗 Additional Resources

- **Raw Data:** \`${path.basename(process.argv[3] || 'test-results.json')}\`
- **Generated:** ${new Date().toLocaleString()}
- **Total Analysis Time:** ${((syncTimes.reduce((a, b) => a + b, 0) + results.reduce((sum, r) => sum + r.analysisTimeSeconds, 0)) / 60).toFixed(1)} minutes

---

*Report generated by Holder Risk Analysis System v1.0*
`;

  return report;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('input', {
      alias: 'i',
      type: 'string',
      demandOption: true,
      description: 'Input JSON file with holder risk test results',
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      default: 'holder-risk-report.md',
      description: 'Output markdown file for the report',
    })
    .parseAsync();

  const { input, output } = argv;

  console.log('\n📊 Generating Holder Risk Analysis Report...\n');
  console.log(`📁 Input:  ${input}`);
  console.log(`📄 Output: ${output}\n`);

  // Read input data
  const rawData = fs.readFileSync(input, 'utf-8');
  const data: TestResults = JSON.parse(rawData);

  // Generate report
  const report = generateMarkdownReport(data);

  // Ensure output directory exists
  const outputDir = path.dirname(output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write report
  fs.writeFileSync(output, report);

  console.log('✅ Report generated successfully!\n');
  console.log(`📊 Summary:`);
  console.log(`   - Wallets analyzed: ${data.summary.walletsTest}`);
  console.log(`   - Total swaps: ${data.summary.totalSwaps.toLocaleString()}`);
  console.log(`   - Avg sync time: ${data.summary.avgSyncTimeSeconds.toFixed(1)}s`);
  console.log(`\n💾 Report saved to: ${output}`);
  console.log(`\n💡 Share this file with your friend!`);
}

main().catch(console.error);
