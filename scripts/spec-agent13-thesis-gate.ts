/**
 * AGENT_13 THESIS GATE (read-only research, :5434).
 *
 * The load-bearing measurement the whole two-vector program rides on, run BEFORE
 * building the scorer / typology (owner doc §29: behavior-kNN is already 92% at the
 * winner tail → the two vectors are NOT assumed independent; state the real number).
 *
 * For a sample of high-dataQuality seed wallets, compute per seed:
 *   - behPnl = mean realizedPnl of its behavior-kNN neighborhood
 *   - capPnl = mean realizedPnl of its capital-kNN neighborhood
 * then report:
 *   (1) Pearson corr(behPnl, capPnl)  — how redundant the two lenses are (~1.0 = the
 *       second vector adds nothing; low = it adds real signal).
 *   (2) neighbor-set overlap (Jaccard) between the two kNN sets — do they even point at
 *       the same wallets?
 *   (3) capital-kNN outcome separation at the tails (does a rich capital nbhd actually
 *       mean the seed is profitable) — the premise of the D2 scorer.
 * All gated at dataQuality > 0.9. Read-only; no writes.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/spec-agent13-thesis-gate.ts [sampleSize]
 */

import { prisma, DatabaseService } from '../src/core/services/database-service';

const K = 20;
const DQ_GATE = 0.9;

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom === 0 ? NaN : sxy / denom;
}

function median(v: number[]): number {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main(): Promise<void> {
  const sampleSize = Number(process.argv[2] ?? 400);
  const db = new DatabaseService();

  // High-dq seeds only, sampled deterministically across the space.
  const seeds = await prisma.$queryRaw<{ walletAddress: string; realizedPnl: number }[]>`
    SELECT cv."walletAddress", ps."realizedPnl"
    FROM "WalletCapitalVector" cv
    JOIN "WalletPnlSummary" ps ON ps."walletAddress" = cv."walletAddress"
    WHERE cv."dataQuality" > ${DQ_GATE}
    ORDER BY md5(cv."walletAddress")
    LIMIT ${sampleSize}
  `;

  const behPnls: number[] = [];
  const capPnls: number[] = [];
  const overlaps: number[] = [];
  const seedPnls: number[] = [];
  const capNbhdProfitablePct: number[] = []; // fraction of capital nbhd that is profitable

  let skipped = 0;

  for (const seed of seeds) {
    // SERIAL, not Promise.all: each kNN helper opens its own interactive $transaction,
    // and concurrent interactive tx exhaust the Prisma pool → P2028 (AGENT_10's
    // documented pitfall). Each probe is only ~1.5–46ms, so serial is cheap.
    const behNbrs = await db.findSimilarWalletVectors(seed.walletAddress, K);
    const capNbrs = await db.findSimilarCapitalVectors(seed.walletAddress, K);
    // Both neighborhoods must be well-populated for a fair comparison.
    if (behNbrs.length < K / 2 || capNbrs.length < K / 2) { skipped++; continue; }

    // Gate capital neighbors to high dq (a low-dq neighbor's PnL is not trustworthy).
    const capHiDq = capNbrs.filter((n) => n.dataQuality > DQ_GATE);
    if (capHiDq.length < K / 2) { skipped++; continue; }

    const behAddrs = behNbrs.map((n) => n.walletAddress);
    const capAddrs = capHiDq.map((n) => n.walletAddress);

    const pnlRows = await prisma.walletPnlSummary.findMany({
      where: { walletAddress: { in: [...behAddrs, ...capAddrs] } },
      select: { walletAddress: true, realizedPnl: true },
    });
    const pnlMap = new Map<string, number>();
    for (const r of pnlRows) pnlMap.set(r.walletAddress, r.realizedPnl);

    const behVals = behAddrs.map((a) => pnlMap.get(a)).filter((x): x is number => typeof x === 'number');
    const capVals = capAddrs.map((a) => pnlMap.get(a)).filter((x): x is number => typeof x === 'number');
    if (behVals.length === 0 || capVals.length === 0) { skipped++; continue; }

    behPnls.push(behVals.reduce((a, b) => a + b, 0) / behVals.length);
    capPnls.push(capVals.reduce((a, b) => a + b, 0) / capVals.length);

    const behSet = new Set(behAddrs);
    const inter = capAddrs.filter((a) => behSet.has(a)).length;
    const union = new Set([...behAddrs, ...capAddrs]).size;
    overlaps.push(union === 0 ? 0 : inter / union);

    seedPnls.push(seed.realizedPnl);
    capNbhdProfitablePct.push(capVals.filter((v) => v > 0).length / capVals.length);
  }

  const corr = pearson(behPnls, capPnls);
  const n = behPnls.length;

  // Does a "rich" capital neighborhood actually track a profitable seed?
  // Split seeds by their capital-nbhd profitable fraction (tails) and compare seed win rate.
  const paired = seedPnls.map((p, i) => ({ seedPnl: p, capRich: capNbhdProfitablePct[i] }));
  const sortedByRich = [...paired].sort((a, b) => a.capRich - b.capRich);
  const tail = Math.max(1, Math.floor(sortedByRich.length * 0.2));
  const richTop = sortedByRich.slice(-tail);
  const richBot = sortedByRich.slice(0, tail);
  const winRate = (arr: { seedPnl: number }[]) => arr.filter((x) => x.seedPnl > 0).length / arr.length;

  console.log(JSON.stringify({
    sampleRequested: sampleSize,
    seedsUsed: n,
    skipped,
    dataQualityGate: DQ_GATE,
    k: K,
    behaviorCapital_neighborhoodPnl_correlation: Number.isNaN(corr) ? null : Number(corr.toFixed(4)),
    interpretation:
      corr > 0.85 ? 'HIGH redundancy — second vector adds little; challenge the two-vector thesis'
      : corr > 0.5 ? 'MODERATE — vectors correlated but capital adds distinct signal'
      : 'LOW — capital lens is largely independent of behavior; two vectors justified',
    medianNeighborSetOverlap_jaccard: Number(median(overlaps).toFixed(4)),
    capitalNbhd_outcome_separation: {
      seedWinRate_richCapitalNbhd_top20pct: Number(winRate(richTop).toFixed(3)),
      seedWinRate_poorCapitalNbhd_bot20pct: Number(winRate(richBot).toFixed(3)),
      populationSeedWinRate: Number((paired.filter((x) => x.seedPnl > 0).length / paired.length).toFixed(3)),
    },
  }, null, 2));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
