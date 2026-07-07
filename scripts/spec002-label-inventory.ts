/**
 * SPEC002_T03 — Label-readiness inventory (READ-ONLY).
 *
 * Measures whether the proprietary analyst-label loop is ready for future
 * metric-learning work. This script trains nothing, serves nothing, and
 * writes nothing. It only reads and reports.
 *
 * Run (Windows / PowerShell):
 *   npx ts-node -r tsconfig-paths/register scripts/spec002-label-inventory.ts
 *
 * If ts-node is unavailable against the live server, the equivalent read-only
 * SQL is documented in:
 *   .ai/context/SPEC002_LABEL_READINESS_2026-07-07.md  (§ "Read-only SQL")
 *
 * Guards (from AGENT_4_SPEC002_LABEL_LEDGER_METRIC_READINESS.md §3):
 *   - No model training, no embeddings, no model-serving deps.
 *   - CreditTransaction.reason is a DEMAND signal only, never a truth label.
 *   - reviewStatus='ignored' is NOT treated as a clean negative (dust auto-ignore
 *     pollutes it — see radar-snapshot.service.ts:77-84).
 */

import { prisma } from '../src/core/services/database-service';

async function main(): Promise<void> {
  const out: Record<string, unknown> = {};

  // 1) RadarHolding.reviewStatus — analyst verdict stream ---------------------
  const reviewByStatus = await prisma.radarHolding.groupBy({
    by: ['reviewStatus'],
    _count: { _all: true },
  });

  // reviewedAt coverage: how many decisions carry a timestamp (needed for splits)
  const reviewedWithTs = await prisma.radarHolding.count({
    where: { reviewStatus: { not: 'unreviewed' }, reviewedAt: { not: null } },
  });
  const reviewedTotal = await prisma.radarHolding.count({
    where: { reviewStatus: { not: 'unreviewed' } },
  });

  // active vs inactive holdings, per status
  const reviewByStatusActive = await prisma.radarHolding.groupBy({
    by: ['reviewStatus', 'isActiveHolding'],
    _count: { _all: true },
  });

  // distinct reviewed wallets / tokens — split-unit cardinality
  const reviewedRows = await prisma.radarHolding.findMany({
    where: { reviewStatus: { not: 'unreviewed' } },
    select: { wallet: true, tokenMint: true },
  });
  const reviewedWallets = new Set(reviewedRows.map((r) => r.wallet)).size;
  const reviewedTokens = new Set(reviewedRows.map((r) => r.tokenMint)).size;

  out.radarHolding = {
    byStatus: reviewByStatus.map((r) => ({ status: r.reviewStatus, count: r._count._all })),
    byStatusActive: reviewByStatusActive.map((r) => ({
      status: r.reviewStatus,
      isActiveHolding: r.isActiveHolding,
      count: r._count._all,
    })),
    reviewedTimestampCoverage: { reviewedTotal, reviewedWithTs },
    distinctReviewedWallets: reviewedWallets,
    distinctReviewedTokens: reviewedTokens,
    note:
      "reviewStatus='ignored' is polluted by dust auto-ignore (radar-snapshot.service.ts:84 and radar.controller.ts:92). Do NOT use as a clean negative.",
  };

  // 2) WalletHuntSnapshot — hand-curated related-wallet ground truth ----------
  const snapshots = await prisma.walletHuntSnapshot.findMany({
    select: { huntId: true, tokenMint: true, sourceType: true, holders: true },
  });

  const holderSetSizes = snapshots.map((s) => s.holders.length).sort((a, b) => a - b);
  const totalSnapshots = snapshots.length;
  const distinctHunts = new Set(snapshots.map((s) => s.huntId)).size;
  const distinctTokens = new Set(snapshots.map((s) => s.tokenMint)).size;

  const sourceTypeCounts = new Map<string, number>();
  for (const s of snapshots) sourceTypeCounts.set(s.sourceType, (sourceTypeCounts.get(s.sourceType) ?? 0) + 1);

  // repeated wallets across snapshots (candidate positive-pair mass)
  const walletHuntCount = new Map<string, Set<string>>(); // wallet -> set of huntIds
  for (const s of snapshots) {
    for (const w of s.holders) {
      if (!walletHuntCount.has(w)) walletHuntCount.set(w, new Set());
      walletHuntCount.get(w)!.add(s.huntId);
    }
  }
  const walletsInMultipleHunts = [...walletHuntCount.values()].filter((h) => h.size >= 2).length;

  // hunts with >=2 snapshots (only these yield confirmed cross-token candidates)
  const snapsPerHunt = new Map<string, number>();
  for (const s of snapshots) snapsPerHunt.set(s.huntId, (snapsPerHunt.get(s.huntId) ?? 0) + 1);
  const huntsWith2PlusSnapshots = [...snapsPerHunt.values()].filter((n) => n >= 2).length;

  out.walletHuntSnapshot = {
    totalSnapshots,
    distinctHunts,
    distinctTokens,
    huntsWith2PlusSnapshots,
    sourceTypes: [...sourceTypeCounts.entries()].map(([sourceType, count]) => ({ sourceType, count })),
    holderSetSize: summarize(holderSetSizes),
    distinctWalletsAcrossAllHolderSets: walletHuntCount.size,
    walletsAppearingIn2PlusHunts: walletsInMultipleHunts,
    note:
      'Positive-pair mass only comes from hunts with >=2 snapshots AND wallets appearing across >=2 tokens (see computeCandidates, wallet-hunt.service.ts:263-277). Single-snapshot hunts contribute no confirmed cross-token pair.',
  };

  // 3) CreditTransaction.reason — DEMAND signal only, not truth --------------
  const demand = await prisma.creditTransaction.groupBy({
    by: ['reason'],
    where: { reason: { startsWith: 'endpoint:' } },
    _count: { _all: true },
  });
  out.creditTransactionDemand = {
    byEndpoint: demand
      .map((d) => ({ reason: d.reason, count: d._count._all }))
      .sort((a, b) => b.count - a.count),
    note: 'DEMAND / prioritization signal only. Never used as a truth label or pair.',
  };

  console.log(JSON.stringify(out, null, 2));
}

function summarize(sorted: number[]): Record<string, number | null> {
  if (sorted.length === 0) return { n: 0, min: null, p50: null, p90: null, max: null, mean: null };
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    p50: at(0.5),
    p90: at(0.9),
    max: sorted[sorted.length - 1],
    mean: Math.round((sum / sorted.length) * 100) / 100,
  };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
