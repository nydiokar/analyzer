/**
 * AGENT_13 Deliverable 2 — calibrated capital outcome-by-analogy scorer (pure core).
 *
 * Given a wallet's capital-kNN neighborhood (each neighbor's realizedPnl + dataQuality)
 * and the wallet's own standardized capital source vector, produce a CALIBRATED
 * EXPECTATION — never a binary skilled/not label:
 *   - profitable fraction of the (dq-gated) neighborhood + a Wilson 95% CI (honest about n),
 *   - median neighbor PnL + IQR (distribution, not a point claim),
 *   - reason codes = which of the wallet's OWN capital axes stand out vs population,
 *   - a confidence tier driven by n and neighborhood dataQuality.
 *
 * Thesis-gate (AGENT_13_THESIS_GATE_2026-07-14): a rich capital neighborhood tracks a
 * profitable seed at the tails (1.00 vs 0.00 vs 0.39 baseline) — but the signal is soft
 * in the middle, so the scorer reports the full gradient + CI, not the tail illusion.
 *
 * Pure + deterministic: no DB, no clock. The DB helper feeds it; tests pin it.
 */

/** Human-readable capital axis names, index-aligned to buildCapitalSourceVector. */
export const CAPITAL_AXIS_LABELS: readonly string[] = [
  'capital deployed (volume)',
  'realized profitability',
  'capital efficiency (pnl/volume)',
  'per-trade efficiency',
  'token win rate',
  'outcome consistency',
  'liquidity (dry powder)',
  'realized share (vs paper gains)',
] as const;

export interface OutcomeNeighbor {
  walletAddress: string;
  realizedPnl: number;
  dataQuality: number;
  distance: number;
}

export interface ReasonCode {
  axis: string;
  /** standardized value (population z-score); sign = direction, magnitude = how unusual */
  z: number;
  direction: 'high' | 'low';
}

export type ConfidenceTier = 'high' | 'medium' | 'low' | 'insufficient';

export interface CapitalOutcomeScore {
  walletAddress: string;
  /** neighbors that passed the dq gate and fed the estimate */
  neighborCount: number;
  /** neighbors dropped by the dq gate (surfaced for honesty) */
  neighborsBelowQuality: number;
  neighborhoodDataQuality: number; // mean dq of the used neighbors
  profitableFraction: number; // p
  profitableCI95: [number, number]; // Wilson score interval on p
  medianNeighborPnl: number;
  neighborPnlIQR: [number, number];
  /** population base rate passed in (so the score is read RELATIVE to it, not absolutely) */
  populationBaseRate: number | null;
  /** lift over population base rate (profitableFraction - baseRate), null if no baseline */
  liftOverBaseRate: number | null;
  confidence: ConfidenceTier;
  reasonCodes: ReasonCode[];
  /** one-line honest expectation, no binary label */
  expectation: string;
}

const Z95 = 1.959963984540054;

/** Wilson score interval for a binomial proportion — honest at small n, unlike normal approx. */
export function wilsonInterval(successes: number, n: number, z: number = Z95): [number, number] {
  if (n === 0) return [0, 1];
  const phat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n))) / denom;
  return [clamp01(center - margin), clamp01(center + margin)];
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Reason codes from the wallet's OWN standardized capital source vector: the axes whose
 * |z| is largest are what make this wallet unusual. Cheap and legible — no extra query.
 */
export function deriveReasonCodes(
  standardizedSourceVector: number[] | null,
  maxCodes: number = 3,
  minAbsZ: number = 0.75,
): ReasonCode[] {
  if (!standardizedSourceVector || standardizedSourceVector.length === 0) return [];
  return standardizedSourceVector
    .slice(0, CAPITAL_AXIS_LABELS.length)
    .map((z, i) => ({ axis: CAPITAL_AXIS_LABELS[i] ?? `axis ${i}`, z, direction: (z >= 0 ? 'high' : 'low') as 'high' | 'low' }))
    .filter((r) => Math.abs(r.z) >= minAbsZ)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, maxCodes);
}

export interface ScoreInput {
  walletAddress: string;
  neighbors: OutcomeNeighbor[];
  standardizedSourceVector: number[] | null;
  /** dq gate — neighbors below this are excluded from the estimate (default 0.9). */
  dataQualityGate?: number;
  /** minimum used-neighbor count to emit anything but 'insufficient' (default 8). */
  minNeighbors?: number;
  /** population profitable base rate for lift framing (optional but recommended). */
  populationBaseRate?: number | null;
}

export function scoreCapitalOutcome(input: ScoreInput): CapitalOutcomeScore {
  const gate = input.dataQualityGate ?? 0.9;
  const minNeighbors = input.minNeighbors ?? 8;

  const used = input.neighbors.filter((n) => n.dataQuality > gate);
  const belowQuality = input.neighbors.length - used.length;
  const reasonCodes = deriveReasonCodes(input.standardizedSourceVector);
  const baseRate = input.populationBaseRate ?? null;

  if (used.length < minNeighbors) {
    return {
      walletAddress: input.walletAddress,
      neighborCount: used.length,
      neighborsBelowQuality: belowQuality,
      neighborhoodDataQuality: used.length ? mean(used.map((n) => n.dataQuality)) : 0,
      profitableFraction: 0,
      profitableCI95: [0, 1],
      medianNeighborPnl: 0,
      neighborPnlIQR: [0, 0],
      populationBaseRate: baseRate,
      liftOverBaseRate: null,
      confidence: 'insufficient',
      reasonCodes,
      expectation:
        `Insufficient high-quality analogues (${used.length} of ${input.neighbors.length} neighbors above dataQuality ${gate}). No calibrated outcome estimate.`,
    };
  }

  const successes = used.filter((n) => n.realizedPnl > 0).length;
  const p = successes / used.length;
  const ci = wilsonInterval(successes, used.length);
  const pnls = used.map((n) => n.realizedPnl).sort((a, b) => a - b);
  const med = median(pnls);
  const iqr: [number, number] = [quantile(pnls, 0.25), quantile(pnls, 0.75)];
  const nbhdDq = mean(used.map((n) => n.dataQuality));
  const lift = baseRate === null ? null : p - baseRate;

  // Confidence: driven by n AND neighborhood dq AND CI width (a wide CI = low confidence
  // even at large n). This is what stops the tail illusion from over-claiming.
  const ciWidth = ci[1] - ci[0];
  let confidence: ConfidenceTier;
  if (used.length >= 15 && nbhdDq >= 0.95 && ciWidth <= 0.35) confidence = 'high';
  else if (used.length >= 10 && ciWidth <= 0.5) confidence = 'medium';
  else confidence = 'low';

  return {
    walletAddress: input.walletAddress,
    neighborCount: used.length,
    neighborsBelowQuality: belowQuality,
    neighborhoodDataQuality: round(nbhdDq),
    profitableFraction: round(p),
    profitableCI95: [round(ci[0]), round(ci[1])],
    medianNeighborPnl: round(med),
    neighborPnlIQR: [round(iqr[0]), round(iqr[1])],
    populationBaseRate: baseRate === null ? null : round(baseRate),
    liftOverBaseRate: lift === null ? null : round(lift),
    confidence,
    reasonCodes,
    expectation: buildExpectation(p, ci, med, used.length, lift, confidence),
  };
}

function buildExpectation(
  p: number,
  ci: [number, number],
  med: number,
  n: number,
  lift: number | null,
  confidence: ConfidenceTier,
): string {
  const pct = Math.round(p * 100);
  const lo = Math.round(ci[0] * 100);
  const hi = Math.round(ci[1] * 100);
  const liftStr =
    lift === null ? '' : lift >= 0
      ? ` (+${Math.round(lift * 100)} pts vs population)`
      : ` (${Math.round(lift * 100)} pts vs population)`;
  return (
    `Capital-analogue neighborhood (n=${n}, ${confidence} confidence): ` +
    `${pct}% profitable [95% CI ${lo}–${hi}%]${liftStr}, median realized PnL ${med} SOL. ` +
    `Read as a calibrated expectation by analogy, not a verdict.`
  );
}

function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

function round(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : 0;
}
