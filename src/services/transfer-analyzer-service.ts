import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { createLogger } from '../utils/logger';
import {
  OnChainAnalysisResult,
  SwapAnalysisSummary,
  AdvancedTradeStats,
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
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
  // Add other known tokens here if needed
};

/**
 * Gets a display-friendly name for a known token address.
 * Falls back to the address itself if not found in KNOWN_TOKENS.
 *
 * @param address The token mint address.
 * @returns The known symbol (e.g., 'WSOL') or the original address.
 */
function getTokenDisplayName(address: string): string {
    return KNOWN_TOKENS[address] || address;
}
// --- End Known Token Addresses ---

/**
 * [REFACTORED] Analyzes pre-processed SwapAnalysisInput records to calculate Profit/Loss per token.
 * Aggregates SOL spent and received for each SPL token based on the input records.
 * Handles stablecoins separately to track SOL flows in/out of stable positions.
 * Assumes input `swapInputs` have accurately calculated amounts and associated SOL/USDC values.
 *
 * @param swapInputs Array of `SwapAnalysisInput` records from the database for a specific wallet.
 * @param walletAddress The wallet address being analyzed (used for logging/verification).
 * @returns A `SwapAnalysisSummary` object containing an array of `OnChainAnalysisResult` per token,
 *          and overall summary metrics like transaction count and time range.
 */
export function analyzeSwapRecords(
  swapInputs: SwapAnalysisInput[], 
  walletAddress: string
): SwapAnalysisSummary {
    if (!swapInputs || !walletAddress) {
        logger.error("SwapAnalysisInput array and walletAddress are required for analysis.");
        return { results: [], totalSignaturesProcessed: 0, overallFirstTimestamp: 0, overallLastTimestamp: 0 };
    }

    logger.info(`Analyzing ${swapInputs.length} pre-processed swap input records for wallet ${walletAddress}...`);

    // Define known tokens that should be treated specially
    // 1. Stablecoins - these represent SOL value that has exited the ecosystem
    const stablecoins = new Map<string, { name: string, decimals: number }>([
        ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { name: 'USDC', decimals: 6 }],
        ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { name: 'USDT', decimals: 6 }],
        // Removed WSOL as it's not a stablecoin for this purpose
        // Add other stablecoins as needed
    ]);

    // 1. Aggregate by SPL Mint
    const analysisBySplMint = new Map<string, Partial<OnChainAnalysisResult> & { timestamps: number[] }>();
    const processedSignatures = new Set<string>();
    let overallFirstTimestamp = Infinity;
    let overallLastTimestamp = 0;

    // Track stablecoin metrics separately
    const stablecoinFlows = new Map<string, {
        totalSolSpent: number,    // SOL spent to buy stablecoins
        totalSolReceived: number, // SOL received from selling stablecoins
        totalAmountIn: number,    // Stablecoins received
        totalAmountOut: number,   // Stablecoins sent
        netSolFlow: number        // Net SOL flow to stablecoins (negative = SOL exited to stablecoins)
    }>();

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
        const isStablecoin = stablecoins.has(splMint);

        // Initialize stablecoin tracking if needed
        if (isStablecoin && !stablecoinFlows.has(splMint)) {
            stablecoinFlows.set(splMint, {
                totalSolSpent: 0,
                totalSolReceived: 0,
                totalAmountIn: 0,
                totalAmountOut: 0,
                netSolFlow: 0
            });
        }

        // Initialize result object if needed
        if (!analysisBySplMint.has(splMint)) {
            analysisBySplMint.set(splMint, {
                tokenAddress: splMint,
                totalAmountIn: 0, totalAmountOut: 0, totalSolSpent: 0,
                totalSolReceived: 0, transferCountIn: 0, transferCountOut: 0,
                timestamps: [], netSolProfitLoss: 0,
                // Flag stablecoins but with different purpose now
                isValuePreservation: isStablecoin,
                preservationType: isStablecoin ? 'stablecoin' : undefined
            });
        }
        const currentAnalysis = analysisBySplMint.get(splMint)!;

        // Aggregate amounts and SOL values based on direction
        currentAnalysis.timestamps!.push(timestamp);
        if (input.direction === 'in') {
            currentAnalysis.totalAmountIn! += input.amount; // Use decimal-adjusted amount from input
            currentAnalysis.transferCountIn!++;
            currentAnalysis.totalSolSpent! += input.associatedSolValue; // Use pre-calculated cost
            
            // Track SOL spent on stablecoins separately
            if (isStablecoin) {
                const flow = stablecoinFlows.get(splMint)!;
                flow.totalSolSpent += input.associatedSolValue;
                flow.totalAmountIn += input.amount;
                flow.netSolFlow -= input.associatedSolValue; // Negative because SOL is exiting to stablecoin
            }
        } else { // direction === 'out'
            currentAnalysis.totalAmountOut! += input.amount; // Use decimal-adjusted amount from input
            currentAnalysis.transferCountOut!++;
            currentAnalysis.totalSolReceived! += input.associatedSolValue; // Use pre-calculated proceeds
            
            // Track SOL received from stablecoins separately
            if (isStablecoin) {
                const flow = stablecoinFlows.get(splMint)!;
                flow.totalSolReceived += input.associatedSolValue;
                flow.totalAmountOut += input.amount;
                flow.netSolFlow += input.associatedSolValue; // Positive because SOL is returning from stablecoin
            }
        }
    } // End loop through swap inputs

    logger.info(`Aggregated data for ${analysisBySplMint.size} unique SPL tokens across ${processedSignatures.size} signatures.`);

    // 2. Calculate Final Metrics
    const finalResults: OnChainAnalysisResult[] = [];
    let totalStablecoinValue = 0;
    let totalStablecoinNetFlow = 0;
    
    for (const [splMint, aggregatedData] of analysisBySplMint.entries()) {
        aggregatedData.timestamps!.sort((a, b) => a - b);

        const netSolProfitLoss = (aggregatedData.totalSolReceived ?? 0) - (aggregatedData.totalSolSpent ?? 0);
        const netAmountChange = (aggregatedData.totalAmountIn ?? 0) - (aggregatedData.totalAmountOut ?? 0);
        
        // We're no longer using "estimatedPreservedValue" for stablecoins in the main P/L calculations
        // Instead, we track them separately and provide this info in reports
        const isStablecoin = stablecoins.has(splMint);
        let stablecoinSolValue = 0;
        
        if (isStablecoin && netAmountChange > 0) {
            // We still want to track stablecoin value for reporting, but not for overall P/L adjustment
            const averageCostBasis = aggregatedData.totalSolSpent && aggregatedData.totalAmountIn
                ? aggregatedData.totalSolSpent / aggregatedData.totalAmountIn : 0;
                
            stablecoinSolValue = netAmountChange * averageCostBasis;
            totalStablecoinValue += stablecoinSolValue;
            
            // Also track the net SOL flow to stablecoins
            const flow = stablecoinFlows.get(splMint);
            if (flow) {
                totalStablecoinNetFlow += flow.netSolFlow;
            }
            
            logger.debug(`Stablecoin ${splMint}: Net amount = ${netAmountChange.toFixed(2)}, Value = ${stablecoinSolValue.toFixed(2)} SOL, NetFlow = ${flow?.netSolFlow.toFixed(2) || 0} SOL`);
        }

        finalResults.push({
            tokenAddress: splMint,
            totalAmountIn: aggregatedData.totalAmountIn ?? 0,
            totalAmountOut: aggregatedData.totalAmountOut ?? 0,
            netAmountChange: netAmountChange,
            totalSolSpent: aggregatedData.totalSolSpent ?? 0,
            totalSolReceived: aggregatedData.totalSolReceived ?? 0,
            netSolProfitLoss: netSolProfitLoss,
            // We're no longer adjusting P/L for stablecoins, just tracking their value
            adjustedNetSolProfitLoss: netSolProfitLoss,
            estimatedPreservedValue: isStablecoin ? stablecoinSolValue : 0,
            isValuePreservation: isStablecoin,
            preservationType: isStablecoin ? 'stablecoin' : undefined,
            transferCountIn: aggregatedData.transferCountIn ?? 0,
            transferCountOut: aggregatedData.transferCountOut ?? 0,
            firstTransferTimestamp: aggregatedData.timestamps!.length > 0 ? aggregatedData.timestamps![0] : 0,
            lastTransferTimestamp: aggregatedData.timestamps!.length > 0 ? aggregatedData.timestamps![aggregatedData.timestamps!.length - 1] : 0,
        });
    }

    logger.info(`Final analysis complete. Generated ${finalResults.length} results.`);
    
    if (totalStablecoinValue > 0) {
        logger.info(`Total stablecoin value: ${totalStablecoinValue.toFixed(2)} SOL`);
        logger.info(`Net SOL flow to stablecoins: ${totalStablecoinNetFlow.toFixed(2)} SOL (negative means SOL exited to stablecoins)`);
    }

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

/**
 * @param timestamp Unix timestamp (in seconds).
 * @returns Formatted date string (YYYY-MM-DD HH:MM:SS) or 'Invalid Date'.
 */
function formatDate(timestamp: number): string {
    if (!timestamp || timestamp === Infinity) return 'N/A';
    return new Date(timestamp * 1000).toISOString().split('T')[0];
}

/**
 * @param netChange The net change in the token amount (in - out).
 * @returns A string representing the percentage remaining (e.g., "50.0%") or "N/A".
 */
function calculatePercentLeft(totalIn: number, netChange: number): string {
    if (totalIn <= 0) {
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
export async function writeAnalysisReportTxt(
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

  // Filter out stablecoins for P/L calculation
  const tradingTokens = results.filter(r => !(r as any).isValuePreservation);
  const stablecoins = results.filter(r => (r as any).isValuePreservation);
  
  // Calculate P/L based only on trading tokens, not stablecoins
  const overallNetPnl = tradingTokens.reduce((sum, r) => sum + r.netSolProfitLoss, 0);
  const overallSolSpent = tradingTokens.reduce((sum, r) => sum + r.totalSolSpent, 0);
  const overallSolReceived = tradingTokens.reduce((sum, r) => sum + r.totalSolReceived, 0);
  
  // Calculate stablecoin metrics
  const totalStablecoinValue = stablecoins.reduce((sum, r) => 
    sum + ((r as any).estimatedPreservedValue || 0), 0
  );
  
  // Calculate net SOL flow to stablecoins (positive = SOL came back from stablecoins, negative = SOL went to stablecoins)
  const stablecoinNetFlow = stablecoins.reduce((sum, r) => sum + r.netSolProfitLoss, 0);

  // Format numbers to 2 decimals for on-chain trading activity
  reportContent += `Total SOL Spent Across Trading Tokens: ${overallSolSpent.toFixed(2)}\n`;
  reportContent += `Total SOL Received Across Trading Tokens: ${overallSolReceived.toFixed(2)}\n`;
  reportContent += `Net SOL P/L From Trading: ${overallNetPnl.toFixed(2)} SOL\n`;
  
  // Add section for stablecoins, but separated from main P/L
  if (stablecoins.length > 0) {
    reportContent += `\n--- Stablecoin Activity ---\n`;
    reportContent += `Stablecoins Held: ${stablecoins.length}\n`;
    reportContent += `Current Stablecoin Holdings Value: ${totalStablecoinValue.toFixed(2)} SOL\n`;
    reportContent += `Net SOL Flow To Stablecoins: ${stablecoinNetFlow.toFixed(2)} SOL\n`;
    
    if (stablecoinNetFlow < 0) {
      reportContent += `(${Math.abs(stablecoinNetFlow).toFixed(2)} SOL has been moved from on-chain trading to stablecoins)\n`;
    } else if (stablecoinNetFlow > 0) {
      reportContent += `(${stablecoinNetFlow.toFixed(2)} SOL has been moved from stablecoins back to on-chain trading)\n`;
    }
    
    // List stablecoins
    reportContent += `\nStablecoin Holdings:\n`;
    stablecoins.forEach((token, i) => {
      const netAmount = token.netAmountChange;
      if (netAmount > 0) {
        reportContent += `${i+1}. ${getTokenDisplayName(token.tokenAddress)}: ${netAmount.toFixed(2)} tokens (≈ ${(token as any).estimatedPreservedValue?.toFixed(2) || 0} SOL)\n`;
      }
    });
  }

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
  // Results are already sorted descending by P/L from the query, but filter out stablecoins
  const topResults = tradingTokens.slice(0, 10);
  topResults.forEach((result, index) => {
    const percentLeft = calculatePercentLeft(result.totalAmountIn, result.netAmountChange);
    // Removed shortened address, added new metrics with formatting
    reportContent += `${index + 1}. ${getTokenDisplayName(result.tokenAddress)}: 
      Net SOL: ${result.netSolProfitLoss.toFixed(2)} | Invested: ${result.totalSolSpent.toFixed(2)} | Received: ${result.totalSolReceived.toFixed(2)} | Tokens Left: ${percentLeft}\n`;
  });

  // --- Bottom Tokens Section ---
  reportContent += `\n--- Bottom 5 Tokens by Net SOL P/L ---\n`;
  const bottomResults = tradingTokens.slice(-5).reverse(); // Get last 5, reverse to show biggest loss first
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
export function writeAnalysisReportTxt_fromMemory(
    results: OnChainAnalysisResult[],
    walletAddress: string,
    totalSignaturesProcessed: number, // Approximated for the period
    overallFirstTimestamp: number, // From the analyzed period
    overallLastTimestamp: number,  // From the analyzed period
    advancedStats?: AdvancedTradeStats | null
): string | null {
  logger.info(`Generating TXT summary report from memory for wallet ${walletAddress}`);

  if (!results || results.length === 0) {
    logger.warn(`No results data provided for wallet ${walletAddress}. Cannot generate TXT report.`);
    return null;
  }

  const outputDir = path.resolve('./analysis_reports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = Date.now();
  const txtFilename = `analysis_report_${walletAddress}_${timestamp}.txt`;
  const txtOutputPath = path.join(outputDir, txtFilename);

  let reportContent = `=== On-Chain SOL P/L Analysis Report ===\n\n`;
  reportContent += `Wallet Address: ${walletAddress}\n`;
  // Use formatDate helper
  reportContent += `Analysis Period: ${formatDate(overallFirstTimestamp)} to ${formatDate(overallLastTimestamp)}\n`;
  reportContent += `Signatures Processed (estimate): ${totalSignaturesProcessed || 'N/A'}\n`;
  reportContent += `Total Unique Tokens Analyzed (with SOL interaction): ${results.length}\n`;
  
  // Filter out stablecoins for P/L calculation
  const tradingTokens = results.filter(r => !r.isValuePreservation);
  const stablecoins = results.filter(r => r.isValuePreservation);
  
  // Calculate P/L based only on trading tokens, not stablecoins
  const overallNetPnl = tradingTokens.reduce((sum, r) => sum + r.netSolProfitLoss, 0);
  const overallSolSpent = tradingTokens.reduce((sum, r) => sum + r.totalSolSpent, 0);
  const overallSolReceived = tradingTokens.reduce((sum, r) => sum + r.totalSolReceived, 0);
  
  // Calculate stablecoin metrics
  const totalStablecoinValue = stablecoins.reduce((sum, r) => 
    sum + (r.estimatedPreservedValue || 0), 0
  );
  
  // Calculate net SOL flow to stablecoins 
  const stablecoinNetFlow = stablecoins.reduce((sum, r) => sum + r.netSolProfitLoss, 0);
  
  reportContent += `\n--- Overall SOL P/L ---\n`;
  
  // Format numbers to 2 decimals
  reportContent += `Total SOL Spent Across Trading Tokens: ${overallSolSpent.toFixed(2)}\n`;
  reportContent += `Total SOL Received Across Trading Tokens: ${overallSolReceived.toFixed(2)}\n`;
  reportContent += `Net SOL P/L From Trading: ${overallNetPnl.toFixed(2)} SOL\n`;
  
  // Add section for stablecoins, but separated from main P/L
  if (stablecoins.length > 0) {
    reportContent += `\n--- Stablecoin Activity ---\n`;
    reportContent += `Stablecoins Held: ${stablecoins.length}\n`;
    reportContent += `Current Stablecoin Holdings Value: ${totalStablecoinValue.toFixed(2)} SOL\n`;
    reportContent += `Net SOL Flow To Stablecoins: ${stablecoinNetFlow.toFixed(2)} SOL\n`;
    
    if (stablecoinNetFlow < 0) {
      reportContent += `(${Math.abs(stablecoinNetFlow).toFixed(2)} SOL has been moved from on-chain trading to stablecoins)\n`;
    } else if (stablecoinNetFlow > 0) {
      reportContent += `(${stablecoinNetFlow.toFixed(2)} SOL has been moved from stablecoins back to on-chain trading)\n`;
    }
    
    // List stablecoins
    reportContent += `\nStablecoin Holdings:\n`;
    stablecoins.forEach((token, i) => {
      const netAmount = token.netAmountChange;
      if (netAmount > 0) {
        reportContent += `${i+1}. ${getTokenDisplayName(token.tokenAddress)}: ${netAmount.toFixed(2)} tokens (≈ ${token.estimatedPreservedValue?.toFixed(2) || 0} SOL)\n`;
      }
    });
  }

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
  // Sort by P/L and filter out stablecoins
  const topResults = [...tradingTokens].sort((a, b) => b.netSolProfitLoss - a.netSolProfitLoss).slice(0, 10);
  topResults.forEach((result, index) => {
    const percentLeft = calculatePercentLeft(result.totalAmountIn, result.netAmountChange);
    // Removed shortened address, added new metrics with formatting
    reportContent += `${index + 1}. ${getTokenDisplayName(result.tokenAddress)}: 
      Net SOL: ${result.netSolProfitLoss.toFixed(2)} | Invested: ${result.totalSolSpent.toFixed(2)} | Received: ${result.totalSolReceived.toFixed(2)} | Tokens Left: ${percentLeft}\n`;
  });

  // --- Bottom Tokens Section ---
  reportContent += `\n--- Bottom 5 Tokens by Net SOL P/L ---\n`;
  const bottomResults = [...tradingTokens].sort((a, b) => a.netSolProfitLoss - b.netSolProfitLoss).slice(0, 5);
  bottomResults.forEach((result, index) => {
      const percentLeft = calculatePercentLeft(result.totalAmountIn, result.netAmountChange);
      // Removed shortened address, added new metrics with formatting
      reportContent += `${index + 1}. ${getTokenDisplayName(result.tokenAddress)}: 
      Net SOL: ${result.netSolProfitLoss.toFixed(2)} | Invested: ${result.totalSolSpent.toFixed(2)} | Received: ${result.totalSolReceived.toFixed(2)} | Tokens Left: ${percentLeft}\n`;
  });

  reportContent += `=========================================\n`;

  try {
    fs.writeFileSync(txtOutputPath, reportContent);
    logger.info(`[Memory] Successfully wrote analysis report TXT to: ${txtOutputPath}`); // Updated log message
    return txtOutputPath;
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
      'lastTransferTimestamp',
      'isValuePreservation',
      'preservationType'
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