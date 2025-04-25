import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { createLogger } from '../utils/logger';
import {
  IntermediateSwapRecord,
  OnChainAnalysisResult
} from '../types/helius-api';

// Logger instance for this module
const logger = createLogger('TransferAnalyzerService');

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Analyzes intermediate swap records (containing both SPL and SOL entries per sig)
 * to produce OnChainAnalysisResult including SOL P/L.
 * Assumes amounts in IntermediateSwapRecord are already adjusted for decimals (both SPL and SOL).
 * @param records Array of IntermediateSwapRecord
 * @returns Array of OnChainAnalysisResult
 */
export function analyzeSwapRecords(
  records: IntermediateSwapRecord[]
): OnChainAnalysisResult[] {
  logger.info(`Analyzing ${records.length} intermediate swap records for On-Chain Metrics + SOL P/L...`);

  // 1. Group by Signature
  const recordsBySignature = new Map<string, IntermediateSwapRecord[]>();
  for (const record of records) {
    if (!recordsBySignature.has(record.signature)) {
      recordsBySignature.set(record.signature, []);
    }
    recordsBySignature.get(record.signature)!.push(record);
  }

  // 2. Aggregate results by SPL Mint, processing all records per signature
  const analysisBySplMint = new Map<string, Partial<OnChainAnalysisResult> & { timestamps: number[] }>();

  let processedSignaturesCount = 0;
  for (const [signature, swapRecords] of recordsBySignature.entries()) {
    processedSignaturesCount++;
    const solRecords = swapRecords.filter(r => r.mint === SOL_MINT);
    const splRecords = swapRecords.filter(r => r.mint !== SOL_MINT);

    // If there are no SPL records for this signature, skip further processing for this sig
    if (splRecords.length === 0) {
        logger.debug(`Sig ${signature}: No SPL records found. Skipping analysis.`);
        continue; 
    }

    // Calculate total SOL movement for this specific signature
    let signatureSolSpent = 0;
    let signatureSolReceived = 0;
    for (const solRecord of solRecords) {
      if (solRecord.direction === 'in') { // SOL received by wallet
        signatureSolReceived += solRecord.amount;
      } else { // SOL sent by wallet (spent)
        signatureSolSpent += solRecord.amount;
      }
    }

    // Process each SPL record in the signature
    let isFirstSplInSig = true; // Track first SPL to attribute SOL to
    for (const splRecord of splRecords) {
      const splMint = splRecord.mint;

      // Initialize result object for this token if it doesn't exist
      if (!analysisBySplMint.has(splMint)) {
        analysisBySplMint.set(splMint, {
          tokenAddress: splMint,
          totalAmountIn: 0,
          totalAmountOut: 0,
          totalSolSpent: 0,
          totalSolReceived: 0,
          transferCountIn: 0,
          transferCountOut: 0,
          timestamps: [],
        });
      }
      const currentAnalysis = analysisBySplMint.get(splMint)!;
      currentAnalysis.timestamps.push(splRecord.timestamp); // Collect timestamp

      // Accumulate SPL metrics
      if (splRecord.direction === 'in') { // Wallet received SPL
        currentAnalysis.totalAmountIn! += splRecord.amount;
        currentAnalysis.transferCountIn!++;
      } else { // Wallet sent SPL (splRecord.direction === 'out')
        currentAnalysis.totalAmountOut! += splRecord.amount;
        currentAnalysis.transferCountOut!++;
      }

      // SOL Attribution: Attribute the signature's total SOL movement
      // to the analysis record of the SPL token(s).
      // Simple approach: Add SOL to *each* SPL token found in the signature.
      // Note: This might overstate SOL P/L if multiple valuable SPLs are swapped for SOL in one TX.
      // A more advanced approach might prorate based on value, but this ensures data isn't lost.
      currentAnalysis.totalSolSpent! += signatureSolSpent;
      currentAnalysis.totalSolReceived! += signatureSolReceived;

      // // Alternative Simple approach: Attribute SOL only to the first SPL token found
      // if (isFirstSplInSig) {
      //    currentAnalysis.totalSolSpent! += signatureSolSpent;
      //    currentAnalysis.totalSolReceived! += signatureSolReceived;
      //    isFirstSplInSig = false;
      // }
    }
     if (splRecords.length > 1 && solRecords.length > 0) {
          logger.warn(`Sig ${signature}: Multiple SPL tokens (${splRecords.length}) found with SOL movement. Attributed total sig SOL (${signatureSolSpent} spent / ${signatureSolReceived} received) to each SPL analysis. P/L might be approximate.`);
      } else if (splRecords.length > 0 && solRecords.length > 1){
         logger.warn(`Sig ${signature}: Multiple SOL movements (${solRecords.length}) found with SPL movement (${splRecords.length} tokens). Attributed total sig SOL (${signatureSolSpent} spent / ${signatureSolReceived} received) to relevant SPL analysis.`);
      } else if (splRecords.length > 0 && solRecords.length === 0){
         logger.debug(`Sig ${signature}: SPL movement found but no SOL movement in this transaction record.`);
      }
  }
  logger.info(`Processed ${processedSignaturesCount} signatures containing SPL transfers across ${analysisBySplMint.size} unique SPL tokens.`);

  // 3. Calculate Final Metrics and create final result array
  const finalResults: OnChainAnalysisResult[] = [];
  for (const [splMint, aggregatedData] of analysisBySplMint.entries()) {
      aggregatedData.timestamps.sort((a, b) => a - b);

      const netAmountChange = (aggregatedData.totalAmountIn ?? 0) - (aggregatedData.totalAmountOut ?? 0);
      const netSolProfitLoss = (aggregatedData.totalSolReceived ?? 0) - (aggregatedData.totalSolSpent ?? 0);

      finalResults.push({
          tokenAddress: splMint,
          totalAmountIn: aggregatedData.totalAmountIn ?? 0,
          totalAmountOut: aggregatedData.totalAmountOut ?? 0,
          netAmountChange: netAmountChange,
          totalSolSpent: aggregatedData.totalSolSpent ?? 0,
          totalSolReceived: aggregatedData.totalSolReceived ?? 0,
          netSolProfitLoss: netSolProfitLoss,
          transferCountIn: aggregatedData.transferCountIn ?? 0,
          transferCountOut: aggregatedData.transferCountOut ?? 0,
          firstTransferTimestamp: aggregatedData.timestamps.length > 0 ? aggregatedData.timestamps[0] : 0,
          lastTransferTimestamp: aggregatedData.timestamps.length > 0 ? aggregatedData.timestamps[aggregatedData.timestamps.length - 1] : 0,
      });
  }

  logger.info(`Analysis complete for ${finalResults.length} SPL tokens.`);
  return finalResults;
}

/**
 * Writes the On-Chain Analysis (including SOL P/L) results to a CSV file.
 * Assumes amounts in results are already adjusted for decimals.
 * @param results Array of OnChainAnalysisResult
 * @param walletAddress The wallet address being analyzed
 * @returns Path to the saved CSV file
 */
export function writeOnChainAnalysisToCsv(results: OnChainAnalysisResult[], walletAddress: string): string {
  const outputDir = path.resolve('./analysis_reports');
  if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const csvFilename = `onchain_sol_pnl_report_${walletAddress}_${timestamp}.csv`;
  const csvOutputPath = path.join(outputDir, csvFilename);

  const headers = [
      'Token Address',
      'Total SPL In',
      'Total SPL Out',
      'Net SPL Change',
      'Total SOL Spent',
      'Total SOL Received',
      'Net SOL P/L',
      'Swaps In Count',
      'Swaps Out Count',
      'First Swap (UTC)',
      'Last Swap (UTC)'
  ];

  // Format data for CSV - Use appropriate precision
  const csvData = results.map(result => ({
    'Token Address': result.tokenAddress,
    'Total SPL In': result.totalAmountIn.toFixed(6),
    'Total SPL Out': result.totalAmountOut.toFixed(6),
    'Net SPL Change': result.netAmountChange.toFixed(6),
    'Total SOL Spent': result.totalSolSpent.toFixed(9),
    'Total SOL Received': result.totalSolReceived.toFixed(9),
    'Net SOL P/L': result.netSolProfitLoss.toFixed(9),
    'Swaps In Count': result.transferCountIn,
    'Swaps Out Count': result.transferCountOut,
    'First Swap (UTC)': result.firstTransferTimestamp > 0 ? new Date(result.firstTransferTimestamp * 1000).toISOString() : 'N/A',
    'Last Swap (UTC)': result.lastTransferTimestamp > 0 ? new Date(result.lastTransferTimestamp * 1000).toISOString() : 'N/A'
  }));

  // Sort CSV data - by Net SOL P/L descending
  csvData.sort((a, b) => parseFloat(b['Net SOL P/L']) - parseFloat(a['Net SOL P/L']));

  try {
    const csvString = Papa.unparse(csvData, { header: true, columns: headers });
    fs.writeFileSync(csvOutputPath, csvString, 'utf8');
    logger.info(`Successfully wrote On-Chain+SOL P/L analysis CSV report to ${csvOutputPath}`);
    return csvOutputPath;
  } catch (error) {
    logger.error('Error writing On-Chain+SOL P/L analysis CSV report', { error });
    throw new Error(`Failed to write On-Chain+SOL P/L analysis CSV report: ${error}`);
  }
}

/**
 * Writes a text summary report based on On-Chain Analysis + SOL P/L.
 * Assumes amounts in results are already adjusted for decimals.
 * @param results Array of OnChainAnalysisResult
 * @param walletAddress The wallet address being analyzed
 * @returns Path to the saved TXT file
 */
export function writeOnChainAnalysisToTxt(results: OnChainAnalysisResult[], walletAddress: string): string {
  const outputDir = path.resolve('./analysis_reports');
  if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const txtFilename = `onchain_sol_pnl_summary_${walletAddress}_${timestamp}.txt`;
  const outputPath = path.join(outputDir, txtFilename);

  // Calculate Overall P/L
  const overallNetSolPL = results.reduce((sum, r) => sum + r.netSolProfitLoss, 0);

  let reportContent = `=== ON-CHAIN SWAP & SOL P/L SUMMARY ===\nWallet: ${walletAddress}\nUnique SPL Tokens Swapped: ${results.length}\nTotal Net SOL P/L: ${overallNetSolPL.toFixed(6)} SOL\n=========================================\n`; // Updated Title

  // Sort results by Net SOL P/L descending
  const sortedResults = [...results].sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss);

  reportContent += '\n=== TOP 10 TOKENS BY SOL P/L ===\n';
  if (sortedResults.length === 0) {
    reportContent += 'No swap activity found\n';
  } else {
    sortedResults.slice(0, 10).forEach((result, index) => {
      reportContent += `${index + 1}. Token: ${result.tokenAddress}\n`;
      reportContent += `   Net SOL P/L: ${result.netSolProfitLoss.toFixed(6)} SOL\n`;
      reportContent += `   Swaps: ${result.transferCountIn} In / ${result.transferCountOut} Out\n`;
      const firstDate = result.firstTransferTimestamp > 0 ? new Date(result.firstTransferTimestamp * 1000).toLocaleDateString() : 'N/A';
      const lastDate = result.lastTransferTimestamp > 0 ? new Date(result.lastTransferTimestamp * 1000).toLocaleDateString() : 'N/A';
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
          reportContent += `${index + 1}. Token: ${result.tokenAddress}\n`;
          reportContent += `   Net SOL P/L: ${result.netSolProfitLoss.toFixed(6)} SOL\n`;
          reportContent += `   Swaps: ${result.transferCountIn} In / ${result.transferCountOut} Out\n`;
      });
  }

  try {
    fs.writeFileSync(outputPath, reportContent, 'utf8');
    logger.info(`Successfully wrote On-Chain+SOL P/L analysis TXT summary to ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error('Error writing On-Chain+SOL P/L analysis TXT summary', { error });
    throw new Error(`Failed to write On-Chain+SOL P/L analysis TXT summary: ${error}`);
  }
} 