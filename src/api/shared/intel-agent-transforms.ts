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
  /** Sum of valueSol across ALL current holdings (not just top 5) */
  totalCurrentHoldingsValueSol: number | null;
  /** Top 5 current holdings by SOL value */
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


export interface AgentHolderAggregate {
  totalHolders: number;
  analyzedHolders: number;
  /** supply % held by top 1 non-LP/non-skipped holder */
  top1SupplyPct: number;
  /** supply % held by top 5 non-LP/non-skipped holders */
  top5SupplyPct: number;
  /**
   * Count and supply % per behavior type, sorted desc by count.
   * Null behaviorType on analyzed (non-skipped) wallets surfaces as "FRESH"
   * — unclassified wallets with insufficient data to determine trading style.
   * Skipped wallets (LP, burn, system) are excluded entirely.
   */
  behaviorDistribution: Array<{ behaviorType: string; count: number; supplyPct: number }>;
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

  const totalCurrentHoldingsValueSol = holdings.length > 0
    ? holdings.reduce((sum, h) => sum + (typeof h.valueSol === 'number' ? h.valueSol : 0), 0)
    : null;

  const holdingsSummary: AgentHoldingsSummary = {
    totalPositions: profile.currentHoldingsCount ?? holdings.length,
    totalCurrentHoldingsValueSol:
      totalCurrentHoldingsValueSol != null
        ? Math.round(totalCurrentHoldingsValueSol * 1000) / 1000
        : null,
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

  // Supply concentration — exclude skipped wallets (LP, burn, system) so an LP
  // sitting at rank 1 doesn't dominate the top1/top5 numbers
  const tradableProfiles = [...analyzedProfiles].sort((a, b) => b.supplyPercent - a.supplyPercent);
  const top1SupplyPct = tradableProfiles[0]?.supplyPercent ?? 0;
  const top5SupplyPct = tradableProfiles.slice(0, 5).reduce((sum, p) => sum + p.supplyPercent, 0);

  // Behavior distribution over analyzed profiles only.
  // null behaviorType on a non-skipped profile = wallet exists but has insufficient
  // data to classify — surface as "FRESH" (same label the bots use for new wallets)
  const countMap = new Map<string, { count: number; supplyPct: number }>();
  for (const p of analyzedProfiles) {
    const bt = p.behaviorType ?? 'FRESH';
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

export interface AgentSimilarityPair {
  walletA: string;
  walletB: string;
  /**
   * Combined similarity score: binaryScore*0.6 + capitalScore*0.4.
   * Same formula as SimilaritySidebar and OG image (behavioral weighted higher).
   */
  similarityScore: number;
  /** Number of tokens both wallets traded (binary set intersection) */
  sharedTokenCount: number;
  /** Total unique tokens in walletA's portfolio */
  portfolioSizeA: number;
  /** Total unique tokens in walletB's portfolio */
  portfolioSizeB: number;
  /** Fraction of walletA's portfolio shared with walletB — mirrors "95%" in UI */
  overlapPctA: number;
  /** Fraction of walletB's portfolio shared with walletA — mirrors "32%" in UI */
  overlapPctB: number;
  /**
   * Present when this pair crosses a coordination threshold.
   * HIGH_SIMILARITY: combinedScore > 0.7
   * HIGH_OVERLAP: either wallet >50% overlap OR >=20 shared tokens with >=20% overlap in either wallet
   * HIGH_SIMILARITY_AND_OVERLAP: both
   */
  flag?: 'HIGH_SIMILARITY' | 'HIGH_OVERLAP' | 'HIGH_SIMILARITY_AND_OVERLAP';
}

export interface AgentSimilarityResult {
  /**
   * Weighted average of all meaningful pair scores (rank-1 = weight N, rank-N = weight 1).
   * Range 0–1. Single number for quick agent decisions.
   */
  coordinationScore: number;
  /**
   * All pairs with meaningful signal, sorted descending by similarityScore.
   * Included if combinedScore >= 0.15 OR sharedTokenCount >= 20.
   * Pairs with coordination signal have a `flag` field set.
   */
  pairs: AgentSimilarityPair[];
  globalMetrics: {
    averageSimilarity: number;
  };
  metadata: {
    walletsAnalyzed: number;
    /** n*(n-1)/2 — all possible pairs regardless of signal */
    totalPairs: number;
    /** Pairs that cleared the signal filter (combinedScore >= 0.15 OR sharedTokenCount >= 20) */
    meaningfulPairs: number;
    flaggedPairs: number;
  };
}

const HIGH_SIMILARITY_THRESHOLD = 0.7;
const HIGH_OVERLAP_PCT_THRESHOLD = 0.5;   // either wallet >50% portfolio overlap
const HIGH_OVERLAP_COUNT_THRESHOLD = 20;  // count gate for large meaningful overlaps
const HIGH_OVERLAP_MIN_PCT_WITH_COUNT = 0.2; // raw count alone is too noisy for large portfolios

// A pair is worth showing if it clears at least one bar:
//   - combinedScore >= 0.15 (binary*0.4 + capital*0.6, same formula as similarity-lab UI), OR
//   - sharedTokenCount >= 20 (meaningful co-occurrence even at low score)
// Pairs that fail both are trivial overlaps — noise for an agent.
const MIN_COMBINED_SCORE_THRESHOLD = 0.15;
const MIN_SHARED_TOKEN_THRESHOLD = 20;

/**
 * Combined score: binary*0.6 + capital*0.4.
 * Binary (behavioral co-occurrence) weighted higher — more indicative of coordination.
 * Matches SimilaritySidebar.tsx and the OG image route, which both use this formula
 * in the holder-profiles coordination context.
 */
function combinedScore(p: CombinedPairwiseSimilarity): number {
  return p.binaryScore * 0.6 + p.capitalScore * 0.4;
}

function pairOverlapPcts(p: CombinedPairwiseSimilarity): { overlapPctA: number; overlapPctB: number; portfolioSizeA: number; portfolioSizeB: number } {
  // portfolioSize = shared + unique (binary counts)
  const portfolioSizeA = p.binarySharedTokenCount + p.binaryUniqueTokenCountA;
  const portfolioSizeB = p.binarySharedTokenCount + p.binaryUniqueTokenCountB;
  const overlapPctA = portfolioSizeA > 0 ? Math.round((p.binarySharedTokenCount / portfolioSizeA) * 1000) / 1000 : 0;
  const overlapPctB = portfolioSizeB > 0 ? Math.round((p.binarySharedTokenCount / portfolioSizeB) * 1000) / 1000 : 0;
  return { overlapPctA, overlapPctB, portfolioSizeA, portfolioSizeB };
}

function hasHighOverlap(
  sharedTokenCount: number,
  overlapPctA: number,
  overlapPctB: number,
): boolean {
  if (overlapPctA > HIGH_OVERLAP_PCT_THRESHOLD || overlapPctB > HIGH_OVERLAP_PCT_THRESHOLD) {
    return true;
  }

  return (
    sharedTokenCount >= HIGH_OVERLAP_COUNT_THRESHOLD &&
    (overlapPctA >= HIGH_OVERLAP_MIN_PCT_WITH_COUNT || overlapPctB >= HIGH_OVERLAP_MIN_PCT_WITH_COUNT)
  );
}

/** Map full CombinedSimilarityResult → AgentSimilarityResult */
export function buildAgentSimilarityResult(
  result: CombinedSimilarityResult,
): AgentSimilarityResult {
  // Sort all pairs descending by combined score (binary*0.4 + capital*0.6) — same as the UI
  const sortedPairs = [...result.pairwiseSimilarities].sort(
    (a, b) => combinedScore(b) - combinedScore(a),
  );

  // Keep pairs with meaningful signal — combined score OR shared token count clears its bar.
  // No hard cap: all pairs with real signal come through regardless of count.
  const meaningfulPairs = sortedPairs.filter(
    (p) => combinedScore(p) >= MIN_COMBINED_SCORE_THRESHOLD || p.binarySharedTokenCount >= MIN_SHARED_TOKEN_THRESHOLD,
  );

  // coordinationScore: weighted average where rank-1 pair has weight N, rank-N has weight 1
  const n = meaningfulPairs.length;
  let coordinationScore = 0;
  if (n > 0) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < n; i++) {
      const weight = n - i;
      weightedSum += combinedScore(meaningfulPairs[i]) * weight;
      totalWeight += weight;
    }
    coordinationScore = Math.round((weightedSum / totalWeight) * 1000) / 1000;
  }

  let flaggedCount = 0;

  const pairs: AgentSimilarityPair[] = meaningfulPairs.map((p) => {
    const { overlapPctA, overlapPctB, portfolioSizeA, portfolioSizeB } = pairOverlapPcts(p);
    const score = combinedScore(p);
    const highSim = score > HIGH_SIMILARITY_THRESHOLD;
    const highOverlap = hasHighOverlap(p.binarySharedTokenCount, overlapPctA, overlapPctB);

    let flag: AgentSimilarityPair['flag'];
    if (highSim || highOverlap) {
      flag = highSim && highOverlap ? 'HIGH_SIMILARITY_AND_OVERLAP'
        : highSim ? 'HIGH_SIMILARITY'
        : 'HIGH_OVERLAP';
      flaggedCount++;
    }

    return {
      walletA: p.walletA,
      walletB: p.walletB,
      similarityScore: Math.round(score * 1000) / 1000,
      sharedTokenCount: p.binarySharedTokenCount,
      portfolioSizeA,
      portfolioSizeB,
      overlapPctA,
      overlapPctB,
      ...(flag != null && { flag }),
    };
  });

  // Derive walletsAnalyzed from the unique addresses in all pairs
  const walletSet = new Set<string>();
  for (const p of result.pairwiseSimilarities) {
    walletSet.add(p.walletA);
    walletSet.add(p.walletB);
  }

  return {
    coordinationScore,
    pairs,
    globalMetrics: {
      averageSimilarity:
        Math.round((result.globalMetrics?.averageSimilarity ?? 0) * 1000) / 1000,
    },
    metadata: {
      walletsAnalyzed: walletSet.size,
      totalPairs: result.pairwiseSimilarities.length,
      meaningfulPairs: pairs.length,
      flaggedPairs: flaggedCount,
    },
  };
}
