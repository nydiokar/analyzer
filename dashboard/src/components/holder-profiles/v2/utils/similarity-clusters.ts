import type { SimilarityPairData } from '../SimilarityPairRibbon';

export interface WalletCluster {
  id: number;
  wallets: string[];
  /** Average similarity within the cluster */
  avgSimilarity: number;
  /** Minimum similarity edge in the cluster */
  minSimilarity: number;
  /** Number of edges (connections) in this cluster */
  edgeCount: number;
}

export interface SimilarityGraphAnalysis {
  /** Clusters of 3+ wallets */
  clusters: WalletCluster[];
  /** Map of wallet address to number of connections above threshold */
  connectionCounts: Map<string, number>;
  /** Map of wallet address to cluster ID (if in a cluster of 3+) */
  walletToCluster: Map<string, number>;
  /** All wallets that have at least one connection */
  connectedWallets: Set<string>;
}

/**
 * Union-Find data structure for efficient cluster detection
 */
class UnionFind {
  private parent: Map<string, string>;
  private rank: Map<string, number>;

  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!));
    }
    return this.parent.get(x)!;
  }

  union(x: string, y: string): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX === rootY) return;

    const rankX = this.rank.get(rootX) ?? 0;
    const rankY = this.rank.get(rootY) ?? 0;

    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }

  getComponents(): Map<string, string[]> {
    const components = new Map<string, string[]>();
    for (const node of this.parent.keys()) {
      const root = this.find(node);
      if (!components.has(root)) {
        components.set(root, []);
      }
      components.get(root)!.push(node);
    }
    return components;
  }
}

/**
 * Analyze similarity pairs to find clusters and connection counts
 * @param pairs - Similarity pairs data
 * @param threshold - Minimum similarity score (0-1) to consider a connection (default 0.7 = 70%)
 */
export function analyzeSimilarityGraph(
  pairs: SimilarityPairData[],
  threshold: number = 0.7
): SimilarityGraphAnalysis {
  const connectionCounts = new Map<string, number>();
  const connectedWallets = new Set<string>();
  const uf = new UnionFind();

  // Track edges per cluster for stats
  const edgesBetween = new Map<string, { walletA: string; walletB: string; score: number }[]>();

  // First pass: count connections and build union-find structure
  for (const pair of pairs) {
    if (pair.overallScore >= threshold) {
      // Count connections for each wallet
      connectionCounts.set(pair.walletA, (connectionCounts.get(pair.walletA) ?? 0) + 1);
      connectionCounts.set(pair.walletB, (connectionCounts.get(pair.walletB) ?? 0) + 1);
      connectedWallets.add(pair.walletA);
      connectedWallets.add(pair.walletB);

      // Union the wallets
      uf.union(pair.walletA, pair.walletB);
    }
  }

  // Get connected components
  const components = uf.getComponents();

  // Build clusters (only 3+ wallets)
  const clusters: WalletCluster[] = [];
  const walletToCluster = new Map<string, number>();
  let clusterId = 0;

  for (const [root, wallets] of components) {
    if (wallets.length >= 3) {
      // Calculate cluster stats from edges
      const clusterWalletSet = new Set(wallets);
      let totalSimilarity = 0;
      let minSimilarity = 1;
      let edgeCount = 0;

      for (const pair of pairs) {
        if (
          pair.overallScore >= threshold &&
          clusterWalletSet.has(pair.walletA) &&
          clusterWalletSet.has(pair.walletB)
        ) {
          totalSimilarity += pair.overallScore;
          minSimilarity = Math.min(minSimilarity, pair.overallScore);
          edgeCount++;
        }
      }

      const cluster: WalletCluster = {
        id: clusterId,
        wallets: wallets.sort(), // Consistent ordering
        avgSimilarity: edgeCount > 0 ? totalSimilarity / edgeCount : 0,
        minSimilarity: edgeCount > 0 ? minSimilarity : 0,
        edgeCount,
      };

      clusters.push(cluster);

      // Map wallets to cluster
      for (const wallet of wallets) {
        walletToCluster.set(wallet, clusterId);
      }

      clusterId++;
    }
  }

  // Sort clusters by size (largest first), then by avg similarity
  clusters.sort((a, b) => {
    if (b.wallets.length !== a.wallets.length) {
      return b.wallets.length - a.wallets.length;
    }
    return b.avgSimilarity - a.avgSimilarity;
  });

  // Re-assign IDs after sorting
  clusters.forEach((cluster, idx) => {
    cluster.id = idx;
    for (const wallet of cluster.wallets) {
      walletToCluster.set(wallet, idx);
    }
  });

  return {
    clusters,
    connectionCounts,
    walletToCluster,
    connectedWallets,
  };
}

/**
 * Get a human-readable description of cluster strength
 */
export function getClusterStrengthLabel(avgSimilarity: number): string {
  if (avgSimilarity >= 0.85) return 'Very Strong';
  if (avgSimilarity >= 0.75) return 'Strong';
  if (avgSimilarity >= 0.65) return 'Moderate';
  return 'Weak';
}

/**
 * Get color classes for cluster strength
 */
export function getClusterStrengthColor(avgSimilarity: number): string {
  if (avgSimilarity >= 0.85) return 'text-rose-400';
  if (avgSimilarity >= 0.75) return 'text-orange-400';
  if (avgSimilarity >= 0.65) return 'text-amber-400';
  return 'text-zinc-400';
}

/**
 * Get background color for cluster indicator
 */
export function getClusterBgColor(avgSimilarity: number): string {
  if (avgSimilarity >= 0.85) return 'bg-rose-500/15';
  if (avgSimilarity >= 0.75) return 'bg-orange-500/15';
  if (avgSimilarity >= 0.65) return 'bg-amber-500/15';
  return 'bg-zinc-500/15';
}
