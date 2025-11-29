import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService as NestDatabaseService } from '../services/database.service'; // NestJS wrapped DB Service
import { BehaviorService as OriginalBehaviorService } from '../../core/analysis/behavior/behavior-service';
import { BehaviorAnalysisConfig } from '../../types/analysis'; // Corrected to use path alias
import { BehavioralMetrics } from '../../types/behavior'; // Corrected to use path alias

@Injectable()
export class BehaviorService {
  private readonly logger = new Logger(BehaviorService.name);

  constructor(
    // Inject the NestJS wrapped DatabaseService for any direct DB calls THIS service might make (if any in future)
    private nestDatabaseService: NestDatabaseService
  ) {}

  /**
   * Analyzes wallet behavior. This method instantiates the original BehaviorService.
   * It requires a BehaviorAnalysisConfig.
   */
  async getWalletBehavior(
    walletAddress: string,
    config: BehaviorAnalysisConfig, // Config will be required per call for now
    timeRange?: { startTs?: number; endTs?: number },
    pnlMap?: Map<string, { pnl: number; capital: number }>
  ): Promise<BehavioralMetrics | null> {
    this.logger.debug(`Getting wallet behavior for ${walletAddress}`);

    // Feature flag: disable with DISABLE_BEHAVIOR_CACHE=true
    const cacheEnabled = process.env.DISABLE_BEHAVIOR_CACHE !== 'true';

    // Only use DB cache for full history queries (not time-ranged)
    if (cacheEnabled && !timeRange) {
      try {
        const cachedProfile = await this.nestDatabaseService.getWalletBehaviorProfile(walletAddress);

        if (cachedProfile) {
          // Smart staleness check: Compare profile update time vs wallet last sync
          const wallet = await this.nestDatabaseService.getWallet(walletAddress);

          if (wallet?.lastSuccessfulFetchTimestamp) {
            const profileUpdatedAt = cachedProfile.updatedAt.getTime();
            const walletLastSyncAt = wallet.lastSuccessfulFetchTimestamp.getTime();

            // If profile was computed AFTER the last sync, it's fresh!
            if (profileUpdatedAt >= walletLastSyncAt) {
              const ageMinutes = Math.round((Date.now() - profileUpdatedAt) / 1000 / 60);
              this.logger.log(
                `✅ Behavior Cache HIT: ${walletAddress} (${ageMinutes}min old, fresh)`
              );
              return this.convertProfileToMetrics(cachedProfile);
            } else {
              const syncAgo = Math.round((Date.now() - walletLastSyncAt) / 1000 / 60);
              this.logger.log(
                `🔄 Behavior Cache STALE: ${walletAddress} - wallet synced ${syncAgo}min ago, re-analyzing`
              );
            }
          } else {
            // No sync timestamp - use 1 hour TTL fallback
            const cacheAgeMs = Date.now() - cachedProfile.updatedAt.getTime();
            if (cacheAgeMs < 60 * 60 * 1000) {
              this.logger.log(`✅ Behavior Cache HIT: ${walletAddress} (TTL fallback, ${Math.round(cacheAgeMs/1000/60)}min old)`);
              return this.convertProfileToMetrics(cachedProfile);
            }
          }
        }
      } catch (cacheError) {
        this.logger.warn(`Error reading behavior cache for ${walletAddress}, falling back to full analysis:`, cacheError);
      }
    }

    // Cache miss, stale, or disabled → full analysis
    const originalService = new OriginalBehaviorService(this.nestDatabaseService, config);

    try {
      return await originalService.analyzeWalletBehavior(walletAddress, timeRange || config.timeRange, pnlMap);
    } catch (error) {
      this.logger.error(`Error in getWalletBehavior for ${walletAddress}:`, error);
      throw error;
    }
  }

  /**
   * Convert WalletBehaviorProfile from DB to BehavioralMetrics format
   * Some fields are not cached and will be null/undefined - consuming code handles this
   */
  private convertProfileToMetrics(profile: any): BehavioralMetrics {
    // Reconstruct historicalPattern from cached pieces
    const historicalPattern = {
      walletAddress: profile.walletAddress,
      historicalAverageHoldTimeHours: profile.averageFlipDurationHours,
      completedCycleCount: profile.completePairsCount,
      medianCompletedHoldTimeHours: profile.medianHoldTime,
      behaviorType: this.extractBehaviorType(profile.tradingStyle),
      exitPattern: 'GRADUAL' as const, // Not cached, use default
      dataQuality: profile.confidenceScore,
      observationPeriodDays: this.calculateObservationPeriodDays(profile),
      holdTimeDistribution: undefined, // Not cached as structured object
      holdTimeTokenMap: profile.holdTimeTokenMap || undefined,
      enrichedHoldTimeDistribution: profile.enrichedHoldTimeDistribution || undefined,
    };

    return {
      buySellRatio: profile.buySellRatio,
      buySellSymmetry: profile.buySellSymmetry,
      averageFlipDurationHours: profile.averageFlipDurationHours,
      medianHoldTime: profile.medianHoldTime,
      averageCurrentHoldingDurationHours: null as any, // Not cached
      medianCurrentHoldingDurationHours: null as any, // Not cached
      weightedAverageHoldingDurationHours: profile.averageFlipDurationHours, // Best approximation
      percentOfValueInCurrentHoldings: null as any, // Not cached
      sequenceConsistency: profile.sequenceConsistency,
      flipperScore: profile.flipperScore,
      uniqueTokensTraded: profile.uniqueTokensTraded,
      tokensWithBothBuyAndSell: profile.tokensWithBothBuyAndSell,
      tokensWithOnlyBuys: null as any, // Not cached
      tokensWithOnlySells: null as any, // Not cached
      totalTradeCount: profile.totalTradeCount,
      totalBuyCount: profile.totalBuyCount,
      totalSellCount: profile.totalSellCount,
      completePairsCount: profile.completePairsCount,
      averageTradesPerToken: profile.averageTradesPerToken,
      tradingTimeDistribution: profile.tradingTimeDistribution as any,
      percentTradesUnder1Hour: profile.percentTradesUnder1Hour,
      percentTradesUnder4Hours: profile.percentTradesUnder4Hours,
      tradingStyle: profile.tradingStyle,
      confidenceScore: profile.confidenceScore,
      tradingFrequency: profile.tradingFrequency as any,
      tokenPreferences: profile.tokenPreferences as any,
      riskMetrics: profile.riskMetrics as any,
      reentryRate: profile.reentryRate,
      percentageOfUnpairedTokens: profile.percentageOfUnpairedTokens,
      sessionCount: profile.sessionCount,
      avgTradesPerSession: profile.avgTradesPerSession,
      activeTradingPeriods: profile.activeTradingPeriods as any,
      averageSessionStartHour: profile.averageSessionStartHour,
      averageSessionDurationMinutes: profile.averageSessionDurationMinutes,
      firstTransactionTimestamp: profile.firstTransactionTimestamp,
      lastTransactionTimestamp: profile.lastTransactionTimestamp,
      historicalPattern, // Reconstructed from cached pieces
    };
  }

  private extractBehaviorType(tradingStyle: string): any {
    // Extract behavior type from trading style string
    // tradingStyle format is like "FLIPPER (ACCUMULATOR): ..."
    if (tradingStyle.includes('SNIPER')) return 'SNIPER';
    if (tradingStyle.includes('SCALPER')) return 'SCALPER';
    if (tradingStyle.includes('MOMENTUM')) return 'MOMENTUM';
    if (tradingStyle.includes('INTRADAY')) return 'INTRADAY';
    if (tradingStyle.includes('DAY_TRADER')) return 'DAY_TRADER';
    if (tradingStyle.includes('SWING')) return 'SWING';
    if (tradingStyle.includes('POSITION')) return 'POSITION';
    if (tradingStyle.includes('HOLDER')) return 'HOLDER';
    return 'DAY_TRADER'; // Default
  }

  private calculateObservationPeriodDays(profile: any): number {
    if (profile.firstTransactionTimestamp && profile.lastTransactionTimestamp) {
      return (profile.lastTransactionTimestamp - profile.firstTransactionTimestamp) / (24 * 60 * 60);
    }
    return 0;
  }
  
  // Helper to get a default config if needed, or this can be managed by a config service later
  getDefaultBehaviorAnalysisConfig(): BehaviorAnalysisConfig {
    // Corrected default config based on BehaviorAnalysisConfig definition
    return {
      excludedMints: [],
      // timeRange can be set if there's a global default, otherwise undefined
      // timeRange: { startTs: undefined, endTs: undefined }
    };
  }

  /**
   * Get token mints for a specific exit timing bucket from CACHED database profile
   * @param walletAddress - Wallet address to analyze
   * @param timeBucket - Time bucket category
   * @returns Array of token mint addresses
   */
  async getExitTimingTokenMints(
    walletAddress: string,
    timeBucket: 'instant' | 'ultraFast' | 'fast' | 'momentum' | 'intraday' | 'day' | 'swing' | 'position'
  ): Promise<string[]> {
    this.logger.debug(`Getting exit timing tokens from cached profile for ${walletAddress} bucket=${timeBucket}`);

    // Read from database instead of recalculating!
    const profile = await this.nestDatabaseService.getWalletBehaviorProfile(walletAddress);

    if (!profile || !profile.holdTimeTokenMap) {
      this.logger.warn(`No cached token map found for wallet ${walletAddress}`);
      return [];
    }

    const tokenMap = profile.holdTimeTokenMap as any;
    return tokenMap[timeBucket] || [];
  }
} 