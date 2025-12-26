import { BehaviorAnalyzer } from 'core/analysis/behavior/analyzer';
import { DatabaseService, WalletBehaviorProfileUpsertData } from 'core/services/database-service'; // Assuming export will be fixed
import { BehaviorAnalysisConfig } from '@/types/analysis';
import { BehavioralMetrics, ActiveTradingPeriods } from '@/types/behavior';
import { createLogger } from 'core/utils/logger';
import { Prisma, SwapAnalysisInput } from '@prisma/client'; // Import Prisma

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
   * @param pnlMap - Optional map of token PnL from AnalysisResult (source of truth).
   * @returns Promise resolving to BehavioralMetrics or null if no data.
   */
  async analyzeWalletBehavior(
    walletAddress: string,
    timeRange?: { startTs?: number; endTs?: number },
    pnlMap?: Map<string, { pnl: number; capital: number }>
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

      // Determine which dataset should power the historical pattern calculation.
      let historicalSwapRecords: SwapAnalysisInput[] | undefined = undefined;
      if (timeRange) {
        logger.debug(`Fetching full history for ${walletAddress} to calculate historical pattern independently of the requested range.`);
        historicalSwapRecords = await this.databaseService.getSwapAnalysisInputs(walletAddress);
      } else {
        historicalSwapRecords = swapRecords;
      }

      // Use the injected BehaviorAnalyzer for calculations, ensuring historical metrics use the full data set
      const metrics = this.behaviorAnalyzer.analyze(
        swapRecords,
        walletAddress,
        historicalSwapRecords,
        pnlMap,
      ); 

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
          tokensWithOnlyBuys, // NEW: For holder bypass
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
          speedCategory, // NEW: Explicit speed classification
          flowPattern, // NEW: Buy/sell flow pattern
          strategyType, // NEW: Canonical strategy type
          velocityScore, // NEW: 0-100 velocity score
          medianActiveHoldingHours, // NEW: For holder bypass
          // NEW: Storytelling metrics (2025-12-26)
          percentOfValueInCurrentHoldings,
          medianCurrentHoldingDurationHours,
          averageCurrentHoldingDurationHours,
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
          historicalPattern, // Need exitPattern from this
        } = metrics;

        // Only save the profile if NO specific timeRange was provided for this analysis run.
        // This means we are doing a full analysis, not a view of a specific period.
        if (!timeRange) {
          // Sanitize numeric data to prevent Prisma validation errors
          const sanitizeNumber = (value: number): number => {
            if (isNaN(value) || !isFinite(value)) {
              return 0; // Default to 0 for invalid numbers
            }
            return value;
          };

          const profileDataToSave: WalletBehaviorProfileUpsertData = {
            walletAddress,
            buySellRatio: sanitizeNumber(buySellRatio),
            buySellSymmetry: sanitizeNumber(buySellSymmetry),
            averageFlipDurationHours: sanitizeNumber(averageFlipDurationHours),
            medianHoldTime: sanitizeNumber(medianHoldTime), // DEPRECATED: trade-level median
            medianCompletedHoldTimeHours: historicalPattern?.medianCompletedHoldTimeHours ?? null, // Token-level median (used for speedCategory)
            sequenceConsistency: sanitizeNumber(sequenceConsistency),
            flipperScore: sanitizeNumber(flipperScore),
            velocityScore: velocityScore ?? null, // NEW: Store velocity score
            uniqueTokensTraded,
            tokensWithBothBuyAndSell,
            tokensWithOnlyBuys: tokensWithOnlyBuys ?? 0, // NEW: For holder bypass
            totalTradeCount,
            totalBuyCount,
            totalSellCount,
            completePairsCount,
            averageTradesPerToken: sanitizeNumber(averageTradesPerToken),
            tradingTimeDistribution: tradingTimeDistribution as unknown as Prisma.InputJsonValue,
            holdTimeTokenMap: (metrics.historicalPattern?.holdTimeTokenMap || null) as unknown as Prisma.InputJsonValue,
            enrichedHoldTimeDistribution: (metrics.historicalPattern?.enrichedHoldTimeDistribution || null) as unknown as Prisma.InputJsonValue,
            percentTradesUnder1Hour: sanitizeNumber(percentTradesUnder1Hour),
            percentTradesUnder4Hours: sanitizeNumber(percentTradesUnder4Hours),
            tradingStyle,
            speedCategory: speedCategory ?? null, // NEW: Explicit speed classification
            flowPattern: flowPattern ?? null, // NEW: Buy/sell flow pattern
            strategyType: strategyType ?? null, // NEW: Canonical strategy type
            medianActiveHoldingHours: medianActiveHoldingHours ?? null, // NEW: For holder bypass
            // NEW: Storytelling metrics for discover page (2025-12-26)
            exitPattern: historicalPattern?.exitPattern ?? null,
            percentOfValueInCurrentHoldings: sanitizeNumber(percentOfValueInCurrentHoldings ?? 0),
            medianCurrentHoldingDurationHours: sanitizeNumber(medianCurrentHoldingDurationHours ?? 0),
            averageCurrentHoldingDurationHours: sanitizeNumber(averageCurrentHoldingDurationHours ?? 0),
            confidenceScore: sanitizeNumber(confidenceScore),
            tradingFrequency: tradingFrequency as unknown as Prisma.InputJsonValue,
            tokenPreferences: tokenPreferences as unknown as Prisma.InputJsonValue,
            riskMetrics: riskMetrics as unknown as Prisma.InputJsonValue,
            reentryRate: sanitizeNumber(reentryRate),
            percentageOfUnpairedTokens: sanitizeNumber(percentageOfUnpairedTokens),
            sessionCount,
            avgTradesPerSession: sanitizeNumber(avgTradesPerSession),
            activeTradingPeriods: activeTradingPeriods as unknown as Prisma.InputJsonValue,
            averageSessionStartHour: sanitizeNumber(averageSessionStartHour),
            averageSessionDurationMinutes: sanitizeNumber(averageSessionDurationMinutes),
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
