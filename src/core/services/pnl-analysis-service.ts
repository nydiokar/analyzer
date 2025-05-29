import { createLogger } from 'core/utils/logger';
import { DatabaseService, prisma } from 'core/services/database-service';
import { SwapAnalyzer } from 'core/analysis/swap/analyzer';
import { AdvancedStatsAnalyzer } from 'core/analysis/stats/analyzer';
import { OnChainAnalysisResult, SwapAnalysisSummary, AdvancedTradeStats as PrismaAdvancedTradeStats } from '@/types/helius-api';
import { SwapAnalysisInput, Wallet, AnalysisRun } from '@prisma/client';
import { HeliusApiClient } from './helius-api-client';
import { WalletBalanceService } from './wallet-balance-service';
import { WalletBalance } from '@/types/wallet';

const logger = createLogger('PnlAnalysisService');

export class PnlAnalysisService {
    private swapAnalyzer: SwapAnalyzer;
    private advancedStatsAnalyzer: AdvancedStatsAnalyzer;
    private walletBalanceService: WalletBalanceService | null;
    private heliusApiClient: HeliusApiClient | null;

    constructor(
        private databaseService: DatabaseService,
        heliusApiClient: HeliusApiClient | null
    ) {
        this.swapAnalyzer = new SwapAnalyzer();
        this.advancedStatsAnalyzer = new AdvancedStatsAnalyzer();
        this.heliusApiClient = heliusApiClient;

        if (this.heliusApiClient) {
            this.walletBalanceService = new WalletBalanceService(this.heliusApiClient);
            logger.info('PnlAnalysisService instantiated with HeliusApiClient. WalletBalanceService active.');
        } else {
            this.walletBalanceService = null;
            logger.info('PnlAnalysisService instantiated without HeliusApiClient. WalletBalanceService inactive.');
        }
    }

    /**
     * Performs P/L and advanced stats analysis for a given wallet, optionally within a time range.
     *
     * @param walletAddress The wallet address to analyze.
     * @param timeRange Optional object with startTs and/or endTs for filtering.
     * @param newestProcessedSignatureFromWallet Optional signature to update Wallet.lastSignatureAnalyzed
     * @param options Optional options for view-only mode
     * @returns A promise resolving to the SwapAnalysisSummary or null if no data/results.
     */
    async analyzeWalletPnl(
        walletAddress: string,
        timeRange?: { startTs?: number, endTs?: number },
        newestProcessedSignatureFromWallet?: string | null,
        options?: { isViewOnly?: boolean }
    ): Promise<(SwapAnalysisSummary & { runId?: number, analysisSkipped?: boolean, currentSolBalance?: number, balancesFetchedAt?: Date }) | null> {
        logger.info(`[PnlAnalysis] Starting analysis for wallet ${walletAddress}`, { timeRange, newSignatureToAnalyze: newestProcessedSignatureFromWallet, options });

        let runId: number | undefined = undefined;
        let analysisRunStatus: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' = 'IN_PROGRESS';
        let analysisRunErrorMessage: string | null = null;

        const isHistoricalView = !!timeRange;
        const isViewOnlyMode = !!options?.isViewOnly;

        let startTimeMs: number = 0;

        // Fetch current wallet state (SOL & Token Balances)
        let currentWalletBalance: WalletBalance | undefined;
        let balancesFetchedAt: Date | undefined;

        if (this.walletBalanceService) {
            try {
                logger.debug(`[PnlAnalysis] Fetching current wallet state for ${walletAddress}...`);
                const walletBalancesMap = await this.walletBalanceService.fetchWalletBalances([walletAddress]);
                currentWalletBalance = walletBalancesMap.get(walletAddress);
                if (currentWalletBalance) {
                    balancesFetchedAt = currentWalletBalance.fetchedAt;
                    logger.info(`[PnlAnalysis] Successfully fetched wallet state for ${walletAddress}. SOL: ${currentWalletBalance.solBalance}, FetchedAt: ${balancesFetchedAt}`);
                }
            } catch (balanceError: any) {
                logger.warn(`[PnlAnalysis] Failed to fetch wallet state for ${walletAddress}. Proceeding without live balances. Error: ${balanceError.message || balanceError}`);
                // Non-critical, proceed with PNL analysis without current balances if fetch fails
            }
        } else {
            logger.info(`[PnlAnalysis] WalletBalanceService is not active (no HeliusApiClient provided). Skipping live balance fetch for ${walletAddress}.`);
        }

        try {
            if (!isViewOnlyMode) {
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
                startTimeMs = Date.now();
            } else {
                startTimeMs = Date.now();
            }

            let swapInputs: SwapAnalysisInput[] = [];
            try {
                swapInputs = await this.databaseService.getSwapAnalysisInputs(walletAddress, timeRange);
                if (swapInputs.length === 0) {
                    logger.warn(`[PnlAnalysis] No swap analysis input records found for ${walletAddress}${timeRange ? ' in time range' : ''}.`);
                    if (runId) {
                        await prisma.analysisRun.update({
                            where: { id: runId },
                            data: { status: 'COMPLETED', signaturesConsidered: 0, durationMs: Date.now() - startTimeMs },
                        });
                    }
                    return { results: [], totalSignaturesProcessed: 0, overallFirstTimestamp: 0, overallLastTimestamp: 0, totalVolume: 0, totalFees: 0, realizedPnl: 0, unrealizedPnl: 0, netPnl: 0, stablecoinNetFlow: 0, firstTransactionTimestamp: 0, lastTransactionTimestamp: 0, averageSwapSize: 0, profitableTokensCount: 0, unprofitableTokensCount: 0, totalExecutedSwapsCount: 0, averageRealizedPnlPerExecutedSwap: 0, realizedPnlToTotalVolumeRatio: 0, advancedStats: undefined, runId: isViewOnlyMode ? undefined : runId, currentSolBalance: currentWalletBalance?.solBalance, balancesFetchedAt: balancesFetchedAt };
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

            // Enrich with token balances
            const enrichedSwapAnalysisResults = swapAnalysisResultsFromAnalyzer.map(res => {
                const tokenBalanceDetail = currentWalletBalance?.tokenBalances.find(tb => tb.mint === res.tokenAddress);
                return {
                    ...res,
                    currentRawBalance: tokenBalanceDetail?.balance,
                    currentUiBalance: tokenBalanceDetail?.uiBalance,
                    currentUiBalanceString: tokenBalanceDetail?.uiBalanceString,
                    balanceDecimals: tokenBalanceDetail?.decimals,
                    balanceFetchedAt: tokenBalanceDetail ? balancesFetchedAt : undefined,
                };
            });

            if (runId) {
                await prisma.analysisRun.update({
                    where: { id: runId },
                    data: { signaturesConsidered: processedSignaturesCount },
                });
            }

            if (!swapAnalysisResultsFromAnalyzer || swapAnalysisResultsFromAnalyzer.length === 0) {
                logger.warn(`[PnlAnalysis] No results from SwapAnalyzer for wallet ${walletAddress}. Returning empty summary.`);
                return { results: [], totalSignaturesProcessed: 0, totalVolume: 0, totalFees: 0, realizedPnl: 0, unrealizedPnl: 0, netPnl: 0, stablecoinNetFlow: 0, overallFirstTimestamp: overallFirstTimestamp ||0, overallLastTimestamp: overallLastTimestamp ||0, averageSwapSize: 0, profitableTokensCount: 0, unprofitableTokensCount: 0, totalExecutedSwapsCount: 0, averageRealizedPnlPerExecutedSwap: 0, realizedPnlToTotalVolumeRatio: 0, advancedStats: undefined, runId: isViewOnlyMode ? undefined : runId, currentSolBalance: currentWalletBalance?.solBalance, balancesFetchedAt: balancesFetchedAt };
            }

            if (!isHistoricalView && !isViewOnlyMode) {
                // Upsert AnalysisResult records with token balances
                const resultsToUpsert = enrichedSwapAnalysisResults.map((r: OnChainAnalysisResult) => ({
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
                    currentRawBalance: r.currentRawBalance,
                    currentUiBalance: r.currentUiBalance,
                    currentUiBalanceString: r.currentUiBalanceString,
                    balanceDecimals: r.balanceDecimals,
                    balanceFetchedAt: r.balanceFetchedAt,
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

            let advancedStatsData: PrismaAdvancedTradeStats | null = null;
            try {
                const resultsForAdvancedStats = swapAnalysisResultsFromAnalyzer.filter(r => !r.isValuePreservation);
                if (resultsForAdvancedStats.length > 0) advancedStatsData = this.advancedStatsAnalyzer.analyze(resultsForAdvancedStats);
                else logger.warn(`[PnlAnalysis] No non-stablecoin results for advanced stats for ${walletAddress}.`);
            } catch (statsError) {
                logger.error(`[PnlAnalysis] Error during advanced stats calculation for ${walletAddress}:`, { statsError });
            }

            const summary: SwapAnalysisSummary = {
                results: enrichedSwapAnalysisResults,
                totalSignaturesProcessed: processedSignaturesCount,
                totalVolume: totalVolume,
                totalFees: totalFees,
                realizedPnl: realizedPnl,
                unrealizedPnl: 0, // Placeholder, true unrealized PNL is complex
                netPnl: realizedPnl, // For now, netPnl is realizedPnl
                stablecoinNetFlow: stablecoinNetFlow,
                overallFirstTimestamp: overallFirstTimestamp || 0,
                overallLastTimestamp: overallLastTimestamp || 0,
                profitableTokensCount,
                unprofitableTokensCount,
                totalExecutedSwapsCount: totalExecutedSwapsCount,
                averageSwapSize: averageSwapSize,
                averageRealizedPnlPerExecutedSwap: averageRealizedPnlPerExecutedSwap,
                realizedPnlToTotalVolumeRatio: realizedPnlToTotalVolumeRatio,
                advancedStats: advancedStatsData ?? undefined,
                currentSolBalance: currentWalletBalance?.solBalance,
                balancesFetchedAt: balancesFetchedAt,
                tokenBalances: currentWalletBalance?.tokenBalances,
            };

            if (!isHistoricalView && !isViewOnlyMode) {
                const pnlSummaryDataForDb = {
                    walletAddress: walletAddress,
                    totalVolume: summary.totalVolume,
                    totalFees: summary.totalFees,
                    realizedPnl: summary.realizedPnl,
                    unrealizedPnl: summary.unrealizedPnl,
                    netPnl: summary.netPnl,
                    stablecoinNetFlow: summary.stablecoinNetFlow,
                    averageSwapSize: summary.averageSwapSize,
                    profitableTokensCount: summary.profitableTokensCount,
                    unprofitableTokensCount: summary.unprofitableTokensCount,
                    totalExecutedSwapsCount: summary.totalExecutedSwapsCount,
                    averageRealizedPnlPerExecutedSwap: summary.averageRealizedPnlPerExecutedSwap,
                    realizedPnlToTotalVolumeRatio: summary.realizedPnlToTotalVolumeRatio,
                    totalSignaturesProcessed: summary.totalSignaturesProcessed,
                    overallFirstTimestamp: summary.overallFirstTimestamp,
                    overallLastTimestamp: summary.overallLastTimestamp,
                    currentSolBalance: currentWalletBalance?.solBalance,
                    solBalanceFetchedAt: balancesFetchedAt,
                };

                if (advancedStatsData) {
                    const sanitizedStats = {
                        medianPnlPerToken: !isFinite(advancedStatsData.medianPnlPerToken) ? 0 : advancedStatsData.medianPnlPerToken,
                        trimmedMeanPnlPerToken: !isFinite(advancedStatsData.trimmedMeanPnlPerToken) ? 0 : advancedStatsData.trimmedMeanPnlPerToken,
                        tokenWinRatePercent: !isFinite(advancedStatsData.tokenWinRatePercent) ? 0 : advancedStatsData.tokenWinRatePercent,
                        standardDeviationPnl: !isFinite(advancedStatsData.standardDeviationPnl) ? 0 : advancedStatsData.standardDeviationPnl,
                        profitConsistencyIndex: !isFinite(advancedStatsData.medianPnlToVolatilityRatio) ? 0 : advancedStatsData.medianPnlToVolatilityRatio,
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

            logger.info(`[PnlAnalysis] Analysis complete for wallet ${walletAddress}. Net PNL: ${summary.netPnl} SOL`);
            return { ...summary, runId: isViewOnlyMode ? undefined : runId };

        } catch (error: any) {
            logger.error(`[PnlAnalysis] Critical error during PNL analysis for ${walletAddress}:`, { error });
            analysisRunStatus = 'FAILED';
            analysisRunErrorMessage = error.message || String(error);
            if (runId) {
                await prisma.analysisRun.update({
                    where: { id: runId },
                    data: { status: analysisRunStatus, errorMessage: analysisRunErrorMessage, durationMs: Date.now() - startTimeMs },
                }).catch(err => logger.error(`[PnlAnalysis] FAILED to update AnalysisRun ${runId} to FAILED status:`, err));
            }
            return null;
        } finally {
            if (runId && (analysisRunStatus === 'IN_PROGRESS' || (analysisRunStatus !== 'COMPLETED' && analysisRunStatus !== 'FAILED'))) {
                 await prisma.analysisRun.update({
                    where: { id: runId },
                    data: { 
                        status: analysisRunStatus === 'IN_PROGRESS' ? 'FAILED' : analysisRunStatus,
                        errorMessage: analysisRunErrorMessage ?? (analysisRunStatus === 'IN_PROGRESS' ? 'Unknown error, service exited prematurely' : null),
                        durationMs: Date.now() - startTimeMs,
                    },
                }).catch(err => logger.error(`[PnlAnalysis] Error in finally block updating AnalysisRun ${runId}:`, err));
            }
        }
    }
}
