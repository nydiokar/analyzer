import { SolPnlAnalysisResult } from '../types/helius-api';
import { createLogger } from '../utils/logger';

const logger = createLogger('DisplayUtils');

/**
 * Get a formatted token identifier (shortened address)
 */
function getTokenIdentifier(result: SolPnlAnalysisResult): string {
  // Shorten the address for display
  return `${result.splMint.substring(0, 6)}...${result.splMint.substring(result.splMint.length - 4)}`;
}

/**
 * Displays a summary of SOL P/L analysis results to the console.
 * Updated for SolPnlAnalysisResult.
 */
export function displaySummary(results: SolPnlAnalysisResult[], walletAddress: string): void {
  console.log(`\n📊 Wallet SOL P/L SWAP Analysis Summary for ${walletAddress}`);
  console.log('=============================================');

  // Basic stats
  const totalTokens = results.length;
  const profitableTokens = results.filter(r => r.netSolProfitLoss > 0).length;
  const lossTokens = results.filter(r => r.netSolProfitLoss < 0).length;
  const totalSwaps = results.reduce((sum, r) => sum + r.swapCountIn + r.swapCountOut, 0);
  const overallNetSolPL = results.reduce((sum, r) => sum + r.netSolProfitLoss, 0);


  console.log(`\n📈 Overview:`);
  console.log(`• Unique SPL Tokens Swapped: ${totalTokens}`);
  console.log(`• Profitable Tokens (SOL): ${profitableTokens}`);
  console.log(`• Loss Tokens (SOL): ${lossTokens}`);
  console.log(`• Total Swap Legs: ${totalSwaps}`); // In/Out counted separately
  console.log(`• Total Net SOL P/L: ${overallNetSolPL.toFixed(6)} SOL`);


  // Top Tokens by SOL P/L
  const topGainers = [...results]
    .sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss)
    .slice(0, 5);

  console.log('\n🔝 Top 5 Tokens by Net SOL P/L:');
  if (topGainers.length === 0 || topGainers[0].netSolProfitLoss <=0) { // Check if any actually gained
      console.log('  No profitable swap activity found.');
  } else {
      topGainers.filter(t => t.netSolProfitLoss > 0).forEach((token, i) => { // Only show actual gainers
        const swaps = token.swapCountIn + token.swapCountOut;
        console.log(`${i + 1}. ${getTokenIdentifier(token)} (${swaps} swaps)`);
        console.log(`   • Net P/L: ${token.netSolProfitLoss.toFixed(6)} SOL`); 
      });
  }
  
  // Activity Summary
  const timeRange = getActivityTimeRange(results);
  if (timeRange) {
    console.log('\n⏱️ Swap Activity Period:');
    console.log(`• First Swap: ${new Date(timeRange.first * 1000).toLocaleDateString()}`);
    console.log(`• Last Swap: ${new Date(timeRange.last * 1000).toLocaleDateString()}`);
    console.log(`• Duration: ${Math.round(timeRange.durationDays)} days`);
  }

}

/**
 * Displays detailed SOL P/L results (simplified for Phase 1).
 */
export function displayDetailedResults(results: SolPnlAnalysisResult[]): void {
  console.log('\n📋 Detailed Token SOL P/L (Top 10 by P/L):');
  console.log('===========================================');

  // Sort by P/L
  const activeTokens = [...results]
    .sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss)
    .slice(0, 10); // Only show top 10 

  if (activeTokens.length === 0) {
      console.log('  No swap activity found.');
  } else {
      activeTokens.forEach(token => {
        const swaps = token.swapCountIn + token.swapCountOut;
        const firstDate = token.firstSwapTimestamp > 0 ? new Date(token.firstSwapTimestamp * 1000).toLocaleDateString() : 'N/A';
        const lastDate = token.lastSwapTimestamp > 0 ? new Date(token.lastSwapTimestamp * 1000).toLocaleDateString() : 'N/A';

        console.log(`\n${getTokenIdentifier(token)}`);
        console.log(`• Net SOL P/L: ${token.netSolProfitLoss.toFixed(6)} SOL`);
        console.log(`• Swaps: ${token.swapCountIn} In / ${token.swapCountOut} Out (${swaps} total)`);
        console.log(`• SOL Spent: ${token.totalSolSpent.toFixed(6)}`);
        console.log(`• SOL Received: ${token.totalSolReceived.toFixed(6)}`);
        console.log(`• Net SPL: ${token.netSplAmountChange.toFixed(token.netSplAmountChange % 1 === 0 ? 0 : 6)}`); 
        console.log(`• First Swap: ${firstDate}`);
        console.log(`• Last Swap: ${lastDate}`);
      });
  }
}

// Helper to get activity time range using timestamps
function getActivityTimeRange(results: SolPnlAnalysisResult[]): { first: number; last: number; durationDays: number } | null {
  const timestamps = results
    .flatMap(r => [r.firstSwapTimestamp, r.lastSwapTimestamp])
    .filter((ts): ts is number => ts > 0); // Filter out 0 or invalid timestamps

  if (timestamps.length === 0) return null;

  const first = Math.min(...timestamps);
  const last = Math.max(...timestamps);
  const durationDays = (last - first) / (60 * 60 * 24); // Duration in days based on unix timestamps

  return { first, last, durationDays };
} 