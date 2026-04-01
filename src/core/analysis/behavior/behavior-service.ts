import { BehaviorAnalyzer } from 'core/analysis/behavior/analyzer';
import { DatabaseService, WalletBehaviorProfileUpsertData, prisma } from 'core/services/database-service'; // Assuming export will be fixed
import { BehaviorAnalysisConfig } from '@/types/analysis';
import { BehavioralMetrics, ActiveTradingPeriods } from '@/types/behavior';
import { createLogger } from 'core/utils/logger';
import { Prisma, SwapAnalysisInput } from '@prisma/client'; // Import Prisma
import { classifyMcap } from 'core/services/market-context-standalone';
import { DEFAULT_EXCLUDED_MINTS } from 'config/constants';

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
          activeTradingDays,
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

          // Compute wallet-wide mcap profile from enriched buy rows
          const walletBuyRows = await prisma.swapAnalysisInput.findMany({
            where: {
              walletAddress,
              direction: 'in',
              mcapBucket: { not: null },
              usdValue: { not: null },
              marketCapUsd: { not: null },
              mint: { notIn: DEFAULT_EXCLUDED_MINTS },
            },
            select: { mint: true, mcapBucket: true, marketCapUsd: true, usdValue: true },
          });

          let preferredMcapBucket: string | null = null;
          let avgEntryMcap: number | null = null;
          let mcapDistribution: Prisma.InputJsonValue | null = null;
          let mcapBucketPnl: Prisma.InputJsonValue | null = null;

          if (walletBuyRows.length >= 3) {
            let totalUsd = 0;
            let sumMcapWeighted = 0;
            const bucketVolume = new Map<string, number>();

            for (const row of walletBuyRows) {
              totalUsd += row.usdValue!;
              sumMcapWeighted += row.marketCapUsd! * row.usdValue!;
              bucketVolume.set(row.mcapBucket!, (bucketVolume.get(row.mcapBucket!) ?? 0) + row.usdValue!);
            }

            if (totalUsd > 0) {
              avgEntryMcap = sumMcapWeighted / totalUsd;

              const dist: Record<string, number> = {};
              for (const [bucket, vol] of bucketVolume) {
                dist[bucket] = Math.round((vol / totalUsd) * 1000) / 1000;
              }
              mcapDistribution = dist;

              let maxVol = 0;
              for (const [bucket, vol] of bucketVolume) {
                if (vol > maxVol) { maxVol = vol; preferredMcapBucket = bucket; }
              }
            }

            // per-bucket PnL: join dominant buy bucket per mint with AnalysisResult
            const mintToBucket = new Map<string, string>();
            const mintBucketVolume = new Map<string, Map<string, number>>();
            for (const row of walletBuyRows) {
              const bv = mintBucketVolume.get(row.mint) ?? new Map<string, number>();
              bv.set(row.mcapBucket!, (bv.get(row.mcapBucket!) ?? 0) + row.usdValue!);
              mintBucketVolume.set(row.mint, bv);
            }
            for (const [mint, bv] of mintBucketVolume) {
              let best = ''; let bestVol = 0;
              for (const [b, v] of bv) { if (v > bestVol) { bestVol = v; best = b; } }
              mintToBucket.set(mint, best);
            }

            const analysisResults = await prisma.analysisResult.findMany({
              where: { walletAddress, tokenAddress: { in: [...mintToBucket.keys()] } },
              select: { tokenAddress: true, realizedPnlSol: true },
            });

            const pnlAcc = new Map<string, { realizedPnlSol: number; count: number; profitable: number }>();
            for (const ar of analysisResults) {
              const bucket = mintToBucket.get(ar.tokenAddress);
              if (!bucket) continue;
              const acc = pnlAcc.get(bucket) ?? { realizedPnlSol: 0, count: 0, profitable: 0 };
              const pnl = ar.realizedPnlSol ?? 0;
              acc.realizedPnlSol += pnl;
              acc.count += 1;
              if (pnl > 0) acc.profitable += 1;
              pnlAcc.set(bucket, acc);
            }

            const pnlResult: Record<string, { realizedPnlSol: number; tradeCount: number; winRate: number }> = {};
            for (const [bucket, acc] of pnlAcc) {
              pnlResult[bucket] = {
                realizedPnlSol: Math.round(acc.realizedPnlSol * 1000) / 1000,
                tradeCount: acc.count,
                winRate: acc.count > 0 ? Math.round((acc.profitable / acc.count) * 1000) / 1000 : 0,
              };
            }
            mcapBucketPnl = pnlResult;
          }

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
            activeTradingDays: activeTradingDays ?? null,
            preferredMcapBucket,
            avgEntryMcap,
            mcapDistribution: mcapDistribution as Prisma.InputJsonValue | null,
            mcapBucketPnl: mcapBucketPnl as Prisma.InputJsonValue | null,
          };

          // Use the new DatabaseService method
          const savedProfile = await this.databaseService.upsertWalletBehaviorProfile(profileDataToSave);
          if (!savedProfile) {
            logger.error(`Failed to upsert WalletBehaviorProfile for ${walletAddress}`);
            // Decide if this should be a critical error that stops the process or just a warning
          }
          // ✅ REMOVED: Success logging to reduce spam - only log failures
        } else {
          logger.debug(`Skipping WalletBehaviorProfile upsert for ${walletAddress} because a specific timeRange was provided.`);
        }
      }

      return metrics;

    } catch (error) {
      logger.error(`Error analyzing behavior for wallet ${walletAddress}:`, { error });
      // Decide on error handling: re-throw, return null, return empty metrics?
      // Returning null is consistent with the "no data" case.
      return null;
    }
  }
} 
