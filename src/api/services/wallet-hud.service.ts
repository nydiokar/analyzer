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

  /**
   * Get HUD data for a single wallet with Redis caching
   *
   * Cache Strategy:
   * - 24-hour TTL to auto-expire stale/inactive wallets (prevents memory bloat)
   * - Actively analyzed wallets get cache invalidated immediately
   * - Data is static until next analysis or 24h expiry
   */
  async getHud(walletAddress: string): Promise<WalletHudDto | null> {
    const cacheKey = `${this.CACHE_PREFIX}:${walletAddress}`;

    try {
      // Try cache first
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.logger.debug(`HUD cache hit for ${walletAddress}`);
        return JSON.parse(cached) as WalletHudDto;
      }

      // Cache miss - fetch from database
      this.logger.debug(`HUD cache miss for ${walletAddress}`);

      // Fetch wallet data and SOL price in parallel
      const [wallet, solPriceUsd] = await Promise.all([
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
        this.tokenInfoService.getSolPrice().catch(() => undefined), // Don't fail if price fetch fails
      ]);

      if (!wallet) {
        return null;
      }

      const hud = this.calculateHud(wallet, walletAddress, solPriceUsd);

      // Cache with 24h TTL to prevent memory bloat from old wallets
      // Active wallets get cache invalidated + refreshed on analysis
      if (hud) {
        await this.redis.set(cacheKey, JSON.stringify(hud), 'EX', this.CACHE_TTL);
      }

      return hud;
    } catch (error) {
      this.logger.error(
        `Error fetching HUD for wallet ${walletAddress}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Invalidate HUD cache for a wallet
   * Call this after wallet analysis completes
   */
  async invalidateCache(walletAddress: string): Promise<void> {
    const cacheKey = `${this.CACHE_PREFIX}:${walletAddress}`;
    try {
      await this.redis.del(cacheKey);
      this.logger.debug(`Invalidated HUD cache for ${walletAddress}`);
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate HUD cache for ${walletAddress}:`,
        error,
      );
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
      // Fetch all wallets and SOL price in parallel
      const [wallets, solPriceUsd] = await Promise.all([
        prisma.wallet.findMany({
          where: {
            address: { in: walletAddresses },
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
        this.tokenInfoService.getSolPrice().catch(() => undefined), // Don't fail if price fetch fails
      ]);

      // Create a map for quick lookup
      const walletMap = new Map(wallets.map((w) => [w.address, w]));

      // Process each requested address
      for (const address of walletAddresses) {
        const wallet = walletMap.get(address);

        if (!wallet) {
          notFound.push(address);
          continue;
        }

        try {
          const hud = this.calculateHud(wallet, address, solPriceUsd);
          if (hud) {
            huds[address] = hud;
          } else {
            notFound.push(address);
          }
        } catch (error) {
          this.logger.warn(
            `Failed to calculate HUD for wallet ${address}:`,
            error,
          );
          notFound.push(address);
        }
      }

      return {
        huds,
        notFound,
        calculatedAt,
      };
    } catch (error) {
      this.logger.error('Error in batch HUD fetch:', error);
      throw error;
    }
  }

  /**
   * Calculate HUD metrics from wallet data
   */
  private calculateHud(
    wallet: any,
    walletAddress: string,
    solPriceUsd?: number,
  ): WalletHudDto | null {
    const pnlSummary = wallet.pnlSummary;
    const advancedStats = pnlSummary?.advancedStats;
    const behaviorProfile = wallet.behaviorProfile;

    // Core metrics with fallbacks
    const trimmedMeanPnl = advancedStats?.trimmedMeanPnlPerToken ?? 0;
    const medianPnlPerToken = advancedStats?.medianPnlPerToken ?? 0;
    const winRate = advancedStats?.tokenWinRatePercent
      ? advancedStats.tokenWinRatePercent / 100 // Convert percentage to decimal
      : 0;

    // Calculate days active
    const daysActive = this.calculateDaysActive(
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

    // Whale detection: Use unrealized PNL (total portfolio value) instead of just SOL balance
    // This represents the current value of all their SPL token holdings
    const unrealizedPnlSol = pnlSummary?.unrealizedPnl ?? 0;

    // Calculate USD value if SOL price is available
    let unrealizedPnlUsd: number | undefined;
    if (solPriceUsd !== undefined && unrealizedPnlSol !== 0) {
      unrealizedPnlUsd = parseFloat((unrealizedPnlSol * solPriceUsd).toFixed(2));
    }

    // Conditional badges
    const isBot = uniqueTokensPerDay > this.BOT_TOKENS_PER_DAY_THRESHOLD;
    const isWhale =
      unrealizedPnlSol > this.WHALE_UNREALIZED_PNL_SOL_THRESHOLD ||
      (unrealizedPnlUsd !== undefined &&
        Math.abs(unrealizedPnlUsd) > this.WHALE_UNREALIZED_PNL_USD_THRESHOLD);

    // Data quality tier
    const dataQualityTier = this.calculateDataQualityTier(
      wallet,
      totalTrades,
      daysActive,
    );

    return {
      walletAddress,
      trimmedMeanPnl,
      medianPnlPerToken,
      behaviorCategory,
      behaviorCode,
      avgTradesPerDay,
      winRate,
      dataQualityTier,
      isBot,
      isWhale,
      uniqueTokensPerDay,
      currentHoldingsSol: unrealizedPnlSol, // Renamed: now represents unrealized PNL, not SOL balance
      currentHoldingsUsd: unrealizedPnlUsd, // USD value of unrealized PNL
      calculatedAt: new Date(),
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
