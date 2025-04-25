import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { createLogger } from '../utils/logger';
import {
  IntermediateSwapRecord,
  OnChainAnalysisResult,
  SwapAnalysisSummary
} from '../types/helius-api';

// Logger instance for this module
const logger = createLogger('TransferAnalyzerService');

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Analyzes intermediate swap records (containing both SPL and SOL entries per sig)
 * to produce OnChainAnalysisResult including SOL P/L and summary statistics.
 * Assumes amounts in IntermediateSwapRecord are already adjusted for decimals (both SPL and SOL).
 * @param records Array of IntermediateSwapRecord
 * @returns SwapAnalysisSummary object containing results and summary info
 */
export function analyzeSwapRecords(
  records: IntermediateSwapRecord[]
): SwapAnalysisSummary {
  logger.debug(`Analyzing ${records.length} intermediate swap records for On-Chain Metrics + SOL P/L...`);

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
  let multiSolMovementCount = 0; // Counter for multiple SOL movements with SPL
  let multiSplTokenCount = 0;    // Counter for multiple SPL tokens with SOL
  let overallFirstTimestamp = Infinity; // Initialize overall timestamps
  let overallLastTimestamp = 0;

  for (const [signature, swapRecords] of recordsBySignature.entries()) {
    processedSignaturesCount++;
    const solRecords = swapRecords.filter(r => r.mint === SOL_MINT);
    const splRecords = swapRecords.filter(r => r.mint !== SOL_MINT);

    // If there are no SPL records for this signature, skip further processing for this sig
    if (splRecords.length === 0) {
        logger.debug(`Sig ${signature}: No SPL records found. Skipping analysis.`);
        continue;
    }

    // Track overall timestamps from relevant records
    swapRecords.forEach(record => {
        if (record.timestamp < overallFirstTimestamp) {
            overallFirstTimestamp = record.timestamp;
        }
        if (record.timestamp > overallLastTimestamp) {
            overallLastTimestamp = record.timestamp;
        }
    });

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
          multiSplTokenCount++;
      } else if (splRecords.length > 0 && solRecords.length > 1){
         multiSolMovementCount++;
      } else if (splRecords.length > 0 && solRecords.length === 0){
         logger.debug(`Sig ${signature}: SPL movement found but no SOL movement in this transaction record.`);
      }
  }
  logger.info(`Processed ${processedSignaturesCount} signatures containing SPL transfers across ${analysisBySplMint.size} unique SPL tokens.`);
  // Log aggregated counts after the loop
  if (multiSplTokenCount > 0) {
    logger.info(`Found ${multiSplTokenCount} signatures with multiple SPL tokens sharing SOL movements (SOL attribution might be approximate).`);
  }
  if (multiSolMovementCount > 0) {
    logger.info(`Found ${multiSolMovementCount} signatures with multiple SOL movements attributed to SPL tokens.`);
  }

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

  // Reset timestamps if no records were processed
  if (overallFirstTimestamp === Infinity) overallFirstTimestamp = 0;

  // Return the comprehensive summary object
  return {
    results: finalResults,
    totalSignaturesProcessed: processedSignaturesCount,
    overallFirstTimestamp: overallFirstTimestamp,
    overallLastTimestamp: overallLastTimestamp
  };
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
 * Includes overall signature count and time frame.
 * Assumes amounts in results are already adjusted for decimals.
 * @param results Array of OnChainAnalysisResult
 * @param walletAddress The wallet address being analyzed
 * @param totalSignaturesProcessed Total number of signatures processed
 * @param overallFirstTimestamp Earliest timestamp from processed records
 * @param overallLastTimestamp Latest timestamp from processed records
 * @returns Path to the saved TXT file
 */
export function writeOnChainAnalysisToTxt(
    results: OnChainAnalysisResult[],
    walletAddress: string,
    totalSignaturesProcessed: number,
    overallFirstTimestamp: number,
    overallLastTimestamp: number
): string {
  const outputDir = path.resolve('./analysis_reports');
  if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const txtFilename = `onchain_sol_pnl_summary_${walletAddress}_${timestamp}.txt`;
  const outputPath = path.join(outputDir, txtFilename);

  // Calculate Overall P/L and Volume
  const overallNetSolPL = results.reduce((sum, r) => sum + r.netSolProfitLoss, 0);
  const overallSolSpent = results.reduce((sum, r) => sum + r.totalSolSpent, 0);     // Added calculation
  const overallSolReceived = results.reduce((sum, r) => sum + r.totalSolReceived, 0); // Added calculation

  // Format overall time frame
  const firstDateStr = overallFirstTimestamp > 0 ? new Date(overallFirstTimestamp * 1000).toISOString() : 'N/A';
  const lastDateStr = overallLastTimestamp > 0 ? new Date(overallLastTimestamp * 1000).toISOString() : 'N/A';

  let reportContent = `=== ON-CHAIN SWAP & SOL P/L SUMMARY ===\n`;
  reportContent += `Wallet: ${walletAddress}\n`;
  reportContent += `Signatures Analyzed: ${totalSignaturesProcessed}\n`;
  reportContent += `Time Frame (UTC): ${firstDateStr} to ${lastDateStr}\n`;
  reportContent += `Unique SPL Tokens Swapped: ${results.length}\n`;
  reportContent += `Total SOL Spent: ${overallSolSpent.toFixed(6)} SOL\n`;       // Added line
  reportContent += `Total SOL Received: ${overallSolReceived.toFixed(6)} SOL\n`; // Added line
  reportContent += `Total Net SOL P/L: ${overallNetSolPL.toFixed(6)} SOL\n`;
  reportContent += `=========================================\n`;

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