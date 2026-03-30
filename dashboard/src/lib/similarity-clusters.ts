export interface ClusterPairData {
  walletA: string;
  walletB: string;
  overallScore: number;
  behavioralScore?: number;
  capitalScore?: number;
  sharedTokensCount?: number;
  uniqueTokensA?: number;
  uniqueTokensB?: number;
}

export interface ClusterAnalysisConfig {
  strongOverallScore: number;
  minBehavioralScore: number;
  highOverlapThreshold: number;
  minSharedTokensForOverlap: number;
  highSharedTokensCount: number;
  minOverlapForHighShared: number;
  minDensity: number;
  minClusterSize: number;
  sharedTokensNormalizer: number;
}

export interface QualifyingClusterEdge extends ClusterPairData {
  smallerWalletOverlap: number;
  largerWalletOverlap: number;
  normalizedSharedTokens: number;
  cohesionScore: number;
  qualificationReasons: string[];
}

export interface WalletCluster {
  id: number;
  wallets: string[];
  avgCohesionScore: number;
  minCohesionScore: number;
  avgOverallScore: number;
  minOverallScore: number;
  avgOverlapRatio: number;
  minOverlapRatio: number;
  totalSharedTokens: number;
  maxSharedTokens: number;
  edgeCount: number;
  possibleEdgeCount: number;
  density: number;
  strongestPairs: QualifyingClusterEdge[];
}

export interface SimilarityGraphAnalysis {
  clusters: WalletCluster[];
  connectionCounts: Map<string, number>;
  walletToCluster: Map<string, number>;
  connectedWallets: Set<string>;
  qualifyingEdges: QualifyingClusterEdge[];
}

export const HOLDER_PROFILES_CLUSTER_CONFIG: ClusterAnalysisConfig = {
  strongOverallScore: 0.64,
  minBehavioralScore: 0.3,
  highOverlapThreshold: 0.72,
  minSharedTokensForOverlap: 3,
  highSharedTokensCount: 10,
  minOverlapForHighShared: 0.45,
  minDensity: 0.6,
  minClusterSize: 3,
  sharedTokensNormalizer: 24,
};

export const SIMILARITY_LAB_CLUSTER_CONFIG: ClusterAnalysisConfig = {
  strongOverallScore: 0.58,
  minBehavioralScore: 0.3,
  highOverlapThreshold: 0.6,
  minSharedTokensForOverlap: 4,
  highSharedTokensCount: 12,
  minOverlapForHighShared: 0.35,
  minDensity: 0.55,
  minClusterSize: 3,
  sharedTokensNormalizer: 40,
};

class UnionFind {
  private readonly parent = new Map<string, string>();
  private readonly rank = new Map<string, number>();

  find(node: string): string {
    if (!this.parent.has(node)) {
      this.parent.set(node, node);
      this.rank.set(node, 0);
    }

    const parent = this.parent.get(node)!;
    if (parent !== node) {
      this.parent.set(node, this.find(parent));
    }

    return this.parent.get(node)!;
  }

  union(left: string, right: string): void {
    const rootLeft = this.find(left);
    const rootRight = this.find(right);

    if (rootLeft === rootRight) {
      return;
    }

    const leftRank = this.rank.get(rootLeft) ?? 0;
    const rightRank = this.rank.get(rootRight) ?? 0;

    if (leftRank < rightRank) {
      this.parent.set(rootLeft, rootRight);
      return;
    }

    if (leftRank > rightRank) {
      this.parent.set(rootRight, rootLeft);
      return;
    }

    this.parent.set(rootRight, rootLeft);
    this.rank.set(rootLeft, leftRank + 1);
  }

  getComponents(): Map<string, string[]> {
    const components = new Map<string, string[]>();

    for (const node of this.parent.keys()) {
      const root = this.find(node);
      const current = components.get(root) ?? [];
      current.push(node);
      components.set(root, current);
    }

    return components;
  }
}

function calculateOverlap(sharedTokensCount: number, uniqueTokensA?: number, uniqueTokensB?: number) {
  const safeUniqueA = Math.max(uniqueTokensA ?? 0, 0);
  const safeUniqueB = Math.max(uniqueTokensB ?? 0, 0);
  const smallerWalletSize = Math.min(safeUniqueA, safeUniqueB);
  const largerWalletSize = Math.max(safeUniqueA, safeUniqueB);

  return {
    smallerWalletOverlap: smallerWalletSize > 0 ? sharedTokensCount / smallerWalletSize : 0,
    largerWalletOverlap: largerWalletSize > 0 ? sharedTokensCount / largerWalletSize : 0,
  };
}

function buildQualifyingEdge(
  pair: ClusterPairData,
  config: ClusterAnalysisConfig
): QualifyingClusterEdge | null {
  const behavioralScore = pair.behavioralScore ?? pair.overallScore;
  const sharedTokensCount = Math.max(pair.sharedTokensCount ?? 0, 0);
  const { smallerWalletOverlap, largerWalletOverlap } = calculateOverlap(
    sharedTokensCount,
    pair.uniqueTokensA,
    pair.uniqueTokensB
  );
  const normalizedSharedTokens =
    config.sharedTokensNormalizer > 0
      ? Math.min(sharedTokensCount / config.sharedTokensNormalizer, 1)
      : 0;

  const qualificationReasons: string[] = [];

  if (pair.overallScore >= config.strongOverallScore && behavioralScore >= config.minBehavioralScore) {
    qualificationReasons.push('score');
  }

  if (
    smallerWalletOverlap >= config.highOverlapThreshold &&
    sharedTokensCount >= config.minSharedTokensForOverlap
  ) {
    qualificationReasons.push('overlap');
  }

  if (
    sharedTokensCount >= config.highSharedTokensCount &&
    smallerWalletOverlap >= config.minOverlapForHighShared
  ) {
    qualificationReasons.push('shared-volume');
  }

  if (qualificationReasons.length === 0) {
    return null;
  }

  const overlapWeightedScore = Math.min(
    1,
    smallerWalletOverlap * 0.8 + normalizedSharedTokens * 0.2
  );
  const cohesionScore = Math.max(pair.overallScore, overlapWeightedScore);

  return {
    ...pair,
    behavioralScore,
    sharedTokensCount,
    smallerWalletOverlap,
    largerWalletOverlap,
    normalizedSharedTokens,
    cohesionScore,
    qualificationReasons,
  };
}

export function analyzeSimilarityGraph(
  pairs: ClusterPairData[],
  config: ClusterAnalysisConfig
): SimilarityGraphAnalysis {
  const connectionCounts = new Map<string, number>();
  const connectedWallets = new Set<string>();
  const walletToCluster = new Map<string, number>();
  const unionFind = new UnionFind();
  const qualifyingEdges: QualifyingClusterEdge[] = [];

  for (const pair of pairs) {
    const edge = buildQualifyingEdge(pair, config);
    if (!edge) {
      continue;
    }

    qualifyingEdges.push(edge);
    connectionCounts.set(edge.walletA, (connectionCounts.get(edge.walletA) ?? 0) + 1);
    connectionCounts.set(edge.walletB, (connectionCounts.get(edge.walletB) ?? 0) + 1);
    connectedWallets.add(edge.walletA);
    connectedWallets.add(edge.walletB);
    unionFind.union(edge.walletA, edge.walletB);
  }

  const components = unionFind.getComponents();
  const clusters: WalletCluster[] = [];

  for (const wallets of components.values()) {
    if (wallets.length < config.minClusterSize) {
      continue;
    }

    const clusterWalletSet = new Set(wallets);
    const clusterEdges = qualifyingEdges
      .filter((edge) => clusterWalletSet.has(edge.walletA) && clusterWalletSet.has(edge.walletB))
      .sort((left, right) => right.cohesionScore - left.cohesionScore);

    const possibleEdgeCount = (wallets.length * (wallets.length - 1)) / 2;
    const density = possibleEdgeCount > 0 ? clusterEdges.length / possibleEdgeCount : 0;

    if (density < config.minDensity) {
      continue;
    }

    const totalSharedTokens = clusterEdges.reduce(
      (sum, edge) => sum + (edge.sharedTokensCount ?? 0),
      0
    );
    const avgCohesionScore =
      clusterEdges.length > 0
        ? clusterEdges.reduce((sum, edge) => sum + edge.cohesionScore, 0) / clusterEdges.length
        : 0;
    const avgOverallScore =
      clusterEdges.length > 0
        ? clusterEdges.reduce((sum, edge) => sum + edge.overallScore, 0) / clusterEdges.length
        : 0;
    const avgOverlapRatio =
      clusterEdges.length > 0
        ? clusterEdges.reduce((sum, edge) => sum + edge.smallerWalletOverlap, 0) / clusterEdges.length
        : 0;

    clusters.push({
      id: clusters.length,
      wallets: [...wallets].sort(),
      avgCohesionScore,
      minCohesionScore: clusterEdges.length > 0 ? Math.min(...clusterEdges.map((edge) => edge.cohesionScore)) : 0,
      avgOverallScore,
      minOverallScore: clusterEdges.length > 0 ? Math.min(...clusterEdges.map((edge) => edge.overallScore)) : 0,
      avgOverlapRatio,
      minOverlapRatio: clusterEdges.length > 0 ? Math.min(...clusterEdges.map((edge) => edge.smallerWalletOverlap)) : 0,
      totalSharedTokens,
      maxSharedTokens: clusterEdges.length > 0 ? Math.max(...clusterEdges.map((edge) => edge.sharedTokensCount ?? 0)) : 0,
      edgeCount: clusterEdges.length,
      possibleEdgeCount,
      density,
      strongestPairs: clusterEdges.slice(0, 3),
    });
  }

  clusters.sort((left, right) => {
    if (right.wallets.length !== left.wallets.length) {
      return right.wallets.length - left.wallets.length;
    }

    if (right.totalSharedTokens !== left.totalSharedTokens) {
      return right.totalSharedTokens - left.totalSharedTokens;
    }

    return right.avgCohesionScore - left.avgCohesionScore;
  });

  clusters.forEach((cluster, index) => {
    cluster.id = index;
    for (const wallet of cluster.wallets) {
      walletToCluster.set(wallet, index);
    }
  });

  return {
    clusters,
    connectionCounts,
    walletToCluster,
    connectedWallets,
    qualifyingEdges,
  };
}

export function getClusterStrengthLabel(avgCohesionScore: number): string {
  if (avgCohesionScore >= 0.85) return 'Very Strong';
  if (avgCohesionScore >= 0.7) return 'Strong';
  if (avgCohesionScore >= 0.55) return 'Notable';
  return 'Emerging';
}

export function getClusterStrengthColor(avgCohesionScore: number): string {
  if (avgCohesionScore >= 0.85) return 'text-emerald-400';
  if (avgCohesionScore >= 0.7) return 'text-sky-400';
  if (avgCohesionScore >= 0.55) return 'text-amber-400';
  return 'text-zinc-300';
}

export function getClusterBgColor(avgCohesionScore: number): string {
  if (avgCohesionScore >= 0.85) return 'bg-emerald-500/15';
  if (avgCohesionScore >= 0.7) return 'bg-sky-500/15';
  if (avgCohesionScore >= 0.55) return 'bg-amber-500/15';
  return 'bg-zinc-500/15';
}
