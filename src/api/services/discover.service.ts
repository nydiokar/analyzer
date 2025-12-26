import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from './database.service';
import {
  DiscoverWalletDto,
  DiscoverWalletsQueryDto,
  DiscoverWalletsResponseDto,
} from '../shared/dto/discover-wallet.dto';

type DiscoverWalletPayload = Prisma.WalletGetPayload<{
  include: { pnlSummary: { include: { advancedStats: true } }; behaviorProfile: true };
}>;

@Injectable()
export class DiscoverService {
  private readonly logger = new Logger(DiscoverService.name);
  private readonly DEFAULT_PAGE_SIZE = 24;
  private readonly MAX_PAGE_SIZE = 40;
  private readonly MIN_PAGE_SIZE = 10;

  constructor(private readonly databaseService: DatabaseService) {}

  async getDiscoverWallets(query: DiscoverWalletsQueryDto): Promise<DiscoverWalletsResponseDto> {
    const sort = query.sort || 'interesting';
    const timeframe = query.timeframe || 'all';
    const page = query.page ?? 1;
    const normalizedPage = page < 1 ? 1 : page;
    const pageSize = this.normalizePageSize(query.pageSize);
    const skip = (normalizedPage - 1) * pageSize;
    const minTradeCount = query.minTradeCount;
    const minFreshnessHours = query.minFreshnessHours;
    const minUniqueTokens = query.minUniqueTokens;
    const style = query.style;
    const holdBias = query.holdBias;

    const updatedSince = minFreshnessHours
      ? new Date(Date.now() - minFreshnessHours * 60 * 60 * 1000)
      : undefined;

    const where: Prisma.WalletWhereInput = {
      pnlSummary: { isNot: null },
    };

    const andFilters: Prisma.WalletWhereInput[] = [];

    // Require behaviorProfile for sorts that depend on behavior metrics
    const behaviorSorts = ['most_active', 'longest_holders', 'interesting'];
    if (behaviorSorts.includes(sort)) {
      andFilters.push({ behaviorProfile: { isNot: null } });

      // No additional null checks needed - fields are non-nullable when behaviorProfile exists
      // The schema guarantees these fields have values (medianHoldTime, totalTradeCount, flipperScore are all non-nullable)
    }

    if (typeof minTradeCount === 'number' && minTradeCount > 0) {
      where.behaviorProfile = { is: { totalTradeCount: { gte: minTradeCount } } };
    }

    if (typeof minUniqueTokens === 'number' && minUniqueTokens > 0) {
      where.behaviorProfile = {
        is: {
          ...(where.behaviorProfile?.is || {}),
          uniqueTokensTraded: { gte: minUniqueTokens },
        },
      };
    }

    if (style) {
      // NEW: Use strategyType enum for exact matching (not substring search)
      const normalizedStyle = style.toUpperCase();
      where.behaviorProfile = {
        is: {
          ...(where.behaviorProfile?.is || {}),
          strategyType: { equals: normalizedStyle },
        },
      };
    }

    if (holdBias) {
      const holdConditions = this.buildHoldBiasCondition(holdBias);
      if (holdConditions) {
        where.behaviorProfile = {
          is: {
            ...(where.behaviorProfile?.is || {}),
            medianHoldTime: holdConditions,
          },
        };
      }
    }

    if (updatedSince) {
      andFilters.push({
        OR: [
          { pnlSummary: { is: { updatedAt: { gte: updatedSince } } } },
          { behaviorProfile: { is: { updatedAt: { gte: updatedSince } } } },
        ],
      });
    }

    if (andFilters.length) {
      where.AND = andFilters;
    }

    const orderBy = this.buildOrder(sort);

    const { total, wallets } = await this.databaseService.getDiscoverWallets({
      where,
      orderBy,
      skip,
      take: pageSize,
    });

    const items: DiscoverWalletDto[] = wallets.map(wallet => this.mapWallet(wallet));

    return {
      items,
      page: normalizedPage,
      pageSize,
      sort,
      timeframe,
      total,
    };
  }

  private normalizePageSize(requested?: number): number {
    if (!requested) return this.DEFAULT_PAGE_SIZE;
    return Math.max(this.MIN_PAGE_SIZE, Math.min(this.MAX_PAGE_SIZE, requested));
  }

  private buildOrder(sort: string): Prisma.WalletOrderByWithRelationInput[] {
    const tieBreaker: Prisma.WalletOrderByWithRelationInput = { address: 'asc' };

    switch (sort) {
      case 'most_active':
        return [
          { behaviorProfile: { totalTradeCount: 'desc' } },
          { behaviorProfile: { uniqueTokensTraded: 'desc' } },
          tieBreaker,
        ];
      case 'best_pnl':
        return [
          { pnlSummary: { realizedPnl: 'desc' } },
          { pnlSummary: { totalExecutedSwapsCount: 'desc' } },
          tieBreaker,
        ];
      case 'longest_holders':
        return [
          { behaviorProfile: { medianHoldTime: 'desc' } },
          { behaviorProfile: { averageFlipDurationHours: 'desc' } },
          tieBreaker,
        ];
      case 'recently_updated':
        return [
          { pnlSummary: { updatedAt: 'desc' } },
          { behaviorProfile: { updatedAt: 'desc' } },
          tieBreaker,
        ];
      case 'interesting':
      default:
        return [
          // NEW: Use velocityScore (professional terminology, replaces flipperScore)
          { behaviorProfile: { velocityScore: { sort: 'desc', nulls: 'last' } } },
          { behaviorProfile: { medianHoldTime: 'desc' } },
          { behaviorProfile: { tradingStyle: 'asc' } },
          { behaviorProfile: { uniqueTokensTraded: 'desc' } },
          { behaviorProfile: { totalTradeCount: 'desc' } },
          { pnlSummary: { realizedPnl: 'desc' } },
          { pnlSummary: { updatedAt: 'desc' } },
          tieBreaker,
        ];
    }
  }

  private mapWallet(wallet: DiscoverWalletPayload): DiscoverWalletDto {
    const pnl = wallet.pnlSummary;
    const advanced = wallet.pnlSummary?.advancedStats;
    const behavior = wallet.behaviorProfile;

    const lastActiveTimestamp =
      behavior?.lastTransactionTimestamp ?? pnl?.overallLastTimestamp ?? null;
    const lastActiveAt = lastActiveTimestamp
      ? new Date(lastActiveTimestamp * 1000)
      : null;
    const lastUpdatedAt = pnl?.updatedAt ?? behavior?.updatedAt ?? null;
    const stalenessMinutes = lastUpdatedAt
      ? Math.round((Date.now() - lastUpdatedAt.getTime()) / (1000 * 60))
      : null;

    const reason = this.deriveReason({
      realizedPnl: pnl?.realizedPnl ?? null,
      unrealizedPnl: pnl?.unrealizedPnl ?? null,
      winRate: advanced?.tokenWinRatePercent ?? null,
      totalTrades: behavior?.totalTradeCount ?? pnl?.totalExecutedSwapsCount ?? null,
      totalBuys: behavior?.totalBuyCount ?? null,
      totalSells: behavior?.totalSellCount ?? null,
      medianHoldHours: behavior?.medianHoldTime ?? null,
      lastActiveAt,
      // NEW: Use new classification system fields
      velocityScore: behavior?.velocityScore ?? behavior?.flipperScore ?? null,
      strategyType: behavior?.strategyType ?? null,
      speedCategory: behavior?.speedCategory ?? null,
      flowPattern: behavior?.flowPattern ?? null,
      uniqueTokensTraded: behavior?.uniqueTokensTraded ?? null,
      tradingStyle: behavior?.tradingStyle ?? null, // Keep for backward compat
    });

    return {
      walletAddress: wallet.address,
      reason: reason.text,
      reasonCode: reason.code,
      lastUpdatedAt,
      metrics: {
        realizedPnl: pnl?.realizedPnl ?? null,
        unrealizedPnl: pnl?.unrealizedPnl ?? null,
        winRatePercent: advanced?.tokenWinRatePercent ?? null,
        totalTrades: behavior?.totalTradeCount ?? pnl?.totalExecutedSwapsCount ?? null,
        totalBuys: behavior?.totalBuyCount ?? null,
        totalSells: behavior?.totalSellCount ?? null,
        totalExecutedSwaps: pnl?.totalExecutedSwapsCount ?? null,
        averageHoldHours: behavior?.averageFlipDurationHours ?? null,
        medianHoldHours: behavior?.medianHoldTime ?? null,
        uniqueTokensTraded: behavior?.uniqueTokensTraded ?? null,
        tradingStyle: behavior?.tradingStyle ?? null,
        speedCategory: behavior?.speedCategory ?? null, // NEW: Explicit speed classification
        flowPattern: behavior?.flowPattern ?? null, // NEW: Buy/sell flow pattern
        strategyType: behavior?.strategyType ?? null, // NEW: Canonical strategy type
        // NEW: Behavioral detail metrics for data-driven storytelling (2025-12-26)
        buySellRatio: behavior?.buySellRatio ?? null,
        percentageOfUnpairedTokens: behavior?.percentageOfUnpairedTokens ?? null,
        buySellSymmetry: behavior?.buySellSymmetry ?? null,
        sequenceConsistency: behavior?.sequenceConsistency ?? null,
        exitPattern: behavior?.exitPattern ?? null, // Now stored directly in DB
        percentOfValueInCurrentHoldings: behavior?.percentOfValueInCurrentHoldings ?? null,
        medianCurrentHoldingDurationHours: behavior?.medianCurrentHoldingDurationHours ?? null,
        lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
        pnlUpdatedAt: pnl?.updatedAt ?? null,
        behaviorUpdatedAt: behavior?.updatedAt ?? null,
        stalenessMinutes,
      },
    };
  }

  private deriveReason(params: {
    realizedPnl: number | null;
    unrealizedPnl: number | null;
    winRate: number | null;
    totalTrades: number | null;
    totalBuys: number | null;
    totalSells: number | null;
    medianHoldHours: number | null;
    lastActiveAt: Date | null;
    // NEW: Use new classification system fields
    velocityScore: number | null;
    strategyType: string | null;
    speedCategory: string | null;
    flowPattern: string | null;
    uniqueTokensTraded: number | null;
    tradingStyle: string | null; // Deprecated, keep for backward compat
  }): { text: string; code: string } {
    const {
      realizedPnl,
      unrealizedPnl,
      winRate,
      totalTrades,
      totalBuys,
      totalSells,
      medianHoldHours,
      lastActiveAt,
      velocityScore,
      strategyType,
      speedCategory,
      flowPattern,
      uniqueTokensTraded,
      tradingStyle, // Deprecated
    } = params;
    const now = Date.now();

    // Holder-specific tags (high priority)
    const buys = totalBuys ?? 0;
    const sells = totalSells ?? 0;

    // Pure accumulator (only buys, no sells)
    if (buys > 10 && sells === 0 && unrealizedPnl !== null) {
      const pnlText = unrealizedPnl >= 0 ? `+${unrealizedPnl.toFixed(1)}` : unrealizedPnl.toFixed(1);
      return { code: 'ACCUMULATOR', text: `Heavy accumulator · ${buys} buys / 0 sells · ${pnlText} SOL unrealized` };
    }

    // Mostly holder (very few sells compared to buys)
    if (buys > 5 && sells > 0 && sells < 3 && unrealizedPnl !== null) {
      return { code: 'PARTIAL_HOLDER', text: `Profit taker · ${sells} exits · still holding positions` };
    }

    // NEW: Use strategyType from classification system
    if (strategyType === 'FAST_TRADER' && velocityScore && velocityScore >= 60) {
      return { code: 'FAST_TRADER', text: `Fast trader · velocity ${Math.round(velocityScore)} · ${buys ?? 0}↑/${sells ?? 0}↓` };
    }

    if (strategyType === 'PURE_HOLDER' && medianHoldHours && medianHoldHours >= 72) {
      return { code: 'HODLER', text: `Patient hodler · ~${Math.round(medianHoldHours / 24)}d median hold` };
    }

    if (strategyType === 'SWING_TRADER' && medianHoldHours && medianHoldHours >= 24) {
      return { code: 'SWING', text: `Swing trader · ~${Math.round(medianHoldHours)}h holds` };
    }

    if (strategyType === 'POSITION_TRADER' && medianHoldHours && medianHoldHours >= 72) {
      return { code: 'POSITION', text: `Position trader · ~${Math.round(medianHoldHours / 24)}d holds` };
    }

    // FALLBACK: Use old tradingStyle if new fields not yet populated (backward compat)
    if (!strategyType && tradingStyle) {
      const normalized = tradingStyle.toUpperCase();

      // Fast traders (legacy)
      if (['FLIPPER', 'SCALPER', 'SNIPER'].includes(normalized) && velocityScore && velocityScore >= 60) {
        return { code: 'FAST_TRADER', text: `Fast trader · velocity ${Math.round(velocityScore)} · ${buys ?? 0}↑/${sells ?? 0}↓` };
      }

      // Hodlers with completed cycles (legacy)
      if (['POSITION', 'HODLER'].includes(normalized) && medianHoldHours && medianHoldHours >= 72) {
        return { code: 'HODLER', text: `Patient hodler · ~${Math.round(medianHoldHours / 24)}d median hold` };
      }

      // Swing/position traders (legacy)
      if (['SWING', 'POSITION'].includes(normalized) && medianHoldHours && medianHoldHours >= 24) {
        return { code: 'SWING', text: `Swing trader · ~${Math.round(medianHoldHours)}h holds` };
      }
    }

    // Velocity score based (when strategy not classified yet)
    if (velocityScore !== null && velocityScore >= 60 && (totalTrades ?? 0) >= 20) {
      return { code: 'FAST_TRADER', text: `Quick rotations · velocity ${Math.round(velocityScore)}` };
    }

    // Token explorer
    if (uniqueTokensTraded !== null && uniqueTokensTraded >= 25) {
      return { code: 'EXPLORER', text: `Token explorer · ${uniqueTokensTraded} tokens sampled` };
    }

    // Recent activity
    if (lastActiveAt && now - lastActiveAt.getTime() <= 1000 * 60 * 60 * 48) {
      return { code: 'RECENT', text: 'Warming up · active in last 48h' };
    }

    // Positive PnL
    if (realizedPnl !== null && realizedPnl > 0) {
      return { code: 'PNL', text: `Profitable · ${realizedPnl.toFixed(1)} SOL realized` };
    }

    return { code: 'INTERESTING', text: 'Curated pick · interesting activity pattern' };
  }

  private buildHoldBiasCondition(
    holdBias: string,
  ): Prisma.FloatFilter | null {
    // medianHoldTime stored in hours
    if (holdBias === 'short') {
      return { lt: 12 };
    }
    if (holdBias === 'medium') {
      return { gte: 12, lte: 72 };
    }
    if (holdBias === 'long') {
      return { gt: 72 };
    }
    return null;
  }
}
