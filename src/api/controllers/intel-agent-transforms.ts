/**
 * intel-agent-transforms.ts
 *
 * Transform helpers for /agent endpoint variants.
 *
 * These functions map the full developer-facing payloads to compact,
 * agent-optimised shapes. The transformation happens at read time —
 * no new queue jobs, no separate compute. The same underlying job runs;
 * the result is just mapped differently when stored under the agent key.
 *
 * Agent result Redis keys:
 *   holder-profiles:agent:result:{jobId}
 *   similarity:agent:result:{requestId}
 *
 * Both use the same TTL as their full counterparts (set by caller).
 */

import type { HolderProfile, HolderProfilesResult } from '../../queues/jobs/types';
import type { CombinedSimilarityResult, CombinedPairwiseSimilarity } from '../../types/similarity';

// ─────────────────────────────────────────────────────────────────────────────
// HOLDER PROFILES — agent shape
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentHoldingsSummary {
  totalPositions: number | null;
  percentValueInCurrentHoldings: number | null;
  topHoldings: Array<{ tokenAddress: string; valueSol: number }>;
}

export interface AgentHolderProfile {
  walletAddress: string;
  rank: number;
  supplyPercent: number;
  tokenHoldingValueSol: number | null;
  // Known-wallet stubs
  analysisSkipped?: boolean;
  knownType?: string;
  knownLabel?: string;
  // Behavioral signals — kept in full
  behaviorType: string | null;
  exitPattern: string | null;
  medianHoldTimeHours: number | null;
  dataQualityTier: string;
  confidence: number;
  completedCycleCount: number;
  walletPnlSol: number | null;
  solBalance: number | null;
  // Replaces currentHoldings[]
  holdingsSummary: AgentHoldingsSummary;
}

/**
 * Behavior types considered "fast money" (short-term traders).
 * Used for the aggregate clusterAlert field.
 */
const FAST_MONEY_TYPES = new Set(['SNIPER', 'SCALPER', 'MOMENTUM']);

export interface AgentHolderAggregate {
  totalHolders: number;
  analyzedHolders: number;
  /** supply % held by top 1 holder */
  top1SupplyPct: number;
  /** supply % held by top 5 holders */
  top5SupplyPct: number;
  /** count per behaviorType, sorted desc by count */
  behaviorDistribution: Array<{ behaviorType: string; count: number; supplyPct: number }>;
  /** % of analyzed holders whose behaviorType is SNIPER, SCALPER, or MOMENTUM */
  fastMoneyPct: number;
  /**
   * "HIGH" when >60% of analyzed holders are fast-money types (high churn risk).
   * "MEDIUM" when >35%.
   * "LOW" otherwise.
   * Derived purely from behaviorDistribution — no invented signal.
   */
  clusterAlert: 'HIGH' | 'MEDIUM' | 'LOW';
  avgWalletPnlSol: number | null;
}

export interface AgentHolderProfilesResult {
  aggregate: AgentHolderAggregate;
  profiles: AgentHolderProfile[];
  metadata: {
    tokenMint: string | undefined;
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
  };
}

/** Map one full HolderProfile → slim AgentHolderProfile */
export function buildAgentHolderProfile(profile: HolderProfile): AgentHolderProfile {
  // Build holdingsSummary from currentHoldings[]
  const holdings = profile.currentHoldings ?? [];
  const topHoldings = holdings
    .filter((h) => typeof h.valueSol === 'number' && h.valueSol > 0)
    .sort((a, b) => (b.valueSol ?? 0) - (a.valueSol ?? 0))
    .slice(0, 5)
    .map((h) => ({ tokenAddress: h.tokenAddress, valueSol: h.valueSol as number }));

  const holdingsSummary: AgentHoldingsSummary = {
    totalPositions: profile.currentHoldingsCount ?? holdings.length,
    percentValueInCurrentHoldings: profile.percentValueInCurrentHoldings ?? null,
    topHoldings,
  };

  return {
    walletAddress: profile.walletAddress,
    rank: profile.rank,
    supplyPercent: profile.supplyPercent,
    tokenHoldingValueSol: profile.tokenHoldingValueSol ?? null,
    // Known-wallet stubs — pass through when present
    ...(profile.analysisSkipped != null && { analysisSkipped: profile.analysisSkipped }),
    ...(profile.knownType != null && { knownType: profile.knownType }),
    ...(profile.knownLabel != null && { knownLabel: profile.knownLabel }),
    // Behavioral signals
    behaviorType: profile.behaviorType,
    exitPattern: profile.exitPattern,
    medianHoldTimeHours: profile.medianHoldTimeHours,
    dataQualityTier: profile.dataQualityTier,
    confidence: profile.confidence,
    completedCycleCount: profile.completedCycleCount,
    walletPnlSol: profile.walletPnlSol ?? null,
    solBalance: profile.solBalance ?? null,
    holdingsSummary,
  };
}

/** Build population-level aggregate from the full profiles array */
function buildAgentHolderAggregate(profiles: HolderProfile[]): AgentHolderAggregate {
  const analyzedProfiles = profiles.filter((p) => !p.analysisSkipped);

  // Supply concentration
  const sorted = [...profiles].sort((a, b) => b.supplyPercent - a.supplyPercent);
  const top1SupplyPct = sorted[0]?.supplyPercent ?? 0;
  const top5SupplyPct = sorted.slice(0, 5).reduce((sum, p) => sum + p.supplyPercent, 0);

  // Behavior distribution over analyzed profiles only
  const countMap = new Map<string, { count: number; supplyPct: number }>();
  for (const p of analyzedProfiles) {
    const bt = p.behaviorType ?? 'UNKNOWN';
    const entry = countMap.get(bt) ?? { count: 0, supplyPct: 0 };
    entry.count += 1;
    entry.supplyPct += p.supplyPercent;
    countMap.set(bt, entry);
  }

  const behaviorDistribution = [...countMap.entries()]
    .map(([behaviorType, { count, supplyPct }]) => ({
      behaviorType,
      count,
      supplyPct: Math.round(supplyPct * 1000) / 1000,
    }))
    .sort((a, b) => b.count - a.count);

  // Fast-money %
  const fastMoneyCount = analyzedProfiles.filter(
    (p) => p.behaviorType != null && FAST_MONEY_TYPES.has(p.behaviorType),
  ).length;
  const fastMoneyPct =
    analyzedProfiles.length > 0
      ? Math.round((fastMoneyCount / analyzedProfiles.length) * 1000) / 1000
      : 0;

  const clusterAlert: 'HIGH' | 'MEDIUM' | 'LOW' =
    fastMoneyPct > 0.6 ? 'HIGH' : fastMoneyPct > 0.35 ? 'MEDIUM' : 'LOW';

  // Average PnL over analyzed profiles that have walletPnlSol
  const pnlValues = analyzedProfiles
    .map((p) => p.walletPnlSol)
    .filter((v): v is number => typeof v === 'number');
  const avgWalletPnlSol =
    pnlValues.length > 0
      ? Math.round((pnlValues.reduce((sum, v) => sum + v, 0) / pnlValues.length) * 100) / 100
      : null;

  return {
    totalHolders: profiles.length,
    analyzedHolders: analyzedProfiles.length,
    top1SupplyPct: Math.round(top1SupplyPct * 1000) / 1000,
    top5SupplyPct: Math.round(top5SupplyPct * 1000) / 1000,
    behaviorDistribution,
    fastMoneyPct,
    clusterAlert,
    avgWalletPnlSol,
  };
}

/** Map full HolderProfilesResult → AgentHolderProfilesResult */
export function buildAgentHolderProfilesResult(
  result: HolderProfilesResult,
): AgentHolderProfilesResult {
  const slimProfiles = result.profiles.map(buildAgentHolderProfile);
  const aggregate = buildAgentHolderAggregate(result.profiles);

  return {
    aggregate,
    profiles: slimProfiles,
    metadata: {
      tokenMint: result.tokenMint,
      totalHoldersRequested: result.metadata.totalHoldersRequested,
      totalHoldersAnalyzed: result.metadata.totalHoldersAnalyzed,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMILARITY — agent shape
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentSimilarityOverlap {
  walletA: string;
  walletB: string;
  /** capitalScore from CombinedPairwiseSimilarity — primary score used throughout the product */
  similarityScore: number;
  binarySharedTokenCount: number;
  capitalSharedTokenCount: number;
}

export interface AgentFlaggedPair {
  walletA: string;
  walletB: string;
  similarityScore: number;
}

export interface AgentSimilarityResult {
  /**
   * coordinationScore: weighted average of top-10 pair capitalScores.
   * Weights are positional (rank 1 = weight N, rank N = weight 1) so top
   * pairs contribute more. Range 0–1. Single number for quick agent decisions.
   */
  coordinationScore: number;
  /**
   * Pairs with capitalScore > 0.7 — direct coordination signal.
   */
  flaggedPairs: AgentFlaggedPair[];
  /**
   * Top 10 pairs sorted descending by capitalScore.
   * No sharedTokens[] arrays — only counts.
   */
  topOverlaps: AgentSimilarityOverlap[];
  globalMetrics: {
    averageSimilarity: number;
    clusterCount: number;
  };
  metadata: {
    walletCount: number;
    vectorTypeUsed: string;
  };
}

const COORDINATION_FLAG_THRESHOLD = 0.7;
const TOP_OVERLAPS_LIMIT = 10;

/** Map full CombinedSimilarityResult → AgentSimilarityResult */
export function buildAgentSimilarityResult(
  result: CombinedSimilarityResult,
  walletCount: number,
): AgentSimilarityResult {
  // Sort all pairs descending by capitalScore
  const sortedPairs = [...result.pairwiseSimilarities].sort(
    (a, b) => b.capitalScore - a.capitalScore,
  );

  const topPairs = sortedPairs.slice(0, TOP_OVERLAPS_LIMIT);

  // coordinationScore: weighted average where rank-1 pair has weight N, rank-N has weight 1
  const n = topPairs.length;
  let coordinationScore = 0;
  if (n > 0) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < n; i++) {
      const weight = n - i; // rank 1 = n, rank n = 1
      weightedSum += topPairs[i].capitalScore * weight;
      totalWeight += weight;
    }
    coordinationScore = Math.round((weightedSum / totalWeight) * 1000) / 1000;
  }

  const flaggedPairs: AgentFlaggedPair[] = sortedPairs
    .filter((p) => p.capitalScore > COORDINATION_FLAG_THRESHOLD)
    .map((p) => ({
      walletA: p.walletA,
      walletB: p.walletB,
      similarityScore: Math.round(p.capitalScore * 1000) / 1000,
    }));

  const topOverlaps: AgentSimilarityOverlap[] = topPairs.map((p) => ({
    walletA: p.walletA,
    walletB: p.walletB,
    similarityScore: Math.round(p.capitalScore * 1000) / 1000,
    binarySharedTokenCount: p.binarySharedTokenCount,
    capitalSharedTokenCount: p.capitalSharedTokenCount,
  }));

  // clusters come from the similarity flow — stored in the full result?
  // CombinedSimilarityResult doesn't carry clusters directly; globalMetrics has averageSimilarity.
  // Cluster count is not available on CombinedSimilarityResult — omit rather than invent.
  const clusterCount = 0; // not available in CombinedSimilarityResult shape

  return {
    coordinationScore,
    flaggedPairs,
    topOverlaps,
    globalMetrics: {
      averageSimilarity:
        Math.round((result.globalMetrics?.averageSimilarity ?? 0) * 1000) / 1000,
      clusterCount,
    },
    metadata: {
      walletCount,
      vectorTypeUsed: result.vectorTypeUsed,
    },
  };
}
