import chalk from 'chalk';
import { OnChainAnalysisResult } from '@/types/helius-api';
import { createLogger } from '@/utils/logger';

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
 * Displays a brief summary of analysis results in the console 
 * @param results Array of OnChainAnalysisResult
 */
export function displaySummary(results: OnChainAnalysisResult[], walletAddress: string): void {
    console.log('\n===== Swap Analysis Summary =====');
    console.log(`Wallet: ${walletAddress}`);

    if (!Array.isArray(results)) {
        logger.error('[DisplayUtils] displaySummary received non-array for results. Cannot proceed.');
        console.log('Total Unique Tokens: N/A (Invalid data)');
        console.log('Overall Net PNL: N/A (Invalid data)');
        return;
    }

    console.log(`Total Unique Tokens: ${results.length}`);
    
    const overallNetPnl = results.length > 0 ? results.reduce((sum, r) => sum + (r.netSolProfitLoss || 0), 0) : 0;
    const overallSolSpent = results.length > 0 ? results.reduce((sum, r) => sum + (r.totalSolSpent || 0), 0) : 0;
    const overallSolReceived = results.length > 0 ? results.reduce((sum, r) => sum + (r.totalSolReceived || 0), 0) : 0;
    
    // Calculate value preservation metrics
    const valuePreservingTokens = results.filter(r => r.isValuePreservation && r.estimatedPreservedValue && r.estimatedPreservedValue > 0);
    const totalPreservedValue = valuePreservingTokens.length > 0 ? valuePreservingTokens.reduce((sum, r) => sum + (r.estimatedPreservedValue || 0), 0) : 0;
    const overallAdjustedPnl = overallNetPnl + totalPreservedValue;
    
    console.log(`\nOverall SOL Spent: ${overallSolSpent.toFixed(2)} SOL`);
    console.log(`Overall SOL Received: ${overallSolReceived.toFixed(2)} SOL`);
    console.log(`Raw Net SOL P/L: ${formatProfitLoss(overallNetPnl)}`);
    
    // Show value preservation information if applicable
    if (totalPreservedValue > 0) {
        console.log(`\n--- Value Preservation ---`);
        console.log(`Value Preservation Tokens: ${valuePreservingTokens.length}`);
        console.log(`Total Estimated Value Preserved: ${totalPreservedValue.toFixed(2)} SOL`);
        console.log(`Adjusted Net SOL P/L (including preserved value): ${formatProfitLoss(overallAdjustedPnl)}`);
        
        // Show top value preservation tokens
        console.log(`\nTop Value Preservation Tokens:`);
        valuePreservingTokens
            .sort((a, b) => (b.estimatedPreservedValue || 0) - (a.estimatedPreservedValue || 0))
            .slice(0, 3)
            .forEach((token, i) => {
                console.log(`${i+1}. ${getTokenName(token.tokenAddress)}: ${token.estimatedPreservedValue?.toFixed(2) || 0} SOL value preserved (${token.netAmountChange.toFixed(2)} tokens remaining)`);
            });
    }
    
    // Top 5 profitable tokens
    const profitableTokens = [...results].sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss);
    const topProfitable = profitableTokens.slice(0, 5);
    
    console.log('\nTop 5 Most Profitable Tokens:');
    topProfitable.forEach((result, index) => {
        const adjustedInfo = result.adjustedNetSolProfitLoss && result.adjustedNetSolProfitLoss !== result.netSolProfitLoss ? 
            ` (Adjusted: ${formatProfitLoss(result.adjustedNetSolProfitLoss)})` : '';
            
        console.log(`${index + 1}. ${getTokenName(result.tokenAddress)}: ${formatProfitLoss(result.netSolProfitLoss)}${adjustedInfo}`);
    });
    
    // Bottom 5 unprofitable tokens
    const unprofitableTokens = [...results].sort((a, b) => a.netSolProfitLoss - b.netSolProfitLoss);
    const bottomUnprofitable = unprofitableTokens.slice(0, 5);
    
    console.log('\nTop 5 Least Profitable Tokens:');
    bottomUnprofitable.forEach((result, index) => {
        const adjustedInfo = result.adjustedNetSolProfitLoss && result.adjustedNetSolProfitLoss !== result.netSolProfitLoss ? 
            ` (Adjusted: ${formatProfitLoss(result.adjustedNetSolProfitLoss)})` : '';
            
        console.log(`${index + 1}. ${getTokenName(result.tokenAddress)}: ${formatProfitLoss(result.netSolProfitLoss)}${adjustedInfo}`);
    });
    
    // Activity time range
    const range = getActivityTimeRange(results);
    if (range) {
        console.log(`\nActivity Time Range: ${formatDate(range.first)} to ${formatDate(range.last)} (approx. ${range.durationDays.toFixed(1)} days)`);
    }
    
    console.log('\nFor detailed results, check the generated report file or use --verbose flag.');
}

// Helper to get friendly token name
function getTokenName(address: string): string {
    // Map of known token addresses to friendly names
    const knownTokens: {[key: string]: string} = {
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
        'So11111111111111111111111111111111111111112': 'Wrapped SOL',
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
        // Add more tokens as needed
    };
    
    return knownTokens[address] || address.slice(0, 6) + '...' + address.slice(-4);
}

// Helper to format profit loss
function formatProfitLoss(value: number): string {
    const color = value >= 0 ? '\x1b[32m' : '\x1b[31m'; // green or red
    const reset = '\x1b[0m';
    return `${color}${value.toFixed(2)} SOL${reset}`;
}

// Helper to format date
function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toISOString().split('T')[0];
}

// Helper to get activity time range
function getActivityTimeRange(results: OnChainAnalysisResult[]): { first: number, last: number, durationDays: number } | null {
    const firstTimestamp = results.reduce((min, r) => r.firstTransferTimestamp > 0 ? Math.min(min, r.firstTransferTimestamp) : min, Infinity);
    const lastTimestamp = results.reduce((max, r) => Math.max(max, r.lastTransferTimestamp), 0);
    
    if (firstTimestamp === Infinity || lastTimestamp === 0) {
        return null;
    }
    
    const durationDays = (lastTimestamp - firstTimestamp) / (60 * 60 * 24);
    return { first: firstTimestamp, last: lastTimestamp, durationDays };
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