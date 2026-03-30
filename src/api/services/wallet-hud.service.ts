import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { prisma } from '../../core/services/database-service';
import { TokenInfoService } from './token-info.service';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import {
  WalletHudDto,
  DataQualityTier,
  BEHAVIOR_CODES,
  BatchWalletHudResponseDto,
} from '../shared/dto/wallet-hud.dto';
import { getErrorMessage } from '../../core/utils/error-utils';

/**
 * Service for generating Wallet HUD (Heads-Up Display) metrics.
 *
 * Provides high-signal, at-a-glance evaluation metrics optimized for:
 * - Trackers page (batch fetching)
 * - Wallet profiles (expanded view)
 * - Discovery and search results (compact inline)
 * - Holder analysis tools
 *
 * Design Philosophy: Like a poker HUD - maximum signal density, instant comprehension.
 */
@Injectable()
export class WalletHudService {
  private readonly logger = new Logger(WalletHudService.name);
  private readonly redis: Redis;

  // Cache configuration
  private readonly CACHE_PREFIX = 'wallet-hud';
  private readonly CACHE_TTL = 86400; // 24 hours - auto-expire stale wallets, still invalidated on analysis
  // NOTE: Portfolio values are now calculated with fresh token prices (30s TTL) on each cache miss
  // This prevents showing stale holdings values while maintaining efficient batch operations

  // Whale thresholds (based on total portfolio value, not just SOL balance)
  private readonly WHALE_UNREALIZED_PNL_SOL_THRESHOLD = 200;
  private readonly WHALE_UNREALIZED_PNL_USD_THRESHOLD = 20000;

  // Bot detection threshold
  private readonly BOT_TOKENS_PER_DAY_THRESHOLD = 60;

  // Data quality thresholds
  private readonly GOLD_MIN_TRADES = 50;
  private readonly GOLD_MIN_DAYS = 7;
  private readonly SILVER_MIN_TRADES = 20;
  private readonly SILVER_MIN_DAYS = 3;
  private readonly BRONZE_MIN_TRADES = 5;

  constructor(
    private readonly tokenInfoService: TokenInfoService,
    @Inject(REDIS_CLIENT) redisClient: Redis,
  ) {
    this.redis = redisClient;
  }

  private getCacheKey(walletAddress: string): string {
    return `${this.CACHE_PREFIX}:${walletAddress}`;
  }

  /**
   * Get HUD data for a single wallet with Redis caching
   *
   * Cache Strategy:
   * - 24-hour TTL to auto-expire stale/inactive wallets (prevents memory bloat)
   * - Actively analyzed wallets get cache invalidated immediately
   * - Data is static until next analysis or 24h expiry
   */
  async getHud(walletAddress: string): Promise<WalletHudDto | null> {
    const cacheKey = this.getCacheKey(walletAddress);

    try {
      // Try cache first
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`HUD cache hit for ${walletAddress}`);
        return JSON.parse(cached) as WalletHudDto;
      }

      // Cache miss - fetch from database
      this.logger.debug(`HUD cache miss for ${walletAddress}`);

      // Fetch wallet data, current holdings balances, and SOL price in parallel
      const [wallet, currentHoldings, solPriceUsd] = await Promise.all([
        prisma.wallet.findUnique({
          where: { address: walletAddress },
          include: {
            pnlSummary: {
              include: {
                advancedStats: true,
              },
            },
            behaviorProfile: true,
          },
        }),
        // Fetch current holdings balances (not stale values)
        prisma.analysisResult.findMany({
          where: {
            walletAddress,
            currentUiBalance: { not: null, gt: 0 },
          },
          select: {
            tokenAddress: true,
            currentUiBalance: true,
          },
        }),
        this.tokenInfoService.getSolPrice().catch(() => undefined), // Don't fail if price fetch fails
      ]);

      if (!wallet) {
        return null;
      }

      // Calculate portfolio value with FRESH token prices
      let portfolioValueSol = 0;
      let portfolioValueUsd: number | undefined;

      if (currentHoldings.length > 0 && solPriceUsd !== undefined) {
        // Batch fetch fresh prices for all tokens in one call
        const tokenMints = currentHoldings.map(h => h.tokenAddress);
        const pricesByMint = await this.tokenInfoService.getTokenPrices(tokenMints);

        // Calculate total portfolio value using fresh prices
        for (const holding of currentHoldings) {
          const balance = holding.currentUiBalance;
          const priceUsd = pricesByMint.get(holding.tokenAddress);

          if (balance && priceUsd && priceUsd > 0) {
            const valueUsd = balance * priceUsd;
            const valueSol = valueUsd / solPriceUsd;
            portfolioValueSol += valueSol;
          }
        }

        portfolioValueUsd = solPriceUsd > 0 ? portfolioValueSol * solPriceUsd : undefined;
      }

      const hud = this.calculateHud(
        wallet,
        walletAddress,
        solPriceUsd,
        portfolioValueSol,
        portfolioValueUsd,
      );

      // Cache with 24h TTL to prevent memory bloat from old wallets
      // Active wallets get cache invalidated + refreshed on analysis
      if (hud) {
        await this.redis.set(cacheKey, JSON.stringify(hud), 'EX', this.CACHE_TTL);
      }

      return hud;
    } catch (error) {
      this.logger.error(`Error fetching HUD for wallet ${walletAddress}: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Invalidate HUD cache for a wallet
   * Call this after wallet analysis completes
   */
  async invalidateCache(walletAddress: string): Promise<void> {
    const cacheKey = this.getCacheKey(walletAddress);
    try {
      await this.redis.del(cacheKey);
      this.logger.debug(`Invalidated HUD cache for ${walletAddress}`);
    } catch (error) {
      this.logger.warn(`Failed to invalidate HUD cache for ${walletAddress}: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Get HUD data for multiple wallets (batch operation)
   * Returns a map indexed by wallet address for O(1) lookup
   */
  async getHudBatch(
    walletAddresses: string[],
  ): Promise<BatchWalletHudResponseDto> {
    const calculatedAt = new Date();
    const huds: Record<string, WalletHudDto> = {};
    const notFound: string[] = [];

    try {
      const uniqueAddresses = [...new Set(walletAddresses.filter(Boolean))];
      if (uniqueAddresses.length === 0) {
        return {
          huds,
          notFound,
          calculatedAt,
        };
      }

      const cacheKeys = uniqueAddresses.map((address) => this.getCacheKey(address));
      const cachedValues = await this.redis.mget(...cacheKeys);
      const missAddresses: string[] = [];

      uniqueAddresses.forEach((address, index) => {
        const cached = cachedValues[index];
        if (!cached) {
          missAddresses.push(address);
          return;
        }

        try {
          huds[address] = JSON.parse(cached) as WalletHudDto;
        } catch {
          missAddresses.push(address);
        }
      });

      if (missAddresses.length === 0) {
        return {
          huds,
          notFound,
          calculatedAt,
        };
      }

      // Fetch only cache misses from the database
      const [wallets, allHoldings, solPriceUsd] = await Promise.all([
        prisma.wallet.findMany({
          where: {
            address: { in: missAddresses },
          },
          include: {
            pnlSummary: {
              include: {
                advancedStats: true,
              },
            },
            behaviorProfile: true,
          },
        }),
        // Fetch current holdings balances for all wallets (not stale values)
        prisma.analysisResult.findMany({
          where: {
            walletAddress: { in: missAddresses },
            currentUiBalance: { not: null, gt: 0 },
          },
          select: {
            walletAddress: true,
            tokenAddress: true,
            currentUiBalance: true,
          },
        }),
        this.tokenInfoService.getSolPrice().catch(() => undefined), // Don't fail if price fetch fails
      ]);

      // Create wallet map for quick lookup
      const walletMap = new Map(wallets.map((w) => [w.address, w]));

      // Group holdings by wallet address
      const holdingsByWallet = new Map<string, Array<{ tokenAddress: string; currentUiBalance: number }>>();
      for (const holding of allHoldings) {
        if (!holdingsByWallet.has(holding.walletAddress)) {
          holdingsByWallet.set(holding.walletAddress, []);
        }
        holdingsByWallet.get(holding.walletAddress)!.push({
          tokenAddress: holding.tokenAddress,
          currentUiBalance: holding.currentUiBalance!,
        });
      }

      // Deduplicate token addresses across ALL wallets for batch price fetch
      const uniqueTokenMints = new Set<string>();
      for (const holdings of holdingsByWallet.values()) {
        for (const holding of holdings) {
          uniqueTokenMints.add(holding.tokenAddress);
        }
      }

      // Batch fetch fresh prices for ALL unique tokens in ONE call
      const pricesByMint = uniqueTokenMints.size > 0 && solPriceUsd !== undefined
        ? await this.tokenInfoService.getTokenPrices(Array.from(uniqueTokenMints))
        : new Map<string, number>();

      // Calculate portfolio value for each wallet using fresh prices
      const portfolioMap = new Map<string, { sol: number; usd: number | undefined }>();

      if (solPriceUsd !== undefined) {
        for (const [walletAddress, holdings] of holdingsByWallet.entries()) {
          let portfolioValueSol = 0;

          for (const holding of holdings) {
            const balance = holding.currentUiBalance;
            const priceUsd = pricesByMint.get(holding.tokenAddress);

            if (balance && priceUsd && priceUsd > 0) {
              const valueUsd = balance * priceUsd;
              const valueSol = valueUsd / solPriceUsd;
              portfolioValueSol += valueSol;
            }
          }

          const portfolioValueUsd = solPriceUsd > 0 ? portfolioValueSol * solPriceUsd : undefined;
          portfolioMap.set(walletAddress, { sol: portfolioValueSol, usd: portfolioValueUsd });
        }
      }

      const redisWrites = this.redis.pipeline();

      // Process only cache misses
      for (const address of missAddresses) {
        const wallet = walletMap.get(address);

        if (!wallet) {
          notFound.push(address);
          continue;
        }

        try {
          const portfolio = portfolioMap.get(address) ?? { sol: 0, usd: undefined };
          const hud = this.calculateHud(
            wallet,
            address,
            solPriceUsd,
            portfolio.sol,
            portfolio.usd,
          );
          if (hud) {
            huds[address] = hud;
            redisWrites.set(this.getCacheKey(address), JSON.stringify(hud), 'EX', this.CACHE_TTL);
          } else {
            notFound.push(address);
          }
        } catch (error) {
          this.logger.warn(`Failed to calculate HUD for wallet ${address}: ${getErrorMessage(error)}`);
          notFound.push(address);
        }
      }

      if (missAddresses.length > 0) {
        await redisWrites.exec();
      }

      return {
        huds,
        notFound,
        calculatedAt,
      };
    } catch (error) {
      this.logger.error(`Error in batch HUD fetch: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Calculate HUD metrics from wallet data
   */
  private calculateHud(
    wallet: any,
    walletAddress: string,
    solPriceUsd: number | undefined,
    portfolioValueSol: number,
    portfolioValueUsd?: number | null,
  ): WalletHudDto | null {
    const pnlSummary = wallet.pnlSummary;
    const advancedStats = pnlSummary?.advancedStats;
    const behaviorProfile = wallet.behaviorProfile;

    // Core metrics with fallbacks
    const trimmedMeanPnl = advancedStats?.trimmedMeanPnlPerToken ?? 0;
    const riskMetrics = behaviorProfile?.riskMetrics as { averageTransactionValueSol?: number } | null;
    const avgTxValueSol = riskMetrics?.averageTransactionValueSol ?? 0;
    const winRate = advancedStats?.tokenWinRatePercent
      ? advancedStats.tokenWinRatePercent / 100 // Convert percentage to decimal
      : 0;

    // Calculate days active — prefer activeTradingDays (distinct trading dates) over wall-clock span.
    // Wall-clock span overstates activity for wallets with long gaps between sessions.
    const daysActive =
      (behaviorProfile as any)?.activeTradingDays ??
      this.calculateDaysActive(
        behaviorProfile?.firstTransactionTimestamp,
        behaviorProfile?.lastTransactionTimestamp,
      );

    // Calculate derived metrics
    const totalTrades = behaviorProfile?.totalTradeCount ?? 0;
    const avgTradesPerDay = daysActive > 0 ? totalTrades / daysActive : 0;

    const uniqueTokensTraded = behaviorProfile?.uniqueTokensTraded ?? 0;
    const uniqueTokensPerDay =
      daysActive > 0 ? uniqueTokensTraded / daysActive : 0;

    // Behavior classification - use speedCategory (enum) not tradingStyle (string description)
    const behaviorCategory = behaviorProfile?.speedCategory ?? behaviorProfile?.strategyType ?? 'UNKNOWN';
    const behaviorCode = this.getBehaviorCode(behaviorCategory);

    // Median hold time - prefer completed hold time as it's more telling than category
    const medianHoldTimeHours = behaviorProfile?.medianCompletedHoldTimeHours ?? behaviorProfile?.medianHoldTime ?? undefined;

    // Portfolio value: Total current holdings value (NOT unrealized P/L)
    // This is the sum of all currentHoldingsValueSol from AnalysisResult
    // If portfolioValueUsd not available, calculate from SOL value
    let portfolioUsd: number | undefined;
    if (portfolioValueUsd !== null && portfolioValueUsd !== undefined) {
      portfolioUsd = portfolioValueUsd;
    } else if (solPriceUsd !== undefined && portfolioValueSol !== 0) {
      portfolioUsd = parseFloat((portfolioValueSol * solPriceUsd).toFixed(2));
    }

    // Conditional badges
    const isBot = uniqueTokensPerDay > this.BOT_TOKENS_PER_DAY_THRESHOLD;
    const isWhale =
      portfolioValueSol > this.WHALE_UNREALIZED_PNL_SOL_THRESHOLD ||
      (portfolioUsd !== undefined &&
        portfolioUsd > this.WHALE_UNREALIZED_PNL_USD_THRESHOLD);

    // Data quality tier
    const dataQualityTier = this.calculateDataQualityTier(
      wallet,
      totalTrades,
      daysActive,
    );

    const calculatedAt = new Date();
    const dataRange =
      behaviorProfile?.firstTransactionTimestamp &&
      behaviorProfile?.lastTransactionTimestamp
        ? {
            from: new Date(
              behaviorProfile.firstTransactionTimestamp * 1000,
            ).toISOString(),
            to: new Date(
              behaviorProfile.lastTransactionTimestamp * 1000,
            ).toISOString(),
          }
        : undefined;

    return {
      walletAddress,
      signalType: 'wallet_behavior_v1',
      trimmedMeanPnl,
      avgTxValueSol,
      behaviorCategory,
      behaviorCode,
      medianHoldTimeHours,
      avgTradesPerDay,
      winRate,
      dataQualityTier,
      isBot,
      isWhale,
      uniqueTokensPerDay,
      currentHoldingsSol: portfolioValueSol, // Total portfolio value in SOL (sum of all holdings)
      currentHoldingsUsd: portfolioUsd, // Total portfolio value in USD (sum of all holdings)
      calculatedAt,
      provenance: {
        provider: 'alpha-node',
        schemaVersion: '1.0.0',
        generatedAt: calculatedAt.toISOString(),
        dataRange,
        source: 'indexed_db',
      },
    };
  }

  /**
   * Calculate days active from first and last transaction timestamps
   */
  private calculateDaysActive(
    firstTimestamp?: number | null,
    lastTimestamp?: number | null,
  ): number {
    if (!firstTimestamp || !lastTimestamp) {
      return 0;
    }

    const diffSeconds = lastTimestamp - firstTimestamp;
    const diffDays = diffSeconds / (60 * 60 * 24);

    // Return at least 1 day if there's any activity
    return Math.max(1, Math.ceil(diffDays));
  }

  /**
   * Map behavior category to single-letter code
   */
  private getBehaviorCode(behaviorCategory: string): string {
    // Normalize the input (uppercase, trim)
    const normalized = behaviorCategory?.toUpperCase().trim() || 'UNKNOWN';

    // Direct lookup
    if (BEHAVIOR_CODES[normalized]) {
      return BEHAVIOR_CODES[normalized];
    }

    // Fuzzy matching for variations
    if (normalized.includes('SNIPER')) return 'S';
    if (normalized.includes('SCALP')) return 'R';
    if (normalized.includes('MOMENTUM')) return 'M';
    if (normalized.includes('INTRADAY')) return 'I';
    if (normalized.includes('DAY')) return 'D';
    if (normalized.includes('SWING')) return 'W';
    if (normalized.includes('POSITION')) return 'P';
    if (normalized.includes('HODL') || normalized.includes('HOLDER')) return 'H';
    if (normalized.includes('FAST')) return 'F';
    if (normalized.includes('ACCUMULATOR')) return 'A';
    if (normalized.includes('DISTRIBUTOR')) return 'T';
    if (normalized.includes('BALANCED')) return 'B';
    if (normalized.includes('LOW_ACTIVITY')) return 'L';

    return '?';
  }

  /**
   * Calculate data quality tier based on data completeness and activity
   */
  private calculateDataQualityTier(
    wallet: any,
    totalTrades: number,
    daysActive: number,
  ): DataQualityTier {
    const hasAdvancedStats = Boolean(wallet.pnlSummary?.advancedStats);
    const hasBehaviorProfile = Boolean(wallet.behaviorProfile);

    // GOLD: Complete data, significant activity
    if (
      hasAdvancedStats &&
      hasBehaviorProfile &&
      totalTrades >= this.GOLD_MIN_TRADES &&
      daysActive >= this.GOLD_MIN_DAYS
    ) {
      return DataQualityTier.GOLD;
    }

    // SILVER: Good data, moderate activity
    if (
      hasAdvancedStats &&
      hasBehaviorProfile &&
      totalTrades >= this.SILVER_MIN_TRADES &&
      daysActive >= this.SILVER_MIN_DAYS
    ) {
      return DataQualityTier.SILVER;
    }

    // BRONZE: Basic data, some activity
    if (
      (hasAdvancedStats || hasBehaviorProfile) &&
      totalTrades >= this.BRONZE_MIN_TRADES
    ) {
      return DataQualityTier.BRONZE;
    }

    // INSUFFICIENT: Too little data
    return DataQualityTier.INSUFFICIENT;
  }
}
