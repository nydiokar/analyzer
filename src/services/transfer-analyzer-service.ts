import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { createLogger } from '../utils/logger';
import {
  IntermediateSwapRecord,
  SolPnlAnalysisResult
} from '../types/helius-api';

// Logger instance for this module
const logger = createLogger('TransferAnalyzerService');

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

// Helper function to adjust amount based on decimals
function adjustAmountForDecimals(rawAmount: number, decimals: number): number {
    if (isNaN(decimals) || decimals < 0) {
        logger.warn(`Invalid decimals: ${decimals}, returning raw amount.`);
        return rawAmount;
    }
    return rawAmount / Math.pow(10, decimals);
}

// Interface for the temporary paired swap data
interface PairedSwapData {
    signature: string;
    timestamp: number;
    splMint: string;
    splAmountRaw: number;
    splDecimals: number;
    splDirection: 'in' | 'out';
    solAmountLamports: number; // SOL amount involved in this specific swap
}

/**
 * Analyzes intermediate swap records to produce SOL Profit/Loss metrics.
 * @param records Array of IntermediateSwapRecord from the mapper
 * @returns Array of SolPnlAnalysisResult
 */
export function analyzeSolPnl(
  records: IntermediateSwapRecord[]
): SolPnlAnalysisResult[] {
  logger.info(`Analyzing ${records.length} intermediate swap records for SOL P/L...`);

  // Step A: Group by Signature
  const recordsBySignature = new Map<string, IntermediateSwapRecord[]>();
  for (const record of records) {
    if (!recordsBySignature.has(record.signature)) {
      recordsBySignature.set(record.signature, []);
    }
    recordsBySignature.get(record.signature)!.push(record);
  }
  logger.debug(`Grouped records into ${recordsBySignature.size} unique signatures.`);

  // Step B: Extract Paired Swap Info (SPL vs SOL for each signature)
  const pairedSwaps: PairedSwapData[] = [];
  for (const [signature, swapRecords] of recordsBySignature.entries()) {
      // Find the SOL record(s) and SPL record(s) for this signature
      const solRecords = swapRecords.filter(r => r.mint === SOL_MINT);
      const splRecords = swapRecords.filter(r => r.mint !== SOL_MINT);

      // Basic case: Expect one SOL and one SPL record relevant to the wallet per sig
      // More complex swaps (multi-leg, different fee structures) might need more robust handling
      if (solRecords.length === 1 && splRecords.length === 1) {
          const solRecord = solRecords[0];
          const splRecord = splRecords[0];

          // Ensure directions are opposite (one in, one out relative to wallet)
          if (solRecord.direction !== splRecord.direction) {
              pairedSwaps.push({
                  signature: signature,
                  timestamp: splRecord.timestamp, // Use SPL timestamp (should be same)
                  splMint: splRecord.mint,
                  splAmountRaw: splRecord.amount,
                  splDecimals: splRecord.decimals,
                  splDirection: splRecord.direction, 
                  solAmountLamports: solRecord.amount, // Use the raw lamport amount
              });
          } else {
              logger.warn(`Signature ${signature}: SOL and SPL records have same direction (${solRecord.direction}). Skipping pairing.`);
          }
      } else {
          // Log if the structure isn't the expected simple 1 SOL vs 1 SPL
          // Could be fees only, or complex swaps not handled by this basic pairing logic
          if(splRecords.length > 0) { // Only log if SPL tokens were involved but pairing failed
             logger.debug(`Signature ${signature}: Unexpected record structure. Found ${solRecords.length} SOL and ${splRecords.length} SPL records. Basic pairing skipped.`);
          }
      }
  }
  logger.info(`Extracted ${pairedSwaps.length} paired SOL/SPL swap events.`);

  // Step C: Aggregate by SPL Mint
  const analysisBySplMint = new Map<string, PairedSwapData[]>();
  for (const swap of pairedSwaps) {
    if (!analysisBySplMint.has(swap.splMint)) {
      analysisBySplMint.set(swap.splMint, []);
    }
    analysisBySplMint.get(swap.splMint)!.push(swap);
  }
  logger.info(`Aggregating results for ${analysisBySplMint.size} unique SPL tokens.`);

  // Step D: Calculate Metrics per SPL Token
  const finalResults: SolPnlAnalysisResult[] = [];
  for (const [splMint, tokenSwaps] of analysisBySplMint.entries()) {
      tokenSwaps.sort((a, b) => a.timestamp - b.timestamp); // Sort by time

      let totalSplRawAmountIn = 0;
      let totalSplRawAmountOut = 0;
      let totalSolSpentLamports = 0;
      let totalSolReceivedLamports = 0;
      let swapCountIn = 0;
      let swapCountOut = 0;
      let firstTimestamp = tokenSwaps[0].timestamp;
      let lastTimestamp = tokenSwaps[tokenSwaps.length - 1].timestamp;
      let decimals = tokenSwaps[0].splDecimals; // Assume consistent decimals

      for (const swap of tokenSwaps) {
          decimals = swap.splDecimals; // Update just in case
          if (swap.splDirection === 'in') {
              totalSplRawAmountIn += swap.splAmountRaw;
              totalSolSpentLamports += swap.solAmountLamports;
              swapCountIn++;
          } else { // splDirection === 'out'
              totalSplRawAmountOut += swap.splAmountRaw;
              totalSolReceivedLamports += swap.solAmountLamports;
              swapCountOut++;
          }
      }

      const totalSplAmountIn = adjustAmountForDecimals(totalSplRawAmountIn, decimals);
      const totalSplAmountOut = adjustAmountForDecimals(totalSplRawAmountOut, decimals);
      const netSplAmountChange = totalSplAmountIn - totalSplAmountOut;

      const totalSolSpent = totalSolSpentLamports / LAMPORTS_PER_SOL;
      const totalSolReceived = totalSolReceivedLamports / LAMPORTS_PER_SOL;
      const netSolProfitLoss = totalSolReceived - totalSolSpent;

      finalResults.push({
          splMint,
          totalSplAmountIn,
          totalSplAmountOut,
          netSplAmountChange,
          totalSolSpent,
          totalSolReceived,
          netSolProfitLoss,
          swapCountIn,
          swapCountOut,
          firstSwapTimestamp: firstTimestamp,
          lastSwapTimestamp: lastTimestamp,
      });
  }

  logger.info(`SOL P/L analysis complete for ${finalResults.length} tokens.`);
  return finalResults;
}

/**
 * Writes the SOL P/L analysis results to a CSV file.
 * @param results Array of SolPnlAnalysisResult
 * @param walletAddress The wallet address being analyzed
 * @returns Path to the saved CSV file
 */
export function writeSolPnlAnalysisToCsv(results: SolPnlAnalysisResult[], walletAddress: string): string {
  const outputDir = path.resolve('./analysis_reports');
  if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const csvFilename = `sol_pnl_report_${walletAddress}_${timestamp}.csv`;
  const csvOutputPath = path.join(outputDir, csvFilename);

  const headers = [
      'SPL Token Address', 
      'Total SPL In', 
      'Total SPL Out', 
      'Net SPL Change',
      'Total SOL Spent',
      'Total SOL Received',
      'Net SOL P/L',
      'Swaps In',
      'Swaps Out',
      'First Swap (UTC)',
      'Last Swap (UTC)'
  ];

  // Format data for CSV
  const csvData = results.map(result => ({
    'SPL Token Address': result.splMint,
    'Total SPL In': result.totalSplAmountIn.toFixed(result.totalSplAmountIn % 1 === 0 ? 0 : 8),
    'Total SPL Out': result.totalSplAmountOut.toFixed(result.totalSplAmountOut % 1 === 0 ? 0 : 8),
    'Net SPL Change': result.netSplAmountChange.toFixed(result.netSplAmountChange % 1 === 0 ? 0 : 8),
    'Total SOL Spent': result.totalSolSpent.toFixed(9),
    'Total SOL Received': result.totalSolReceived.toFixed(9),
    'Net SOL P/L': result.netSolProfitLoss.toFixed(9),
    'Swaps In': result.swapCountIn,
    'Swaps Out': result.swapCountOut,
    'First Swap (UTC)': result.firstSwapTimestamp > 0 ? new Date(result.firstSwapTimestamp * 1000).toISOString() : 'N/A',
    'Last Swap (UTC)': result.lastSwapTimestamp > 0 ? new Date(result.lastSwapTimestamp * 1000).toISOString() : 'N/A'
  }));

  // Sort CSV data - by Net SOL P/L descending
  csvData.sort((a, b) => parseFloat(b['Net SOL P/L']) - parseFloat(a['Net SOL P/L']));

  try {
    const csvString = Papa.unparse(csvData, { header: true, columns: headers });
    fs.writeFileSync(csvOutputPath, csvString, 'utf8');
    logger.info(`Successfully wrote SOL P/L analysis CSV report to ${csvOutputPath}`);
    return csvOutputPath;
  } catch (error) {
    logger.error('Error writing SOL P/L analysis CSV report', { error });
    throw new Error(`Failed to write SOL P/L analysis CSV report: ${error}`);
  }
}

/**
 * Writes a text summary report based on SOL P/L analysis.
 * @param results Array of SolPnlAnalysisResult
 * @param walletAddress The wallet address being analyzed
 * @returns Path to the saved TXT file
 */
export function writeSolPnlAnalysisToTxt(results: SolPnlAnalysisResult[], walletAddress: string): string {
  const outputDir = path.resolve('./analysis_reports');
  if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const txtFilename = `sol_pnl_summary_${walletAddress}_${timestamp}.txt`;
  const outputPath = path.join(outputDir, txtFilename);

  // Calculate Overall P/L
  const overallNetSolPL = results.reduce((sum, r) => sum + r.netSolProfitLoss, 0);

  let reportContent = `=== SOL P/L SWAP ANALYSIS SUMMARY ===\nWallet: ${walletAddress}\nUnique Tokens Swapped: ${results.length}\nTotal Net SOL P/L: ${overallNetSolPL.toFixed(6)} SOL\n=======================================\n`;

  // Sort results by Net SOL P/L descending
  const sortedResults = [...results].sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss);

  reportContent += '\n=== TOP 10 TOKENS BY SOL P/L ===\n';
  if (sortedResults.length === 0) {
    reportContent += 'No swap activity found\n';
  } else {
    sortedResults.slice(0, 10).forEach((result, index) => {
      reportContent += `${index + 1}. Token: ${result.splMint}\n`;
      reportContent += `   Net SOL P/L: ${result.netSolProfitLoss.toFixed(6)} SOL\n`;
      reportContent += `   Swaps: ${result.swapCountIn} In / ${result.swapCountOut} Out\n`;
      const firstDate = result.firstSwapTimestamp > 0 ? new Date(result.firstSwapTimestamp * 1000).toLocaleDateString() : 'N/A';
      const lastDate = result.lastSwapTimestamp > 0 ? new Date(result.lastSwapTimestamp * 1000).toLocaleDateString() : 'N/A';
      reportContent += `   Activity: ${firstDate} to ${lastDate}\n`;
    });
  }

  // Add Top Losers section
  const topLosers = sortedResults.filter(r => r.netSolProfitLoss < 0).slice(-5).reverse();
  reportContent += '\n=== TOP 5 TOKENS BY SOL LOSS ===\n';
  if (topLosers.length === 0) {
      reportContent += 'No tokens with SOL loss found.\n';
  } else {
      topLosers.forEach((result, index) => {
          reportContent += `${index + 1}. Token: ${result.splMint}\n`;
          reportContent += `   Net SOL P/L: ${result.netSolProfitLoss.toFixed(6)} SOL\n`;
          reportContent += `   Swaps: ${result.swapCountIn} In / ${result.swapCountOut} Out\n`;
      });
  }

  try {
    fs.writeFileSync(outputPath, reportContent, 'utf8');
    logger.info(`Successfully wrote SOL P/L analysis TXT summary to ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error('Error writing SOL P/L analysis TXT summary', { error });
    throw new Error(`Failed to write SOL P/L analysis TXT summary: ${error}`);
  }
} 