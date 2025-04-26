import chalk from 'chalk';
import { OnChainAnalysisResult } from '../types/helius-api';
import { createLogger } from '../utils/logger';

const logger = createLogger('DisplayUtils');

// --- Known Token Addresses (Copied from transfer-analyzer-service) ---
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const KNOWN_TOKENS: Record<string, string> = {
  [SOL_MINT]: 'SOL',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  // 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
};

function getTokenDisplayName(address: string): string {
    return KNOWN_TOKENS[address] || address;
}
// --- End Known Token Addresses ---

/**
 * Displays a summary of the On-Chain Analysis results to the console.
 * @param results Array of OnChainAnalysisResult
 * @param walletAddress The wallet address analyzed
 */
export function displaySummary(results: OnChainAnalysisResult[], walletAddress: string): void {
  const overallNetSolPL = results.reduce((sum, r) => sum + r.netSolProfitLoss, 0);
  const profitableTokens = results.filter(r => r.netSolProfitLoss > 0).length;
  const lossTokens = results.filter(r => r.netSolProfitLoss < 0).length;
  const totalSwapLegs = results.reduce((sum, r) => sum + r.transferCountIn + r.transferCountOut, 0);

  const sortedResults = [...results].sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss);

  const firstTimestamp = results.reduce((min, r) => r.firstTransferTimestamp > 0 ? Math.min(min, r.firstTransferTimestamp) : min, Infinity);
  const lastTimestamp = results.reduce((max, r) => Math.max(max, r.lastTransferTimestamp), 0);
  const firstDate = firstTimestamp !== Infinity ? new Date(firstTimestamp * 1000).toLocaleDateString() : 'N/A';
  const lastDate = lastTimestamp > 0 ? new Date(lastTimestamp * 1000).toLocaleDateString() : 'N/A';
  const durationDays = (firstTimestamp !== Infinity && lastTimestamp > 0) ? Math.ceil((lastTimestamp - firstTimestamp) / (60 * 60 * 24)) : 0;

  console.log(`\n${chalk.bold.blue('📊 Wallet On-Chain SWAP & SOL P/L Summary for')} ${chalk.yellow(walletAddress)}`);
  console.log(chalk.blue('======================================================='));

  console.log(chalk.bold('\n📈 Overview:'));
  console.log(`• Unique SPL Tokens Swapped: ${chalk.cyan(results.length)}`);
  console.log(`• Overall Net SOL P/L: ${chalk.bold(overallNetSolPL >= 0 ? chalk.green(overallNetSolPL.toFixed(6)) : chalk.red(overallNetSolPL.toFixed(6)))} SOL`);
  console.log(`• Profitable Tokens (SOL): ${chalk.green(profitableTokens)}`);
  console.log(`• Loss Tokens (SOL): ${chalk.red(lossTokens)}`);
  console.log(`• Total Swap Legs (In/Out): ${chalk.magenta(totalSwapLegs)}`);

  console.log(chalk.bold('\n💰 Top 5 Tokens by Net SOL P/L:'));
  sortedResults.slice(0, 5).forEach((result, index) => {
    const pnlColor = result.netSolProfitLoss >= 0 ? chalk.green : chalk.red;
    const displayName = getTokenDisplayName(result.tokenAddress);
    const addrDisplay = displayName !== result.tokenAddress ? chalk.gray(` (${result.tokenAddress.substring(0,4)}...${result.tokenAddress.substring(result.tokenAddress.length-4)})`) : '';
    console.log(`${index + 1}. ${chalk.bold(displayName)}${addrDisplay} (${pnlColor(result.netSolProfitLoss.toFixed(4) + ' SOL')})`);
  });

  console.log(chalk.bold('\n⏱️ Swap Activity Period:'));
  console.log(`• First Swap: ${chalk.yellow(firstDate)}`);
  console.log(`• Last Swap: ${chalk.yellow(lastDate)}`);
  if (durationDays > 0) {
      console.log(`• Duration: ${chalk.yellow(durationDays)} days`);
  }
}

/**
 * Displays detailed token swap activity (Top/Bottom by P/L) to the console.
 * @param results Array of OnChainAnalysisResult
 */
export function displayDetailedResults(results: OnChainAnalysisResult[]): void {
  const sortedResults = [...results].sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss);

  console.log(chalk.bold.blue('\n--- Detailed SOL P/L by Token ---'));

  console.log(chalk.bold.green('\nTop 10 Gainers by SOL P/L:'));
  if (sortedResults.filter(r => r.netSolProfitLoss > 0).length === 0) {
      console.log(chalk.gray('  No profitable tokens found.'));
  } else {
      sortedResults.filter(r => r.netSolProfitLoss > 0).slice(0, 10).forEach((result, index) => {
        const displayName = getTokenDisplayName(result.tokenAddress);
        const addrDisplay = displayName !== result.tokenAddress ? chalk.gray(` (${result.tokenAddress})`) : '';
        console.log(`  ${index + 1}. ${chalk.bold(displayName)}${addrDisplay}`);
        console.log(`     Net SOL P/L: ${chalk.green(result.netSolProfitLoss.toFixed(6))} SOL`);
        console.log(`     Swaps: ${chalk.cyan(result.transferCountIn)} In / ${chalk.cyan(result.transferCountOut)} Out`);
      });
  }

  console.log(chalk.bold.red('\nTop 10 Losers by SOL P/L:'));
  const losers = sortedResults.filter(r => r.netSolProfitLoss < 0).reverse(); // Reverse to show biggest loss first
  if (losers.length === 0) {
      console.log(chalk.gray('  No tokens with SOL loss found.'));
  } else {
      losers.slice(0, 10).forEach((result, index) => {
        const displayName = getTokenDisplayName(result.tokenAddress);
        const addrDisplay = displayName !== result.tokenAddress ? chalk.gray(` (${result.tokenAddress})`) : '';
        console.log(`  ${index + 1}. ${chalk.bold(displayName)}${addrDisplay}`);
        console.log(`     Net SOL P/L: ${chalk.red(result.netSolProfitLoss.toFixed(6))} SOL`);
        console.log(`     Swaps: ${chalk.cyan(result.transferCountIn)} In / ${chalk.cyan(result.transferCountOut)} Out`);
      });
  }
  console.log(chalk.blue('-----------------------------------'));
}

// Helper to get activity time range using timestamps
function getActivityTimeRange(results: OnChainAnalysisResult[]): { first: number; last: number; durationDays: number } | null {
  const timestamps = results
    .flatMap(r => [r.firstTransferTimestamp, r.lastTransferTimestamp])
    .filter((ts): ts is number => ts > 0); // Filter out 0 or invalid timestamps

  if (timestamps.length === 0) return null;

  const first = Math.min(...timestamps);
  const last = Math.max(...timestamps);
  const durationDays = (last - first) / (60 * 60 * 24); // Duration in days based on unix timestamps

  return { first, last, durationDays };
} 