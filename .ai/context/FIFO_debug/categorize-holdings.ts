#!/usr/bin/env node
/**
 * Categorize all tokens for a wallet by FIFO weighted holding time
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TokenTrade {
  timestamp: number;
  direction: 'in' | 'out';
  amount: number;
}

interface TokenResult {
  mint: string;
  weightedHoldTimeHours: number;
  weightedHoldTimeMinutes: number;
  peakPosition: number;
  currentPosition: number;
  isCompleted: boolean;
  buyCount: number;
  sellCount: number;
  firstTrade: number;
  lastTrade: number;
}

interface Category {
  label: string;
  minMinutes: number;
  maxMinutes: number;
  tokens: TokenResult[];
}

const CATEGORIES: Omit<Category, 'tokens'>[] = [
  { label: '< 1 second', minMinutes: 0, maxMinutes: 1/60 },
  { label: '1 sec - 1 min', minMinutes: 1/60, maxMinutes: 1 },
  { label: '1-5 min', minMinutes: 1, maxMinutes: 5 },
  { label: '5-10 min', minMinutes: 5, maxMinutes: 10 },
  { label: '10-30 min', minMinutes: 10, maxMinutes: 30 },
  { label: '30-60 min', minMinutes: 30, maxMinutes: 60 },
  { label: '1-4 hours', minMinutes: 60, maxMinutes: 240 },
  { label: '4-24 hours', minMinutes: 240, maxMinutes: 1440 },
  { label: '1-7 days', minMinutes: 1440, maxMinutes: 10080 },
  { label: '> 7 days', minMinutes: 10080, maxMinutes: Infinity },
];

function calculateFIFOWeightedHoldTime(
  trades: TokenTrade[],
  currentTimestamp: number
): {
  weightedHoldTimeHours: number;
  peakPosition: number;
  currentPosition: number;
  isCompleted: boolean;
} {
  const buyQueue: Array<{ timestamp: number; amount: number }> = [];
  let totalWeightedDuration = 0;
  let totalAmountProcessed = 0;
  let peakPosition = 0;
  let currentPosition = 0;

  const secondsToHours = (seconds: number) => seconds / 3600;
  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  // Calculate peak position
  for (const trade of sortedTrades) {
    if (trade.direction === 'in') {
      currentPosition += trade.amount;
      if (currentPosition > peakPosition) {
        peakPosition = currentPosition;
      }
    } else if (trade.direction === 'out') {
      currentPosition -= trade.amount;
    }
  }

  // Reset for calculation
  currentPosition = 0;
  const buyQueueForCalc: Array<{ timestamp: number; amount: number }> = [];

  for (const trade of sortedTrades) {
    if (trade.direction === 'in') {
      buyQueueForCalc.push({
        timestamp: trade.timestamp,
        amount: trade.amount
      });
      currentPosition += trade.amount;
    } else if (trade.direction === 'out' && buyQueueForCalc.length > 0) {
      let remainingSellAmount = trade.amount;
      const sellTimestamp = trade.timestamp;

      while (remainingSellAmount > 0 && buyQueueForCalc.length > 0) {
        const oldestBuy = buyQueueForCalc[0];
        const durationSeconds = sellTimestamp - oldestBuy.timestamp;

        if (oldestBuy.amount <= remainingSellAmount) {
          totalWeightedDuration += secondsToHours(durationSeconds) * oldestBuy.amount;
          totalAmountProcessed += oldestBuy.amount;
          currentPosition -= oldestBuy.amount;
          remainingSellAmount -= oldestBuy.amount;
          buyQueueForCalc.shift();
        } else {
          totalWeightedDuration += secondsToHours(durationSeconds) * remainingSellAmount;
          totalAmountProcessed += remainingSellAmount;
          currentPosition -= remainingSellAmount;
          oldestBuy.amount -= remainingSellAmount;
          remainingSellAmount = 0;
        }
      }
    }
  }

  const isCompleted = currentPosition <= peakPosition * 0.20;
  if (!isCompleted && buyQueueForCalc.length > 0) {
    for (const position of buyQueueForCalc) {
      const durationSeconds = currentTimestamp - position.timestamp;
      totalWeightedDuration += secondsToHours(durationSeconds) * position.amount;
      totalAmountProcessed += position.amount;
    }
  }

  const weightedHoldTimeHours = totalAmountProcessed > 0
    ? totalWeightedDuration / totalAmountProcessed
    : 0;

  return {
    weightedHoldTimeHours,
    peakPosition,
    currentPosition,
    isCompleted
  };
}

function formatDuration(minutes: number): string {
  if (minutes < 1/60) {
    return `${(minutes * 60).toFixed(2)}s`;
  } else if (minutes < 1) {
    return `${(minutes * 60).toFixed(1)}s`;
  } else if (minutes < 60) {
    return `${minutes.toFixed(1)}m`;
  } else if (minutes < 1440) {
    return `${(minutes / 60).toFixed(2)}h`;
  } else {
    return `${(minutes / 1440).toFixed(2)}d`;
  }
}

async function analyzeWallet(walletAddress: string) {
  console.log('=== TOKEN HOLDING TIME CATEGORIZATION ===\n');
  console.log(`Wallet: ${walletAddress}\n`);

  // Fetch all swaps for this wallet
  const swaps = await prisma.swapAnalysisInput.findMany({
    where: { walletAddress },
    orderBy: { timestamp: 'asc' }
  });

  console.log(`📊 Total swap records: ${swaps.length}\n`);

  // Group by token
  const tokenMap = new Map<string, any[]>();
  swaps.forEach(swap => {
    if (!tokenMap.has(swap.mint)) {
      tokenMap.set(swap.mint, []);
    }
    tokenMap.get(swap.mint)!.push(swap);
  });

  console.log(`🪙 Unique tokens traded: ${tokenMap.size}\n`);

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const tokenResults: TokenResult[] = [];

  // Analyze each token
  for (const [mint, tokenSwaps] of tokenMap.entries()) {
    const trades: TokenTrade[] = tokenSwaps.map(s => ({
      timestamp: s.timestamp,
      direction: s.direction as 'in' | 'out',
      amount: s.amount
    }));

    const buys = trades.filter(t => t.direction === 'in');
    const sells = trades.filter(t => t.direction === 'out');

    // Skip tokens with no completed cycles
    if (buys.length === 0 || sells.length === 0) {
      continue;
    }

    const result = calculateFIFOWeightedHoldTime(trades, currentTimestamp);

    tokenResults.push({
      mint,
      weightedHoldTimeHours: result.weightedHoldTimeHours,
      weightedHoldTimeMinutes: result.weightedHoldTimeHours * 60,
      peakPosition: result.peakPosition,
      currentPosition: result.currentPosition,
      isCompleted: result.isCompleted,
      buyCount: buys.length,
      sellCount: sells.length,
      firstTrade: Math.min(...trades.map(t => t.timestamp)),
      lastTrade: Math.max(...trades.map(t => t.timestamp))
    });
  }

  console.log(`✅ Analyzed tokens with completed cycles: ${tokenResults.length}\n`);

  // Categorize tokens
  const categories: Category[] = CATEGORIES.map(cat => ({
    ...cat,
    tokens: []
  }));

  tokenResults.forEach(token => {
    const category = categories.find(
      cat => token.weightedHoldTimeMinutes >= cat.minMinutes &&
             token.weightedHoldTimeMinutes < cat.maxMinutes
    );
    if (category) {
      category.tokens.push(token);
    }
  });

  // Print results
  console.log('='.repeat(80));
  console.log('HOLDING TIME DISTRIBUTION');
  console.log('='.repeat(80));
  console.log();

  categories.forEach(category => {
    if (category.tokens.length === 0) return;

    const percentage = (category.tokens.length / tokenResults.length) * 100;
    const bar = '█'.repeat(Math.round(percentage / 2));

    console.log(`\n📁 ${category.label}`);
    console.log(`   Count: ${category.tokens.length} tokens (${percentage.toFixed(1)}%)`);
    console.log(`   ${bar}\n`);

    // Sort by hold time
    const sorted = category.tokens.sort((a, b) => a.weightedHoldTimeMinutes - b.weightedHoldTimeMinutes);

    sorted.forEach((token, idx) => {
      const shortMint = `${token.mint.substring(0, 4)}...${token.mint.substring(token.mint.length - 4)}`;
      const status = token.isCompleted ? '✓' : '○';
      console.log(
        `   ${idx + 1}. ${shortMint} - ${formatDuration(token.weightedHoldTimeMinutes)} ` +
        `(${token.buyCount}B/${token.sellCount}S) ${status}`
      );
    });
  });

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(80));
  console.log();

  const allHoldTimes = tokenResults.map(t => t.weightedHoldTimeMinutes);
  const sorted = [...allHoldTimes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const avg = allHoldTimes.reduce((a, b) => a + b, 0) / allHoldTimes.length;

  console.log(`Total Tokens: ${tokenResults.length}`);
  console.log(`Median Hold Time: ${formatDuration(median)}`);
  console.log(`Average Hold Time: ${formatDuration(avg)}`);
  console.log(`Fastest: ${formatDuration(Math.min(...allHoldTimes))}`);
  console.log(`Slowest: ${formatDuration(Math.max(...allHoldTimes))}`);
  console.log();

  const ultraFast = categories.slice(0, 2).reduce((sum, c) => sum + c.tokens.length, 0);
  const fast = categories.slice(2, 4).reduce((sum, c) => sum + c.tokens.length, 0);
  console.log(`⚡ Ultra-fast (< 1 min): ${ultraFast} (${(ultraFast/tokenResults.length*100).toFixed(1)}%)`);
  console.log(`🏃 Fast (1-10 min): ${fast} (${(fast/tokenResults.length*100).toFixed(1)}%)`);
  console.log();

  console.log('Legend: ✓ = Exited, ○ = Active, B = Buys, S = Sells');
  console.log();
}

async function main() {
  const walletAddress = 'DfTFZuqiLaQH2mJTbsQnuVgJ7ixpax1NvogPMrhXiyX3';

  try {
    await analyzeWallet(walletAddress);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
