import type { AdvancedTradeStats, WalletPnlSummary } from '@prisma/client';

/**
 * Capital / outcome feature vector — the MONEY axis, a SEPARATE embedding beside
 * the behavior vector (never merged into WalletVector). Mirrors the behavior
 * builder's shape exactly: build source -> population stats -> standardize -> pad.
 *
 * Design is gated by CAPITAL_METRICS_AUDIT_2026-07-13.md (Part A, GREEN) with three
 * hard requirements carried in here:
 *   - profitability uses REALIZED PnL (not net — net folds in unrealized paper gains),
 *   - every magnitude/profit dim is signed-log + winsorized (no whale dominates
 *     cosine geometry; no unbounded dim),
 *   - a bounded dataQuality [0,1] is computed alongside and MUST ride with every
 *     neighbor result (untracked transfers / paper gains / dust volume corrupt money).
 */

export const CAPITAL_VECTOR_SCHEMA_VERSION = 1;
export const CAPITAL_VECTOR_SOURCE_DIMENSIONS = 8;
export const CAPITAL_VECTOR_STORAGE_DIMENSIONS = 16;

type PnlLike = Pick<
  WalletPnlSummary,
  | 'realizedPnl'
  | 'totalVolume'
  | 'realizedPnlToTotalVolumeRatio'
  | 'averageSwapSize'
  | 'currentSolBalance'
  | 'unrealizedPnl'
>;

type CapitalAdvancedStatsLike = Pick<
  AdvancedTradeStats,
  | 'tokenWinRatePercent'
  | 'trimmedMeanPnlPerToken'
  | 'standardDeviationPnl'
> | null;

export interface CapitalFeatureSource {
  pnl: PnlLike;
  advancedStats: CapitalAdvancedStatsLike;
  /** Existing per-wallet quality signal from WalletBehaviorProfile.confidenceScore (0..1). */
  confidenceScore: number | null;
}

export interface CapitalPopulationVectorStats {
  means: number[];
  scales: number[];
  walletCount: number;
}

/**
 * Bounded source vector. Axes (audit §3): magnitude, profitability, efficiency,
 * per-trade efficiency, win-rate, consistency, liquidity, + realized-share signal.
 * Every magnitude/profit dim is signed-log then winsorized to a fixed band so the
 * population-standardization step is not dominated by whales.
 */
export function buildCapitalSourceVector(source: CapitalFeatureSource): number[] {
  const pnl = source.pnl;
  const stats = source.advancedStats;

  const realizedPnl = safeNumber(pnl.realizedPnl);
  const totalVolume = nonNegative(pnl.totalVolume);
  const unrealized = safeNumber(pnl.unrealizedPnl);

  // Realized-share of gross outcome: separates realized skill from paper gains.
  // 1.0 = all outcome is realized; ->0 = dominated by unrealized (honesty risk).
  const grossAbs = Math.abs(realizedPnl) + Math.abs(unrealized);
  const realizedShare = grossAbs > 0 ? Math.abs(realizedPnl) / grossAbs : 1;

  return [
    // 0 magnitude — how much capital moves (signed-log unnecessary; volume >= 0)
    winsorLog(totalVolume, 0, LOG_VOLUME_CAP),
    // 1 profitability — REALIZED pnl, signed-log + winsorized both directions
    signedWinsorLog(realizedPnl, LOG_PNL_CAP),
    // 2 efficiency — pnl per unit volume, clamped to a sane band (dust ratios are noise)
    clamp(safeNumber(pnl.realizedPnlToTotalVolumeRatio), -RVR_CAP, RVR_CAP) / RVR_CAP,
    // 3 per-trade efficiency — trimmed-mean pnl/token (robust), signed-log + winsorized
    signedWinsorLog(safeNumber(stats?.trimmedMeanPnlPerToken), LOG_PNL_CAP),
    // 4 win-rate — already [0,1]
    clamp01(safeNumber(stats?.tokenWinRatePercent) / 100),
    // 5 consistency — inverse PnL volatility. profitConsistencyIndex is NOT bounded
    // (range -120e9..132 on :5434, clamp01 would kill it -> dead dim), so use
    // standardDeviationPnl (median 1.05, p99 49): 1 - winsorLog(sd) => high when
    // outcomes are repeatable, low when erratic. Bounded [0,1]. Guard: sd==0 means
    // "no completed trades" (~5%), NOT "perfectly consistent" -> neutral 0.5, so a
    // never-seller doesn't falsely cluster as maximally consistent (GAP-A lesson).
    consistencyDim(stats?.standardDeviationPnl),
    // 6 liquidity / dry powder — current SOL balance, winsor-log
    winsorLog(nonNegative(pnl.currentSolBalance), 0, LOG_BALANCE_CAP),
    // 7 realized-share — honesty-aware profitability discount signal
    clamp01(realizedShare),
  ];
}

/**
 * Bounded per-wallet data-quality score [0,1] (audit §4). Rides with every capital
 * vector so downstream never treats a neighbor as ground-truth "skilled". Low means
 * the money numbers are suspect (dust volume, paper-gain-dominated, low confidence).
 */
export function computeCapitalDataQuality(source: CapitalFeatureSource): number {
  const pnl = source.pnl;
  const realized = Math.abs(safeNumber(pnl.realizedPnl));
  const unrealized = Math.abs(safeNumber(pnl.unrealizedPnl));
  const volume = nonNegative(pnl.totalVolume);

  let q = clamp01(source.confidenceScore ?? 0.5);
  // Paper-gain penalty: unrealized dwarfing realized => outcome isn't realized skill.
  if (realized > 0 && unrealized > 5 * realized) q *= 0.5;
  else if (realized === 0 && unrealized > 0) q *= 0.6;
  // Dust-volume penalty: sub-0.1 SOL volume => PnL statistically meaningless.
  if (volume < 0.1) q *= 0.4;
  return clamp01(q);
}

export function padCapitalVector(sourceVector: number[]): number[] {
  if (sourceVector.length !== CAPITAL_VECTOR_SOURCE_DIMENSIONS) {
    throw new Error(`Expected ${CAPITAL_VECTOR_SOURCE_DIMENSIONS} source dimensions, got ${sourceVector.length}`);
  }
  return [
    ...sourceVector,
    ...Array.from({ length: CAPITAL_VECTOR_STORAGE_DIMENSIONS - CAPITAL_VECTOR_SOURCE_DIMENSIONS }, () => 0),
  ];
}

export function computeCapitalPopulationStats(sourceVectors: number[][]): CapitalPopulationVectorStats {
  if (sourceVectors.length === 0) {
    return {
      means: Array.from({ length: CAPITAL_VECTOR_SOURCE_DIMENSIONS }, () => 0),
      scales: Array.from({ length: CAPITAL_VECTOR_SOURCE_DIMENSIONS }, () => 1),
      walletCount: 0,
    };
  }
  for (const vector of sourceVectors) {
    if (vector.length !== CAPITAL_VECTOR_SOURCE_DIMENSIONS) {
      throw new Error(`Expected ${CAPITAL_VECTOR_SOURCE_DIMENSIONS} source dimensions, got ${vector.length}`);
    }
  }
  const means = Array.from({ length: CAPITAL_VECTOR_SOURCE_DIMENSIONS }, (_, index) => {
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

export function standardizeCapitalVector(
  sourceVector: number[],
  stats: Pick<CapitalPopulationVectorStats, 'means' | 'scales'>,
): number[] {
  if (sourceVector.length !== CAPITAL_VECTOR_SOURCE_DIMENSIONS) {
    throw new Error(`Expected ${CAPITAL_VECTOR_SOURCE_DIMENSIONS} source dimensions, got ${sourceVector.length}`);
  }
  if (stats.means.length !== CAPITAL_VECTOR_SOURCE_DIMENSIONS || stats.scales.length !== CAPITAL_VECTOR_SOURCE_DIMENSIONS) {
    throw new Error(`Capital population stats do not match schema (expected ${CAPITAL_VECTOR_SOURCE_DIMENSIONS} dims)`);
  }
  const standardized = sourceVector.map((value, index) => {
    const scale = stats.scales[index] > 0 ? stats.scales[index] : 1;
    return roundVectorNumber((value - stats.means[index]) / scale);
  });
  return padCapitalVector(standardized);
}

export function capitalVectorToSqlLiteral(vector: number[]): string {
  if (vector.length !== CAPITAL_VECTOR_STORAGE_DIMENSIONS) {
    throw new Error(`Expected ${CAPITAL_VECTOR_STORAGE_DIMENSIONS} storage dimensions, got ${vector.length}`);
  }
  return `[${vector.map(roundVectorNumber).join(',')}]`;
}

// --- bounding helpers (winsorized signed-log) ---

// Caps chosen from the audit's p99 bands on :5434 (SOL units): volume/balance/pnl
// live in ~0..thousands; ln(1+x) compresses that to ~0..8, then normalized by the cap.
const LOG_VOLUME_CAP = 10; // ln(1+~22000)
const LOG_BALANCE_CAP = 8; // ln(1+~2980)
const LOG_PNL_CAP = 9; // ln(1+~8100)
const LOG_SDPNL_CAP = 4; // ln(1+~54); standardDeviationPnl p99≈49
const RVR_CAP = 2; // realizedPnlToTotalVolumeRatio clamp band

/**
 * Consistency dim from standardDeviationPnl. sd==0 (or null) means the wallet has
 * no completed trades to be consistent OR erratic about -> return neutral 0.5, not
 * the spurious 1.0 that `1 - winsorLog(0)` would give.
 */
function consistencyDim(sd: number | null): number {
  const v = safeNumber(sd);
  if (v <= 0) return 0.5;
  return clamp01(1 - winsorLog(v, 0, LOG_SDPNL_CAP));
}

/** log1p normalized to [0,1] by a cap; input assumed >= 0. */
function winsorLog(value: number, min: number, cap: number): number {
  const v = clamp(value, min, Number.POSITIVE_INFINITY);
  return clamp01(Math.log1p(v) / cap);
}

/** signed log1p normalized to [-1,1] by a cap; preserves loss vs profit sign. */
function signedWinsorLog(value: number, cap: number): number {
  const s = Math.sign(value);
  return clamp(s * (Math.log1p(Math.abs(value)) / cap), -1, 1);
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
