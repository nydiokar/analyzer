import type { AdvancedTradeStats, Prisma, WalletBehaviorProfile } from '@prisma/client';

// v2 (2026-07-13): applies BEHAVIORAL_AXIS_MAP + fixes MCAP-VEC-BUG. Net 32 -> 30
// source dims. Storage width stays 64 (padded) so the pgvector column, HNSW index,
// and edge math are UNCHANGED. See AGENT_12_ADVERSARIAL_REVIEW_2026-07-13.md.
// Changes vs v1:
//   FIX  6 dead mcap dims -> 2 honest dims (weighted-median mcap + concentration),
//        read from the real dollar-range keys the DB actually stores.
//   DROP flipperScore, %<4h, velocityScore, %<1h×flipper, completePairsRatio (redundant).
//   ADD  medianCompletedHoldTimeHours (+presence flag), sellSkew, sessionStart sin/cos,
//        holdingConviction.
export const WALLET_VECTOR_SCHEMA_VERSION = 2;
export const WALLET_VECTOR_SOURCE_DIMENSIONS = 27;
export const WALLET_VECTOR_STORAGE_DIMENSIONS = 64;

type BehaviorLike = Pick<
  WalletBehaviorProfile,
  | 'buySellSymmetry'
  | 'medianHoldTime'
  | 'averageFlipDurationHours'
  | 'buySellRatio'
  | 'sequenceConsistency'
  | 'percentTradesUnder1Hour'
  | 'reentryRate'
  | 'sessionCount'
  | 'avgTradesPerSession'
  | 'uniqueTokensTraded'
  | 'tokensWithBothBuyAndSell'
  | 'averageTradesPerToken'
  | 'percentageOfUnpairedTokens'
  | 'averageSessionDurationMinutes'
  | 'percentOfValueInCurrentHoldings'
  | 'dominantEntryMcapBucketShare'
  | 'avgEntryMcap'
  | 'activeTradingDays'
  | 'medianActiveHoldingHours'
  | 'mcapDistribution'
  // v2 adds:
  | 'medianCompletedHoldTimeHours'
  | 'totalBuyCount'
  | 'totalSellCount'
  | 'averageSessionStartHour'
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
  const mcap = readMcapDistribution(behavior.mcapDistribution);

  // Axis 4 — sellSkew: derived from stored counts (tokensWithOnlySells is NOT
  // stored). 0.5 = balanced; >0.5 sell-heavy (DISTRIBUTOR), <0.5 buy-heavy.
  const buys = nonNegative(behavior.totalBuyCount);
  const sells = nonNegative(behavior.totalSellCount);
  const sellSkew = buys + sells > 0 ? sells / (buys + sells) : 0.5;

  // Axis 3 — closed round-trip exit tempo. GAP A: null on ~12% (buy-only wallets).
  // 0 would misread as "instant exit", so carry an explicit presence flag: 1 when
  // the wallet has completed a round-trip, 0 for a never-seller (holder).
  const completedRaw = behavior.medianCompletedHoldTimeHours;
  const hasCompleted = typeof completedRaw === 'number' && Number.isFinite(completedRaw) && completedRaw > 0;
  const completedHold = hasCompleted ? log1pHours(completedRaw) : 0;

  // Axis 6 — circular session-start hour as sin/cos (hour 23 ≈ hour 0). ⊥ everything.
  const hour = ((safeNumber(behavior.averageSessionStartHour) % 24) + 24) % 24;
  const hourRad = (hour / 24) * 2 * Math.PI;

  // Axis 5 — holding conviction, the PURE_HOLDER vs LOW_ACTIVITY separator. Data:
  // PURE_HOLDER = pctHeld≈1.0 AND never-sold (comp_hold=0); LOW_ACTIVITY = pctHeld≈
  // 0.46 AND does-sell. Single merged dim: pctHeld, attenuated 0.4× when the wallet
  // HAS completed a round-trip (a seller) so it peaks for true holders (~1.0) and
  // sits low for churners (~0.18). Continuous across the whole population (not
  // sparse) so it carries variance for everyone and does not read as a dead dim.
  const pctHeld = clamp01(behavior.percentOfValueInCurrentHoldings);
  const holdingConviction = clamp01(pctHeld * (hasCompleted ? 0.4 : 1));

  return [
    clamp01(behavior.buySellSymmetry),
    log1pHours(behavior.medianHoldTime),
    log1pHours(behavior.averageFlipDurationHours),
    clamp01((source.advancedStats?.tokenWinRatePercent ?? 0) / 100),
    clamp(safeNumber(behavior.buySellRatio), 0, 10) / 10,
    clamp01(behavior.sequenceConsistency),
    clamp01(behavior.percentTradesUnder1Hour),
    clamp01(behavior.reentryRate),
    Math.log1p(nonNegative(behavior.sessionCount)),
    Math.log1p(nonNegative(behavior.avgTradesPerSession)),
    Math.log1p(uniqueTokens),
    Math.log1p(nonNegative(behavior.averageTradesPerToken)),
    // v2 mcap: 1 honest dim from real dollar-range keys (was 6 dead dims).
    // concentration dropped (collinear r=0.98 w/ dominantEntryMcapBucketShare);
    // highCapShare dropped (collinear r=0.95 w/ weightedMedian in standardized space).
    mcap.weightedMedian,
    clamp01(bothBuySellRatio),
    clamp01(behavior.percentageOfUnpairedTokens),
    Math.log1p(nonNegative(behavior.averageSessionDurationMinutes)),
    clamp01(behavior.percentOfValueInCurrentHoldings),
    clamp01(behavior.dominantEntryMcapBucketShare),
    Math.log1p(nonNegative(behavior.avgEntryMcap) + 1),
    // onlyBuysRatio dropped — near-inverse (r=-0.95) of bothBuySellRatio; the
    // buy-only-vs-round-trip axis is already carried by bothBuySellRatio + unpaired.
    Math.log1p(nonNegative(behavior.activeTradingDays)),
    Math.log1p(nonNegative(behavior.medianActiveHoldingHours)),
    // v2 adds:
    completedHold,
    hasCompleted ? 1 : 0,
    clamp01(sellSkew),
    Math.sin(hourRad),
    Math.cos(hourRad),
    holdingConviction,
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

// v2 per-axis weights (applied to the standardized z-score, so they are NOT
// cancelled by scale normalization). Descriptive/hand-set — NO learned weights.
// Rationale (adversarial-review GAP: rare types diluted by the speed bloc):
//   - down-weight the redundant speed/session/count cluster that dominated v1
//     geometry (indices 5-11, 21) so it stops swamping the sparse types;
//   - up-weight the holding-conviction + closed-hold + sell-skew axes (17,22-25,
//     28,29) that separate PURE_HOLDER/DISTRIBUTOR from the fast-trade mass.
// Length MUST equal WALLET_VECTOR_SOURCE_DIMENSIONS. Order matches the builder.
export const WALLET_VECTOR_AXIS_WEIGHTS: number[] = [
  1.0, // 0  buySellSymmetry
  1.2, // 1  medianHoldTime
  1.0, // 2  averageFlipDurationHours
  1.0, // 3  winRate
  1.0, // 4  buySellRatio
  0.7, // 5  sequenceConsistency (speed bloc)
  0.7, // 6  %<1h (speed bloc)
  0.8, // 7  reentryRate
  0.6, // 8  sessionCount (activity magnitude)
  0.7, // 9  avgTradesPerSession (activity magnitude)
  0.8, // 10 uniqueTokens
  0.8, // 11 averageTradesPerToken
  1.2, // 12 mcap.weightedMedian
  1.0, // 13 bothBuySellRatio
  1.0, // 14 percentageOfUnpairedTokens
  0.7, // 15 sessionDuration (activity magnitude)
  1.5, // 16 percentOfValueInCurrentHoldings (holder axis)
  1.0, // 17 dominantEntryMcapBucketShare
  1.0, // 18 avgEntryMcap
  0.7, // 19 activeTradingDays (activity magnitude)
  1.3, // 20 medianActiveHoldingHours (open-position axis)
  1.4, // 21 completedHold (closed round-trip tempo)
  1.4, // 22 hasCompleted presence
  1.6, // 23 sellSkew (DISTRIBUTOR separator)
  1.0, // 24 sessionStart sin
  1.0, // 25 sessionStart cos
  1.8, // 26 holdingConviction (PURE_HOLDER separator, single merged dim)
];

if (WALLET_VECTOR_AXIS_WEIGHTS.length !== WALLET_VECTOR_SOURCE_DIMENSIONS) {
  throw new Error(
    `WALLET_VECTOR_AXIS_WEIGHTS length ${WALLET_VECTOR_AXIS_WEIGHTS.length} != ${WALLET_VECTOR_SOURCE_DIMENSIONS}`,
  );
}

export function standardizeWalletVector(sourceVector: number[], stats: Pick<PopulationVectorStats, 'means' | 'scales'>): number[] {
  if (sourceVector.length !== WALLET_VECTOR_SOURCE_DIMENSIONS) {
    throw new Error(`Expected ${WALLET_VECTOR_SOURCE_DIMENSIONS} source dimensions, got ${sourceVector.length}`);
  }
  if (stats.means.length !== WALLET_VECTOR_SOURCE_DIMENSIONS || stats.scales.length !== WALLET_VECTOR_SOURCE_DIMENSIONS) {
    throw new Error(`Population stats do not match wallet vector schema (expected ${WALLET_VECTOR_SOURCE_DIMENSIONS} dims)`);
  }

  const standardized = sourceVector.map((value, index) => {
    const scale = stats.scales[index] > 0 ? stats.scales[index] : 1;
    const z = (value - stats.means[index]) / scale;
    return roundVectorNumber(z * WALLET_VECTOR_AXIS_WEIGHTS[index]);
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

// v2 mcap fix (MCAP-VEC-BUG): the DB stores dollar-range keys, not the legacy
// word keys the v1 reader used. Ordered buckets with a representative log10(mcap)
// rank per bucket, so we can derive a continuous positioning signal instead of 6
// mostly-empty one-hot dims.
const MCAP_BUCKETS: { key: string; rank: number }[] = [
  { key: '0-10k', rank: 0 },
  { key: '10-20k', rank: 1 },
  { key: '20-30k', rank: 2 },
  { key: '30-50k', rank: 3 },
  { key: '50-100k', rank: 4 },
  { key: '100-200k', rank: 5 },
  { key: '200-500k', rank: 6 },
  { key: '500k-1m', rank: 7 },
  { key: '1m+', rank: 8 },
];
const MCAP_MAX_RANK = 8;
const MCAP_HIGHCAP_MIN_RANK = 5; // >=100k

function readMcapDistribution(value: Prisma.JsonValue | null): {
  weightedMedian: number; // normalized [0,1] weighted-mean bucket rank (positioning)
  concentration: number; // [0,1] Herfindahl-style share concentration (specialist vs spread)
  highCapShare: number; // [0,1] share of weight in >=100k buckets
} {
  const empty = { weightedMedian: 0, concentration: 0, highCapShare: 0 };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  const record = value as Record<string, unknown>;

  const weights = MCAP_BUCKETS.map((b) => Math.max(0, safeNumber(record[b.key])));
  const total = weights.reduce((a, w) => a + w, 0);
  if (total <= 0) return empty;

  const norm = weights.map((w) => w / total);
  const weightedRank = norm.reduce((acc, w, i) => acc + w * MCAP_BUCKETS[i].rank, 0);
  const concentration = norm.reduce((acc, w) => acc + w * w, 0); // 1=single bucket, ->0 spread
  const highCapShare = MCAP_BUCKETS.reduce(
    (acc, b, i) => (b.rank >= MCAP_HIGHCAP_MIN_RANK ? acc + norm[i] : acc),
    0,
  );

  return {
    weightedMedian: clamp01(weightedRank / MCAP_MAX_RANK),
    concentration: clamp01(concentration),
    highCapShare: clamp01(highCapShare),
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
