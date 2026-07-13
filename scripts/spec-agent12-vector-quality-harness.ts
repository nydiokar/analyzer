/**
 * AGENT_12 acceptance harness — behavior-vector quality, version-parameterized.
 *
 * The SAME script runs on v1 (baseline) and v2 (post-rebuild) so "prove it's
 * better" has a real before/after. Read-only: no writes, safe against the live
 * substrate. Retrieval uses the EXACT prod path (HNSW cosine `<=>` over
 * WalletVector, filtered by schemaVersion) so the harness measures what
 * products actually see.
 *
 * Metrics:
 *   1. Per-type neighbor purity  — for N seeds/type, top-K HNSW neighbors, the
 *      fraction whose strategyType == the seed's type. Blind types
 *      (DISTRIBUTOR, PURE_HOLDER) are the ones the audit says v1 gets wrong.
 *   2. Named confusion           — DISTRIBUTOR->FAST_TRADER, PURE_HOLDER->LOW_ACTIVITY.
 *   3. Per-dim health            — frac-zero per source dim + the max |pearson r|
 *      pair (dead-dim + collinearity gate).
 *
 * Known-connected recovery (Solomon/FLORK recover, STELLAR does not) is NOT
 * measured here — it is covered by scripts/surface1-representation-batch-smoke.ts,
 * which exercises the materialized cluster/edge path end-to-end. Run that too.
 *
 * Run (version comes from the code constant of whatever is checked out):
 *   npx ts-node -r tsconfig-paths/register scripts/spec-agent12-vector-quality-harness.ts \
 *     [--seeds-per-type=100] [--k=20] [--out=.ai/context/BEHAVIOR_VECTOR_V1_BASELINE_<date>.json]
 */

import { prisma } from '../src/core/services/database-service';
import {
  WALLET_VECTOR_SCHEMA_VERSION,
  WALLET_VECTOR_SOURCE_DIMENSIONS,
} from '../src/core/representations/wallet-feature-vector';
import { writeFileSync } from 'fs';

interface Args {
  seedsPerType: number;
  k: number;
  out: string | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return {
    seedsPerType: Number(get('seeds-per-type') ?? 100),
    k: Number(get('k') ?? 20),
    out: get('out') ?? null,
  };
}

// The blind types the audit flagged (v1 confuses these) + the strong types that
// must NOT regress. Everything present in the DB is measured; these drive gates.
const BLIND_TYPES = ['DISTRIBUTOR', 'PURE_HOLDER'] as const;
const STRONG_TYPES = ['FAST_TRADER', 'LOW_ACTIVITY'] as const;

interface SeedRow {
  walletAddress: string;
  strategyType: string;
}

interface NeighborRow {
  walletAddress: string;
  strategyType: string | null;
  distance: number;
}

async function seedsForType(type: string, limit: number): Promise<SeedRow[]> {
  // Deterministic sample: only wallets that actually have a v<current> vector.
  return prisma.$queryRawUnsafe<SeedRow[]>(
    `
    SELECT b."walletAddress" AS "walletAddress", b."strategyType" AS "strategyType"
    FROM "WalletBehaviorProfile" b
    JOIN "WalletVector" v
      ON v."walletAddress" = b."walletAddress"
     AND v."schemaVersion" = $1
    WHERE b."strategyType" = $2
    ORDER BY b."walletAddress"
    LIMIT $3
    `,
    WALLET_VECTOR_SCHEMA_VERSION,
    type,
    limit,
  );
}

async function neighbors(walletAddress: string, k: number): Promise<NeighborRow[]> {
  // Same retrieval as findSimilarWalletVectors, joined to strategyType so we can
  // score purity in one round-trip. ef_search >= k for a full HNSW candidate set.
  return prisma.$transaction(async (tx) => {
    const seed = await tx.$queryRawUnsafe<{ vector: string }[]>(
      `SELECT "vector"::text AS "vector" FROM "WalletVector"
       WHERE "walletAddress" = $1 AND "schemaVersion" = $2 LIMIT 1`,
      walletAddress,
      WALLET_VECTOR_SCHEMA_VERSION,
    );
    const seedVector = seed[0]?.vector;
    if (!seedVector) return [];
    await tx.$executeRawUnsafe(`SELECT set_config('hnsw.ef_search', $1, true)`, String(Math.max(k, 100)));
    return tx.$queryRawUnsafe<NeighborRow[]>(
      `
      SELECT v."walletAddress" AS "walletAddress",
             b."strategyType"  AS "strategyType",
             (v."vector" <=> $1::vector)::float AS "distance"
      FROM "WalletVector" v
      LEFT JOIN "WalletBehaviorProfile" b ON b."walletAddress" = v."walletAddress"
      WHERE v."schemaVersion" = $2 AND v."walletAddress" <> $3
      ORDER BY v."vector" <=> $1::vector
      LIMIT $4
      `,
      seedVector,
      WALLET_VECTOR_SCHEMA_VERSION,
      walletAddress,
      k,
    );
  });
}

interface TypeResult {
  type: string;
  seedCount: number;
  meanPurity: number;
  confusionInto: Record<string, number>;
}

async function purityByType(args: Args): Promise<TypeResult[]> {
  const typeRows = await prisma.$queryRawUnsafe<{ strategyType: string }[]>(
    `SELECT DISTINCT "strategyType" FROM "WalletBehaviorProfile" WHERE "strategyType" IS NOT NULL`,
  );
  const results: TypeResult[] = [];
  for (const { strategyType: type } of typeRows) {
    const seeds = await seedsForType(type, args.seedsPerType);
    if (seeds.length === 0) continue;
    let purSum = 0;
    let counted = 0;
    const confusion: Record<string, number> = {};
    for (const seed of seeds) {
      const nn = await neighbors(seed.walletAddress, args.k);
      if (nn.length === 0) continue;
      const same = nn.filter((n) => n.strategyType === type).length;
      purSum += same / nn.length;
      counted += 1;
      for (const n of nn) {
        if (n.strategyType && n.strategyType !== type) {
          confusion[n.strategyType] = (confusion[n.strategyType] ?? 0) + 1 / nn.length;
        }
      }
    }
    // Normalize confusion mass to a per-seed average fraction.
    const confusionInto: Record<string, number> = {};
    for (const [k, v] of Object.entries(confusion)) {
      confusionInto[k] = counted > 0 ? round(v / counted) : 0;
    }
    results.push({
      type,
      seedCount: counted,
      meanPurity: counted > 0 ? round(purSum / counted) : 0,
      confusionInto,
    });
  }
  return results;
}

interface DimHealth {
  dims: number;
  fracZero: number[];
  deadDims: number[]; // frac-zero >= 0.9
  maxAbsCorr: { i: number; j: number; r: number };
}

async function dimHealth(sampleLimit = 20000): Promise<DimHealth> {
  const rows = await prisma.$queryRawUnsafe<{ sourceVector: number[] }[]>(
    `SELECT "sourceVector" FROM "WalletVector" WHERE "schemaVersion" = $1 LIMIT $2`,
    WALLET_VECTOR_SCHEMA_VERSION,
    sampleLimit,
  );
  const vectors = rows.map((r) => r.sourceVector as unknown as number[]).filter((v) => Array.isArray(v));
  const dims = vectors[0]?.length ?? WALLET_VECTOR_SOURCE_DIMENSIONS;
  const n = vectors.length;

  const fracZero = new Array(dims).fill(0);
  const means = new Array(dims).fill(0);
  for (const v of vectors) {
    for (let d = 0; d < dims; d++) {
      if (v[d] === 0) fracZero[d] += 1;
      means[d] += v[d];
    }
  }
  for (let d = 0; d < dims; d++) {
    fracZero[d] = round(fracZero[d] / n);
    means[d] /= n;
  }

  // Pearson r for every pair — dims small (~30), n up to 20k. O(dims^2 * n).
  const sd = new Array(dims).fill(0);
  for (const v of vectors) for (let d = 0; d < dims; d++) sd[d] += (v[d] - means[d]) ** 2;
  for (let d = 0; d < dims; d++) sd[d] = Math.sqrt(sd[d] / n) || 1;

  let maxAbs = { i: -1, j: -1, r: 0 };
  for (let i = 0; i < dims; i++) {
    for (let j = i + 1; j < dims; j++) {
      let cov = 0;
      for (const v of vectors) cov += (v[i] - means[i]) * (v[j] - means[j]);
      const r = cov / n / (sd[i] * sd[j]);
      if (Math.abs(r) > Math.abs(maxAbs.r)) maxAbs = { i, j, r: round(r) };
    }
  }
  const deadDims = fracZero.map((f, d) => (f >= 0.9 ? d : -1)).filter((d) => d >= 0);
  return { dims, fracZero, deadDims, maxAbsCorr: maxAbs };
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[harness] schemaVersion=${WALLET_VECTOR_SCHEMA_VERSION} seeds/type=${args.seedsPerType} k=${args.k}`);

  const total = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT count(*) c FROM "WalletVector" WHERE "schemaVersion" = $1`,
    WALLET_VECTOR_SCHEMA_VERSION,
  );
  console.log(`[harness] WalletVector rows @ v${WALLET_VECTOR_SCHEMA_VERSION}: ${total[0].c}`);
  if (Number(total[0].c) === 0) {
    console.error(`[harness] ABORT: no vectors at schemaVersion ${WALLET_VECTOR_SCHEMA_VERSION}. Backfill first.`);
    process.exit(1);
  }

  const perType = await purityByType(args);
  const health = await dimHealth();

  console.log('\n=== Per-type neighbor purity ===');
  for (const t of perType.sort((a, b) => b.meanPurity - a.meanPurity)) {
    const tag = (BLIND_TYPES as readonly string[]).includes(t.type)
      ? ' [BLIND]'
      : (STRONG_TYPES as readonly string[]).includes(t.type)
      ? ' [STRONG]'
      : '';
    const topConf = Object.entries(t.confusionInto).sort((a, b) => b[1] - a[1])[0];
    console.log(
      `  ${t.type.padEnd(16)}${tag.padEnd(9)} purity=${t.meanPurity.toFixed(3)} ` +
        `(n=${t.seedCount})  top-confusion=${topConf ? `${topConf[0]}:${topConf[1].toFixed(3)}` : '-'}`,
    );
  }

  console.log('\n=== Named confusions (audit gate) ===');
  const dist = perType.find((t) => t.type === 'DISTRIBUTOR');
  const hold = perType.find((t) => t.type === 'PURE_HOLDER');
  console.log(`  DISTRIBUTOR -> FAST_TRADER  : ${(dist?.confusionInto['FAST_TRADER'] ?? 0).toFixed(3)}`);
  console.log(`  PURE_HOLDER -> LOW_ACTIVITY : ${(hold?.confusionInto['LOW_ACTIVITY'] ?? 0).toFixed(3)}`);

  console.log('\n=== Per-dim health ===');
  console.log(`  dims=${health.dims}  deadDims(frac0>=0.9)=[${health.deadDims.join(',')}]`);
  console.log(
    `  max|r| pair = dim${health.maxAbsCorr.i} <-> dim${health.maxAbsCorr.j} r=${health.maxAbsCorr.r}`,
  );

  const report = {
    schemaVersion: WALLET_VECTOR_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    args,
    perType,
    dimHealth: health,
  };
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(report, null, 2));
    console.log(`\n[harness] wrote ${args.out}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
