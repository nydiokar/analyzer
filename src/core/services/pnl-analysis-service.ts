import { createLogger } from 'core/utils/logger';
import { DatabaseService, prisma } from 'core/services/database-service';
import { SwapAnalyzer } from 'core/analysis/swap/analyzer';
import { AdvancedStatsAnalyzer } from 'core/analysis/stats/analyzer';
import { OnChainAnalysisResult, SwapAnalysisSummary, AdvancedTradeStats } from '@/types/helius-api';
import { SwapAnalysisInput, Wallet } from '@prisma/client';

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
     * @param newestProcessedSignatureFromWallet Optional signature to update Wallet.lastSignatureAnalyzed
     * @returns A promise resolving to the SwapAnalysisSummary or null if no data/results.
     */
    async analyzeWalletPnl(
        walletAddress: string,
        timeRange?: { startTs?: number, endTs?: number },
        newestProcessedSignatureFromWallet?: string | null 
    ): Promise<(SwapAnalysisSummary & { runId?: number, analysisSkipped?: boolean }) | null> {
        logger.info(`[PnlAnalysis] Starting analysis for wallet ${walletAddress}`, { timeRange, newSignatureToAnalyze: newestProcessedSignatureFromWallet });

        let runId: number | undefined = undefined;
        let analysisRunStatus: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' = 'IN_PROGRESS';
        let analysisRunErrorMessage: string | null = null;

        const isHistoricalView = !!timeRange;

        try {
            const run = await prisma.analysisRun.create({
                data: {
                    walletAddress: walletAddress,
                    status: 'IN_PROGRESS',
                    analysisStartTs: timeRange?.startTs,
                    analysisEndTs: timeRange?.endTs,
                }
            });
            runId = run.id;

            let swapInputs: SwapAnalysisInput[] = [];
            try {
                swapInputs = await this.databaseService.getSwapAnalysisInputs(walletAddress, isHistoricalView ? timeRange : undefined);
                if (swapInputs.length === 0) {
                    logger.warn(`[PnlAnalysis] No swap analysis input records found for ${walletAddress}${isHistoricalView ? ' in time range' : ''}.`);
                    await prisma.analysisRun.update({
                        where: { id: runId },
                        data: { status: 'COMPLETED', signaturesProcessed: 0 },
                    });
                    return { results: [], totalSignaturesProcessed: 0, overallFirstTimestamp: 0, overallLastTimestamp: 0, totalVolume: 0, totalFees: 0, realizedPnl: 0, unrealizedPnl: 0, netPnl: 0, stablecoinNetFlow: 0, firstTransactionTimestamp: 0, lastTransactionTimestamp: 0, averageSwapSize: 0, profitableSwaps: 0, unprofitableSwaps: 0, advancedStats: undefined, runId };
                }
                logger.debug(`[PnlAnalysis] Fetched ${swapInputs.length} swap input records from DB.`);
            } catch (dbError: any) {
                logger.error(`[PnlAnalysis] Error fetching swap inputs for ${walletAddress}:`, { dbError });
                analysisRunErrorMessage = dbError.message || String(dbError);
                throw dbError; // Re-throw to be caught by the main try-catch, which will set FAILED status
            }
            
            let overallFirstTimestamp: number | undefined = undefined;
            let overallLastTimestamp: number | undefined = undefined;
            for (const tx of swapInputs) {
                let tsNumber: number | undefined = undefined;
                if (typeof tx.timestamp === 'number') {
                    tsNumber = tx.timestamp;
                } else if (tx.timestamp && typeof tx.timestamp === 'object' && typeof (tx.timestamp as Date).getTime === 'function') {
                    tsNumber = (tx.timestamp as Date).getTime() / 1000;
                }
                if (tsNumber === undefined) continue;
                if (overallFirstTimestamp === undefined || tsNumber < overallFirstTimestamp) overallFirstTimestamp = tsNumber;
                if (overallLastTimestamp === undefined || tsNumber > overallLastTimestamp) overallLastTimestamp = tsNumber;
            }

            const swapAnalysisCore = this.swapAnalyzer.analyze(swapInputs, walletAddress);
            const { results: swapAnalysisResultsFromAnalyzer, processedSignaturesCount, stablecoinNetFlow } = swapAnalysisCore;

            await prisma.analysisRun.update({
                where: { id: runId },
                data: { signaturesProcessed: processedSignaturesCount },
            });

            if (!swapAnalysisResultsFromAnalyzer || swapAnalysisResultsFromAnalyzer.length === 0) {
                logger.warn(`[PnlAnalysis] Core swap analysis yielded no results for ${walletAddress}.`);
                analysisRunStatus = 'COMPLETED';
                return { results: [], totalSignaturesProcessed: processedSignaturesCount, overallFirstTimestamp: overallFirstTimestamp || 0, overallLastTimestamp: overallLastTimestamp || 0, totalVolume: 0, totalFees: 0, realizedPnl: 0, unrealizedPnl: 0, netPnl: 0, stablecoinNetFlow: 0, firstTransactionTimestamp: overallFirstTimestamp || 0, lastTransactionTimestamp: overallLastTimestamp ||0, averageSwapSize: 0, profitableSwaps: 0, unprofitableSwaps: 0, advancedStats: undefined, runId };
            }

            if (!isHistoricalView) {
                const resultsToUpsert = swapAnalysisResultsFromAnalyzer.map((r: OnChainAnalysisResult) => ({
                    walletAddress: walletAddress,
                    tokenAddress: r.tokenAddress,
                    totalAmountIn: r.totalAmountIn,
                    totalAmountOut: r.totalAmountOut,
                    netAmountChange: r.netAmountChange,
                    totalSolSpent: r.totalSolSpent,
                    totalSolReceived: r.totalSolReceived,
                    totalFeesPaidInSol: r.totalFeesPaidInSol,
                    netSolProfitLoss: r.netSolProfitLoss,
                    firstTransferTimestamp: r.firstTransferTimestamp,
                    lastTransferTimestamp: r.lastTransferTimestamp,
                    transferCountIn: r.transferCountIn,
                    transferCountOut: r.transferCountOut,
                }));
                for (const record of resultsToUpsert) {
                    await prisma.analysisResult.upsert({
                        where: { walletAddress_tokenAddress: { walletAddress: record.walletAddress, tokenAddress: record.tokenAddress }},
                        create: record,
                        update: record,
                    });
                }
                logger.info(`[PnlAnalysis] Upserted ${resultsToUpsert.length} AnalysisResult records for ${walletAddress}.`);
            }

            let totalVolume = 0, totalFees = 0, realizedPnl = 0, unrealizedPnl = 0, profitableSwaps = 0, unprofitableSwaps = 0;
            for (const result of swapAnalysisResultsFromAnalyzer) {
                totalVolume += (result.totalSolSpent || 0) + (result.totalSolReceived || 0);
                totalFees += result.totalFeesPaidInSol || 0;
                realizedPnl += result.adjustedNetSolProfitLoss ?? (result.netSolProfitLoss || 0);
                if (result.isValuePreservation && result.estimatedPreservedValue) unrealizedPnl += result.estimatedPreservedValue;
                const finalPnl = result.adjustedNetSolProfitLoss ?? (result.netSolProfitLoss || 0);
                if (finalPnl > 0) profitableSwaps++;
                else if (finalPnl < 0) unprofitableSwaps++;
            }
            const finalNetPnl = realizedPnl + unrealizedPnl;
            const totalPnlSwaps = profitableSwaps + unprofitableSwaps;
            const averageSwapSize = totalPnlSwaps > 0 ? totalVolume / totalPnlSwaps : 0;

            let advancedStatsData: AdvancedTradeStats | null = null;
            try {
                const resultsForAdvancedStats = swapAnalysisResultsFromAnalyzer.filter(r => !r.isValuePreservation);
                if (resultsForAdvancedStats.length > 0) advancedStatsData = this.advancedStatsAnalyzer.analyze(resultsForAdvancedStats);
                else logger.warn(`[PnlAnalysis] No non-stablecoin results for advanced stats for ${walletAddress}.`);
            } catch (statsError) {
                logger.error(`[PnlAnalysis] Error during advanced stats calculation for ${walletAddress}:`, { statsError });
            }

            if (!isHistoricalView && advancedStatsData && runId) {
                // Sanitize advancedStatsData to prevent PrismaClientValidationError for NaN/Infinity
                const sanitizedStats = {
                    medianPnlPerToken: !isFinite(advancedStatsData.medianPnlPerToken) ? 0 : advancedStatsData.medianPnlPerToken,
                    trimmedMeanPnlPerToken: !isFinite(advancedStatsData.trimmedMeanPnlPerToken) ? 0 : advancedStatsData.trimmedMeanPnlPerToken,
                    tokenWinRatePercent: !isFinite(advancedStatsData.tokenWinRatePercent) ? 0 : advancedStatsData.tokenWinRatePercent,
                    standardDeviationPnl: !isFinite(advancedStatsData.standardDeviationPnl) ? 0 : advancedStatsData.standardDeviationPnl,
                    profitConsistencyIndex: !isFinite(advancedStatsData.profitConsistencyIndex) ? 0 : advancedStatsData.profitConsistencyIndex,
                    weightedEfficiencyScore: !isFinite(advancedStatsData.weightedEfficiencyScore) ? 0 : advancedStatsData.weightedEfficiencyScore,
                    averagePnlPerDayActiveApprox: !isFinite(advancedStatsData.averagePnlPerDayActiveApprox) ? 0 : advancedStatsData.averagePnlPerDayActiveApprox
                };

                const createData = {
                    runId: runId, 
                    walletAddress: walletAddress, 
                    ...sanitizedStats // Use the sanitized stats
                };
                await prisma.advancedStatsResult.upsert({
                    where: { runId: runId },
                    create: createData,
                    update: createData,
                });
                logger.info(`[PnlAnalysis] Saved AdvancedStatsResult for run ${runId}.`);
            }

            const summary: SwapAnalysisSummary = {
                results: swapAnalysisResultsFromAnalyzer,
                totalSignaturesProcessed: processedSignaturesCount,
                overallFirstTimestamp: overallFirstTimestamp || 0,
                overallLastTimestamp: overallLastTimestamp || 0,
                totalVolume,
                totalFees,
                realizedPnl,
                unrealizedPnl,
                netPnl: finalNetPnl,
                stablecoinNetFlow,
                firstTransactionTimestamp: overallFirstTimestamp,
                lastTransactionTimestamp: overallLastTimestamp,
                averageSwapSize,
                profitableSwaps,
                unprofitableSwaps,
                advancedStats: advancedStatsData ?? undefined,
            };

            if (!isHistoricalView && newestProcessedSignatureFromWallet) {
                await prisma.wallet.update({
                    where: { address: walletAddress },
                    data: { lastSignatureAnalyzed: newestProcessedSignatureFromWallet },
                });
                logger.info(`[PnlAnalysis] Updated Wallet.lastSignatureAnalyzed for ${walletAddress} to ${newestProcessedSignatureFromWallet}.`);
            }

            analysisRunStatus = 'COMPLETED';
            logger.info(`[PnlAnalysis] Analysis complete for wallet ${walletAddress}. Net PNL: ${summary.netPnl.toFixed(4)} SOL`);
            return { ...summary, runId };

        } catch (error: any) {
            logger.error(`[PnlAnalysis] Critical error during PNL analysis for ${walletAddress}:`, { error });
            analysisRunStatus = 'FAILED';
            analysisRunErrorMessage = error.message || String(error);
            if (runId) {
                await prisma.analysisRun.update({
                    where: { id: runId },
                    data: { status: analysisRunStatus, errorMessage: analysisRunErrorMessage },
                }).catch(err => logger.error(`[PnlAnalysis] FAILED to update AnalysisRun ${runId} to FAILED status:`, err));
            }
            return null;
        } finally {
            if (runId && (analysisRunStatus === 'IN_PROGRESS' || (analysisRunStatus !== 'COMPLETED' && analysisRunStatus !== 'FAILED'))) {
                 await prisma.analysisRun.update({
                    where: { id: runId },
                    data: { 
                        status: analysisRunStatus === 'IN_PROGRESS' ? 'FAILED' : analysisRunStatus,
                        errorMessage: analysisRunErrorMessage ?? (analysisRunStatus === 'IN_PROGRESS' ? 'Unknown error, service exited prematurely' : null)
                    },
                }).catch(err => logger.error(`[PnlAnalysis] Error in finally block updating AnalysisRun ${runId}:`, err));
            }
        }
    }
} 