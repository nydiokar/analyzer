import type { AdvancedTradeStats, Prisma, WalletBehaviorProfile } from '@prisma/client';

export const WALLET_VECTOR_SCHEMA_VERSION = 1;
export const WALLET_VECTOR_SOURCE_DIMENSIONS = 32;
export const WALLET_VECTOR_STORAGE_DIMENSIONS = 64;

type BehaviorLike = Pick<
  WalletBehaviorProfile,
  | 'buySellSymmetry'
  | 'flipperScore'
  | 'medianHoldTime'
  | 'averageFlipDurationHours'
  | 'buySellRatio'
  | 'sequenceConsistency'
  | 'percentTradesUnder1Hour'
  | 'percentTradesUnder4Hours'
  | 'reentryRate'
  | 'sessionCount'
  | 'avgTradesPerSession'
  | 'uniqueTokensTraded'
  | 'tokensWithBothBuyAndSell'
  | 'completePairsCount'
  | 'averageTradesPerToken'
  | 'velocityScore'
  | 'percentageOfUnpairedTokens'
  | 'averageSessionDurationMinutes'
  | 'percentOfValueInCurrentHoldings'
  | 'dominantEntryMcapBucketShare'
  | 'avgEntryMcap'
  | 'tokensWithOnlyBuys'
  | 'activeTradingDays'
  | 'medianActiveHoldingHours'
  | 'mcapDistribution'
>;

type AdvancedStatsLike = Pick<AdvancedTradeStats, 'tokenWinRatePercent'> | null;

export interface WalletFeatureSource {
  behavior: BehaviorLike;
  advancedStats: AdvancedStatsLike;
}

export interface PopulationVectorStats {
  means: number[];
  scales: number[];
  walletCount: number;
}

export function buildWalletSourceVector(source: WalletFeatureSource): number[] {
  const behavior = source.behavior;
  const uniqueTokens = nonNegative(behavior.uniqueTokensTraded);
  const bothBuySellRatio = uniqueTokens > 0 ? safeNumber(behavior.tokensWithBothBuyAndSell) / uniqueTokens : 0;
  const completePairsRatio = uniqueTokens > 0 ? safeNumber(behavior.completePairsCount) / uniqueTokens : 0;
  const onlyBuysRatio = uniqueTokens > 0 ? safeNumber(behavior.tokensWithOnlyBuys) / uniqueTokens : 0;
  const flipperScore = clamp01(behavior.flipperScore);
  const mcapDistribution = readMcapDistribution(behavior.mcapDistribution);

  return [
    clamp01(behavior.buySellSymmetry),
    flipperScore,
    log1pHours(behavior.medianHoldTime),
    log1pHours(behavior.averageFlipDurationHours),
    clamp01((source.advancedStats?.tokenWinRatePercent ?? 0) / 100),
    clamp(safeNumber(behavior.buySellRatio), 0, 10) / 10,
    clamp01(behavior.sequenceConsistency),
    clamp01(behavior.percentTradesUnder1Hour),
    clamp01(behavior.percentTradesUnder4Hours),
    clamp01(behavior.reentryRate),
    Math.log1p(nonNegative(behavior.sessionCount)),
    Math.log1p(nonNegative(behavior.avgTradesPerSession)),
    Math.log1p(uniqueTokens),
    clamp01(completePairsRatio),
    Math.log1p(nonNegative(behavior.averageTradesPerToken)),
    mcapDistribution.nano,
    mcapDistribution.micro,
    mcapDistribution.small,
    mcapDistribution.mid,
    safeNumber(behavior.velocityScore) / 100,
    clamp01(bothBuySellRatio),
    clamp01(behavior.percentageOfUnpairedTokens),
    Math.log1p(nonNegative(behavior.averageSessionDurationMinutes)),
    clamp01(behavior.percentOfValueInCurrentHoldings),
    mcapDistribution.ultraMicro,
    mcapDistribution.largePlus,
    clamp01(behavior.dominantEntryMcapBucketShare),
    Math.log1p(nonNegative(behavior.avgEntryMcap) + 1),
    clamp01(onlyBuysRatio),
    Math.log1p(nonNegative(behavior.activeTradingDays)),
    Math.log1p(nonNegative(behavior.medianActiveHoldingHours)),
    clamp01(behavior.percentTradesUnder1Hour) * flipperScore,
  ];
}

export function padWalletVector(sourceVector: number[]): number[] {
  if (sourceVector.length !== WALLET_VECTOR_SOURCE_DIMENSIONS) {
    throw new Error(`Expected ${WALLET_VECTOR_SOURCE_DIMENSIONS} source dimensions, got ${sourceVector.length}`);
  }
  return [
    ...sourceVector,
    ...Array.from({ length: WALLET_VECTOR_STORAGE_DIMENSIONS - WALLET_VECTOR_SOURCE_DIMENSIONS }, () => 0),
  ];
}

export function computePopulationStats(sourceVectors: number[][]): PopulationVectorStats {
  if (sourceVectors.length === 0) {
    return {
      means: Array.from({ length: WALLET_VECTOR_SOURCE_DIMENSIONS }, () => 0),
      scales: Array.from({ length: WALLET_VECTOR_SOURCE_DIMENSIONS }, () => 1),
      walletCount: 0,
    };
  }

  for (const vector of sourceVectors) {
    if (vector.length !== WALLET_VECTOR_SOURCE_DIMENSIONS) {
      throw new Error(`Expected ${WALLET_VECTOR_SOURCE_DIMENSIONS} source dimensions, got ${vector.length}`);
    }
  }

  const means = Array.from({ length: WALLET_VECTOR_SOURCE_DIMENSIONS }, (_, index) => {
    const sum = sourceVectors.reduce((acc, vector) => acc + vector[index], 0);
    return sum / sourceVectors.length;
  });
  const scales = means.map((mean, index) => {
    const variance = sourceVectors.reduce((acc, vector) => acc + (vector[index] - mean) ** 2, 0) / sourceVectors.length;
    const scale = Math.sqrt(variance);
    return scale > 0 ? scale : 1;
  });

  return { means, scales, walletCount: sourceVectors.length };
}

export function standardizeWalletVector(sourceVector: number[], stats: Pick<PopulationVectorStats, 'means' | 'scales'>): number[] {
  if (sourceVector.length !== WALLET_VECTOR_SOURCE_DIMENSIONS) {
    throw new Error(`Expected ${WALLET_VECTOR_SOURCE_DIMENSIONS} source dimensions, got ${sourceVector.length}`);
  }
  if (stats.means.length !== WALLET_VECTOR_SOURCE_DIMENSIONS || stats.scales.length !== WALLET_VECTOR_SOURCE_DIMENSIONS) {
    throw new Error('Population stats do not match wallet vector schema v1');
  }

  const standardized = sourceVector.map((value, index) => {
    const scale = stats.scales[index] > 0 ? stats.scales[index] : 1;
    return roundVectorNumber((value - stats.means[index]) / scale);
  });

  return padWalletVector(standardized);
}

export function vectorToSqlLiteral(vector: number[]): string {
  if (vector.length !== WALLET_VECTOR_STORAGE_DIMENSIONS) {
    throw new Error(`Expected ${WALLET_VECTOR_STORAGE_DIMENSIONS} storage dimensions, got ${vector.length}`);
  }
  return `[${vector.map(roundVectorNumber).join(',')}]`;
}

export function computeWalletVectorDrift(previous: number[] | null, current: number[]): number | null {
  if (!previous) return null;
  if (previous.length !== current.length) {
    throw new Error(`Cannot compare wallet vectors with different dimensions: ${previous.length} and ${current.length}`);
  }

  const sumSquaredDistance = current.reduce((acc, value, index) => {
    const delta = value - previous[index];
    return acc + delta * delta;
  }, 0);
  return roundVectorNumber(Math.sqrt(sumSquaredDistance));
}

function readMcapDistribution(value: Prisma.JsonValue | null): {
  nano: number;
  ultraMicro: number;
  micro: number;
  small: number;
  mid: number;
  largePlus: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { nano: 0, ultraMicro: 0, micro: 0, small: 0, mid: 0, largePlus: 0 };
  }
  const record = value as Record<string, unknown>;
  return {
    nano: clamp01(record.nano),
    ultraMicro: clamp01(record['ultra-micro'] ?? record.ultraMicro),
    micro: clamp01(record.micro),
    small: clamp01(record.small),
    mid: clamp01(record.mid),
    largePlus: clamp01((record.large ?? 0) as number) + clamp01((record.mega ?? 0) as number),
  };
}

function log1pHours(value: number | null): number {
  return Math.log1p(nonNegative(value));
}

function nonNegative(value: number | null): number {
  return Math.max(0, safeNumber(value));
}

function clamp01(value: unknown): number {
  return clamp(safeNumber(value), 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundVectorNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}
