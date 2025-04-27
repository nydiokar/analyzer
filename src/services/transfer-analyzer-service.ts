import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { createLogger } from '../utils/logger';
import {
  IntermediateSwapRecord,
  OnChainAnalysisResult,
  SwapAnalysisSummary,
  AdvancedTradeStats
} from '../types/helius-api';
import { AnalysisResult, AdvancedStatsResult } from '@prisma/client';
import { 
    getAnalysisRun, 
    getAnalysisResultsForRun, 
    getAdvancedStatsForRun 
} from './database-service'; // Import DB query functions

// Logger instance for this module
const logger = createLogger('TransferAnalyzerService');

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// --- Known Token Addresses ---
const KNOWN_TOKENS: Record<string, string> = {
  [SOL_MINT]: 'SOL', // Use the constant for SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  // Add other known tokens here if needed
  // 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
};

function getTokenDisplayName(address: string): string {
    return KNOWN_TOKENS[address] || address;
}
// --- End Known Token Addresses ---

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
  let splWithoutSolCount = 0;   // Counter for SPL txns without SOL movement
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
         splWithoutSolCount++;
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
  if (splWithoutSolCount > 0) {
      logger.debug(`Found ${splWithoutSolCount} signatures with SPL movement but no detected SOL movement (potential airdrops/transfers).`);
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

  logger.info(`Analysis complete for ${finalResults.length} SPL tokens initially.`);

  // --- Filter out results with zero SOL interaction ---
  const filteredResults = finalResults.filter(result => 
      result.totalSolSpent > 0 || result.totalSolReceived > 0
  );
  const filteredCount = finalResults.length - filteredResults.length;
  if (filteredCount > 0) {
      logger.info(`Filtered out ${filteredCount} tokens with zero detected SOL interaction (potential spam/transfers).`);
  }
  // --- End Filtering ---

  // Reset timestamps if no records were processed
  if (overallFirstTimestamp === Infinity) overallFirstTimestamp = 0;

  // Return the comprehensive summary object with FILTERED results
  return {
    results: filteredResults, // Use the filtered array
    totalSignaturesProcessed: processedSignaturesCount,
    overallFirstTimestamp: overallFirstTimestamp,
    overallLastTimestamp: overallLastTimestamp
  };
}

/**
 * Writes the On-Chain Analysis (including SOL P/L) results from a specific AnalysisRun to a CSV file.
 * @param runId The ID of the AnalysisRun to report on.
 * @param walletAddress The wallet address (used for filename).
 * @returns Path to the saved CSV file, or null if data is missing.
 */
// REMOVED writeOnChainAnalysisToCsv function

/**
 * Writes a summary TXT report for a specific AnalysisRun.
 * @param runId The ID of the AnalysisRun to report on.
 * @param walletAddress The wallet address (used for filename).
 * @returns Path to the saved TXT file, or null if data is missing.
 */
export async function writeAnalysisReportTxt( // Renamed from writeOnChainAnalysisToTxt
    runId: number,
    walletAddress: string
): Promise<string | null> {
  logger.info(`Generating TXT summary report for AnalysisRun ID: ${runId}`);

  // Fetch data from database
  const analysisRun = await getAnalysisRun(runId);
  const results: AnalysisResult[] = await getAnalysisResultsForRun(runId);
  const advancedStats: AdvancedStatsResult | null = await getAdvancedStatsForRun(runId);

  if (!analysisRun) {
      logger.warn(`AnalysisRun data not found for Run ID ${runId}. Cannot generate TXT report.`);
      return null;
  }
  if (!results || results.length === 0) {
      logger.warn(`No AnalysisResult data found for Run ID ${runId}. Cannot generate TXT report.`);
      return null;
  }
  // advancedStats can be null, handle that later

  const outputDir = path.resolve('./analysis_reports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  // Updated filename
  const txtFilename = `analysis_report_${walletAddress}_run${runId}_${timestamp}.txt`;
  const txtOutputPath = path.join(outputDir, txtFilename);

  let reportContent = `=== On-Chain SOL P/L Analysis Report ===\\n\\n`;
  reportContent += `Wallet Address: ${walletAddress}\n`;
  reportContent += `Analysis Run ID: ${runId}\n`;
  reportContent += `Run Timestamp: ${analysisRun.runTimestamp.toISOString()}\n`;
  // Use formatDate helper
  reportContent += `Analysis Period: ${formatDate(analysisRun.analysisStartTs ?? 0)} to ${formatDate(analysisRun.analysisEndTs ?? 0)}\n`; 
  reportContent += `Signatures Processed (estimate): ${analysisRun.signaturesProcessed || 'N/A'}\n`; 
  reportContent += `Total Unique Tokens Analyzed (with SOL interaction): ${results.length}\n`;
  reportContent += `\n--- Overall SOL P/L ---\n`;

  const overallNetPnl = results.reduce((sum, r) => sum + r.netSolProfitLoss, 0);
  const overallSolSpent = results.reduce((sum, r) => sum + r.totalSolSpent, 0);
  const overallSolReceived = results.reduce((sum, r) => sum + r.totalSolReceived, 0);

  // Format numbers to 2 decimals
  reportContent += `Total SOL Spent Across All Tokens: ${overallSolSpent.toFixed(2)}\n`;
  reportContent += `Total SOL Received Across All Tokens: ${overallSolReceived.toFixed(2)}\n`;
  reportContent += `Overall Net SOL P/L: ${overallNetPnl.toFixed(2)} SOL\n`;

  // --- Advanced Stats Section (Moved Up) ---
  reportContent += `\n--- Advanced Trading Statistics ---\n`;
  if (advancedStats) {
    // Iterate over the keys of the advancedStats object (excluding id and runId)
    Object.entries(advancedStats).forEach(([key, value]) => {
      if (key !== 'id' && key !== 'runId' && value !== null) {
        // Simple formatting: Convert camelCase to Title Case
        const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
        // Format numbers to 2 decimals, keep others as string
        const formattedValue = typeof value === 'number' ? value.toFixed(2) : String(value);
        reportContent += `${formattedKey}: ${formattedValue}\n`;
      }
    });
  } else {
    reportContent += `(Not calculated or available for this run)\n`;
  }

  // --- Top Tokens Section ---
  reportContent += `\n--- Top 10 Tokens by Net SOL P/L ---\n`;
  // Results are already sorted descending by P/L from the query
  const topResults = results.slice(0, 10);
  topResults.forEach((result, index) => {
    const percentLeft = calculatePercentLeft(result.totalAmountIn, result.netAmountChange);
    // Removed shortened address, added new metrics with formatting
    reportContent += `${index + 1}. ${getTokenDisplayName(result.tokenAddress)}: 
      Net SOL: ${result.netSolProfitLoss.toFixed(2)} | Invested: ${result.totalSolSpent.toFixed(2)} | Received: ${result.totalSolReceived.toFixed(2)} | Tokens Left: ${percentLeft}\n`;
  });

  // --- Bottom Tokens Section ---
  reportContent += `\n--- Bottom 5 Tokens by Net SOL P/L ---\n`;
  const bottomResults = results.slice(-5).reverse(); // Get last 5, reverse to show biggest loss first
  bottomResults.forEach((result, index) => {
      const percentLeft = calculatePercentLeft(result.totalAmountIn, result.netAmountChange);
      // Removed shortened address, added new metrics with formatting
      reportContent += `${index + 1}. ${getTokenDisplayName(result.tokenAddress)}: 
      Net SOL: ${result.netSolProfitLoss.toFixed(2)} | Invested: ${result.totalSolSpent.toFixed(2)} | Received: ${result.totalSolReceived.toFixed(2)} | Tokens Left: ${percentLeft}\n`;
  });

  reportContent += `=========================================\\n`;

  try {
    fs.writeFileSync(txtOutputPath, reportContent);
    logger.info(`Successfully wrote Analysis Report TXT to: ${txtOutputPath}`); // Updated log message
    return txtOutputPath;
  } catch (error) {
    logger.error(`Error writing Analysis Report TXT:`, { error });
    return null;
  }
}

// Helper function for date formatting
function formatDate(timestamp: number): string {
    if (!timestamp || timestamp <= 0) return 'N/A';
    // Get YYYY-MM-DD part of ISO string
    return new Date(timestamp * 1000).toISOString().split('T')[0]; 
}

// Helper function to calculate % left
function calculatePercentLeft(totalIn: number, netChange: number): string {
    if (totalIn <= 0) {
        // If nothing came in, but something went out (netChange < 0), they have 0% left.
        // If nothing came in and nothing went out, it's N/A.
        return netChange < 0 ? '0.00%' : 'N/A';
    }
    // If totalIn > 0, calculate percentage based on net change relative to total received
    const percent = (netChange / totalIn) * 100;
    // Clamp the value between 0 and 100 (or more if somehow netChange > totalIn?)
    const clampedPercent = Math.max(0, percent);
    return `${clampedPercent.toFixed(2)}%`;
}

// --- ADD BACK Original (Memory-Based) Reporting Functions for Historical Analysis ---

/**
 * [MEMORY-BASED] Writes On-Chain Analysis results directly from memory to CSV.
 * Used for historical analysis view where no new Run ID is created.
 */
// REMOVED writeOnChainAnalysisToCsv_fromMemory function

/**
 * [MEMORY-BASED] Writes a text summary report directly from memory.
 * Used for historical analysis view.
 */
export function writeAnalysisReportTxt_fromMemory( // Renamed from writeOnChainAnalysisToTxt_fromMemory
    results: OnChainAnalysisResult[],
    walletAddress: string,
    totalSignaturesProcessed: number, // Approximated for the period
    overallFirstTimestamp: number, // From the analyzed period
    overallLastTimestamp: number,  // From the analyzed period
    advancedStats?: AdvancedTradeStats | null
): string | null {
  // logger.info(`[Memory] Generating analysis report TXT...`); // <<< REMOVED internal log
  if (!results || results.length === 0) {
      logger.warn(`[Memory] No results provided. Cannot generate TXT report.`);
      return null;
  }

  const outputDir = path.resolve('./analysis_reports');
  if (!fs.existsSync(outputDir)){
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  // Updated filename
  const txtFilename = `analysis_report_${walletAddress}_${timestamp}.txt`; // Historical doesn't have runId
  const outputPath = path.join(outputDir, txtFilename);

  const overallNetSolPL = results.reduce((sum, r) => sum + r.netSolProfitLoss, 0);
  const overallSolSpent = results.reduce((sum, r) => sum + r.totalSolSpent, 0);
  const overallSolReceived = results.reduce((sum, r) => sum + r.totalSolReceived, 0);

  const firstDateStr = overallFirstTimestamp > 0 ? new Date(overallFirstTimestamp * 1000).toISOString() : 'N/A';
  const lastDateStr = overallLastTimestamp > 0 ? new Date(overallLastTimestamp * 1000).toISOString() : 'N/A';

  let reportContent = `=== On-Chain SOL P/L Analysis Report (Time-Ranged) ===\\n`; // Title adjusted
  reportContent += `Wallet: ${walletAddress}\n`;
  reportContent += `Signatures Analyzed: ${totalSignaturesProcessed}\n`;
  // Use formatDate helper
  reportContent += `Time Frame Analyzed: ${formatDate(overallFirstTimestamp)} to ${formatDate(overallLastTimestamp)}\n`; 
  reportContent += `Unique SPL Tokens: ${results.length}\n`;

  reportContent += `\n--- Overall SOL P/L (Period) ---\n`;
  // Format numbers to 2 decimals
  reportContent += `SOL Spent: ${overallSolSpent.toFixed(2)} SOL\n`;
  reportContent += `SOL Received: ${overallSolReceived.toFixed(2)} SOL\n`;
  reportContent += `Net SOL P/L: ${overallNetSolPL.toFixed(2)} SOL\n`;

  // --- Advanced Stats Section (Moved Up) ---
  reportContent += `\n--- Advanced Trading Statistics (Period) ---\n`;
  if (advancedStats) {
    Object.entries(advancedStats).forEach(([key, value]) => {
        if (key !== 'id' && key !== 'runId' && value !== null) {
            const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());
            // Format numbers to 2 decimals
            const formattedValue = typeof value === 'number' ? value.toFixed(2) : String(value);
            reportContent += `${formattedKey}: ${formattedValue}\n`;
        }
    });
  } else {
    reportContent += `(Not calculated or available)\n`;
  }

  // Sort results for Top/Bottom display (results from memory aren't pre-sorted)
  const sortedResults = [...results].sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss);

  // --- Top Tokens Section ---
  reportContent += '\n--- TOP 10 TOKENS BY SOL P/L (Period) ---\n';
  sortedResults.slice(0, 10).forEach((result, index) => {
      const percentLeft = calculatePercentLeft(result.totalAmountIn, result.netAmountChange);
      // Removed shortened address, added new metrics with formatting
      reportContent += `${index + 1}. ${getTokenDisplayName(result.tokenAddress)}: 
      Net SOL: ${result.netSolProfitLoss.toFixed(2)} | Invested: ${result.totalSolSpent.toFixed(2)} | Received: ${result.totalSolReceived.toFixed(2)} | Tokens Left: ${percentLeft}\n`;
  });

  // --- Bottom Tokens Section ---
  reportContent += '\n--- BOTTOM 5 TOKENS BY SOL P/L (Period) ---\n';
  const bottomResults = sortedResults.slice(-5).reverse();
  bottomResults.forEach((result, index) => {
      const percentLeft = calculatePercentLeft(result.totalAmountIn, result.netAmountChange);
      // Removed shortened address, added new metrics with formatting
      reportContent += `${index + 1}. ${getTokenDisplayName(result.tokenAddress)}: 
      Net SOL: ${result.netSolProfitLoss.toFixed(2)} | Invested: ${result.totalSolSpent.toFixed(2)} | Received: ${result.totalSolReceived.toFixed(2)} | Tokens Left: ${percentLeft}\n`;
  });

  reportContent += `=========================================\\n`;

  try {
    fs.writeFileSync(outputPath, reportContent);
    logger.info(`[Memory] Successfully wrote analysis report TXT to: ${outputPath}`); // Updated log message
    return outputPath;
  } catch (error) {
    logger.error(`[Memory] Error writing analysis report TXT:`, { error });
    return null;
  }
}

/**
 * Saves the aggregated On-Chain Analysis results (per-token P/L) to a CSV file.
 * @param results Array of OnChainAnalysisResult
 * @param walletAddress The wallet address (used for filename).
 * @param runId The ID of the AnalysisRun (optional, used for filename).
 * @returns Path to the saved CSV file, or null if data is missing.
 */
export function saveAnalysisResultsToCsv(
    results: OnChainAnalysisResult[], 
    walletAddress: string, 
    runId?: number
): string | null {
  if (!results || results.length === 0) {
    logger.warn(`No results provided. Cannot save analysis results to CSV.`);
    return null;
  }

  const outputDir = path.resolve('./analysis_reports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = `analysis_results_${walletAddress}_${runId ? `run${runId}_` : ''}${timestamp}.csv`;
  const outputPath = path.join(outputDir, filename);

  const csvData = Papa.unparse(results, {
    header: true,
    columns: [
      'tokenAddress',
      'totalAmountIn',
      'totalAmountOut',
      'netAmountChange',
      'totalSolSpent',
      'totalSolReceived',
      'netSolProfitLoss',
      'transferCountIn',
      'transferCountOut',
      'firstTransferTimestamp',
      'lastTransferTimestamp'
    ]
  });

  try {
    fs.writeFileSync(outputPath, csvData);
    logger.info(`Successfully saved analysis results to CSV: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error(`Error saving analysis results to CSV:`, { error });
    return null;
  }
} 