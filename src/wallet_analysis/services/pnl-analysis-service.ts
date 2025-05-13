import { createLogger } from '@/utils/logger';
import { DatabaseService } from '@/services/database-service';
import { SwapAnalyzer } from '@/core/swap/analyzer';
import { AdvancedStatsAnalyzer } from '@/core/stats/analyzer';
import { OnChainAnalysisResult, SwapAnalysisSummary, AdvancedTradeStats } from '@/types/helius-api';
import { SwapAnalysisInput } from '@prisma/client';

const logger = createLogger('PnlAnalysisService');

export class PnlAnalysisService {
    private swapAnalyzer: SwapAnalyzer;
    private advancedStatsAnalyzer: AdvancedStatsAnalyzer;

    constructor(
        private databaseService: DatabaseService
    ) {
        this.swapAnalyzer = new SwapAnalyzer();
        this.advancedStatsAnalyzer = new AdvancedStatsAnalyzer();
        logger.info('PnlAnalysisService instantiated.');
    }

    /**
     * Performs P/L and advanced stats analysis for a given wallet, optionally within a time range.
     *
     * @param walletAddress The wallet address to analyze.
     * @param timeRange Optional object with startTs and/or endTs for filtering.
     * @returns A promise resolving to the SwapAnalysisSummary or null if no data/results.
     */
    async analyzeWalletPnl(
        walletAddress: string,
        timeRange?: { startTs?: number, endTs?: number }
    ): Promise<SwapAnalysisSummary | null> {
        logger.info(`[PnlAnalysis] Starting analysis for wallet ${walletAddress}`, { timeRange });

        // 1. Fetch SwapAnalysisInput data
        let swapInputs: SwapAnalysisInput[] = [];
        try {
            swapInputs = await this.databaseService.getSwapAnalysisInputs(walletAddress, timeRange);
            if (swapInputs.length === 0) {
                logger.warn(`[PnlAnalysis] No swap analysis input records found for ${walletAddress}${timeRange ? ' in time range' : ''}. Returning null summary.`);
                return null; 
            }
            logger.debug(`[PnlAnalysis] Fetched ${swapInputs.length} swap input records from DB.`);
        } catch (dbError) {
            logger.error(`[PnlAnalysis] Error fetching swap inputs for ${walletAddress}:`, { dbError });
            return null; 
        }
        
        // Calculate overall first and last timestamps from the fetched transaction inputs
        let overallFirstTimestamp: number | undefined = undefined;
        let overallLastTimestamp: number | undefined = undefined;
        for (const tx of swapInputs) {
            let tsNumber: number | undefined = undefined;
            // Revised type check with explicit cast
            if (typeof tx.timestamp === 'number') {
                tsNumber = tx.timestamp; // Assume it's already Unix timestamp (seconds)
            } else if (tx.timestamp && typeof tx.timestamp === 'object' && typeof (tx.timestamp as Date).getTime === 'function') {
                // Added explicit cast to Date before calling getTime
                tsNumber = (tx.timestamp as Date).getTime() / 1000; // Convert Date to Unix timestamp (seconds)
            }
            
            // Skip if timestamp is null/undefined or not a recognized type
            if (tsNumber === undefined) continue; 

            if (overallFirstTimestamp === undefined || tsNumber < overallFirstTimestamp) {
                overallFirstTimestamp = tsNumber;
            }
            if (overallLastTimestamp === undefined || tsNumber > overallLastTimestamp) {
                overallLastTimestamp = tsNumber;
            }
        }

        // 2. Perform core P/L analysis using SwapAnalyzer
        const swapAnalysisCore = this.swapAnalyzer.analyze(swapInputs, walletAddress);
        
        // Destructure results
        const { 
            results: swapAnalysisResults, 
            processedSignaturesCount, // Use this instead of swapInputs.length? Typically same.
            // Note: SwapAnalyzer also returns first/last timestamps based on *analyzed* data,
            // which might differ slightly if inputs were filtered. We use the overall ones from raw inputs.
            stablecoinNetFlow // Get calculated flow from analyzer
        } = swapAnalysisCore;

        if (!swapAnalysisResults || swapAnalysisResults.length === 0) {
            logger.warn(`[PnlAnalysis] Core swap analysis yielded no results for ${walletAddress}.`);
            // Return empty summary, using overall timestamps from inputs
            return {
                results: [],
                totalSignaturesProcessed: processedSignaturesCount, 
                overallFirstTimestamp: overallFirstTimestamp || 0, 
                overallLastTimestamp: overallLastTimestamp || 0,
                totalVolume: 0,
                totalFees: 0,
                realizedPnl: 0,
                unrealizedPnl: 0,
                netPnl: 0,
                stablecoinNetFlow: 0, // Default to 0 if no results
                firstTransactionTimestamp: overallFirstTimestamp, 
                lastTransactionTimestamp: overallLastTimestamp,
                averageSwapSize: 0,
                profitableSwaps: 0,
                unprofitableSwaps: 0,
                advancedStats: undefined,
            };
        }

        // 3. Calculate summary metrics from results
        let totalVolume = 0;
        let totalFees = 0;
        let realizedPnl = 0;
        let unrealizedPnl = 0;
        // stablecoinNetFlow is taken directly from swapAnalysisCore result
        let profitableSwaps = 0;
        let unprofitableSwaps = 0;

        for (const result of swapAnalysisResults) {
            totalVolume += (result.totalSolSpent || 0) + (result.totalSolReceived || 0);
            totalFees += result.totalFeesPaidInSol || 0;
            // Use adjusted PNL if available (includes stablecoin value), otherwise base PNL
            realizedPnl += result.adjustedNetSolProfitLoss ?? (result.netSolProfitLoss || 0); 

            // Unrealized PNL calculation might need refinement. 
            // Currently relies on estimatedPreservedValue from SwapAnalyzer (only for stables).
            // If HODL tokens are introduced, this needs update.
            if (result.isValuePreservation && result.estimatedPreservedValue) {
                 unrealizedPnl += result.estimatedPreservedValue;
            }

            // Count swaps based on final PNL (adjusted or not)
            const finalPnl = result.adjustedNetSolProfitLoss ?? (result.netSolProfitLoss || 0);
            if (finalPnl > 0) {
                profitableSwaps++;
            } else if (finalPnl < 0) {
                unprofitableSwaps++;
            }
        }

        const netPnl = realizedPnl; // Net PNL is effectively the sum of adjusted PNLs
                                 // Unrealized PNL is tracked separately maybe?
                                 // Let's clarify the definition: Net = Realized + Unrealized
        const finalNetPnl = realizedPnl + unrealizedPnl; 

        const totalPnlSwaps = profitableSwaps + unprofitableSwaps;
        const averageSwapSize = totalPnlSwaps > 0 ? totalVolume / totalPnlSwaps : 0;

        // 4. Calculate advanced stats (Optional)
        let advancedStats: AdvancedTradeStats | null = null;
        try {
            // Filter out value preservation tokens before calculating advanced stats
            const resultsForAdvancedStats = swapAnalysisResults.filter(r => !r.isValuePreservation);
            if (resultsForAdvancedStats.length > 0) {
                 advancedStats = this.advancedStatsAnalyzer.analyze(resultsForAdvancedStats); 
            } else {
                logger.warn(`[PnlAnalysis] No non-stablecoin results for advanced stats for ${walletAddress}.`);
            }
        } catch (statsError) {
            logger.error(`[PnlAnalysis] Error during advanced stats calculation for ${walletAddress}:`, { statsError });
        }

        // 5. Assemble final summary object
        const summary: SwapAnalysisSummary = {
            results: swapAnalysisResults,
            totalSignaturesProcessed: processedSignaturesCount,
            // Use overall timestamps calculated from raw inputs
            overallFirstTimestamp: overallFirstTimestamp || 0, 
            overallLastTimestamp: overallLastTimestamp || 0,   
            totalVolume,
            totalFees,
            realizedPnl, // Sum of adjusted PNLs
            unrealizedPnl, // Sum of estimated preserved values
            netPnl: finalNetPnl, // Realized + Unrealized
            stablecoinNetFlow, // From SwapAnalyzer result
            // Use overall timestamps for first/last transaction fields
            firstTransactionTimestamp: overallFirstTimestamp, 
            lastTransactionTimestamp: overallLastTimestamp,   
            averageSwapSize,
            profitableSwaps,
            unprofitableSwaps,
            advancedStats: advancedStats ?? undefined,
        };

        logger.info(`[PnlAnalysis] Analysis complete for ${walletAddress}. Net PNL: ${summary.netPnl.toFixed(4)} SOL`);
        return summary;
    }
} 