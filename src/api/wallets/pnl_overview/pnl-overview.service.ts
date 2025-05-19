import { Injectable, NotFoundException } from '@nestjs/common';
import { PnlAnalysisService } from '../../../core/services/pnl-analysis-service';
import { SwapAnalysisSummary, AdvancedTradeStats } from '../../../types/helius-api'; // Added AdvancedTradeStats

// Updated PnlOverviewResponse to include more fields
export class PnlOverviewResponse {
  dataFrom?: string; 
  realizedPnl: number;
  winRate?: number; 
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
  profitConsistencyIndex?: number; // New
  weightedEfficiencyScore?: number; // New
  averagePnlPerDayActiveApprox?: number; // New
}

@Injectable()
export class PnlOverviewService {
  constructor(
    private readonly pnlAnalysisService: PnlAnalysisService,
  ) {}

  async getPnlOverview(walletAddress: string): Promise<PnlOverviewResponse> {
    const analysisSummary: (SwapAnalysisSummary & { runId?: number | undefined; analysisSkipped?: boolean | undefined; }) | null = 
        await this.pnlAnalysisService.analyzeWalletPnl(walletAddress);

    if (!analysisSummary || (analysisSummary.results.length === 0 && !analysisSummary.analysisSkipped)) {
      throw new NotFoundException(`No PNL overview data available for wallet ${walletAddress}. Analysis might have failed or yielded no results.`);
    }
    
    if (analysisSummary.analysisSkipped) {
        throw new NotFoundException(`PNL analysis for ${walletAddress} was skipped (e.g., no new transactions).`);
    }

    const {
      realizedPnl,
      profitableSwaps,
      unprofitableSwaps,
      totalVolume,
      overallFirstTimestamp,
      overallLastTimestamp,
      advancedStats, // This is of type AdvancedTradeStats | undefined
    } = analysisSummary;

    const totalTrades = profitableSwaps + unprofitableSwaps;
    const winRate = totalTrades > 0 ? (profitableSwaps / totalTrades) * 100 : 0;
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

    // Helper to parse float and fix decimals, returning undefined if input is undefined
    const formatAdvancedStat = (value: number | undefined, decimals: number = 2): number | undefined => {
        return value !== undefined ? parseFloat(value.toFixed(decimals)) : undefined;
    };

    return {
      dataFrom: dataFromString,
      realizedPnl: realizedPnl,
      winRate: formatAdvancedStat(winRate, 1),
      winLossCount: `${profitableSwaps}/${totalTrades} wins`,
      avgPLTrade: formatAdvancedStat(avgPLTrade, 2),
      totalVolume: formatAdvancedStat(totalVolume, 2),
      totalSolSpent: formatAdvancedStat(calculatedTotalSolSpent, 2) as number, // Cast as non-undefined as it's always calculated
      totalSolReceived: formatAdvancedStat(calculatedTotalSolReceived, 2) as number, // Cast as non-undefined

      // Populate from advancedStats
      medianPLToken: formatAdvancedStat(advancedStats?.medianPnlPerToken, 2),
      trimmedMeanPnlPerToken: formatAdvancedStat(advancedStats?.trimmedMeanPnlPerToken, 2),
      tokenWinRate: formatAdvancedStat(advancedStats?.tokenWinRatePercent, 1),
      standardDeviationPnl: formatAdvancedStat(advancedStats?.standardDeviationPnl, 2),
      profitConsistencyIndex: formatAdvancedStat(advancedStats?.profitConsistencyIndex, 2),
      weightedEfficiencyScore: formatAdvancedStat(advancedStats?.weightedEfficiencyScore, 2),
      averagePnlPerDayActiveApprox: formatAdvancedStat(advancedStats?.averagePnlPerDayActiveApprox, 2),
    };
  }
} 