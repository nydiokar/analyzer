import { Injectable, NotFoundException } from '@nestjs/common';
import { PnlAnalysisService } from './pnl-analysis.service';
import { SwapAnalysisSummary } from '../../types/helius-api';

// Updated PnlOverviewResponse to include more fields
export class PnlOverviewResponseData {
  dataFrom?: string;
  realizedPnl: number;
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
  constructor(
    private readonly pnlAnalysisService: PnlAnalysisService,
  ) {}

  private formatPnlData(analysisSummary: (SwapAnalysisSummary & { analysisSkipped?: boolean }) | null): PnlOverviewResponseData | null {
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
    
    // Calculate true trade-level winrate by counting individual trades
    let profitableTradesCount = 0;
    let totalIndividualTrades = 0;
    
    analysisSummary.results.forEach(result => {
      if (!result.isValuePreservation) {
        // Count individual trades (transfers)
        const tradesIn = result.transferCountIn || 0;
        const tradesOut = result.transferCountOut || 0;
        const totalTradesForToken = tradesIn + tradesOut;
        
        if (totalTradesForToken > 0) {
          totalIndividualTrades += totalTradesForToken;
          
          // If the token was profitable, all its trades are considered profitable
          // If the token was unprofitable, all its trades are considered unprofitable
          if (result.netSolProfitLoss > 0) {
            profitableTradesCount += totalTradesForToken;
          }
        }
      }
    });
    
    // Use true trade-level winrate if we have individual trade data, otherwise fallback to token-level
    const swapWinRate = totalIndividualTrades > 0 
      ? (profitableTradesCount / totalIndividualTrades) * 100 
      : (totalTrades > 0 ? (profitableTokensCount / totalTrades) * 100 : 0);
    
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
      realizedPnl: realizedPnl,
      swapWinRate: formatAdvancedStat(swapWinRate, 1),
      winLossCount: totalIndividualTrades > 0 
        ? `${profitableTradesCount}/${totalIndividualTrades} trades` 
        : `${profitableTokensCount}/${totalTrades} tokens`,
      avgPLTrade: formatAdvancedStat(avgPLTrade, 2),
      totalVolume: formatAdvancedStat(totalVolume, 2),
      totalSolSpent: formatAdvancedStat(calculatedTotalSolSpent, 2) as number,
      totalSolReceived: formatAdvancedStat(calculatedTotalSolReceived, 2) as number,
      medianPLToken: formatAdvancedStat(advancedStats?.medianPnlPerToken, 2),
      trimmedMeanPnlPerToken: formatAdvancedStat(advancedStats?.trimmedMeanPnlPerToken, 2),
      tokenWinRate: formatAdvancedStat(advancedStats?.tokenWinRatePercent, 1),
      standardDeviationPnl: formatAdvancedStat(advancedStats?.standardDeviationPnl, 2),
      medianPnlToVolatilityRatio: formatAdvancedStat(advancedStats?.medianPnlToVolatilityRatio, 2),
      weightedEfficiencyScore: formatAdvancedStat(advancedStats?.weightedEfficiencyScore, 2),
      averagePnlPerDayActiveApprox: formatAdvancedStat(advancedStats?.averagePnlPerDayActiveApprox, 2),
      profitableTokensCount: profitableTokensCount,
      unprofitableTokensCount: unprofitableTokensCount,
    };
  }

  async getPnlOverview(
    walletAddress: string,
    timeRange?: { startTs?: number; endTs?: number },
  ): Promise<PnlOverviewResponse> {
    // Fetch all-time data - SKIP balance fetch since Account Stats doesn't need current balances
    const allTimeAnalysisSummary = await this.pnlAnalysisService.analyzeWalletPnl(
      walletAddress,
      undefined, // No time range for all-time
      { isViewOnly: true, skipBalanceFetch: true },
    );

    const allTimeData = this.formatPnlData(allTimeAnalysisSummary);
    if (!allTimeData) {
      throw new NotFoundException(`No PNL overview data available for wallet ${walletAddress}. All-time analysis might have failed, yielded no results, or was skipped.`);
    }

    let periodData: PnlOverviewResponseData | null = null;
    if (timeRange && timeRange.startTs && timeRange.endTs) {
      const periodAnalysisSummary = await this.pnlAnalysisService.analyzeWalletPnl(
        walletAddress,
        timeRange,
        { isViewOnly: true, skipBalanceFetch: true },
      );
      periodData = this.formatPnlData(periodAnalysisSummary);
      // If periodData is null (e.g. no transactions in period), it's fine, it will be returned as null.
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
    const analysisSummary = await this.pnlAnalysisService.analyzeWalletPnl(
      walletAddress,
      timeRange,
      { isViewOnly: true, skipBalanceFetch: true },
    );
    return analysisSummary as (SwapAnalysisSummary & { runId?: undefined }) | null;
  }
} 