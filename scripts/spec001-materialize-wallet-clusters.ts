/**
 * SPEC-001 Phase 2 wallet cluster materializer.
 *
 * Converts WalletWalletEdge into stored connected-component membership, matching
 * the current correlation analyzer's cluster rule: edges must clear
 * minClusterScoreThreshold and components need at least 3 wallets.
 *
 * Run after spec001-materialize-wallet-wallet-edges.ts:
 *   npx ts-node -r tsconfig-paths/register scripts/spec001-materialize-wallet-clusters.ts
 */

import { CLUSTERING_CONFIG } from '../src/config/constants';
import { prisma } from '../src/core/services/database-service';

const MAX_EDGES_IN_MEMORY = 1_000_000;

async function main(): Promise<void> {
  const edgeCount = await prisma.walletWalletEdge.count({
    where: { score: { gte: CLUSTERING_CONFIG.minClusterScoreThreshold } },
  });
  if (edgeCount > MAX_EDGES_IN_MEMORY) {
    throw new Error(`Refusing to materialize ${edgeCount} edges in memory; size Gate-2 and shard this batch first.`);
  }

  const edges = await prisma.walletWalletEdge.findMany({
    where: { score: { gte: CLUSTERING_CONFIG.minClusterScoreThreshold } },
    select: { a: true, b: true, score: true },
  });

  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    addNeighbor(adjacency, edge.a, edge.b);
    addNeighbor(adjacency, edge.b, edge.a);
  }

  const visited = new Set<string>();
  const memberships: Array<{ walletAddress: string; clusterId: string; role: string; clusterSize: number }> = [];
  for (const wallet of adjacency.keys()) {
    if (visited.has(wallet)) continue;
    const members = collectComponent(wallet, adjacency, visited).sort();
    if (members.length < 3) continue;
    const clusterId = members.join('-');
    const degrees = members.map((member) => ({ member, degree: adjacency.get(member)?.size ?? 0 }));
    const maxDegree = Math.max(...degrees.map((item) => item.degree));
    for (const member of members) {
      const degree = adjacency.get(member)?.size ?? 0;
      memberships.push({
        walletAddress: member,
        clusterId,
        role: degree === maxDegree ? 'core' : 'peripheral',
        clusterSize: members.length,
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.walletClusterMembership.deleteMany({});
    if (memberships.length === 0) return;
    await tx.walletClusterMembership.createMany({ data: memberships });
  });

  console.log(JSON.stringify({ edgesRead: edges.length, clustersWritten: new Set(memberships.map((m) => m.clusterId)).size, membershipsWritten: memberships.length }, null, 2));
}

function addNeighbor(adjacency: Map<string, Set<string>>, a: string, b: string): void {
  const neighbors = adjacency.get(a) ?? new Set<string>();
  neighbors.add(b);
  adjacency.set(a, neighbors);
}

function collectComponent(start: string, adjacency: Map<string, Set<string>>, visited: Set<string>): string[] {
  const stack = [start];
  const members: string[] = [];
  while (stack.length > 0) {
    const wallet = stack.pop();
    if (!wallet || visited.has(wallet)) continue;
    visited.add(wallet);
    members.push(wallet);
    for (const next of adjacency.get(wallet) ?? []) {
      if (!visited.has(next)) stack.push(next);
    }
  }
  return members;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
