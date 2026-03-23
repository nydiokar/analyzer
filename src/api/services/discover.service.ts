import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from './database.service';
import {
  DiscoverWalletDto,
  DiscoverWalletsQueryDto,
  DiscoverWalletsResponseDto,
} from '../shared/dto/discover-wallet.dto';

type DiscoverWalletPayload = Prisma.WalletGetPayload<{
  include: { pnlSummary: { include: { advancedStats: true } }; behaviorProfile: true; kolProfile: true };
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
    const scope = query.scope || 'all';
    const timeframe = query.timeframe || 'all';
    const page = query.page ?? 1;
    const normalizedPage = page < 1 ? 1 : page;
    const pageSize = this.normalizePageSize(query.pageSize);
    const skip = (normalizedPage - 1) * pageSize;
    const search = query.search?.trim();
    const minTradeCount = query.minTradeCount;
    const minFreshnessHours = query.minFreshnessHours;
    const minUniqueTokens = query.minUniqueTokens;
    const style = query.style;
    const speedCategory = query.speedCategory;
    const flowPattern = query.flowPattern;
    const holdBias = query.holdBias;
    const minVelocity = query.minVelocity;
    const maxVelocity = query.maxVelocity;

    const updatedSince = minFreshnessHours
      ? new Date(Date.now() - minFreshnessHours * 60 * 60 * 1000)
      : undefined;

    if (scope === 'kols') {
      const where = this.buildDiscoverWhere({
        baseWhere: this.buildKolWhere(search),
        sort,
        minTradeCount,
        minUniqueTokens,
        style,
        speedCategory,
        flowPattern,
        holdBias,
        minVelocity,
        maxVelocity,
        updatedSince,
        requireBehaviorForSort: false,
      });
      const orderBy = this.buildKolOrder(sort);
      const { total, wallets } = await this.databaseService.getDiscoverWallets({
        where,
        orderBy,
        skip,
        take: pageSize,
      });

      return {
        items: wallets.map(wallet => this.mapWallet(wallet)),
        page: normalizedPage,
        pageSize,
        sort,
        timeframe,
        total,
      };
    }

    const where = this.buildDiscoverWhere({
      baseWhere: { pnlSummary: { isNot: null } },
      sort,
      minTradeCount,
      minUniqueTokens,
      style,
      speedCategory,
      flowPattern,
      holdBias,
      minVelocity,
      maxVelocity,
      updatedSince,
      requireBehaviorForSort: true,
    });

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

  /**
   * Get aggregated distribution stats for the filtered dataset
   * Returns counts and percentages for speedCategory and flowPattern
   */
  async getDiscoverAggregation(query: DiscoverWalletsQueryDto): Promise<{
    speedDistribution: { category: string; count: number; totalPnl: number; percentage: number }[];
    flowDistribution: { pattern: string; count: number; totalPnl: number; percentage: number }[];
    total: number;
  }> {
    const scope = query.scope || 'all';
    const minTradeCount = query.minTradeCount;
    const minUniqueTokens = query.minUniqueTokens;
    const minFreshnessHours = query.minFreshnessHours;
    const style = query.style;
    const speedCategory = query.speedCategory;
    const flowPattern = query.flowPattern;
    const holdBias = query.holdBias;
    const minVelocity = query.minVelocity;
    const maxVelocity = query.maxVelocity;
    const updatedSince = minFreshnessHours
      ? new Date(Date.now() - minFreshnessHours * 60 * 60 * 1000)
      : undefined;
    const where = this.buildDiscoverWhere({
      baseWhere: scope === 'kols'
        ? this.buildKolWhere(query.search?.trim())
        : { pnlSummary: { isNot: null } },
      sort: query.sort || 'interesting',
      minTradeCount,
      minUniqueTokens,
      style,
      speedCategory,
      flowPattern,
      holdBias,
      minVelocity,
      maxVelocity,
      updatedSince,
      requireBehaviorForSort: false,
    });

    where.behaviorProfile = {
      is: {
        ...(where.behaviorProfile?.is || {}),
      },
    };

    // Fetch speedCategory, flowPattern, and PnL fields (efficient)
    const wallets = await this.databaseService.getDiscoverAggregationData({ where });

    const total = wallets.length;
    const speedStats = new Map<string, { count: number; totalPnl: number }>();
    const flowStats = new Map<string, { count: number; totalPnl: number }>();

    wallets.forEach((wallet) => {
      const speed = wallet.speedCategory || 'UNCLASSIFIED';
      const flow = wallet.flowPattern || 'UNCLASSIFIED';
      const pnl = wallet.pnl || 0;

      // Update speed stats
      const speedStat = speedStats.get(speed) || { count: 0, totalPnl: 0 };
      speedStats.set(speed, {
        count: speedStat.count + 1,
        totalPnl: speedStat.totalPnl + pnl,
      });

      // Update flow stats
      const flowStat = flowStats.get(flow) || { count: 0, totalPnl: 0 };
      flowStats.set(flow, {
        count: flowStat.count + 1,
        totalPnl: flowStat.totalPnl + pnl,
      });
    });

    const speedDistribution = Array.from(speedStats.entries()).map(([category, stats]) => ({
      category,
      count: stats.count,
      totalPnl: stats.totalPnl,
      percentage: total > 0 ? (stats.count / total) * 100 : 0,
    }));

    const flowDistribution = Array.from(flowStats.entries()).map(([pattern, stats]) => ({
      pattern,
      count: stats.count,
      totalPnl: stats.totalPnl,
      percentage: total > 0 ? (stats.count / total) * 100 : 0,
    }));

    return {
      speedDistribution,
      flowDistribution,
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
          { behaviorProfile: { medianCompletedHoldTimeHours: { sort: 'desc', nulls: 'last' } } },
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
          { behaviorProfile: { medianCompletedHoldTimeHours: { sort: 'desc', nulls: 'last' } } },
          { behaviorProfile: { tradingStyle: 'asc' } },
          { behaviorProfile: { uniqueTokensTraded: 'desc' } },
          { behaviorProfile: { totalTradeCount: 'desc' } },
          { pnlSummary: { realizedPnl: 'desc' } },
          { pnlSummary: { updatedAt: 'desc' } },
          tieBreaker,
        ];
    }
  }

  private buildKolWhere(search?: string): Prisma.WalletWhereInput {
    const where: Prisma.WalletWhereInput = {
      knownType: 'KOL',
    };

    if (!search) {
      return where;
    }

    where.AND = [
      {
        OR: [
          { address: { contains: search, mode: 'insensitive' } },
          { knownLabel: { contains: search, mode: 'insensitive' } },
          { kolProfile: { is: { name: { contains: search, mode: 'insensitive' } } } },
          { kolProfile: { is: { twitter: { contains: search, mode: 'insensitive' } } } },
          { kolProfile: { is: { telegram: { contains: search, mode: 'insensitive' } } } },
        ],
      },
    ];

    return where;
  }

  private buildDiscoverWhere(params: {
    baseWhere: Prisma.WalletWhereInput;
    sort: string;
    minTradeCount?: number;
    minUniqueTokens?: number;
    style?: string;
    speedCategory?: string;
    flowPattern?: string;
    holdBias?: string;
    minVelocity?: number;
    maxVelocity?: number;
    updatedSince?: Date;
    requireBehaviorForSort: boolean;
  }): Prisma.WalletWhereInput {
    const where: Prisma.WalletWhereInput = { ...params.baseWhere };
    const existingAnd = where.AND
      ? Array.isArray(where.AND)
        ? where.AND
        : [where.AND]
      : [];
    const andFilters: Prisma.WalletWhereInput[] = [...existingAnd];

    const behaviorSorts = ['most_active', 'longest_holders', 'interesting'];
    if (params.requireBehaviorForSort && behaviorSorts.includes(params.sort)) {
      andFilters.push({ behaviorProfile: { isNot: null } });
    }

    if (typeof params.minTradeCount === 'number' && params.minTradeCount > 0) {
      where.behaviorProfile = { is: { totalTradeCount: { gte: params.minTradeCount } } };
    }

    if (typeof params.minUniqueTokens === 'number' && params.minUniqueTokens > 0) {
      where.behaviorProfile = {
        is: {
          ...(where.behaviorProfile?.is || {}),
          uniqueTokensTraded: { gte: params.minUniqueTokens },
        },
      };
    }

    if (params.style) {
      const normalizedStyle = params.style.toUpperCase();
      if (['BALANCED_TRADER', 'ACCUMULATOR', 'DISTRIBUTOR'].includes(normalizedStyle)) {
        const flowPatternMap: Record<string, string> = {
          'BALANCED_TRADER': 'BALANCED',
          'ACCUMULATOR': 'ACCUMULATOR',
          'DISTRIBUTOR': 'DISTRIBUTOR',
        };
        where.behaviorProfile = {
          is: {
            ...(where.behaviorProfile?.is || {}),
            flowPattern: { equals: flowPatternMap[normalizedStyle] },
          },
        };
      } else {
        where.behaviorProfile = {
          is: {
            ...(where.behaviorProfile?.is || {}),
            strategyType: { equals: normalizedStyle },
          },
        };
      }
    }

    if (params.speedCategory) {
      const normalizedSpeed = params.speedCategory.toUpperCase();
      where.behaviorProfile = {
        is: {
          ...(where.behaviorProfile?.is || {}),
          speedCategory: { equals: normalizedSpeed },
        },
      };
    }

    if (params.flowPattern) {
      const normalizedFlow = params.flowPattern.toUpperCase();
      where.behaviorProfile = {
        is: {
          ...(where.behaviorProfile?.is || {}),
          flowPattern: { equals: normalizedFlow },
        },
      };
    }

    if (params.holdBias) {
      const holdConditions = this.buildHoldBiasCondition(params.holdBias);
      if (holdConditions) {
        where.behaviorProfile = {
          is: {
            ...(where.behaviorProfile?.is || {}),
            medianCompletedHoldTimeHours: holdConditions,
          },
        };
      }
    }

    if (typeof params.minVelocity === 'number' || typeof params.maxVelocity === 'number') {
      const velocityFilter: Prisma.IntNullableFilter = {};
      if (typeof params.minVelocity === 'number') velocityFilter.gte = params.minVelocity;
      if (typeof params.maxVelocity === 'number') velocityFilter.lte = params.maxVelocity;
      where.behaviorProfile = {
        is: {
          ...(where.behaviorProfile?.is || {}),
          velocityScore: velocityFilter,
        },
      };
    }

    if (params.updatedSince) {
      andFilters.push({
        OR: [
          { pnlSummary: { is: { updatedAt: { gte: params.updatedSince } } } },
          { behaviorProfile: { is: { updatedAt: { gte: params.updatedSince } } } },
        ],
      });
    }

    if (andFilters.length) {
      where.AND = andFilters;
    }

    return where;
  }

  private buildKolOrder(sort: string): Prisma.WalletOrderByWithRelationInput[] {
    const tieBreaker: Prisma.WalletOrderByWithRelationInput = { address: 'asc' };

    if (sort === 'recently_updated') {
      return [
        { kolProfile: { updatedAt: 'desc' } },
        { knownLabel: 'asc' },
        tieBreaker,
      ];
    }

    return [
      { knownLabel: { sort: 'asc', nulls: 'last' } },
      { kolProfile: { updatedAt: 'desc' } },
      tieBreaker,
    ];
  }

  private mapWallet(wallet: DiscoverWalletPayload): DiscoverWalletDto {
    const pnl = wallet.pnlSummary;
    const advanced = wallet.pnlSummary?.advancedStats;
    const behavior = wallet.behaviorProfile;
    const kol = wallet.kolProfile;

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
      knownType: wallet.knownType ?? null,
      kolName: kol?.name ?? wallet.knownLabel ?? null,
      realizedPnl: pnl?.realizedPnl ?? null,
      unrealizedPnl: pnl?.unrealizedPnl ?? null,
      winRate: advanced?.tokenWinRatePercent ?? null,
      totalTrades: behavior?.totalTradeCount ?? pnl?.totalExecutedSwapsCount ?? null,
      totalBuys: behavior?.totalBuyCount ?? null,
      totalSells: behavior?.totalSellCount ?? null,
      medianHoldHours: behavior?.medianCompletedHoldTimeHours ?? behavior?.medianHoldTime ?? null, // Use correct field, fallback for old data
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
      knownType: wallet.knownType ?? null,
      knownLabel: wallet.knownLabel ?? null,
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
        medianHoldHours: behavior?.medianCompletedHoldTimeHours ?? behavior?.medianHoldTime ?? null, // Use correct token-level median
        uniqueTokensTraded: behavior?.uniqueTokensTraded ?? null,
        tradingStyle: behavior?.tradingStyle ?? null,
        speedCategory: behavior?.speedCategory ?? null, // NEW: Explicit speed classification
        flowPattern: behavior?.flowPattern ?? null, // NEW: Buy/sell flow pattern
        strategyType: behavior?.strategyType ?? null, // NEW: Canonical strategy type
        velocityScore: behavior?.velocityScore ?? behavior?.flipperScore ?? null, // 0-100 trading velocity
        // NEW: Behavioral detail metrics for data-driven storytelling (2025-12-26)
        buySellRatio: behavior?.buySellRatio ?? null,
        percentageOfUnpairedTokens: behavior?.percentageOfUnpairedTokens ?? null,
        buySellSymmetry: behavior?.buySellSymmetry ?? null,
        sequenceConsistency: behavior?.sequenceConsistency ?? null,
        exitPattern: behavior?.exitPattern ?? null, // Now stored directly in DB
        percentOfValueInCurrentHoldings: behavior?.percentOfValueInCurrentHoldings ?? null,
        medianCurrentHoldingDurationHours: behavior?.medianCurrentHoldingDurationHours ?? null,
        currentSolBalance: pnl?.currentSolBalance ?? null,
        lastActiveAt: lastActiveAt ? lastActiveAt.toISOString() : null,
        pnlUpdatedAt: pnl?.updatedAt ?? null,
        behaviorUpdatedAt: behavior?.updatedAt ?? null,
        stalenessMinutes,
      },
    };
  }

  private deriveReason(params: {
    knownType: string | null;
    kolName: string | null;
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
      knownType,
      kolName,
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

    if (knownType === 'KOL') {
      return {
        code: 'KOL',
        text: kolName ? `KOL registry · ${kolName}` : 'KOL registry entry',
      };
    }

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
