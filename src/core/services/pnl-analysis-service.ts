import { createLogger } from 'core/utils/logger';
import { DatabaseService, prisma } from 'core/services/database-service';
import { SwapAnalyzer } from 'core/analysis/swap/analyzer';
import { AdvancedStatsAnalyzer } from 'core/analysis/stats/analyzer';
import { OnChainAnalysisResult, SwapAnalysisSummary, AdvancedTradeStats as PrismaAdvancedTradeStats } from '@/types/helius-api';
import { SwapAnalysisInput, Wallet, AnalysisRun } from '@prisma/client';
import { HeliusApiClient } from './helius-api-client';
import { WalletBalanceService } from './wallet-balance-service';
import { WalletBalance } from '@/types/wallet';
import { Injectable } from '@nestjs/common';
import { TokenInfoService } from '../../api/services/token-info.service';

const logger = createLogger('PnlAnalysisService');

/**
 * Service responsible for performing Profit and Loss (P&L) analysis for wallets.
 * It coordinates fetching transaction data, running swap analysis, calculating advanced statistics,
 * and saving the results to the database. It can also fetch and include current wallet balances.
 */
@Injectable()
export class PnlAnalysisService {
    private swapAnalyzer: SwapAnalyzer;
    private advancedStatsAnalyzer: AdvancedStatsAnalyzer;
    private walletBalanceService: WalletBalanceService | null;
    private heliusApiClient: HeliusApiClient | null;
    private tokenInfoService: TokenInfoService | null;

    /**
     * Constructs an instance of the PnlAnalysisService.
     *
     * @param databaseService Instance of DatabaseService for database interactions.
     * @param heliusApiClient Optional instance of HeliusApiClient. If provided, WalletBalanceService will be activated for fetching live wallet balances.
     * @param tokenInfoService Optional instance of TokenInfoService. If provided, token info enrichment will be activated.
     */
    constructor(
        private databaseService: DatabaseService,
        heliusApiClient: HeliusApiClient | null,
        tokenInfoService: TokenInfoService | null,
    ) {
        this.swapAnalyzer = new SwapAnalyzer();
        this.advancedStatsAnalyzer = new AdvancedStatsAnalyzer();
        this.heliusApiClient = heliusApiClient;
        this.tokenInfoService = tokenInfoService;

        // Note: In a proper NestJS setup, WalletBalanceService would be injected via constructor
        // For now, we'll keep the manual instantiation for the core service
        if (this.heliusApiClient) {
            this.walletBalanceService = new WalletBalanceService(this.heliusApiClient, this.databaseService, this.tokenInfoService);
            logger.info('PnlAnalysisService instantiated with HeliusApiClient and TokenInfoService. WalletBalanceService active.');
        } else {
            this.walletBalanceService = null;
            logger.info('PnlAnalysisService instantiated without HeliusApiClient. WalletBalanceService inactive.');
        }
    }

    /**
     * Performs P/L and advanced stats analysis for a given wallet, optionally within a time range.
     *
     * @param walletAddress The wallet address to analyze.
     * @param timeRange Optional object with `startTs` and/or `endTs` (Unix timestamps in seconds) to filter SwapAnalysisInput records for the analysis.
     * @param options Optional configuration for the analysis:
     *                - `isViewOnly`: If true, results are not saved to the database (e.g., for historical views without altering records).
     *                - `preFetchedBalances`: Optional pre-fetched wallet balances to avoid redundant API calls.
     * @returns A promise resolving to an enriched `SwapAnalysisSummary` object, or null if a critical error occurs
     *          or if no relevant swap input data is found. The summary includes P&L metrics, advanced stats,
     *          and potentially the `runId` of the analysis if not in view-only mode. It may also include
     *          `currentSolBalance` and `balancesFetchedAt` if live balance fetching is successful.
     */
    async analyzeWalletPnl(
        walletAddress: string,
        timeRange?: { startTs?: number; endTs?: number },
        options?: { isViewOnly?: boolean, preFetchedBalances?: Map<string, WalletBalance>, skipBalanceFetch?: boolean, solPriceUsd?: number }
    ): Promise<(SwapAnalysisSummary & { runId?: number, analysisSkipped?: boolean, currentSolBalance?: number, balancesFetchedAt?: Date }) | null> {
        logger.debug(`[PnlAnalysis] Starting analysis for wallet ${walletAddress}`, { timeRange, options });

        let runId: number | undefined = undefined;
        let analysisRunStatus: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' = 'IN_PROGRESS';
        let analysisRunErrorMessage: string | null = null;

        const isHistoricalView = !!timeRange;
        const isViewOnlyMode = !!options?.isViewOnly;
        const shouldSkipBalanceFetch = !!options?.skipBalanceFetch;

        let startTimeMs: number = 0;

        // Fetch current wallet state (SOL & Token Balances) - SKIP if requested
        let currentWalletBalance: WalletBalance | undefined;
        let balancesFetchedAt: Date | undefined;

        if (shouldSkipBalanceFetch) {
            logger.debug(`[PnlAnalysis] Skipping balance fetch for ${walletAddress} (skipBalanceFetch=true)`);
            // Retrieve stored balance data from database instead of fetching fresh balances
            try {
                const storedAnalysisResults = await this.databaseService.getAnalysisResults({
                    where: { walletAddress }
                });
                
                if (storedAnalysisResults.length > 0) {
                    // Create a WalletBalance object from stored data
                    const tokenBalances = storedAnalysisResults
                        .filter(result => result.currentUiBalance && result.currentUiBalance > 0)
                        .map(result => ({
                            mint: result.tokenAddress,
                            tokenAccountAddress: result.tokenAddress, // Use token address as fallback since we don't store token account address
                            balance: result.currentRawBalance || '0',
                            uiBalance: result.currentUiBalance || 0,
                            uiBalanceString: result.currentUiBalanceString || '0',
                            decimals: result.balanceDecimals || 0,
                        }));
                    
                    // Get SOL balance from WalletPnlSummary if available
                    const pnlSummary = await this.databaseService.getWalletPnlSummaryWithRelations(walletAddress);
                    const solBalance = pnlSummary?.currentSolBalance || 0;
                    const balancesFetchedAt = pnlSummary?.solBalanceFetchedAt || 
                        (storedAnalysisResults[0]?.balanceFetchedAt || new Date());
                    
                    currentWalletBalance = {
                        solBalance,
                        tokenBalances,
                        fetchedAt: balancesFetchedAt,
                    };
                    
                    logger.info(`[PnlAnalysis] Retrieved stored balance data for ${walletAddress}. SOL: ${solBalance}, Tokens: ${tokenBalances.length}`);
                } else {
                    logger.debug(`[PnlAnalysis] No stored balance data found for ${walletAddress}`);
                }
            } catch (error) {
                logger.warn(`[PnlAnalysis] Failed to retrieve stored balance data for ${walletAddress}: ${error}`);
            }
        } else {
            // Use pre-fetched balances if provided, otherwise fetch them
            if (options?.preFetchedBalances) {
                currentWalletBalance = options.preFetchedBalances.get(walletAddress);
                if (currentWalletBalance) {
                    balancesFetchedAt = currentWalletBalance.fetchedAt;
                    logger.info(`[PnlAnalysis] Using pre-fetched wallet state for ${walletAddress}. SOL: ${currentWalletBalance.solBalance}, FetchedAt: ${balancesFetchedAt}`);
                }
            } else if (this.walletBalanceService) {
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
                logger.debug(`[PnlAnalysis] WalletBalanceService is not active (no HeliusApiClient provided). Skipping live balance fetch for ${walletAddress}.`);
            }
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

            // This is the primary analysis call
            const { results: swapAnalysisResultsFromAnalyzer, processedSignaturesCount, stablecoinNetFlow } = this.swapAnalyzer.analyze(swapInputs, walletAddress);
            logger.debug(`[PnlAnalysis] SwapAnalyzer finished for ${walletAddress}. Got ${swapAnalysisResultsFromAnalyzer.length} token results.`);
            
            // Attach wallet balances to the results if available.
            const enrichedSwapAnalysisResults = swapAnalysisResultsFromAnalyzer.map(result => {
                const tokenBalance = currentWalletBalance?.tokenBalances.find(b => b.mint === result.tokenAddress);
                return {
                    ...result,
                    currentRawBalance: tokenBalance?.balance,
                    currentUiBalance: tokenBalance?.uiBalance,
                    currentUiBalanceString: tokenBalance?.uiBalanceString,
                    balanceDecimals: tokenBalance?.decimals,
                    balanceFetchedAt: tokenBalance ? balancesFetchedAt : undefined,
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
            
            // Calculate unrealized PNL for current holdings using stored balance data
            if (currentWalletBalance && currentWalletBalance.tokenBalances.length > 0) {
                try {
                    // Get token info for price data
                    const tokenAddresses = currentWalletBalance.tokenBalances.map(tb => tb.mint);
                    const tokenInfoList = this.tokenInfoService ? await this.tokenInfoService.findMany(tokenAddresses) : [];
                    const tokenInfoMap = new Map<string, any>();
                    for (const info of tokenInfoList) {
                        tokenInfoMap.set(info.tokenAddress, info);
                    }
                    
                    // Get SOL price for USD conversion
                    let estimatedSolPriceUsd = options?.solPriceUsd || 0;
                    if (estimatedSolPriceUsd <= 0) {
                        logger.warn(`[PnlAnalysis] Cannot calculate unrealized PNL without proper SOL price. Skipping unrealized PNL calculation.`);
                    } else {
                        logger.debug(`[PnlAnalysis] Using SOL price: $${estimatedSolPriceUsd} for unrealized PNL calculation`);
                    }
                    
                    // Only calculate unrealized PNL if we have proper SOL price
                    if (estimatedSolPriceUsd > 0) {
                        for (const tokenBalance of currentWalletBalance.tokenBalances) {
                            const currentUiBalance = tokenBalance.uiBalance || 0;
                            if (currentUiBalance > 0) {
                                const tokenInfo = tokenInfoMap.get(tokenBalance.mint);
                                const priceUsd = tokenInfo?.priceUsd ? parseFloat(tokenInfo.priceUsd) : null;
                                
                                if (priceUsd && priceUsd > 0) {
                                    // Calculate current value in SOL (USD / SOL_price)
                                    const currentHoldingsValueUsd = currentUiBalance * priceUsd;
                                    const currentHoldingsValueSol = currentHoldingsValueUsd / estimatedSolPriceUsd;
                                    
                                    // Find the corresponding analysis result for cost basis
                                    const analysisResult = enrichedSwapAnalysisResults.find(r => r.tokenAddress === tokenBalance.mint);
                                    if (analysisResult) {
                                        const totalSolSpent = analysisResult.totalSolSpent || 0;
                                        const totalAmountIn = analysisResult.totalAmountIn || 0;
                                        const avgCostPerToken = totalAmountIn > 0 ? totalSolSpent / totalAmountIn : 0;
                                        const costBasisForCurrentHoldings = currentUiBalance * avgCostPerToken;
                                        
                                        // Unrealized P&L: Current value vs cost basis of remaining holdings (both in SOL)
                                        const unrealizedPnlSol = currentHoldingsValueSol - costBasisForCurrentHoldings;
                                        unrealizedPnl += unrealizedPnlSol;
                                        
                                        logger.debug(`[PnlAnalysis] Token ${tokenBalance.mint}: Holdings=${currentUiBalance}, Price=${priceUsd}, Value=${currentHoldingsValueSol} SOL, Cost=${costBasisForCurrentHoldings} SOL, Unrealized=${unrealizedPnlSol} SOL`);
                                    }
                                }
                            }
                        }
                    } else {
                        logger.warn(`[PnlAnalysis] Skipping unrealized PNL calculation due to missing SOL price data`);
                    }
                    
                    logger.debug(`[PnlAnalysis] Calculated unrealized PNL for ${walletAddress}: ${unrealizedPnl} SOL`);
                } catch (error) {
                    logger.warn(`[PnlAnalysis] Failed to calculate unrealized PNL for ${walletAddress}: ${error}`);
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
                unrealizedPnl: unrealizedPnl, // Use calculated unrealized PNL
                netPnl: finalNetPnl, // Use calculated net PNL (realized + unrealized)
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
                const pnlSummaryDataForDb: any = {
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
                    updatedAt: new Date(),
                };

                if (currentWalletBalance) {
                    pnlSummaryDataForDb.currentSolBalance = currentWalletBalance.solBalance;
                    pnlSummaryDataForDb.solBalanceFetchedAt = balancesFetchedAt;
                }

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
                } else {
                    await prisma.walletPnlSummary.upsert({
                        where: { walletAddress: walletAddress },
                        create: pnlSummaryDataForDb,
                        update: pnlSummaryDataForDb,
                    });
                    logger.info(`[PnlAnalysis] Upserted WalletPnlSummary (no advanced stats) for ${walletAddress}.`);
                }
                
                // Update the analyzed timestamp range for the wallet
                const nowInSeconds = Math.floor(Date.now() / 1000);
                const startTs = summary.overallFirstTimestamp !== undefined && summary.overallFirstTimestamp !== 0 ? summary.overallFirstTimestamp : nowInSeconds;
                const endTs = nowInSeconds; // Always use current time for when analysis was completed

                    
                    await prisma.wallet.update({
                        where: { address: walletAddress },
                        data: {
                            analyzedTimestampStart: startTs,
                            analyzedTimestampEnd: endTs,
                            lastSuccessfulFetchTimestamp: new Date(),
                        },
                        select: { address: true, analyzedTimestampEnd: true, lastSuccessfulFetchTimestamp: true }
                    });
                                    

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

                // Use the optimized batch upsert method for better performance
                await this.databaseService.batchUpsertAnalysisResults(resultsToUpsert);
                logger.debug(`[PnlAnalysis] Batch upserted ${resultsToUpsert.length} AnalysisResult records for ${walletAddress}.`);

                // DEACTIVATED: The enrichment process is now triggered from the frontend to decouple it from the main analysis pipeline.
                // if (this.tokenInfoService) {
                //     const tokenAddresses = resultsToUpsert.map(r => r.tokenAddress);
                //     logger.info(`[PnlAnalysis] Triggering background token info enrichment for ${tokenAddresses.length} tokens.`);
                //     this.tokenInfoService.triggerTokenInfoEnrichment(tokenAddresses);
                // }
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

            // Add meaningful summary log
            const timeRangeStr = timeRange ? ` (${timeRange.startTs ? new Date(timeRange.startTs * 1000).toISOString().split('T')[0] : 'start'} to ${timeRange.endTs ? new Date(timeRange.endTs * 1000).toISOString().split('T')[0] : 'end'})` : '';
            logger.info(`[PnlAnalysis] Analysis completed for ${walletAddress}${timeRangeStr}: ${swapInputs.length} transactions → ${summary.results.length} tokens, Net PNL: ${summary.netPnl.toFixed(4)} SOL`);

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
