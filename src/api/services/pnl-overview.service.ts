import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PnlAnalysisService } from './pnl-analysis.service';
import { TokenInfoService } from './token-info.service';
import { DexscreenerService } from './dexscreener.service';
import { BalanceCacheService } from './balance-cache.service';
import { SwapAnalysisSummary } from '../../types/helius-api';
import { getErrorMessage, getErrorDetails } from '../../core/utils/error-utils';
import { prisma } from '../../core/services/database-service';


// Updated PnlOverviewResponse to include more fields
export class PnlOverviewResponseData {
  dataFrom?: string;
  realizedPnl: number;
  unrealizedPnl?: number; // Add unrealized PnL field
  swapWinRate?: number;
  winLossCount?: string; 
  avgPLTrade?: number;
  totalVolume?: number;
  totalSolSpent: number; 
  totalSolReceived: number;

  // Fields from AdvancedTradeStats
  medianPLToken?: number; 
  trimmedMeanPnlPerToken?: number; // New
  tokenWinRate?: number; 
  standardDeviationPnl?: number; // New
  medianPnlToVolatilityRatio?: number; // New
  weightedEfficiencyScore?: number; // New
  averagePnlPerDayActiveApprox?: number; // New
  
  // Token count fields for context
  profitableTokensCount?: number;
  unprofitableTokensCount?: number;
}

export class PnlOverviewResponse {
  periodData: PnlOverviewResponseData | null;
  allTimeData: PnlOverviewResponseData;
}

@Injectable()
export class PnlOverviewService {
  private readonly logger = new Logger(PnlOverviewService.name);

  constructor(
    private readonly pnlAnalysisService: PnlAnalysisService,
    private readonly tokenInfoService: TokenInfoService,
    private readonly dexscreenerService: DexscreenerService,
    private readonly balanceCacheService: BalanceCacheService,
  ) {}

  private async formatPnlData(analysisSummary: (SwapAnalysisSummary & { analysisSkipped?: boolean }) | null): Promise<PnlOverviewResponseData | null> {
    if (!analysisSummary || (analysisSummary.results.length === 0 && !analysisSummary.analysisSkipped)) {
      return null;
    }
    
    if (analysisSummary.analysisSkipped) {
        // Decide how to handle skipped analysis, maybe return a specific marker or null
        return null; 
    }

    const {
      realizedPnl,
      profitableTokensCount,
      unprofitableTokensCount,
      totalVolume,
      overallFirstTimestamp,
      overallLastTimestamp,
      advancedStats,
    } = analysisSummary;

    const totalTrades = profitableTokensCount + unprofitableTokensCount;
    
    // Use unrealized PNL from the analysis summary (calculated by core service)
    const unrealizedPnl = analysisSummary.unrealizedPnl || 0;
    
    const totalIndividualTrades = analysisSummary.totalIndividualTradesCount ?? 0;
    const profitableTradesCount = analysisSummary.profitableTradesCount ?? 0;
    
    // Use true trade-level winrate if we have individual trade data, otherwise fallback to token-level
    const swapWinRate = totalIndividualTrades > 0 
      ? (profitableTradesCount / totalIndividualTrades) * 100 
      : (totalTrades > 0 ? (profitableTokensCount / totalTrades) * 100 : 0);
    
    // Use realized PNL for performance metrics to avoid unrealized PNL volatility
    const avgPLTrade = totalTrades > 0 ? realizedPnl / totalTrades : 0;
    
    let calculatedTotalSolSpent = 0;
    let calculatedTotalSolReceived = 0;
    analysisSummary.results.forEach(res => {
        calculatedTotalSolSpent += res.totalSolSpent;
        calculatedTotalSolReceived += res.totalSolReceived;
    });

    const formatDate = (timestamp: number | undefined): string => {
        if (!timestamp) return 'N/A';
        return new Date(timestamp * 1000).toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    };
    
    const dataFromString = `${formatDate(overallFirstTimestamp)} to ${formatDate(overallLastTimestamp)}`;

    const formatAdvancedStat = (value: number | undefined, decimals: number = 2): number | undefined => {
        return value !== undefined ? parseFloat(value.toFixed(decimals)) : undefined;
    };

    return {
      dataFrom: dataFromString,
      realizedPnl: realizedPnl, // Completed trades only - stable metric
      unrealizedPnl: formatAdvancedStat(unrealizedPnl, 2), // Current holdings value - volatile
      swapWinRate: formatAdvancedStat(swapWinRate, 1), // Based on completed trades only
      winLossCount: totalIndividualTrades > 0 
        ? `${profitableTradesCount}/${totalIndividualTrades} trades` 
        : `${profitableTokensCount}/${totalTrades} tokens`,
      avgPLTrade: formatAdvancedStat(avgPLTrade, 2), // Based on realized PNL only
      totalVolume: formatAdvancedStat(totalVolume, 2),
      totalSolSpent: formatAdvancedStat(calculatedTotalSolSpent, 2) as number,
      totalSolReceived: formatAdvancedStat(calculatedTotalSolReceived, 2) as number,
      medianPLToken: formatAdvancedStat(advancedStats?.medianPnlPerToken, 2), // Based on realized PNL only
      trimmedMeanPnlPerToken: formatAdvancedStat(advancedStats?.trimmedMeanPnlPerToken, 2), // Based on realized PNL only
      tokenWinRate: formatAdvancedStat(advancedStats?.tokenWinRatePercent, 1), // Based on realized PNL only
      standardDeviationPnl: formatAdvancedStat(advancedStats?.standardDeviationPnl, 2), // Based on realized PNL only
      medianPnlToVolatilityRatio: formatAdvancedStat(advancedStats?.medianPnlToVolatilityRatio, 2), // Based on realized PNL only
      weightedEfficiencyScore: formatAdvancedStat(advancedStats?.weightedEfficiencyScore, 2), // Based on realized PNL only
      averagePnlPerDayActiveApprox: formatAdvancedStat(advancedStats?.averagePnlPerDayActiveApprox, 2), // Based on realized PNL only
      profitableTokensCount: profitableTokensCount, // Based on realized PNL only
      unprofitableTokensCount: unprofitableTokensCount, // Based on realized PNL only
    };
  }

  /**
   * DA-9: Aggregate period PnL data from WalletDailyPnl rows.
   * Returns null if no daily rows exist for the period.
   *
   * volumeSol in WalletDailyPnl is Σ(effectiveSolValue) for all swaps (buys + sells combined)
   * and cannot be split into spent vs received. We query SwapAnalysisInput directly for a
   * cheap direction-level groupBy to get the buy/sell SOL split accurately — no FIFO,
   * no Redis lock, just a single aggregate query.
   *
   * Fields not derivable from daily rows (medianPLToken, trimmedMean, advancedStats) are omitted.
   */
  private async getPeriodDataFromDailyRows(
    walletAddress: string,
    startTs: number,
    endTs: number,
  ): Promise<PnlOverviewResponseData | null> {
    // Convert unix timestamps to YYYY-MM-DD UTC strings for WalletDailyPnl date column
    const startDate = new Date(startTs * 1000).toISOString().slice(0, 10);
    const endDate = new Date(endTs * 1000).toISOString().slice(0, 10);

    const [rows, directionGroups] = await Promise.all([
      prisma.walletDailyPnl.findMany({
        where: {
          walletAddress,
          date: { gte: startDate, lte: endDate },
        },
        select: {
          date: true,
          realizedPnlSol: true,
          volumeSol: true,
          feesSol: true,
          tradeCount: true,
          buyCount: true,
          sellCount: true,
          profitableSellsCount: true,
          totalSellsCount: true,
          volumeUsd: true,
          realizedPnlUsd: true,
        },
      }),
      // Cheap direction-level aggregate from SwapAnalysisInput to get buy/sell SOL split.
      // Uses timestamp (unix seconds) bounds derived from the same date range.
      prisma.swapAnalysisInput.groupBy({
        by: ['direction'],
        where: {
          walletAddress,
          timestamp: { gte: startTs, lte: endTs },
        },
        _sum: { associatedSolValue: true },
      }),
    ]);

    if (rows.length === 0) return null;

    const totalRealizedPnl = rows.reduce((s, r) => s + r.realizedPnlSol, 0);
    const totalVolumeSol = rows.reduce((s, r) => s + r.volumeSol, 0);
    const totalSellCount = rows.reduce((s, r) => s + r.sellCount, 0);
    const totalProfitableSells = rows.reduce((s, r) => s + r.profitableSellsCount, 0);
    const totalSells = rows.reduce((s, r) => s + r.totalSellsCount, 0);
    const hasVolumeUsd = rows.some(r => r.volumeUsd !== null);
    const totalVolumeUsd = hasVolumeUsd
      ? rows.reduce((s, r) => s + (r.volumeUsd ?? 0), 0)
      : null;

    // Buy/sell SOL split from SwapAnalysisInput direction groupBy
    const buyGroup = directionGroups.find(g => g.direction === 'in');
    const sellGroup = directionGroups.find(g => g.direction === 'out');
    const totalSolSpent = Math.abs(buyGroup?._sum?.associatedSolValue ?? 0);
    const totalSolReceived = Math.abs(sellGroup?._sum?.associatedSolValue ?? 0);

    // Sell-event win rate (sell-event basis, not token win rate)
    const swapWinRate = totalSells > 0 ? (totalProfitableSells / totalSells) * 100 : 0;
    const avgPLTrade = totalSellCount > 0 ? totalRealizedPnl / totalSellCount : 0;

    const minDate = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date);
    const maxDate = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);

    return {
      dataFrom: `${minDate} to ${maxDate} UTC`,
      realizedPnl: totalRealizedPnl,
      unrealizedPnl: undefined, // point-in-time — not available for past periods
      swapWinRate,
      winLossCount: `${totalProfitableSells}/${totalSells} sells`,
      avgPLTrade,
      totalVolume: totalVolumeSol,
      totalSolSpent,
      totalSolReceived,
      // Advanced stats require sorted distributions across tokens — not derivable from daily row aggregates
      medianPLToken: undefined,
      trimmedMeanPnlPerToken: undefined,
      tokenWinRate: swapWinRate, // closest equivalent available from daily rows
      standardDeviationPnl: undefined,
      medianPnlToVolatilityRatio: undefined,
      weightedEfficiencyScore: undefined,
      averagePnlPerDayActiveApprox: undefined,
      profitableTokensCount: undefined,
      unprofitableTokensCount: undefined,
    };
  }

  async getPnlOverview(
    walletAddress: string,
    timeRange?: { startTs?: number; endTs?: number },
  ): Promise<PnlOverviewResponse> {
    // Fetch SOL price for unrealized PNL calculation (cached in Redis with 30s TTL)
    let solPriceUsd = 0;
    try {
      solPriceUsd = await this.tokenInfoService.getSolPrice();
      // this.logger.log(`[PnlOverview] Fetched SOL price: $${solPriceUsd}`);
    } catch (error) {
      this.logger.warn(`[PnlOverview] Failed to fetch SOL price: ${getErrorMessage(error)}. Unrealized PNL calculation will be skipped.`);
    }

    // 🔥 FRESH BALANCES: Fetch current balances using BalanceCacheService
    // This uses Redis cache (30s) + incremental fetch + persistent watermarks
    // Result: Fresh data (<30s old) without RPC explosion
    const freshBalance = await this.balanceCacheService.getBalances(walletAddress);
    const preFetchedBalances = freshBalance ? new Map([[walletAddress, freshBalance]]) : undefined;

    // Fetch all-time data with fresh balances for accurate unrealized PNL
    const allTimeAnalysisSummary = await this.pnlAnalysisService.analyzeWalletPnl(
      walletAddress,
      undefined, // No time range for all-time
      { isViewOnly: true, skipBalanceFetch: false, preFetchedBalances, solPriceUsd },
    );

    const allTimeData = await this.formatPnlData(allTimeAnalysisSummary);
    if (!allTimeData) {
      throw new NotFoundException(`No PNL overview data available for wallet ${walletAddress}. All-time analysis might have failed, yielded no results, or was skipped.`);
    }

    // DA-9: serve period data from WalletDailyPnl rows — fast, no Redis lock, no raw-swap recompute.
    let periodData: PnlOverviewResponseData | null = null;
    if (timeRange && timeRange.startTs && timeRange.endTs) {
      periodData = await this.getPeriodDataFromDailyRows(walletAddress, timeRange.startTs, timeRange.endTs);
    }

    return {
      allTimeData,
      periodData,
    };
  }
  
  /**
   * Fetches PNL analysis summary for a wallet, optionally for a specific time range, in a view-only mode.
   * This method is intended for API endpoints that display summary data and should not create AnalysisRun records.
   * @param walletAddress The wallet address.
   * @param timeRange Optional start and end timestamps (in seconds).
   * @returns A promise resolving to SwapAnalysisSummary or a relevant subset, or null.
   */
  async getPnlAnalysisForSummary(
    walletAddress: string,
    timeRange?: { startTs?: number; endTs?: number },
  ): Promise<(SwapAnalysisSummary & { runId?: undefined }) | null> { 
    // Fetch SOL price for unrealized PNL calculation (cached in Redis with 30s TTL)
    let solPriceUsd: number | undefined;
    try {
      solPriceUsd = await this.tokenInfoService.getSolPrice();
      // this.logger.log(`[PnlAnalysisForSummary] Fetched SOL price: $${solPriceUsd}`);
    } catch (error) {
      // this.logger.warn(`[PnlAnalysisForSummary] Failed to fetch SOL price: ${getErrorMessage(error)}. Unrealized PNL calculation will be skipped.`);
    }

    const analysisSummary = await this.pnlAnalysisService.analyzeWalletPnl(
      walletAddress,
      timeRange,
      { isViewOnly: true, skipBalanceFetch: true, solPriceUsd },
    );
    return analysisSummary as (SwapAnalysisSummary & { runId?: undefined }) | null;
  }
} 
