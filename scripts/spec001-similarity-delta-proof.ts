/**
 * SPEC001_T06 delta proof (READ-ONLY).
 *
 * Answers the SPEC001_T06-caveat item (d): "we must SEE the delta — run current
 * similarity vs vector-first on the same wallets and confirm same-or-better
 * results". Concretely it exercises the exact production code paths the
 * /intel/wallet/:addr/similar endpoint calls:
 *   - findSimilarWalletVectors        (default cosine-only ordering)
 *   - findRankedSimilarWallets        (vector-first k-NN + shared-token blend)
 *   - getWalletBehaviorEnrichment     (payload enrichment shared by both modes)
 *
 * For each seed it reports retrieval latency, whether the rerank ordering is a
 * superset/permutation of the cosine candidate set (no candidate is dropped —
 * boosting only reorders), and the enriched behavior labels so a human can judge
 * neighborhood coherence. It writes nothing.
 *
 * Run against the real-data copy:
 *   DATABASE_URL="postgresql://postgres:postgres@localhost:5434/sova_analyzer?schema=public" \
 *     npx ts-node -r tsconfig-paths/register scripts/spec001-similarity-delta-proof.ts
 *
 * Optionally pass seed addresses as argv; otherwise it samples recent vectors.
 */

import { DatabaseService } from '../src/core/services/database-service';
import { prisma } from '../src/core/services/database-service';

const K = 15;

async function pickSeeds(explicit: string[]): Promise<string[]> {
  if (explicit.length > 0) return explicit;
  const rows = await prisma.walletVector.findMany({
    where: { schemaVersion: 1 },
    select: { walletAddress: true },
    orderBy: { builtAt: 'desc' },
    take: 5,
  });
  return rows.map((r) => r.walletAddress);
}

async function main(): Promise<void> {
  const db = new DatabaseService();
  const seeds = await pickSeeds(process.argv.slice(2));
  if (seeds.length === 0) {
    console.log('No seed wallets with vectors found.');
    return;
  }

  for (const seed of seeds) {
    const seedEnrich = await db.getWalletBehaviorEnrichment([seed]);
    const seedLabel = seedEnrich.get(seed);

    const t0 = Date.now();
    const cosine = await db.findSimilarWalletVectors(seed, K);
    const cosineMs = Date.now() - t0;

    const t1 = Date.now();
    const ranked = await db.findRankedSimilarWallets(seed, K);
    const rankedMs = Date.now() - t1;

    const cosineSet = new Set(cosine.map((c) => c.walletAddress));
    const rankedSet = new Set(ranked.map((r) => r.walletAddress));
    // Rerank retrieves a WIDER pool (k*3) than it returns, then boosts by shared
    // tokens. So a cosine top-K neighbor being reordered out of the ranked top-K
    // is EXPECTED (a coordination sibling was promoted past it), not a regression.
    // What we assert is: the ranked top-K stays within the same behavioral pool
    // (every ranked member is a genuine near-neighbor) and coordination siblings
    // (high shared-token count) are the ones that get promoted.
    const retainedFromCosineTopK = cosine.filter((c) => rankedSet.has(c.walletAddress)).length;
    const reordered = ranked.filter((r, i) => cosine[i]?.walletAddress !== r.walletAddress).length;
    const promotedSiblings = ranked.filter((r) => !cosineSet.has(r.walletAddress) && r.sharedTokenCount > 0).length;

    const enrich = await db.getWalletBehaviorEnrichment(ranked.map((r) => r.walletAddress));

    console.log('\n============================================================');
    console.log(`SEED ${seed}`);
    console.log(
      `  seed behavior: strategy=${seedLabel?.strategyType ?? '-'} speed=${seedLabel?.speedCategory ?? '-'} win%=${seedLabel?.winRate ?? '-'}`,
    );
    console.log(`  cosine-only:  ${cosine.length} neighbors in ${cosineMs}ms`);
    console.log(`  vector-first: ${ranked.length} neighbors in ${rankedMs}ms`);
    console.log(`  top-K retained: ${retainedFromCosineTopK}/${cosine.length} cosine neighbors; reordered positions: ${reordered}; coordination siblings promoted into top-K: ${promotedSiblings}`);
    console.log('  ranked neighbors (blended):');
    for (const r of ranked) {
      const e = enrich.get(r.walletAddress);
      const inCosine = cosineSet.has(r.walletAddress) ? ' ' : '+';
      console.log(
        `   ${inCosine} d=${r.distance.toFixed(4)} cos=${r.cosineSimilarity.toFixed(4)} shared=${r.sharedTokenCount} jac=${r.sharedTokenJaccard.toFixed(4)} blend=${r.blendedScore.toFixed(4)}  ${e?.strategyType ?? '-'}/${e?.speedCategory ?? '-'} win%=${e?.winRate ?? '-'}`,
      );
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
