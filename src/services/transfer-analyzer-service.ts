import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { createLogger } from '../utils/logger';
import {
  IntermediateSwapRecord,
  OnChainAnalysisResult,
  SwapAnalysisSummary,
  AdvancedTradeStats,
  HeliusTransaction,
  TokenTransfer,
  AccountData,
  TokenBalanceChange
} from '../types/helius-api';
import { AnalysisResult, AdvancedStatsResult, SwapAnalysisInput } from '@prisma/client';
import {
    getAnalysisRun,
    getAnalysisResultsForRun,
    getAdvancedStatsForRun
} from './database-service';

// Logger instance for this module
const logger = createLogger('TransferAnalyzerService');

// const SOL_MINT = 'So11111111111111111111111111111111111111112'; // No longer needed directly here

// --- Known Token Addresses ---
const KNOWN_TOKENS: Record<string, string> = {
  'So11111111111111111111111111111111111111112': 'WSOL',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  // Add other known tokens here if needed
  // 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
};

function getTokenDisplayName(address: string): string {
    return KNOWN_TOKENS[address] || address;
}
// --- End Known Token Addresses ---

/**
 * [REFACTORED] Analyzes pre-processed SwapAnalysisInput records to produce OnChainAnalysisResult.
 * This version assumes the input records have already accurately calculated the
 * decimal-adjusted SPL amount and the associated SOL value for each user swap leg.
 *
 * @param swapInputs Array of SwapAnalysisInput records from the database.
 * @param walletAddress The specific wallet address being analyzed (used for logging/verification).
 * @returns SwapAnalysisSummary object containing results and summary info.
 */
export function analyzeSwapRecords(
  swapInputs: SwapAnalysisInput[], // Use the actual DB model type
  walletAddress: string
): SwapAnalysisSummary {
    if (!swapInputs || !walletAddress) {
        logger.error("SwapAnalysisInput array and walletAddress are required for analysis.");
        return { results: [], totalSignaturesProcessed: 0, overallFirstTimestamp: 0, overallLastTimestamp: 0 };
    }

    logger.info(`Analyzing ${swapInputs.length} pre-processed swap input records for wallet ${walletAddress}...`);

    // 1. Aggregate by SPL Mint
    const analysisBySplMint = new Map<string, Partial<OnChainAnalysisResult> & { timestamps: number[] }>();
    const processedSignatures = new Set<string>();
    let overallFirstTimestamp = Infinity;
    let overallLastTimestamp = 0;

    for (const input of swapInputs) {
        // Verification (optional): Check if record belongs to the correct wallet
        if (input.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
            logger.warn(`Skipping input record for signature ${input.signature} belonging to unexpected wallet ${input.walletAddress}`);
            continue;
        }

        processedSignatures.add(input.signature);
        const timestamp = input.timestamp;
        if (timestamp < overallFirstTimestamp) overallFirstTimestamp = timestamp;
        if (timestamp > overallLastTimestamp) overallLastTimestamp = timestamp;

        const splMint = input.mint; // Field name from latest schema

        // Initialize result object if needed
        if (!analysisBySplMint.has(splMint)) {
            analysisBySplMint.set(splMint, {
                tokenAddress: splMint,
                totalAmountIn: 0, totalAmountOut: 0, totalSolSpent: 0,
                totalSolReceived: 0, transferCountIn: 0, transferCountOut: 0,
                timestamps: [], netSolProfitLoss: 0,
            });
        }
        const currentAnalysis = analysisBySplMint.get(splMint)!;

        // Aggregate amounts and SOL values based on direction
        currentAnalysis.timestamps!.push(timestamp);
        if (input.direction === 'in') {
            currentAnalysis.totalAmountIn! += input.amount; // Use decimal-adjusted amount from input
            currentAnalysis.transferCountIn!++;
            currentAnalysis.totalSolSpent! += input.associatedSolValue; // Use pre-calculated cost
        } else { // direction === 'out'
            currentAnalysis.totalAmountOut! += input.amount; // Use decimal-adjusted amount from input
            currentAnalysis.transferCountOut!++;
            currentAnalysis.totalSolReceived! += input.associatedSolValue; // Use pre-calculated proceeds
        }
    } // End loop through swap inputs

    logger.info(`Aggregated data for ${analysisBySplMint.size} unique SPL tokens across ${processedSignatures.size} signatures.`);

    // 2. Calculate Final Metrics
    const finalResults: OnChainAnalysisResult[] = [];
    for (const [splMint, aggregatedData] of analysisBySplMint.entries()) {

        aggregatedData.timestamps!.sort((a, b) => a - b);

        const netSolProfitLoss = (aggregatedData.totalSolReceived ?? 0) - (aggregatedData.totalSolSpent ?? 0);
        const netAmountChange = (aggregatedData.totalAmountIn ?? 0) - (aggregatedData.totalAmountOut ?? 0);

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
            firstTransferTimestamp: aggregatedData.timestamps!.length > 0 ? aggregatedData.timestamps![0] : 0,
            lastTransferTimestamp: aggregatedData.timestamps!.length > 0 ? aggregatedData.timestamps![aggregatedData.timestamps!.length - 1] : 0,
        });
    }

    logger.info(`Final analysis complete. Generated ${finalResults.length} results.`);

    if (overallFirstTimestamp === Infinity) overallFirstTimestamp = 0;

    const summary: SwapAnalysisSummary = {
        results: finalResults, // Use finalResults directly
        totalSignaturesProcessed: processedSignatures.size, 
        overallFirstTimestamp: overallFirstTimestamp,
        overallLastTimestamp: overallLastTimestamp
    };

    logger.info(`Analysis summary created. Final token results count: ${summary.results.length}.`);
    return summary;
}

// --- Reporting / Helper Functions --- (Remain Largely Unchanged)

// Helper function for date formatting
function formatDate(timestamp: number): string {
    if (!timestamp || timestamp <= 0) return 'N/A';
    return new Date(timestamp * 1000).toISOString().split('T')[0];
}

// Helper function to calculate % left
function calculatePercentLeft(totalIn: number, netChange: number): string {
    if (totalIn <= 1e-9) { // Use threshold for float comparison
        return netChange < -1e-9 ? '0.00%' : 'N/A';
    }
    const percent = (netChange / totalIn) * 100;
    const clampedPercent = Math.max(0, percent); // Clamp at 0% minimum
    return `${clampedPercent.toFixed(2)}%`;
}

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

  let reportContent = `=== On-Chain SOL P/L Analysis Report ===\n\n`;
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

  reportContent += `=========================================\n`;

  try {
    fs.writeFileSync(txtOutputPath, reportContent);
    logger.info(`Successfully wrote Analysis Report TXT to: ${txtOutputPath}`); // Updated log message
    return txtOutputPath;
  } catch (error) {
    logger.error(`Error writing Analysis Report TXT:`, { error });
    return null;
  }
}

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

  let reportContent = `=== On-Chain SOL P/L Analysis Report (Time-Ranged) ===\n`; // Title adjusted
  reportContent += `Wallet: ${walletAddress}\n`;
  reportContent += `Signatures Analyzed: ${totalSignaturesProcessed}\n`;
  // Use formatDate helper
  reportContent += `Time Frame Analyzed: ${formatDate(overallFirstTimestamp)} to ${formatDate(overallLastTimestamp)}\n`;
  reportContent += `Unique SPL Tokens: ${results.length}\n`;

  reportContent += `\n--- Overall SOL P/L (Period) ---\n`;
  // Format numbers to 2 decimals
  reportContent += `SOL Spent: ${overallSolSpent.toFixed(2)} SOL\n`;
  reportContent += `SOL Received: ${overallSolReceived.toFixed(2)} SOL\n`;
  reportContent += `Overall Net SOL P/L: ${overallNetSolPL.toFixed(2)} SOL\n`;

  // --- Advanced Stats Section ---
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
    reportContent += `(Not calculated or available for this period)\n`;
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

  reportContent += `=========================================\n`;

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