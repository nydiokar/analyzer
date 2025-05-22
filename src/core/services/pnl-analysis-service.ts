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
                    serviceInvoked: 'PnlAnalysisService',
                    status: 'IN_PROGRESS',
                    inputDataStartTs: timeRange?.startTs,
                    inputDataEndTs: timeRange?.endTs,
                }
            });
            runId = run.id;
            const startTimeMs = Date.now();

            let swapInputs: SwapAnalysisInput[] = [];
            try {
                swapInputs = await this.databaseService.getSwapAnalysisInputs(walletAddress, isHistoricalView ? timeRange : undefined);
                if (swapInputs.length === 0) {
                    logger.warn(`[PnlAnalysis] No swap analysis input records found for ${walletAddress}${isHistoricalView ? ' in time range' : ''}.`);
                    await prisma.analysisRun.update({
                        where: { id: runId },
                        data: { status: 'COMPLETED', signaturesConsidered: 0 },
                    });
                    return { results: [], totalSignaturesProcessed: 0, overallFirstTimestamp: 0, overallLastTimestamp: 0, totalVolume: 0, totalFees: 0, realizedPnl: 0, unrealizedPnl: 0, netPnl: 0, stablecoinNetFlow: 0, firstTransactionTimestamp: 0, lastTransactionTimestamp: 0, averageSwapSize: 0, profitableTokensCount: 0, unprofitableTokensCount: 0, totalExecutedSwapsCount: 0, averageRealizedPnlPerExecutedSwap: 0, realizedPnlToTotalVolumeRatio: 0, advancedStats: undefined, runId };
                }
                logger.debug(`[PnlAnalysis] Fetched ${swapInputs.length} swap input records from DB.`);
            } catch (dbError: any) {
                const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
                const errorStack = dbError instanceof Error ? dbError.stack : undefined;
                logger.error(
                    `[PnlAnalysis] Error fetching swap inputs for ${walletAddress}. Message: ${errorMessage}`,
                    {
                        originalError: dbError,
                        stack: errorStack
                    }
                );
                analysisRunErrorMessage = errorMessage;
                throw dbError;
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
                data: { signaturesConsidered: processedSignaturesCount },
            });

            if (!swapAnalysisResultsFromAnalyzer || swapAnalysisResultsFromAnalyzer.length === 0) {
                logger.warn(`[PnlAnalysis] No results from SwapAnalyzer for wallet ${walletAddress}. Returning empty summary.`);
                return { results: [], totalSignaturesProcessed: 0, totalVolume: 0, totalFees: 0, realizedPnl: 0, unrealizedPnl: 0, netPnl: 0, stablecoinNetFlow: 0, overallFirstTimestamp: overallFirstTimestamp ||0, overallLastTimestamp: overallLastTimestamp ||0, averageSwapSize: 0, profitableTokensCount: 0, unprofitableTokensCount: 0, totalExecutedSwapsCount: 0, averageRealizedPnlPerExecutedSwap: 0, realizedPnlToTotalVolumeRatio: 0, advancedStats: undefined, runId };
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
                    isValuePreservation: r.isValuePreservation,
                    estimatedPreservedValue: r.estimatedPreservedValue,
                    preservationType: r.preservationType,
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

            let totalVolume = 0, totalFees = 0, realizedPnl = 0, unrealizedPnl = 0, profitableTokensCount = 0, unprofitableTokensCount = 0;
            let totalExecutedSwapsCount = 0;

            for (const result of swapAnalysisResultsFromAnalyzer) {
                totalVolume += (result.totalSolSpent || 0) + (result.totalSolReceived || 0);
                totalFees += result.totalFeesPaidInSol || 0;
                
                if (!result.isValuePreservation) {
                    realizedPnl += result.netSolProfitLoss ?? 0;
                    totalExecutedSwapsCount += (result.transferCountIn || 0) + (result.transferCountOut || 0);
                    const finalPnl = result.netSolProfitLoss ?? 0;
                    if (finalPnl > 0) profitableTokensCount++;
                    else if (finalPnl < 0) unprofitableTokensCount++;
                } else if (result.isValuePreservation && result.estimatedPreservedValue) {
                    unrealizedPnl += result.estimatedPreservedValue;
                }
            }
            const finalNetPnl = realizedPnl + unrealizedPnl;
            const totalPnlTokens = profitableTokensCount + unprofitableTokensCount;
            const averageSwapSize = totalPnlTokens > 0 ? totalVolume / totalPnlTokens : 0;
            const averageRealizedPnlPerExecutedSwap = totalExecutedSwapsCount > 0 ? realizedPnl / totalExecutedSwapsCount : 0;
            const realizedPnlToTotalVolumeRatio = totalVolume > 0 ? realizedPnl / totalVolume : 0;

            let advancedStatsData: AdvancedTradeStats | null = null;
            try {
                const resultsForAdvancedStats = swapAnalysisResultsFromAnalyzer.filter(r => !r.isValuePreservation);
                if (resultsForAdvancedStats.length > 0) advancedStatsData = this.advancedStatsAnalyzer.analyze(resultsForAdvancedStats);
                else logger.warn(`[PnlAnalysis] No non-stablecoin results for advanced stats for ${walletAddress}.`);
            } catch (statsError) {
                logger.error(`[PnlAnalysis] Error during advanced stats calculation for ${walletAddress}:`, { statsError });
            }

            const summaryForReturn: SwapAnalysisSummary = {
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
                averageSwapSize,
                profitableTokensCount,
                unprofitableTokensCount,
                totalExecutedSwapsCount,
                averageRealizedPnlPerExecutedSwap,
                realizedPnlToTotalVolumeRatio,
                advancedStats: advancedStatsData ?? undefined,
            };

            if (!isHistoricalView) {
                const pnlSummaryDataForDb = {
                    walletAddress: walletAddress,
                    totalVolume: summaryForReturn.totalVolume,
                    totalFees: summaryForReturn.totalFees,
                    realizedPnl: summaryForReturn.realizedPnl,
                    unrealizedPnl: summaryForReturn.unrealizedPnl,
                    netPnl: summaryForReturn.netPnl,
                    stablecoinNetFlow: summaryForReturn.stablecoinNetFlow,
                    averageSwapSize: summaryForReturn.averageSwapSize,
                    profitableTokensCount: summaryForReturn.profitableTokensCount,
                    unprofitableTokensCount: summaryForReturn.unprofitableTokensCount,
                    totalExecutedSwapsCount: summaryForReturn.totalExecutedSwapsCount,
                    averageRealizedPnlPerExecutedSwap: summaryForReturn.averageRealizedPnlPerExecutedSwap,
                    realizedPnlToTotalVolumeRatio: summaryForReturn.realizedPnlToTotalVolumeRatio,
                    totalSignaturesProcessed: summaryForReturn.totalSignaturesProcessed,
                    overallFirstTimestamp: summaryForReturn.overallFirstTimestamp,
                    overallLastTimestamp: summaryForReturn.overallLastTimestamp,
                };

                if (advancedStatsData) {
                    const sanitizedStats = {
                        medianPnlPerToken: !isFinite(advancedStatsData.medianPnlPerToken) ? 0 : advancedStatsData.medianPnlPerToken,
                        trimmedMeanPnlPerToken: !isFinite(advancedStatsData.trimmedMeanPnlPerToken) ? 0 : advancedStatsData.trimmedMeanPnlPerToken,
                        tokenWinRatePercent: !isFinite(advancedStatsData.tokenWinRatePercent) ? 0 : advancedStatsData.tokenWinRatePercent,
                        standardDeviationPnl: !isFinite(advancedStatsData.standardDeviationPnl) ? 0 : advancedStatsData.standardDeviationPnl,
                        profitConsistencyIndex: !isFinite(advancedStatsData.medianPnlToVolatilityRatio) ? 0 : advancedStatsData.medianPnlToVolatilityRatio, // TODO: rename to medianPnlToVolatilityRatio in db later on
                        weightedEfficiencyScore: !isFinite(advancedStatsData.weightedEfficiencyScore) ? 0 : advancedStatsData.weightedEfficiencyScore,
                        averagePnlPerDayActiveApprox: !isFinite(advancedStatsData.averagePnlPerDayActiveApprox) ? 0 : advancedStatsData.averagePnlPerDayActiveApprox,
                        firstTransactionTimestamp: advancedStatsData.firstTransactionTimestamp,
                        lastTransactionTimestamp: advancedStatsData.lastTransactionTimestamp,
                    };

                    await prisma.walletPnlSummary.upsert({
                        where: { walletAddress: walletAddress }, 
                        create: {
                            ...pnlSummaryDataForDb,
                            advancedStats: {
                                create: sanitizedStats,
                            },
                        },
                        update: {
                            ...pnlSummaryDataForDb,
                            advancedStats: {
                                upsert: {
                                    create: sanitizedStats,
                                    update: sanitizedStats,
                                },
                            },
                        },
                    });
                    logger.info(`[PnlAnalysis] Upserted WalletPnlSummary and AdvancedTradeStats for ${walletAddress}.`);

                } else {
                    await prisma.walletPnlSummary.upsert({
                        where: { walletAddress: walletAddress },
                        create: pnlSummaryDataForDb,
                        update: pnlSummaryDataForDb,
                    });
                    logger.info(`[PnlAnalysis] Upserted WalletPnlSummary (no advanced stats) for ${walletAddress}.`);
                }
                
                if (newestProcessedSignatureFromWallet) {
                    await prisma.wallet.update({
                        where: { address: walletAddress },
                        data: { lastSignatureAnalyzed: newestProcessedSignatureFromWallet },
                    });
                    logger.info(`[PnlAnalysis] Updated Wallet.lastSignatureAnalyzed for ${walletAddress} to ${newestProcessedSignatureFromWallet}.`);
                }
            }

            analysisRunStatus = 'COMPLETED';
            if (runId) { 
                await prisma.analysisRun.update({
                    where: { id: runId },
                    data: { 
                        status: 'COMPLETED', 
                        errorMessage: null,
                        durationMs: Date.now() - startTimeMs,
                        signaturesConsidered: swapInputs.length,
                    },
                });
                logger.info(`[PnlAnalysis] Successfully marked AnalysisRun ${runId} as COMPLETED.`);
            }

            logger.info(`[PnlAnalysis] Analysis complete for wallet ${walletAddress}. Net PNL: ${summaryForReturn.netPnl.toFixed(4)} SOL`);
            return { ...summaryForReturn, runId };

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