import { createLogger } from 'core/utils/logger';
import { OnChainAnalysisResult } from '@/types/helius-api';
import { SwapAnalysisInput } from '@prisma/client';

// Logger instance for this module
const logger = createLogger('SwapAnalyzer');

// Constants can be moved here or to a central config
const stablecoins = new Map<string, { name: string, decimals: number }>([
    ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { name: 'USDC', decimals: 6 }],
    ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { name: 'USDT', decimals: 6 }],
]);
const SOL_MINT = 'So11111111111111111111111111111111111111112';


export class SwapAnalyzer {

  constructor() {
    // Configuration could be passed here if needed in the future (e.g., custom stablecoins)
    logger.debug('SwapAnalyzer instantiated.');
  }

  /**
   * Analyzes pre-processed SwapAnalysisInput records to calculate Profit/Loss per token.
   * Aggregates SOL spent and received for each SPL token based on the input records.
   * Handles stablecoins separately to track SOL flows in/out of stable positions.
   * Assumes input `swapInputs` have accurately calculated amounts and associated SOL/USDC values.
   *
   * @param swapInputs Array of `SwapAnalysisInput` records for a specific wallet.
   * @param walletAddress The wallet address being analyzed (used for logging/verification).
   * @returns An object containing the analysis results per token, signature count, and timestamps.
   *          Note: This returns the core data; the calling service will assemble the final SwapAnalysisSummary.
   */
  analyze(swapInputs: SwapAnalysisInput[], walletAddress: string): { 
    results: OnChainAnalysisResult[], 
    processedSignaturesCount: number, 
    firstTimestamp: number, 
    lastTimestamp: number,
    stablecoinNetFlow: number
  } {
        logger.debug(`[SwapAnalyzer] Analyzing ${swapInputs.length} pre-processed swap input records for wallet ${walletAddress} (after BURN filter)...`);
        
        // Filter out BURN interactions
        const filteredSwapInputs = swapInputs.filter(input => input.interactionType !== 'BURN');
        if (filteredSwapInputs.length !== swapInputs.length) {
            logger.debug(`Filtered out ${swapInputs.length - filteredSwapInputs.length} records with 'BURN' interaction type for ${walletAddress}.`);
        }

    // 1. Aggregate by SPL Mint
    const analysisBySplMint = new Map<string, Partial<OnChainAnalysisResult> & { timestamps: number[], totalFeesPaidInSol?: number }>();
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

    for (const input of filteredSwapInputs) {
        // Verification (optional): Check if record belongs to the correct wallet
        if (input.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
            logger.warn(`[SwapAnalyzer] Skipping input record for signature ${input.signature} belonging to unexpected wallet ${input.walletAddress}`);
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
                timestamps: [], netSolProfitLoss: 0, totalFeesPaidInSol: 0,
                isValuePreservation: isStablecoin,
                preservationType: isStablecoin ? 'stablecoin' : undefined
            });
        }
        const currentAnalysis = analysisBySplMint.get(splMint)!;

        currentAnalysis.timestamps!.push(timestamp);

        const solValueToConsider = input.associatedSolValue; 
        const currentFeeAmount = input.feeAmount || 0;

        if (input.direction === 'in') {
            currentAnalysis.totalAmountIn! += input.amount; 
            currentAnalysis.transferCountIn!++;
            currentAnalysis.totalSolSpent! += solValueToConsider; // Gross SOL spent
            currentAnalysis.totalFeesPaidInSol! += currentFeeAmount; 
            
            if (isStablecoin) {
                const flow = stablecoinFlows.get(splMint)!;
                flow.totalSolSpent += solValueToConsider;
                flow.totalAmountIn += input.amount;
                flow.netSolFlow -= solValueToConsider; 
            }
        } else { // direction === 'out'
            currentAnalysis.totalAmountOut! += input.amount; 
            currentAnalysis.transferCountOut!++;
            currentAnalysis.totalSolReceived! += solValueToConsider; // Gross SOL received
            currentAnalysis.totalFeesPaidInSol! += currentFeeAmount; 
            
            if (isStablecoin) {
                const flow = stablecoinFlows.get(splMint)!;
                flow.totalSolReceived += solValueToConsider;
                flow.totalAmountOut += input.amount;
                flow.netSolFlow += solValueToConsider; 
            }
        }
    } // End loop through swap inputs

    logger.debug(`[SwapAnalyzer] Aggregated data for ${analysisBySplMint.size} unique SPL tokens across ${processedSignatures.size} signatures.`);

    // 2. Calculate Final Metrics
    const finalResultsPreFilter: OnChainAnalysisResult[] = [];
    let totalStablecoinValue = 0;
    let totalStablecoinNetFlow = 0;
    
    for (const [splMint, aggregatedData] of analysisBySplMint.entries()) {
        aggregatedData.timestamps!.sort((a, b) => a - b);

        const netSolProfitLoss = (aggregatedData.totalSolReceived ?? 0) - (aggregatedData.totalSolSpent ?? 0) - (aggregatedData.totalFeesPaidInSol ?? 0);
        const netAmountChange = (aggregatedData.totalAmountIn ?? 0) - (aggregatedData.totalAmountOut ?? 0);
        
        const isStablecoin = stablecoins.has(splMint);
        let stablecoinSolValue = 0;
        
        if (isStablecoin && netAmountChange > 0) {
            const averageCostBasis = aggregatedData.totalSolSpent && aggregatedData.totalAmountIn
                ? aggregatedData.totalSolSpent / aggregatedData.totalAmountIn : 0;
            stablecoinSolValue = netAmountChange * averageCostBasis;
            totalStablecoinValue += stablecoinSolValue;
            
            const flow = stablecoinFlows.get(splMint);
            if (flow) {
                totalStablecoinNetFlow += flow.netSolFlow;
            }
            logger.debug(`[SwapAnalyzer] Stablecoin ${splMint}: Net amount = ${netAmountChange.toFixed(2)}, Value = ${stablecoinSolValue.toFixed(2)} SOL, NetFlow = ${flow?.netSolFlow.toFixed(2) || 0} SOL`);
        }

        finalResultsPreFilter.push({
            tokenAddress: splMint,
            totalAmountIn: aggregatedData.totalAmountIn ?? 0,
            totalAmountOut: aggregatedData.totalAmountOut ?? 0,
            netAmountChange: netAmountChange,
            totalSolSpent: aggregatedData.totalSolSpent ?? 0,
            totalSolReceived: aggregatedData.totalSolReceived ?? 0,
            totalFeesPaidInSol: aggregatedData.totalFeesPaidInSol ?? 0,
            netSolProfitLoss: netSolProfitLoss,
            estimatedPreservedValue: isStablecoin ? stablecoinSolValue : 0,
            isValuePreservation: isStablecoin,
            preservationType: isStablecoin ? 'stablecoin' : undefined,
            transferCountIn: aggregatedData.transferCountIn ?? 0,
            transferCountOut: aggregatedData.transferCountOut ?? 0,
            firstTransferTimestamp: aggregatedData.timestamps!.length > 0 ? aggregatedData.timestamps![0] : 0,
            lastTransferTimestamp: aggregatedData.timestamps!.length > 0 ? aggregatedData.timestamps![aggregatedData.timestamps!.length - 1] : 0,
        });
    }

    // Filter out WSOL records from the final results
    const finalResults = finalResultsPreFilter.filter(r => r.tokenAddress !== SOL_MINT);

    logger.debug(`[SwapAnalyzer] Final analysis complete. Generated ${finalResults.length} results (after filtering WSOL).`);
    
    if (totalStablecoinValue > 0) {
        logger.debug(`[SwapAnalyzer] Total stablecoin value: ${totalStablecoinValue.toFixed(2)} SOL`);
        logger.debug(`[SwapAnalyzer] Net SOL flow to stablecoins: ${totalStablecoinNetFlow.toFixed(2)} SOL`);
    }

    if (overallFirstTimestamp === Infinity) overallFirstTimestamp = 0;

    return {
        results: finalResults,
        processedSignaturesCount: processedSignatures.size,
        firstTimestamp: overallFirstTimestamp,
        lastTimestamp: overallLastTimestamp,
        stablecoinNetFlow: totalStablecoinNetFlow // Return the calculated net flow
    };
  }
}