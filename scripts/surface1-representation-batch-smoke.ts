/**
 * SURFACE-1 STEP-1 smoke (READ-ONLY).
 *
 * Exercises getWalletRepresentationBatch against the known-connected collections
 * (Solomon / FLORK fleets → should cluster + have siblings; STELLAR pair → should
 * NOT be in any cluster). Proves the N+1-guard batched read returns the correct
 * per-wallet signals in one call.
 *
 * Run against the real-data copy:
 *   DATABASE_URL="postgresql://postgres:postgres@localhost:5434/sova_analyzer?schema=public" \
 *     npx ts-node -r tsconfig-paths/register scripts/surface1-representation-batch-smoke.ts
 */

import { DatabaseService, prisma } from '../src/core/services/database-service';

const GROUND_TRUTH_USER = 'cmk1e8ru000bxlb2lpqthg1py';

async function main(): Promise<void> {
  const db = new DatabaseService();

  const favorites = await prisma.userFavoriteWallet.findMany({
    where: { userId: GROUND_TRUTH_USER },
    select: { walletAddress: true, nickname: true, collections: true },
  });

  const pick = (needle: string) =>
    favorites.filter((f) => (f.nickname ?? '').toUpperCase().includes(needle));

  const solomon = pick('SOLOMON');
  const flork = pick('FLORK');
  const stellar = pick('STELLAR');
  const seeds = [...solomon, ...flork, ...stellar];

  if (seeds.length === 0) {
    console.log('No ground-truth favorites found — is this the :5434 real-data copy?');
    await prisma.$disconnect();
    return;
  }

  const nameByAddr = new Map(seeds.map((s) => [s.walletAddress, s.nickname ?? s.walletAddress.slice(0, 8)]));

  const t0 = Date.now();
  const batch = await db.getWalletRepresentationBatch(seeds.map((s) => s.walletAddress));
  const ms = Date.now() - t0;

  console.log(`\nBatched representation read for ${seeds.length} wallets in ${ms}ms\n`);
  for (const seed of seeds) {
    const r = batch.get(seed.walletAddress);
    const name = nameByAddr.get(seed.walletAddress);
    if (!r) {
      console.log(`- ${name}: MISSING`);
      continue;
    }
    const cluster = r.cluster ? `cluster=${r.cluster.clusterSize} (role=${r.cluster.role ?? '—'})` : 'cluster=NONE';
    const siblings = r.siblings
      ? `siblings=${r.siblings.count} top=${r.siblings.topStrategy ?? '—'} coord=${r.siblings.coordinatedNeighborCount} medWin=${r.siblings.medianNeighborWinRate ?? '—'}`
      : 'siblings=NONE';
    const drift = r.drift ? `drift=${r.drift.magnitude}` : 'drift=—';
    console.log(`- ${name}: vector=${r.hasVector} | ${cluster} | ${siblings} | ${drift}`);
  }

  console.log('\nExpectation: Solomon/FLORK are clustered + have siblings; STELLAR has a vector but NO cluster.\n');

  // --- Cohort coordination (the engine-swap read that feeds SimilaritySidebar) ---
  const cohortAddrs = seeds.map((s) => s.walletAddress);
  const tc0 = Date.now();
  const cohort = await db.getCohortCoordination(cohortAddrs);
  const cms = Date.now() - tc0;
  console.log(`Cohort coordination for ${cohortAddrs.length} wallets in ${cms}ms:`);
  console.log(`  DB-wide rings shared by ≥2 cohort members: ${cohort.clusters.length}`);
  for (const c of cohort.clusters) {
    const names = c.membersInCohort.map((m) => nameByAddr.get(m.walletAddress) ?? m.walletAddress.slice(0, 6)).join(', ');
    console.log(`   - cluster ${c.clusterId.slice(0, 10)}… size=${c.clusterSize} cohortMembers=[${names}]`);
  }
  console.log(`  Materialized coordination edges internal to cohort: ${cohort.edges.length}`);
  console.log('  Expectation: a Solomon ring + a FLORK ring surface; STELLAR appears in neither.\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
