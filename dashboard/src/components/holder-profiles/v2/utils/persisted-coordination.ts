import type {
  SimilarityGraphAnalysis,
  WalletCluster,
  QualifyingClusterEdge,
} from '@/lib/similarity-clusters';
import type { CohortCoordinationResponse } from '@/types/api';

/**
 * SURFACE-1 engine swap adapter.
 *
 * Maps the PERSISTED cohort-coordination verdict (materialized DB-wide rings +
 * WalletWalletEdge coordination edges) into the exact `SimilarityGraphAnalysis`
 * shape the holder-profiles UI already consumes — so `SimilaritySidebar`, the
 * table `connectionCounts`, cluster highlighting, and selection all keep working
 * unchanged. Only the *source of truth* moves from the client-side
 * `analyzeSimilarityGraph` recompute to the stored engine.
 *
 * Fields the old client graph derived from cohort capital pairs (cohesion,
 * overlap ratios, density) have no materialized-engine equivalent; they are set
 * to neutral/derived values. The sidebar renders cluster size + membership +
 * strongest edges, which we DO have from the persisted engine.
 */
export function buildPersistedGraphAnalysis(
  coordination: CohortCoordinationResponse | undefined,
): SimilarityGraphAnalysis | null {
  if (!coordination) return null;
  if (coordination.clusters.length === 0 && coordination.edges.length === 0) {
    return {
      clusters: [],
      connectionCounts: new Map(),
      walletToCluster: new Map(),
      connectedWallets: new Set(),
      qualifyingEdges: [],
    };
  }

  // Edge score is a materialized coordination weight; normalize to a 0..1
  // cohesion-like value for the existing strength labels/colors. Scores are
  // already bounded by the materializer; clamp defensively.
  const toCohesion = (score: number): number => Math.max(0, Math.min(1, score));

  const connectionCounts = new Map<string, number>();
  const connectedWallets = new Set<string>();
  const qualifyingEdges: QualifyingClusterEdge[] = coordination.edges.map((edge) => {
    connectionCounts.set(edge.a, (connectionCounts.get(edge.a) ?? 0) + 1);
    connectionCounts.set(edge.b, (connectionCounts.get(edge.b) ?? 0) + 1);
    connectedWallets.add(edge.a);
    connectedWallets.add(edge.b);
    const cohesion = toCohesion(edge.score);
    return {
      walletA: edge.a,
      walletB: edge.b,
      overallScore: cohesion,
      behavioralScore: cohesion,
      sharedTokensCount: edge.sharedNonObvious,
      cohesionScore: cohesion,
      smallerWalletOverlap: 0,
      largerWalletOverlap: 0,
      normalizedSharedTokens: 0,
      qualificationReasons: ['coordinated'],
    };
  });

  const walletToCluster = new Map<string, number>();
  const clusters: WalletCluster[] = coordination.clusters.map((cluster, index) => {
    const wallets = cluster.membersInCohort.map((m) => m.walletAddress).sort();
    for (const wallet of wallets) walletToCluster.set(wallet, index);

    // Edges internal to this cluster's cohort members (for strongest-pairs).
    const memberSet = new Set(wallets);
    const clusterEdges = qualifyingEdges
      .filter((e) => memberSet.has(e.walletA) && memberSet.has(e.walletB))
      .sort((a, b) => b.cohesionScore - a.cohesionScore);
    const avgCohesion =
      clusterEdges.length > 0
        ? clusterEdges.reduce((s, e) => s + e.cohesionScore, 0) / clusterEdges.length
        : 0;
    const totalShared = clusterEdges.reduce((s, e) => s + (e.sharedTokensCount ?? 0), 0);
    const possibleEdgeCount = (wallets.length * (wallets.length - 1)) / 2;

    return {
      id: index,
      wallets,
      relatedWallets: [],
      avgCohesionScore: avgCohesion,
      minCohesionScore: clusterEdges.length > 0 ? Math.min(...clusterEdges.map((e) => e.cohesionScore)) : 0,
      avgOverallScore: avgCohesion,
      minOverallScore: clusterEdges.length > 0 ? Math.min(...clusterEdges.map((e) => e.overallScore)) : 0,
      avgOverlapRatio: 0,
      minOverlapRatio: 0,
      totalSharedTokens: totalShared,
      maxSharedTokens: clusterEdges.length > 0 ? Math.max(...clusterEdges.map((e) => e.sharedTokensCount ?? 0)) : 0,
      edgeCount: clusterEdges.length,
      possibleEdgeCount,
      density: possibleEdgeCount > 0 ? clusterEdges.length / possibleEdgeCount : 0,
      strongestPairs: clusterEdges.slice(0, 3),
    };
  });

  // Order clusters by in-cohort size (largest ring first).
  clusters.sort((a, b) => b.wallets.length - a.wallets.length);
  clusters.forEach((cluster, index) => {
    cluster.id = index;
    for (const wallet of cluster.wallets) walletToCluster.set(wallet, index);
  });

  return { clusters, connectionCounts, walletToCluster, connectedWallets, qualifyingEdges };
}
