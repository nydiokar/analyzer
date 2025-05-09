/**
 * @fileoverview Wallet Behavior Analyzer
 * 
 * Analyzes Solana wallet transaction history to identify trading patterns and behaviors.
 * Calculates key performance indicators (KPIs) that characterize wallet trading behavior:
 * 
 * - Trading speed metrics (% trades in different time windows)
 * - Token-level buy/sell symmetry (balanced trading on per-token basis)
 * - Hold duration metrics (median and average time between buy/sell)
 * - Trade sequence consistency (buy→sell pattern adherence)
 * - Automatic trading style classification with confidence scoring
 * 
 * This script specializes in identifying "fast flippers" - traders who quickly
 * buy and sell tokens for short-term profits. It works directly with pre-processed
 * transaction data from the database.
 * 
 * Usage:
 * ```
 * npx ts-node src/scripts/wallet-behavior-analyzer.ts --wallets <WALLET_ADDRESS>
 * ```
 * 
 * @module WalletBehaviorAnalyzer
 */

import { createLogger } from '../utils/logger';
import { SwapAnalysisInput } from '@prisma/client';
import { getSwapAnalysisInputs, prisma } from '../services/database-service';
import * as fs from 'fs';
import * as path from 'path';

// Create logger for this module
const logger = createLogger('WalletBehaviorAnalyzer');

// Types for our behavioral analysis
interface TokenTradeSequence {
  mint: string;
  trades: {
    timestamp: number;
    direction: 'in' | 'out';
    amount: number;
    associatedSolValue: number;
  }[];
  buyCount: number;
  sellCount: number;
  completePairs: number;  // Renamed for clarity from consecutivePairs
  buySellRatio: number;   // Added: actual buy/sell ratio for this token
}

interface BehavioralMetrics {
  // Core flipper metrics
  buySellRatio: number;              // Ratio of buys:sells (1.0 = perfect balance)
  buySellSymmetry: number;           // How balanced buys/sells are (1.0 = perfect balance)
  averageFlipDurationHours: number;  // Average time between buy-sell pairs
  sequenceConsistency: number;       // How consistent the buy-sell alternation is
  flipperScore: number;              // Combined score for flipper behavior
  
  // Supporting metrics
  uniqueTokensTraded: number;
  tokensWithBothBuyAndSell: number;  // Tokens with at least one buy AND one sell
  totalTradeCount: number;
  totalBuyCount: number;             // Total buys across all tokens
  totalSellCount: number;            // Total sells across all tokens
  completePairsCount: number;        // Total number of complete buy→sell pairs
  averageTradesPerToken: number;
  
  // More granular timing distribution
  tradingTimeDistribution: {
    ultraFast: number;      // < 30 minutes
    veryFast: number;       // 30-60 minutes
    fast: number;           // 1-4 hours
    moderate: number;       // 4-8 hours
    dayTrader: number;      // 8-24 hours
    swing: number;          // 1-7 days
    position: number;       // > 7 days
  };
  
  // Classification
  tradingStyle: string;     // "True Flipper", "Partial Flipper", "Swing Trader", etc.
  confidenceScore: number;  // How confident the classification is
  
  // Additional descriptive metrics
  medianHoldTime: number;   // Median hold time in hours (less affected by outliers)
  percentTradesUnder1Hour: number;  // % of all trades completed within 1 hour
  percentTradesUnder4Hours: number; // % of all trades completed within 4 hours
}

/**
 * Analyzes raw swap records to detect trading behavior patterns
 * with a focus on identifying "fast flipper" behavior.
 * 
 * This function serves as the main entry point for wallet behavior analysis.
 * It fetches swap records from the database, processes them to identify trading
 * patterns, and calculates behavioral metrics focused on trading speed, 
 * token-level symmetry, and buy/sell sequence consistency.
 * 
 * @param walletAddress - The Solana wallet address to analyze
 * @param timeRange - Optional time range to limit the analysis (unix timestamps)
 * @returns Promise resolving to a BehavioralMetrics object containing all calculated KPIs
 */
export async function analyzeTradingBehavior(
  walletAddress: string,
  timeRange?: { startTs?: number, endTs?: number }
): Promise<BehavioralMetrics> {
  logger.info(`Analyzing trading behavior for wallet ${walletAddress}`);
  
  // Fetch all swap records from database
  const swapRecords = await getSwapAnalysisInputs(walletAddress, timeRange);
  
  if (swapRecords.length === 0) {
    logger.warn(`No swap records found for wallet ${walletAddress}`);
    return getEmptyMetrics();
  }
  
  // Group transactions by token
  const tokenSequences = buildTokenSequences(swapRecords);
  
  // Calculate core behavioral metrics
  const metrics = calculateBehavioralMetrics(tokenSequences);
  
  // Classify trading style based on revised criteria
  classifyTradingStyle(metrics);
  
  logger.info(`Completed behavior analysis for ${walletAddress}`);
  return metrics;
}

/**
 * Groups swap records by token and sorts them chronologically
 */
function buildTokenSequences(swapRecords: SwapAnalysisInput[]): TokenTradeSequence[] {
  // First, group by token mint
  const groupedByMint: { [key: string]: SwapAnalysisInput[] } = {};
  
  swapRecords.forEach(record => {
    if (!groupedByMint[record.mint]) {
      groupedByMint[record.mint] = [];
    }
    groupedByMint[record.mint].push(record);
  });
  
  // Then create token sequences with chronologically sorted trades
  const sequences: TokenTradeSequence[] = [];
  
  for (const [mint, records] of Object.entries(groupedByMint)) {
    // Sort by timestamp ascending
    const sortedRecords = records.sort((a, b) => a.timestamp - b.timestamp);
    
    const buyCount = records.filter(r => r.direction === 'in').length;
    const sellCount = records.filter(r => r.direction === 'out').length;
    
    // Calculate buy/sell ratio - avoiding division by zero
    let buySellRatio = 0;
    if (buyCount > 0 && sellCount > 0) {
      buySellRatio = buyCount / sellCount;
      // Invert ratio if sells > buys to keep it >= 1 for consistency
      if (buySellRatio < 1) {
        buySellRatio = 1 / buySellRatio;
      }
    }
    
    // Build the trade sequence
    const sequence: TokenTradeSequence = {
      mint,
      trades: sortedRecords.map(r => ({
        timestamp: r.timestamp,
        direction: r.direction as 'in' | 'out',
        amount: r.amount,
        associatedSolValue: r.associatedSolValue
      })),
      buyCount,
      sellCount,
      completePairs: 0,  // Will be calculated next
      buySellRatio
    };
    
    // Calculate consecutive buy-sell pairs
    sequence.completePairs = countBuySellPairs(sequence.trades);
    
    sequences.push(sequence);
  }
  
  return sequences;
}

/**
 * Counts the number of clean buy-sell pairs in a sequence
 * A clean pair is defined as a buy followed by a sell
 */
function countBuySellPairs(trades: TokenTradeSequence['trades']): number {
  let pairCount = 0;
  let expectingDirection: 'in' | 'out' = 'in'; // Start expecting a buy
  let currentPairStart = -1;
  
  for (let i = 0; i < trades.length; i++) {
    const trade = trades[i];
    
    if (trade.direction === expectingDirection) {
      if (expectingDirection === 'in') {
        // Found a buy, start a potential pair
        currentPairStart = i;
        expectingDirection = 'out';
      } else {
        // Found a sell that follows a buy, complete the pair
        pairCount++;
        expectingDirection = 'in';
      }
    } else if (expectingDirection === 'out' && trade.direction === 'in') {
      // Found another buy before selling, reset the expected sequence
      currentPairStart = i;
      // Still expecting a sell
    }
    // If we see a sell when expecting a buy, just ignore it
  }
  
  return pairCount;
}

/**
 * Calculate the median hold time (more resistant to outliers)
 * Fix to ensure we don't get 0.0h for wallets with clearly different trading speeds
 */
function calculateMedianHoldTime(durations: number[]): number {
  if (durations.length === 0) return 0;
  
  // Make sure we're using a copy to avoid modifying the original
  const sortedDurations = [...durations].sort((a, b) => a - b);
  const midIndex = Math.floor(sortedDurations.length / 2);
  
  if (sortedDurations.length % 2 === 0) {
    // Even number of elements - average the middle two
    return (sortedDurations[midIndex - 1] + sortedDurations[midIndex]) / 2;
  } else {
    // Odd number of elements - take the middle one
    return sortedDurations[midIndex];
  }
}

/**
 * Calculate the revised flipper score that better reflects true flipper behavior
 * Heavily weights ultra-fast trading percentage (< 30min) and token-level buy/sell symmetry
 */
function calculateFlipperScore(metrics: BehavioralMetrics): number {
  // Speed scores with high emphasis on ultra-fast trades
  const speedScore = (
    metrics.tradingTimeDistribution.ultraFast * 0.85 +  // Increased weight for ultra-fast (<30min)
    metrics.tradingTimeDistribution.veryFast * 0.10 +   // Reduced weight for very fast (30-60min)
    metrics.tradingTimeDistribution.fast * 0.05         // Small weight for 1-4h trades
  );
  
  // Use token-level balanced trading (symmetry) and consistent sequences
  const balanceScore = (
    metrics.buySellSymmetry * 0.6 +              // Token-level symmetry (now more meaningful)
    metrics.sequenceConsistency * 0.4            // How consistently the trader follows buy-sell patterns
  );
  
  // Combined score with very strong emphasis on ultra-fast trading
  // and meaningful influence from token-level balance
  return (speedScore * 0.85) + (balanceScore * 0.15);
}

/**
 * Calculate flip durations and time distributions 
 */
function calculateTimeDistributions(sequences: TokenTradeSequence[]): {
  durations: number[],
  distribution: BehavioralMetrics['tradingTimeDistribution'],
  percentUnder1Hour: number,
  percentUnder4Hours: number,
  avgDuration: number,
  medianDuration: number
} {
  const allDurations: number[] = [];
  
  // Counters for each time window
  let ultraFastCount = 0;    // < 30 min
  let veryFastCount = 0;     // 30-60 min
  let fastCount = 0;         // 1-4 hours
  let moderateCount = 0;     // 4-8 hours
  let dayTraderCount = 0;    // 8-24 hours
  let swingCount = 0;        // 1-7 days
  let positionCount = 0;     // > 7 days
  
  // Extract all durations from sequences
  for (const seq of sequences) {
    // Only analyze tokens with both buys and sells
    if (seq.buyCount > 0 && seq.sellCount > 0) {
      const tokenDurations = calculateFlipDurations(seq.trades);
      allDurations.push(...tokenDurations);
    }
  }
  
  // Categorize each duration
  for (const hours of allDurations) {
    if (hours < 0.5) ultraFastCount++;              // < 30 min
    else if (hours < 1) veryFastCount++;            // 30-60 min
    else if (hours < 4) fastCount++;                // 1-4 hours
    else if (hours < 8) moderateCount++;            // 4-8 hours
    else if (hours < 24) dayTraderCount++;          // 8-24 hours
    else if (hours < 168) swingCount++;             // 1-7 days
    else positionCount++;                           // > 7 days
  }
  
  const totalCount = Math.max(1, allDurations.length); // Avoid division by zero
  
  // Calculate distribution percentages
  const distribution = {
    ultraFast: ultraFastCount / totalCount,
    veryFast: veryFastCount / totalCount,
    fast: fastCount / totalCount,
    moderate: moderateCount / totalCount,
    dayTrader: dayTraderCount / totalCount,
    swing: swingCount / totalCount,
    position: positionCount / totalCount
  };
  
  // Calculate other time-based metrics
  const percentUnder1Hour = (ultraFastCount + veryFastCount) / totalCount;
  const percentUnder4Hours = (ultraFastCount + veryFastCount + fastCount) / totalCount;
  
  // Calculate average duration
  const avgDuration = allDurations.length > 0 
    ? allDurations.reduce((sum, d) => sum + d, 0) / allDurations.length 
    : 0;
  
  // Calculate median duration using our dedicated function
  const medianDuration = calculateMedianHoldTime(allDurations);
  
  return {
    durations: allDurations,
    distribution,
    percentUnder1Hour,
    percentUnder4Hours,
    avgDuration,
    medianDuration
  };
}

/**
 * Calculate the behavioral metrics from token trade sequences
 */
function calculateBehavioralMetrics(sequences: TokenTradeSequence[]): BehavioralMetrics {
  // Initialize with empty metrics
  const metrics = getEmptyMetrics();
  
  if (sequences.length === 0) {
    return metrics;
  }
  
  // Basic counts
  metrics.uniqueTokensTraded = sequences.length;
  metrics.totalTradeCount = sequences.reduce((sum, seq) => sum + seq.trades.length, 0);
  metrics.totalBuyCount = sequences.reduce((sum, seq) => sum + seq.buyCount, 0);
  metrics.totalSellCount = sequences.reduce((sum, seq) => sum + seq.sellCount, 0);
  
  // Get only tokens with both buys and sells
  const sequencesWithBothBuyAndSell = sequences.filter(s => s.buyCount > 0 && s.sellCount > 0);
  metrics.tokensWithBothBuyAndSell = sequencesWithBothBuyAndSell.length;
  
  // Calculate buy/sell ratio for the entire wallet
  if (metrics.totalBuyCount > 0 && metrics.totalSellCount > 0) {
    metrics.buySellRatio = metrics.totalBuyCount / metrics.totalSellCount;
  }
  
  // NEW TOKEN-LEVEL SYMMETRY CALCULATION
  // Instead of wallet-level, calculate symmetry at token level first, then average
  if (sequencesWithBothBuyAndSell.length > 0) {
    // Calculate symmetry for each token that has both buys and sells
    const tokenSymmetries = sequencesWithBothBuyAndSell.map(seq => 
      Math.min(seq.buyCount, seq.sellCount) / Math.max(seq.buyCount, seq.sellCount)
    );
    
    // Calculate trade volumes for potential weighting
    const tokenTradeCounts = sequencesWithBothBuyAndSell.map(seq => 
      seq.buyCount + seq.sellCount
    );
    const totalTradeCount = tokenTradeCounts.reduce((sum, count) => sum + count, 0);
    
    // Option 1: Simple average of token symmetries
    const simpleAvgSymmetry = tokenSymmetries.reduce((sum, sym) => sum + sym, 0) / tokenSymmetries.length;
    
    // Option 2: Weighted average based on trading volume (tokens with more trades have more influence)
    const weightedAvgSymmetry = tokenTradeCounts.reduce((sum, count, i) => 
      sum + (tokenSymmetries[i] * count / totalTradeCount), 0
    );
    
    // Use the weighted average for more accurate representation
    metrics.buySellSymmetry = weightedAvgSymmetry;
    
    // Log for debugging
    logger.debug(`Token-level symmetry: simple=${simpleAvgSymmetry.toFixed(3)}, weighted=${weightedAvgSymmetry.toFixed(3)}`);
  } else {
    metrics.buySellSymmetry = 0;
  }
  
  // Calculate sequence consistency and complete pairs
  metrics.completePairsCount = sequences.reduce((sum, seq) => sum + seq.completePairs, 0);
  
  // Calculate theoretical maximum possible pairs across all tokens
  const maxPossiblePairs = sequences.reduce((sum, seq) => sum + Math.min(seq.buyCount, seq.sellCount), 0);
  
  if (maxPossiblePairs > 0) {
    metrics.sequenceConsistency = metrics.completePairsCount / maxPossiblePairs;
  }
  
  // Calculate trades per token
  metrics.averageTradesPerToken = metrics.totalTradeCount / metrics.uniqueTokensTraded;
  
  // Calculate time distributions using our dedicated function
  const timeStats = calculateTimeDistributions(sequences);
  
  // Copy the calculated metrics
  metrics.tradingTimeDistribution = timeStats.distribution;
  metrics.percentTradesUnder1Hour = timeStats.percentUnder1Hour;
  metrics.percentTradesUnder4Hours = timeStats.percentUnder4Hours;
  metrics.averageFlipDurationHours = timeStats.avgDuration;
  metrics.medianHoldTime = timeStats.medianDuration;
  
  // Calculate the flipper score
  metrics.flipperScore = calculateFlipperScore(metrics);
  
  return metrics;
}

/**
 * Calculate the duration between buy-sell pairs in hours
 */
function calculateFlipDurations(trades: TokenTradeSequence['trades']): number[] {
  const durations: number[] = [];
  const secondsToHours = (seconds: number) => seconds / 3600;
  
  let buyIndex = -1;
  
  for (let i = 0; i < trades.length; i++) {
    if (trades[i].direction === 'in') {
      // Found a buy
      buyIndex = i;
    } else if (buyIndex !== -1 && trades[i].direction === 'out') {
      // Found a sell after a buy, calculate duration
      const buyTime = trades[buyIndex].timestamp;
      const sellTime = trades[i].timestamp;
      const durationHours = secondsToHours(sellTime - buyTime);
      
      durations.push(durationHours);
      buyIndex = -1; // Reset to find the next pair
    }
  }
  
  return durations;
}

/**
 * Classify trading style based on behavioral metrics
 * Prioritizes ultra-fast trading percentage as primary classifier for true flippers
 */
function classifyTradingStyle(metrics: BehavioralMetrics): void {
  // Default values
  metrics.tradingStyle = "Unclassified";
  metrics.confidenceScore = 0;
  
  // No trades or insufficient data case
  if (metrics.totalTradeCount < 5 || metrics.tokensWithBothBuyAndSell === 0) {
    metrics.tradingStyle = "Insufficient Data";
    metrics.confidenceScore = 0;
    return;
  }
  
  // True Flipper classification - extreme short-term trading
  // PRIMARY FACTOR: ultra-fast trades (< 30 min)
  if (metrics.tradingTimeDistribution.ultraFast >= 0.75) { 
    metrics.tradingStyle = "True Flipper";
    metrics.confidenceScore = Math.min(1.0, metrics.tradingTimeDistribution.ultraFast * 1.1);
    return; // Exit early to prevent fallthrough
  }
  
  // Fast Trader classification - short-term but not as extreme
  if (metrics.percentTradesUnder1Hour >= 0.70) {
    metrics.tradingStyle = "Fast Trader";
    metrics.confidenceScore = metrics.percentTradesUnder1Hour;
    return;
  }
  
  // Day Trader classification - trades within a day
  if (metrics.percentTradesUnder4Hours >= 0.60) {
    metrics.tradingStyle = "Day Trader";
    metrics.confidenceScore = 0.7;
    return;
  }
  
  // Swing Trader classification
  if (metrics.tradingTimeDistribution.swing >= 0.4) {
    metrics.tradingStyle = "Swing Trader";
    metrics.confidenceScore = 0.6 + (metrics.tradingTimeDistribution.swing - 0.4);
    return;
  }
  
  // Position Trader classification
  if (metrics.tradingTimeDistribution.position >= 0.5) {
    metrics.tradingStyle = "Position Trader";
    metrics.confidenceScore = 0.6 + (metrics.tradingTimeDistribution.position - 0.5);
    return;
  }
  
  // Accumulator classification - now focuses on buy/sell ratio rather than symmetry
  // Since we now have token-level symmetry, we should look at overall ratio for accumulation
  if (metrics.buySellRatio > 1.75 && 
      metrics.completePairsCount / Math.max(1, metrics.totalTradeCount) < 0.3) {
    metrics.tradingStyle = "Accumulator";
    metrics.confidenceScore = Math.min(0.9, metrics.buySellRatio / 5);
    return;
  }
  
  // Distributor classification - now focuses on buy/sell ratio rather than symmetry
  if (metrics.buySellRatio < 0.6 && 
      metrics.completePairsCount / Math.max(1, metrics.totalTradeCount) < 0.3) {
    metrics.tradingStyle = "Distributor";
    metrics.confidenceScore = Math.min(0.9, (1 / metrics.buySellRatio) / 5);
    return;
  }
  
  // Chaotic Trader classification
  if (metrics.sequenceConsistency < 0.3 && metrics.uniqueTokensTraded > 5) {
    metrics.tradingStyle = "Chaotic Trader";
    metrics.confidenceScore = 0.9 - metrics.sequenceConsistency;
    return;
  }
  
  // Mixed/Undefined Trading Style
  metrics.tradingStyle = "Mixed Style";
  metrics.confidenceScore = 0.4;
}

/**
 * Generate a detailed report of the behavioral analysis
 */
export function generateBehaviorReport(
  walletAddress: string, 
  metrics: BehavioralMetrics
): string {
  // Format a report that highlights the key metrics and provides clear insights
  const report = [
    `=== WALLET TRADING BEHAVIOR ANALYSIS ===`,
    `Wallet: ${walletAddress}`,
    ``,
    `TRADING STYLE CLASSIFICATION`,
    `Primary Trading Style: ${metrics.tradingStyle}`,
    `Classification Confidence: ${(metrics.confidenceScore * 100).toFixed(1)}%`,
    ``,
    `CORE BEHAVIORAL METRICS`,
    `Token-Level Buy/Sell Symmetry: ${(metrics.buySellSymmetry * 100).toFixed(1)}% (100% = perfectly balanced token-by-token)`,
    `Overall Buy:Sell Ratio: ${metrics.buySellRatio.toFixed(2)}:1`,
    `Median Hold Time: ${metrics.medianHoldTime.toFixed(1)} hours`,
    `Average Hold Time: ${metrics.averageFlipDurationHours.toFixed(1)} hours`,
    `Trade Sequence Consistency: ${(metrics.sequenceConsistency * 100).toFixed(1)}% (100% = perfect alternation)`,
    `Complete Buy→Sell Pairs: ${metrics.completePairsCount} (of ${metrics.tokensWithBothBuyAndSell} tokens with both)`,
    ``,
    `TRADING TIME DISTRIBUTION`,
    `Ultra-Fast (<30min): ${(metrics.tradingTimeDistribution.ultraFast * 100).toFixed(1)}%`,
    `Very Fast (30-60min): ${(metrics.tradingTimeDistribution.veryFast * 100).toFixed(1)}%`,
    `Fast (1-4h): ${(metrics.tradingTimeDistribution.fast * 100).toFixed(1)}%`,
    `Moderate (4-8h): ${(metrics.tradingTimeDistribution.moderate * 100).toFixed(1)}%`,
    `Day Trader (8-24h): ${(metrics.tradingTimeDistribution.dayTrader * 100).toFixed(1)}%`,
    `Swing (1-7d): ${(metrics.tradingTimeDistribution.swing * 100).toFixed(1)}%`,
    `Position (>7d): ${(metrics.tradingTimeDistribution.position * 100).toFixed(1)}%`,
    ``,
    `ACTIVITY SUMMARY`,
    `Unique Tokens Traded: ${metrics.uniqueTokensTraded}`,
    `Total Buy Transactions: ${metrics.totalBuyCount}`,
    `Total Sell Transactions: ${metrics.totalSellCount}`,
    `Total Transactions: ${metrics.totalTradeCount}`,
    `Tokens With Complete Pairs: ${metrics.tokensWithBothBuyAndSell}`,
    `% Trades Under 1 Hour: ${(metrics.percentTradesUnder1Hour * 100).toFixed(1)}%`,
    `% Trades Under 4 Hours: ${(metrics.percentTradesUnder4Hours * 100).toFixed(1)}%`,
    ``,
    `BEHAVIORAL INSIGHTS`,
  ];
  
  // Add specific insights based on the trading style
  if (metrics.tradingStyle === "True Flipper") {
    report.push(
      `This wallet exhibits classic "True Flipper" behavior, characterized by:`,
      `• Ultra-fast trading cycles (${(metrics.percentTradesUnder1Hour * 100).toFixed(1)}% of trades completed within 1 hour)`,
      `• Well-balanced buy/sell pattern at token level (${(metrics.buySellSymmetry * 100).toFixed(1)}% symmetry)`,
      `• Consistent buy→sell sequencing (${(metrics.sequenceConsistency * 100).toFixed(1)}% consistency)`,
      ``,
      `This trader is likely focused on very short-term price movements, executing`,
      `rapid trades to capture small volatility-based profits.`
    );
  } else if (metrics.tradingStyle === "Fast Trader") {
    report.push(
      `This wallet shows "Fast Trader" behavior, characterized by:`,
      `• Short-term trading cycles (${(metrics.percentTradesUnder4Hours * 100).toFixed(1)}% of trades completed within 4 hours)`,
      `• Generally balanced buy/sell pattern (${(metrics.buySellSymmetry * 100).toFixed(1)}% token symmetry)`,
      `• Reasonable alternating buy→sell pattern`,
      ``,
      `This trader appears to operate on a slightly longer timeframe than pure flippers,`,
      `likely watching price action over hours rather than minutes.`
    );
  } else if (metrics.tradingStyle === "Day Trader") {
    report.push(
      `This wallet demonstrates "Day Trader" characteristics:`,
      `• Most trades completed within same day (${((metrics.tradingTimeDistribution.ultraFast + 
         metrics.tradingTimeDistribution.veryFast + metrics.tradingTimeDistribution.fast + 
         metrics.tradingTimeDistribution.moderate + metrics.tradingTimeDistribution.dayTrader) * 100).toFixed(1)}%)`,
      `• Average hold time of ${metrics.averageFlipDurationHours.toFixed(1)} hours`,
      `• Trading across ${metrics.uniqueTokensTraded} different tokens`
    );
  } else if (metrics.tradingStyle === "Accumulator") {
    report.push(
      `This wallet shows "Accumulator" behavior, characterized by:`,
      `• Significantly more buys (${metrics.totalBuyCount}) than sells (${metrics.totalSellCount})`,
      `• Buy/sell ratio of ${metrics.buySellRatio.toFixed(2)}:1`,
      `• Only ${metrics.tokensWithBothBuyAndSell} of ${metrics.uniqueTokensTraded} tokens have both buys & sells`,
      ``,
      `This wallet appears to be focused on accumulating positions rather than`,
      `short-term trading activity.`
    );
  } else if (metrics.tradingStyle === "Distributor") {
    report.push(
      `This wallet shows "Distributor" behavior, characterized by:`,
      `• Significantly more sells (${metrics.totalSellCount}) than buys (${metrics.totalBuyCount})`,
      `• Sell/buy ratio of ${(1/metrics.buySellRatio).toFixed(2)}:1`,
      `• Only ${metrics.tokensWithBothBuyAndSell} of ${metrics.uniqueTokensTraded} tokens have both buys & sells`,
      ``,
      `This wallet appears to be primarily distributing/selling tokens rather than`,
      `actively trading them.`
    );
  }
  
  return report.join('\n');
}

/**
 * Save the behavior report to a file
 */
export function saveBehaviorReport(walletAddress: string, report: string): string {
  const dir = path.join(process.cwd(), 'reports');
  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const filename = `${walletAddress.substring(0, 8)}_behavior_report.txt`;
  const filepath = path.join(dir, filename);
  
  fs.writeFileSync(filepath, report);
  logger.info(`Saved behavior report to ${filepath}`);
  
  return filepath;
}

/**
 * Get empty metrics structure for initialization or error cases
 */
function getEmptyMetrics(): BehavioralMetrics {
  return {
    buySellRatio: 0,
    buySellSymmetry: 0,
    averageFlipDurationHours: 0,
    sequenceConsistency: 0,
    flipperScore: 0,
    uniqueTokensTraded: 0,
    tokensWithBothBuyAndSell: 0,
    totalTradeCount: 0,
    totalBuyCount: 0,
    totalSellCount: 0,
    completePairsCount: 0,
    averageTradesPerToken: 0,
    tradingTimeDistribution: {
      ultraFast: 0,
      veryFast: 0,
      fast: 0,
      moderate: 0,
      dayTrader: 0,
      swing: 0,
      position: 0
    },
    tradingStyle: "Insufficient Data",
    confidenceScore: 0,
    medianHoldTime: 0,
    percentTradesUnder1Hour: 0,
    percentTradesUnder4Hours: 0
  };
}

/**
 * CLI entry point
 */
if (require.main === module) {
  // This code runs when script is executed directly (not imported)
  const yargs = require('yargs/yargs');
  const { hideBin } = require('yargs/helpers');
  
  const argv = yargs(hideBin(process.argv))
    .usage('$0 --wallets <wallet-address> [options]')
    .option('wallets', {
      alias: 'w',
      description: 'Solana wallet address to analyze',
      type: 'string',
      demandOption: true
    })
    .option('period', {
      alias: 'p',
      description: 'Time period to analyze (day, week, month, quarter, year)',
      choices: ['day', 'week', 'month', 'quarter', 'year']
    })
    .option('startDate', {
      description: 'Start date for analysis (YYYY-MM-DD)',
      type: 'string'
    })
    .option('endDate', {
      description: 'End date for analysis (YYYY-MM-DD)',
      type: 'string'
    })
    .option('saveReport', {
      description: 'Save the behavior report to a file',
      type: 'boolean',
      default: true
    })
    .help()
    .version(false)
    .parse();
  
  // Process date range
  let timeRange: { startTs?: number, endTs?: number } | undefined = undefined;
  
  if (argv.period) {
    const endDate = new Date();
    const startDate = new Date();
    
    switch(argv.period.toLowerCase()) {
      case 'day':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }
    
    timeRange = {
      startTs: Math.floor(startDate.getTime() / 1000),
      endTs: Math.floor(endDate.getTime() / 1000)
    };
  } else if (argv.startDate || argv.endDate) {
    timeRange = {};
    
    if (argv.startDate) {
      timeRange.startTs = Math.floor(Date.parse(argv.startDate + 'T00:00:00Z') / 1000);
    }
    
    if (argv.endDate) {
      timeRange.endTs = Math.floor(Date.parse(argv.endDate + 'T23:59:59Z') / 1000);
    }
  }
  
  // Run the analysis
  (async () => {
    try {
      const metrics = await analyzeTradingBehavior(argv.wallets as string, timeRange);
      const report = generateBehaviorReport(argv.wallets as string, metrics);
      
      // Display report to console
      console.log(report);
      
      // Save report if requested
      if (argv.saveReport) {
        const filepath = saveBehaviorReport(argv.wallets as string, report);
        console.log(`\nReport saved to: ${filepath}`);
      }
    } catch (error) {
      console.error('Error during behavior analysis:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  })();
} 