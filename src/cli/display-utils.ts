import { OnChainAnalysisResult } from '../types/helius-api';
import { createLogger } from '../utils/logger';

const logger = createLogger('DisplayUtils');

/**
 * Get a formatted token identifier (shortened address)
 */
function getTokenIdentifier(result: OnChainAnalysisResult): string {
  // Shorten the address for display
  return `${result.tokenAddress.substring(0, 6)}...${result.tokenAddress.substring(result.tokenAddress.length - 4)}`;
}

/**
 * Displays a summary of On-Chain Swap Analysis & SOL P/L results.
 */
export function displaySummary(results: OnChainAnalysisResult[], walletAddress: string): void {
  console.log(`\n📊 Wallet On-Chain SWAP & SOL P/L Summary for ${walletAddress}`);
  console.log('=======================================================');

  // Calculate overall SOL P/L and token counts based on SOL P/L
  const totalTokens = results.length;
  const overallNetSolPL = results.reduce((sum, r) => sum + r.netSolProfitLoss, 0);
  const profitableTokens = results.filter(r => r.netSolProfitLoss > 0).length;
  const lossTokens = results.filter(r => r.netSolProfitLoss < 0).length;
  const totalInteractions = results.reduce((sum, r) => sum + r.transferCountIn + r.transferCountOut, 0);

  console.log(`\n📈 Overview:`);
  console.log(`• Unique SPL Tokens Swapped: ${totalTokens}`);
  console.log(`• Overall Net SOL P/L: ${overallNetSolPL.toFixed(6)} SOL`); // Display overall SOL P/L
  console.log(`• Profitable Tokens (SOL): ${profitableTokens}`); // Count based on SOL
  console.log(`• Loss Tokens (SOL): ${lossTokens}`); // Count based on SOL
  console.log(`• Total Swap Legs (In/Out): ${totalInteractions}`);

  // Top Tokens by SOL P/L
  const topBySolPL = [...results]
    .sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss) // Sort by SOL P/L descending
    .slice(0, 5);

  console.log('\n💰 Top 5 Tokens by Net SOL P/L:');
  if (topBySolPL.length === 0) {
      console.log('  No swap activity found.');
  } else {
      topBySolPL.forEach((token, i) => {
        // Only show positive P/L tokens in this summary section for brevity, or indicate loss
        const pnlString = token.netSolProfitLoss > 0 
            ? `+${token.netSolProfitLoss.toFixed(4)} SOL` 
            : `${token.netSolProfitLoss.toFixed(4)} SOL`;
        console.log(`${i + 1}. ${getTokenIdentifier(token)} (${pnlString})`);
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
 * Displays detailed results, focusing on SOL P/L.
 */
export function displayDetailedResults(results: OnChainAnalysisResult[]): void {
  console.log('\n📋 Detailed Token Swap Activity (Top 10 by Net SOL P/L):'); // Updated title
  console.log('=========================================================');

  // Sort by Net SOL P/L descending
  const sortedResults = [...results]
    .sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss)
    .slice(0, 10); // Only show top 10

  if (sortedResults.length === 0) {
      console.log('  No swap activity found.');
  } else {
      sortedResults.forEach(token => {
        const interactions = token.transferCountIn + token.transferCountOut;
        const firstDate = token.firstTransferTimestamp > 0 ? new Date(token.firstTransferTimestamp * 1000).toLocaleDateString() : 'N/A';
        const lastDate = token.lastTransferTimestamp > 0 ? new Date(token.lastTransferTimestamp * 1000).toLocaleDateString() : 'N/A';

        console.log(`\n${getTokenIdentifier(token)} (${token.tokenAddress})`); // Show full address here too
        console.log(`• Net SOL P/L: ${token.netSolProfitLoss.toFixed(6)} SOL`); // Key metric
        console.log(`• Total SOL Spent: ${token.totalSolSpent.toFixed(6)} SOL`);
        console.log(`• Total SOL Received: ${token.totalSolReceived.toFixed(6)} SOL`);
        console.log(`• Swaps: ${token.transferCountIn} In / ${token.transferCountOut} Out (${interactions} total)`);
        console.log(`• Activity: ${firstDate} to ${lastDate}`);
      });
  }
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