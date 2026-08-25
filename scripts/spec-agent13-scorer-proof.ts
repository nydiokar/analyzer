/**
 * AGENT_13 D2 proof — calibrated capital outcome scorer on :5434 (read-only).
 *
 * Picks real wallets across the outcome spectrum (top winner, big loser, mid, and a
 * LOW-dq wallet) and prints the calibrated score, to show the estimate is honest across
 * the gradient — not just the 1.00/0.00 tail illusion the thesis gate flagged. Also runs
 * a population calibration sweep: bucket wallets by predicted profitableFraction and check
 * the ACTUAL seed win-rate per bucket monotonically tracks it (the real calibration test).
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register scripts/spec-agent13-scorer-proof.ts [sweepN]
 */

import { prisma, DatabaseService } from '../src/core/services/database-service';

async function pick(where: string): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<{ walletAddress: string }[]>(
    `SELECT cv."walletAddress"
     FROM "WalletCapitalVector" cv
     JOIN "WalletPnlSummary" ps ON ps."walletAddress" = cv."walletAddress"
     WHERE ${where}
     LIMIT 1`,
  );
  return rows[0]?.walletAddress ?? null;
}

async function main(): Promise<void> {
  const db = new DatabaseService();
  const sweepN = Number(process.argv[2] ?? 500);

  const cases: Record<string, string | null> = {
    topWinner: await pick(`cv."dataQuality" > 0.9 AND ps."realizedPnl" > 100 ORDER BY ps."realizedPnl" DESC`),
    bigLoser: await pick(`cv."dataQuality" > 0.9 AND ps."realizedPnl" < -50 ORDER BY ps."realizedPnl" ASC`),
    midWallet: await pick(`cv."dataQuality" > 0.9 AND ps."realizedPnl" BETWEEN -1 AND 1 ORDER BY md5(cv."walletAddress")`),
    lowQuality: await pick(`cv."dataQuality" < 0.5 ORDER BY md5(cv."walletAddress")`),
  };

  console.log('=== Spectrum cases ===');
  for (const [label, addr] of Object.entries(cases)) {
    if (!addr) { console.log(`${label}: (none found)`); continue; }
    const seedPnl = await prisma.walletPnlSummary.findUnique({
      where: { walletAddress: addr }, select: { realizedPnl: true },
    });
    const score = await db.getCapitalOutcomeScore(addr);
    console.log(`\n--- ${label} (${addr.slice(0, 8)}… own realizedPnl=${seedPnl?.realizedPnl?.toFixed(1)}) ---`);
    if (!score) { console.log('  no capital vector'); continue; }
    console.log(JSON.stringify({
      profitableFraction: score.profitableFraction,
      profitableCI95: score.profitableCI95,
      liftOverBaseRate: score.liftOverBaseRate,
      medianNeighborPnl: score.medianNeighborPnl,
      neighborCount: score.neighborCount,
      neighborsBelowQuality: score.neighborsBelowQuality,
      confidence: score.confidence,
      reasonCodes: score.reasonCodes.map((r) => `${r.direction} ${r.axis} (z=${r.z.toFixed(2)})`),
      expectation: score.expectation,
    }, null, 2));
  }

  // === Calibration sweep: predicted profitableFraction vs actual seed win-rate ===
  console.log('\n=== Calibration sweep ===');
  const seeds = await prisma.$queryRaw<{ walletAddress: string; realizedPnl: number }[]>`
    SELECT cv."walletAddress", ps."realizedPnl"
    FROM "WalletCapitalVector" cv
    JOIN "WalletPnlSummary" ps ON ps."walletAddress" = cv."walletAddress"
    WHERE cv."dataQuality" > 0.9
    ORDER BY md5(cv."walletAddress")
    LIMIT ${sweepN}
  `;

  const buckets = new Map<string, { predSum: number; winCount: number; n: number }>();
  const bucketKey = (p: number) => {
    if (p < 0.2) return '[0.0,0.2)';
    if (p < 0.4) return '[0.2,0.4)';
    if (p < 0.6) return '[0.4,0.6)';
    if (p < 0.8) return '[0.6,0.8)';
    return '[0.8,1.0]';
  };

  let scored = 0;
  for (const seed of seeds) {
    const s = await db.getCapitalOutcomeScore(seed.walletAddress);
    if (!s || s.confidence === 'insufficient') continue;
    scored++;
    const k = bucketKey(s.profitableFraction);
    const b = buckets.get(k) ?? { predSum: 0, winCount: 0, n: 0 };
    b.predSum += s.profitableFraction;
    b.winCount += seed.realizedPnl > 0 ? 1 : 0;
    b.n += 1;
    buckets.set(k, b);
  }

  console.log(`scored ${scored}/${seeds.length} seeds (rest insufficient/no-vector)`);
  console.log('predicted-fraction bucket → (avg predicted | ACTUAL seed win-rate | n)');
  for (const key of ['[0.0,0.2)', '[0.2,0.4)', '[0.4,0.6)', '[0.6,0.8)', '[0.8,1.0]']) {
    const b = buckets.get(key);
    if (!b) { console.log(`  ${key}: (empty)`); continue; }
    console.log(`  ${key}: avgPred=${(b.predSum / b.n).toFixed(3)} | actualWinRate=${(b.winCount / b.n).toFixed(3)} | n=${b.n}`);
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
