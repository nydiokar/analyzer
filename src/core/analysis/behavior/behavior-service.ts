import { BehaviorAnalyzer } from 'core/analysis/behavior/analyzer';
import { DatabaseService, WalletBehaviorProfileUpsertData } from 'core/services/database-service'; // Assuming export will be fixed
import { BehaviorAnalysisConfig } from '@/types/analysis';
import { BehavioralMetrics, ActiveTradingPeriods } from '@/types/behavior';
import { createLogger } from 'core/utils/logger';
import { Prisma } from '@prisma/client'; // Import Prisma

const logger = createLogger('BehaviorService');

export class BehaviorService {
  private behaviorAnalyzer: BehaviorAnalyzer;

  constructor(
    private databaseService: DatabaseService,
    private config: BehaviorAnalysisConfig
  ) {
    this.behaviorAnalyzer = new BehaviorAnalyzer(config); // Pass specific config
    logger.debug('BehaviorService instantiated');
  }

  /**
   * Analyzes the trading behavior for a given wallet address.
   * Fetches data, performs calculations using BehaviorAnalyzer, and returns metrics.
   * 
   * @param walletAddress - The Solana wallet address to analyze.
   * @param timeRange - Optional time range to limit the analysis (unix timestamps).
   * @returns Promise resolving to BehavioralMetrics or null if no data.
   */
  async analyzeWalletBehavior(
    walletAddress: string,
    timeRange?: { startTs?: number; endTs?: number }
  ): Promise<BehavioralMetrics | null> {
    logger.debug(`Analyzing trading behavior for wallet ${walletAddress}`);

    try {
      // Fetch swap records using the injected DatabaseService
      const swapRecords = await this.databaseService.getSwapAnalysisInputs(walletAddress, timeRange);

      if (!swapRecords || swapRecords.length === 0) {
        logger.warn(`No swap records found for wallet ${walletAddress} within the specified time range.`);
        // Optionally, delete existing profile if no data? Or leave stale? For now, leave.
        return null; 
      }

      // Use the injected BehaviorAnalyzer for calculations
      // Pass both swap records AND wallet address (needed for historicalPattern calculation)
      const metrics = this.behaviorAnalyzer.analyze(swapRecords, walletAddress); 

      if (metrics) {
        // Destructure metrics to prepare for DB save
        const {
          // Core flipper metrics
          buySellRatio,
          buySellSymmetry,
          averageFlipDurationHours,
          medianHoldTime,
          sequenceConsistency,
          flipperScore,
          // Supporting metrics
          uniqueTokensTraded,
          tokensWithBothBuyAndSell,
          totalTradeCount,
          totalBuyCount,
          totalSellCount,
          completePairsCount,
          averageTradesPerToken,
          // Time distribution
          tradingTimeDistribution,
          // Additional time metrics
          percentTradesUnder1Hour,
          percentTradesUnder4Hours,
          // Classification
          tradingStyle,
          confidenceScore,
          // New/Refined metrics from plan
          tradingFrequency,
          tokenPreferences,
          riskMetrics,
          reentryRate,
          percentageOfUnpairedTokens,
          sessionCount,
          avgTradesPerSession,
          activeTradingPeriods, // This is a JSON object
          averageSessionStartHour,
          averageSessionDurationMinutes,
          firstTransactionTimestamp,
          lastTransactionTimestamp,
        } = metrics;

        // Only save the profile if NO specific timeRange was provided for this analysis run.
        // This means we are doing a full analysis, not a view of a specific period.
        if (!timeRange) {
          const profileDataToSave: WalletBehaviorProfileUpsertData = {
            walletAddress,
            buySellRatio,
            buySellSymmetry,
            averageFlipDurationHours,
            medianHoldTime,
            sequenceConsistency,
            flipperScore,
            uniqueTokensTraded,
            tokensWithBothBuyAndSell,
            totalTradeCount,
            totalBuyCount,
            totalSellCount,
            completePairsCount,
            averageTradesPerToken,
            tradingTimeDistribution: tradingTimeDistribution as unknown as Prisma.InputJsonValue,
            percentTradesUnder1Hour,
            percentTradesUnder4Hours,
            tradingStyle,
            confidenceScore,
            tradingFrequency: tradingFrequency as unknown as Prisma.InputJsonValue,
            tokenPreferences: tokenPreferences as unknown as Prisma.InputJsonValue,
            riskMetrics: riskMetrics as unknown as Prisma.InputJsonValue,
            reentryRate,
            percentageOfUnpairedTokens,
            sessionCount,
            avgTradesPerSession,
            activeTradingPeriods: activeTradingPeriods as unknown as Prisma.InputJsonValue,
            averageSessionStartHour,
            averageSessionDurationMinutes,
            firstTransactionTimestamp,
            lastTransactionTimestamp,
          };
          
          // Use the new DatabaseService method
          const savedProfile = await this.databaseService.upsertWalletBehaviorProfile(profileDataToSave);
          if (!savedProfile) {
            logger.error(`Failed to upsert WalletBehaviorProfile for ${walletAddress}`);
            // Decide if this should be a critical error that stops the process or just a warning
          }
          // ✅ REMOVED: Success logging to reduce spam - only log failures
        } else {
          logger.info(`Skipping WalletBehaviorProfile upsert for ${walletAddress} because a specific timeRange was provided.`);
        }
      }

      logger.info(`Completed behavior analysis for ${walletAddress}`);
      return metrics;

    } catch (error) {
      logger.error(`Error analyzing behavior for wallet ${walletAddress}:`, { error });
      // Decide on error handling: re-throw, return null, return empty metrics?
      // Returning null is consistent with the "no data" case.
      return null;
    }
  }
} 