#!/usr/bin/env node
/**
 * Generate Detailed Holder Risk Report with Token-Level Distributions
 *
 * Calculates holding times directly from database for complete transparency.
 * Shows exactly how many tokens fall into each time bucket.
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const prisma = new PrismaClient();

interface TokenHoldingTime {
  mint: string;
  entryTimestamp: number;
  exitTimestamp: number;
  holdingTimeMinutes: number;
  holdingTimeHours: number;
}

interface TimeBucket {
  label: string;
  minMinutes: number;
  maxMinutes: number;
  count: number;
  percentage: number;
}

interface WalletAnalysis {
  walletAddress: string;
  totalSwaps: number;
  completedPositions: TokenHoldingTime[];
  timeBuckets: TimeBucket[];
  avgHoldTimeMinutes: number;
  medianHoldTimeMinutes: number;
  medianTokenNumber: number; // Which token position represents the median
}

// Time buckets for analysis
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

function formatDuration(minutes: number): string {
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

function calculateHoldingTimes(swaps: any[]): TokenHoldingTime[] {
  // Group by token mint
  const tokenMap = new Map<string, any[]>();

  swaps.forEach(swap => {
    if (!tokenMap.has(swap.mint)) {
      tokenMap.set(swap.mint, []);
    }
    tokenMap.get(swap.mint)!.push(swap);
  });

  const completedPositions: TokenHoldingTime[] = [];

  // For each token, calculate holding time
  tokenMap.forEach((tokenSwaps, mint) => {
    // Sort by timestamp
    tokenSwaps.sort((a, b) => a.timestamp - b.timestamp);

    // Find first buy and last sell
    const buys = tokenSwaps.filter(s => s.direction === 'in');
    const sells = tokenSwaps.filter(s => s.direction === 'out');

    if (buys.length === 0 || sells.length === 0) {
      // Incomplete position, skip
      return;
    }

    const firstBuy = buys[0];
    const lastSell = sells[sells.length - 1];

    // Calculate holding time
    const holdingTimeSeconds = lastSell.timestamp - firstBuy.timestamp;
    const holdingTimeMinutes = holdingTimeSeconds / 60;
    const holdingTimeHours = holdingTimeMinutes / 60;

    completedPositions.push({
      mint,
      entryTimestamp: firstBuy.timestamp,
      exitTimestamp: lastSell.timestamp,
      holdingTimeMinutes,
      holdingTimeHours,
    });
  });

  return completedPositions;
}

function calculateTimeBuckets(holdingTimes: TokenHoldingTime[]): TimeBucket[] {
  const buckets = TIME_BUCKETS.map(b => ({
    ...b,
    count: 0,
    percentage: 0,
  }));

  holdingTimes.forEach(ht => {
    const bucket = buckets.find(
      b => ht.holdingTimeMinutes >= b.minMinutes && ht.holdingTimeMinutes < b.maxMinutes
    );
    if (bucket) {
      bucket.count++;
    }
  });

  // Calculate percentages
  const total = holdingTimes.length;
  buckets.forEach(b => {
    b.percentage = total > 0 ? (b.count / total) * 100 : 0;
  });

  return buckets;
}

function calculateMedian(values: number[]): { median: number; position: number } {
  if (values.length === 0) return { median: 0, position: 0 };

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return {
    median: sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid],
    position: mid + 1, // 1-indexed for human readability
  };
}

async function analyzeWallet(walletAddress: string): Promise<WalletAnalysis> {
  console.log(`\n📊 Analyzing ${walletAddress.substring(0, 8)}...`);

  // Fetch all swaps for this wallet
  const swaps = await prisma.swapAnalysisInput.findMany({
    where: { walletAddress },
    orderBy: { timestamp: 'asc' },
  });

  console.log(`   Found ${swaps.length} total swaps`);

  // Calculate holding times
  const completedPositions = calculateHoldingTimes(swaps);
  console.log(`   Completed positions: ${completedPositions.length}`);

  // Calculate statistics
  const holdingTimesMinutes = completedPositions.map(p => p.holdingTimeMinutes);
  const avgHoldTimeMinutes = holdingTimesMinutes.reduce((a, b) => a + b, 0) / holdingTimesMinutes.length;
  const medianResult = calculateMedian(holdingTimesMinutes);

  // Calculate time buckets
  const timeBuckets = calculateTimeBuckets(completedPositions);

  return {
    walletAddress,
    totalSwaps: swaps.length,
    completedPositions,
    timeBuckets,
    avgHoldTimeMinutes,
    medianHoldTimeMinutes: medianResult.median,
    medianTokenNumber: medianResult.position,
  };
}

function generateBarChart(percentage: number, maxWidth: number = 40): string {
  const barLength = Math.round((percentage / 100) * maxWidth);
  return '█'.repeat(barLength);
}

function generateMarkdownReport(analyses: WalletAnalysis[]): string {
  let report = `# 🔍 Detailed Holder Risk Analysis\n\n`;
  report += `**Generated:** ${new Date().toLocaleString()}\n`;
  report += `**Wallets Analyzed:** ${analyses.length}\n\n`;
  report += `---\n\n`;

  analyses.forEach((analysis, idx) => {
    const shortAddr = `${analysis.walletAddress.substring(0, 4)}...${analysis.walletAddress.substring(analysis.walletAddress.length - 4)}`;

    report += `## ${idx + 1}. Wallet \`${shortAddr}\`\n\n`;
    report += `**Full Address:** \`${analysis.walletAddress}\`\n\n`;

    // Summary stats
    report += `### Summary\n\n`;
    report += `| Metric | Value |\n`;
    report += `|--------|-------|\n`;
    report += `| Total Swaps | ${analysis.totalSwaps} |\n`;
    report += `| Completed Positions | ${analysis.completedPositions.length} |\n`;
    report += `| Average Hold Time | ${formatDuration(analysis.avgHoldTimeMinutes)} |\n`;
    report += `| Median Hold Time | ${formatDuration(analysis.medianHoldTimeMinutes)} |\n`;
    report += `| Median Position | Token #${analysis.medianTokenNumber} of ${analysis.completedPositions.length} |\n\n`;

    // Math verification
    const totalMinutes = analysis.completedPositions.reduce((sum, p) => sum + p.holdingTimeMinutes, 0);
    const calculatedAvg = totalMinutes / analysis.completedPositions.length;
    report += `**Math Verification:**\n`;
    report += `- Sum of all hold times: ${formatDuration(totalMinutes)}\n`;
    report += `- Positions: ${analysis.completedPositions.length}\n`;
    report += `- Average = ${formatDuration(totalMinutes)} ÷ ${analysis.completedPositions.length} = ${formatDuration(calculatedAvg)}\n\n`;

    // Time bucket distribution
    report += `### Holding Time Distribution\n\n`;
    report += `| Time Range | Tokens | % | Distribution |\n`;
    report += `|------------|--------|---|-------------|\n`;

    analysis.timeBuckets.forEach(bucket => {
      if (bucket.count > 0) {
        const bar = generateBarChart(bucket.percentage);
        report += `| ${bucket.label.padEnd(11)} | ${bucket.count.toString().padStart(6)} | ${bucket.percentage.toFixed(1).padStart(5)}% | ${bar} |\n`;
      }
    });
    report += `\n`;

    // Key insight
    const fastTrades = analysis.timeBuckets.slice(0, 4).reduce((sum, b) => sum + b.count, 0); // < 10 min
    const fastPercentage = (fastTrades / analysis.completedPositions.length) * 100;

    report += `**Key Insight:**\n`;
    report += `- ${fastTrades} tokens (${fastPercentage.toFixed(1)}%) held for less than 10 minutes\n`;
    report += `- Median of ${formatDuration(analysis.medianHoldTimeMinutes)} means 50% of positions exit faster than this\n`;
    report += `- Average is higher due to ${analysis.timeBuckets.slice(-2).reduce((sum, b) => sum + b.count, 0)} long-hold outliers\n\n`;

    report += `---\n\n`;
  });

  return report;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option('wallets', {
      alias: 'w',
      type: 'array',
      description: 'Wallet addresses to analyze (space-separated)',
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      default: 'reports/detailed-holder-report.md',
      description: 'Output markdown file',
    })
    .parseAsync();

  const wallets = (argv.wallets || []) as string[];

  if (wallets.length === 0) {
    console.error('\n❌ Error: Please provide at least one wallet address\n');
    console.log('Usage: npx ts-node -r tsconfig-paths/register src/scripts/generate-detailed-holder-report.ts \\');
    console.log('  --wallets HmqcAxtmkNvGwDZ7GKimC48QHVZtzs5eocuJ7yiuw7hN moo7FRNJBtAfKZjLMLpbWVXbR3LfimmajiU8hSeUXeT\n');
    process.exit(1);
  }

  console.log('\n🔍 Generating Detailed Holder Risk Report...\n');
  console.log(`📋 Wallets to analyze: ${wallets.length}`);

  const analyses: WalletAnalysis[] = [];

  for (const wallet of wallets) {
    const analysis = await analyzeWallet(wallet);
    analyses.push(analysis);
  }

  // Generate report
  const report = generateMarkdownReport(analyses);

  // Write to file
  const outputDir = argv.output.split('/').slice(0, -1).join('/');
  if (outputDir && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(argv.output, report);

  console.log('\n✅ Report generated successfully!\n');
  console.log(`📄 Output: ${argv.output}\n`);

  await prisma.$disconnect();
}

main().catch(console.error);
