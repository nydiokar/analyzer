/**
 * Non-destructive A/B: compares PnL produced by the persisted (legacy-mapped) SwapAnalysisInput rows
 * against PnL from the clean RPC-full mapper, over the SAME signature set. ZERO writes to production —
 * everything runs in memory. Mirrors the validated harness fetch shape (full, jsonParsed,
 * status:succeeded + tokenAccounts:balanceChanged).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/ab-rpc-full-pnl.ts --wallets A,B
 *   npx ts-node -r tsconfig-paths/register scripts/ab-rpc-full-pnl.ts --sample-from-db 3 --sample-offset 0 --max-pages 5
 *
 * Self-loads HELIUS_API_KEY via dotenv; never prints it.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { SwapAnalyzer } from '../src/core/analysis/swap/analyzer';
import { mapRpcFullToSwapAnalysisInputs } from '../src/core/services/rpc-full-mapper';

const RPC_BASE = 'https://mainnet.helius-rpc.com/';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const prisma = new PrismaClient();
const analyzer = new SwapAnalyzer();

// Real per-day SOL/USD prices from the DB (SolDailyPrice), used to convert USDC-valued legs to SOL
// at the price on the trade's own day — applied identically to baseline and clean rows.
const timestampToDateKey = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10); // YYYY-MM-DD UTC
async function loadSolDailyPrices(): Promise<Map<string, number>> {
  const rows = await prisma.solDailyPrice.findMany({ select: { date: true, priceUsd: true } });
  return new Map(rows.map((r) => [r.date, r.priceUsd]));
}
let missingPriceDays = 0;
/** Returns a shallow copy of rows with USDC-only legs converted to SOL at their day's price. */
function withUsdcConvertedToSol(rows: any[], prices: Map<string, number>): any[] {
  return rows.map((r) => {
    const sol = Math.abs(r.associatedSolValue || 0);
    const usdc = Math.abs(r.associatedUsdcValue || 0);
    if (sol === 0 && usdc > 0) {
      const price = prices.get(timestampToDateKey(r.timestamp));
      if (price && price > 0) {
        return { ...r, associatedSolValue: usdc / price, associatedUsdcValue: 0 };
      }
      missingPriceDays++;
    }
    return r;
  });
}

interface Args { wallets: string[]; sampleFromDb: number; sampleOffset: number; maxPages: number; limit: number; }
function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  return {
    wallets: (get('--wallets') || '').split(',').map((s) => s.trim()).filter(Boolean),
    sampleFromDb: Number(get('--sample-from-db') || 0),
    sampleOffset: Number(get('--sample-offset') || 0),
    maxPages: Number(get('--max-pages') || 5),
    limit: Number(get('--limit') || 100),
  };
}
function requireKey(): string {
  const k = process.env.HELIUS_API_KEY;
  if (!k) throw new Error('HELIUS_API_KEY not set');
  return k;
}

async function rpcCall(method: string, params: any[], key: string): Promise<any> {
  const res = await fetch(`${RPC_BASE}?api-key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `ab-${method}`, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json = (await res.json()) as any;
  if (json.error) throw new Error(`RPC ${method} error: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function fetchRpcFull(address: string, limit: number, maxPages: number, key: string): Promise<Map<string, any>> {
  const bySig = new Map<string, any>();
  let paginationToken: string | undefined;
  let pages = 0;
  const PAGE = Math.min(limit, 1000);
  while (pages < maxPages) {
    const opts: any = {
      transactionDetails: 'full', encoding: 'jsonParsed', sortOrder: 'desc', limit: PAGE,
      commitment: 'finalized', maxSupportedTransactionVersion: 0,
      filters: { status: 'succeeded', tokenAccounts: 'balanceChanged' },
    };
    if (paginationToken) opts.paginationToken = paginationToken;
    const result = await rpcCall('getTransactionsForAddress', [address, opts], key);
    pages++;
    const txs: any[] = result?.data || result?.transactions || [];
    for (const tx of txs) {
      const sig = tx?.signature || tx?.transaction?.signatures?.[0];
      if (sig && !bySig.has(sig)) bySig.set(sig, tx);
    }
    paginationToken = result?.paginationToken;
    if (!paginationToken || txs.length === 0) break;
  }
  return bySig;
}

function aggregate(rows: any[], wallet: string, prices: Map<string, number>) {
  // Convert USDC legs to SOL at each trade's real day price, then analyze WITHOUT a blend price.
  const converted = withUsdcConvertedToSol(rows, prices);
  const { results } = analyzer.analyze(converted as any, wallet, undefined);
  let netPnl = 0, spent = 0, received = 0, fees = 0, tokens = 0;
  const perToken = new Map<string, number>();
  for (const r of results) {
    if (r.tokenAddress === SOL_MINT || r.isValuePreservation) continue; // positions only
    tokens++;
    netPnl += r.netSolProfitLoss ?? 0;
    spent += r.totalSolSpent ?? 0;
    received += r.totalSolReceived ?? 0;
    fees += r.totalFeesPaidInSol ?? 0;
    perToken.set(r.tokenAddress, r.netSolProfitLoss ?? 0);
  }
  return { netPnl, spent, received, fees, tokens, perToken };
}

async function runWallet(wallet: string, args: Args, key: string, prices: Map<string, number>) {
  const cleanFetched = await fetchRpcFull(wallet, args.limit, args.maxPages, key);
  const cleanSigs = new Set(cleanFetched.keys());

  // Baseline rows for the SAME signatures (apples-to-apples on the overlap).
  const baselineRows = (await prisma.swapAnalysisInput.findMany({
    where: { walletAddress: wallet, signature: { in: Array.from(cleanSigs) } },
  })) as any[];

  // Clean rows from the clean mapper for those signatures.
  const cleanRows: any[] = [];
  for (const tx of cleanFetched.values()) {
    const { rows } = mapRpcFullToSwapAnalysisInputs(wallet, [tx]);
    cleanRows.push(...rows);
  }

  const baseAgg = aggregate(baselineRows, wallet, prices);
  const cleanAgg = aggregate(cleanRows, wallet, prices);

  // Top per-token PnL divergences.
  const allTokens = new Set([...baseAgg.perToken.keys(), ...cleanAgg.perToken.keys()]);
  const diffs = [...allTokens]
    .map((t) => ({ t, base: baseAgg.perToken.get(t) ?? 0, clean: cleanAgg.perToken.get(t) ?? 0 }))
    .map((d) => ({ ...d, delta: d.clean - d.base }))
    .filter((d) => Math.abs(d.delta) > 0.01)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);

  console.log(`\n=== ${wallet} ===`);
  console.log(`overlap sigs: ${cleanSigs.size} | baseline rows: ${baselineRows.length} | clean rows: ${cleanRows.length}`);
  const fmt = (n: number) => n.toFixed(3);
  console.log(`                 netPnL(SOL)    spent     received    fees     #tokens`);
  console.log(`  baseline:      ${fmt(baseAgg.netPnl).padStart(9)}   ${fmt(baseAgg.spent).padStart(8)}  ${fmt(baseAgg.received).padStart(9)}  ${fmt(baseAgg.fees).padStart(7)}   ${baseAgg.tokens}`);
  console.log(`  clean:         ${fmt(cleanAgg.netPnl).padStart(9)}   ${fmt(cleanAgg.spent).padStart(8)}  ${fmt(cleanAgg.received).padStart(9)}  ${fmt(cleanAgg.fees).padStart(7)}   ${cleanAgg.tokens}`);
  console.log(`  Δ (clean-base):${fmt(cleanAgg.netPnl - baseAgg.netPnl).padStart(9)}   ${fmt(cleanAgg.spent - baseAgg.spent).padStart(8)}  ${fmt(cleanAgg.received - baseAgg.received).padStart(9)}  ${fmt(cleanAgg.fees - baseAgg.fees).padStart(7)}   ${cleanAgg.tokens - baseAgg.tokens}`);
  if (diffs.length > 0) {
    console.log(`  top per-token netPnL Δ:`);
    for (const d of diffs) console.log(`    ${d.t.slice(0, 8)}…  base=${fmt(d.base)}  clean=${fmt(d.clean)}  Δ=${fmt(d.delta)}`);
  }
  return { wallet, baseAgg, cleanAgg };
}

async function main() {
  const args = parseArgs();
  const key = requireKey();
  let wallets = args.wallets;
  if (wallets.length === 0 && args.sampleFromDb > 0) {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT "walletAddress" FROM "SwapAnalysisInput" GROUP BY "walletAddress" ORDER BY MAX("timestamp") DESC LIMIT ${Math.floor(args.sampleFromDb)} OFFSET ${Math.floor(args.sampleOffset)}`,
    )) as Array<{ walletAddress: string }>;
    wallets = rows.map((r) => r.walletAddress);
  }
  if (wallets.length === 0) { console.error('Provide --wallets or --sample-from-db <N>'); process.exit(1); }
  const prices = await loadSolDailyPrices();
  console.log(`A/B PnL: ${wallets.length} wallet(s), maxPages=${args.maxPages}, USDC→SOL via SolDailyPrice (${prices.size} days), overlap-only.`);
  for (const w of wallets) {
    try { await runWallet(w, args, key, prices); }
    catch (e) { console.error(`  ${w}: ${(e as Error).message}`); }
  }
  if (missingPriceDays > 0) console.log(`\n(note: ${missingPriceDays} USDC-leg rows had no SolDailyPrice for their day — left unconverted, same on both sides)`);
  await prisma.$disconnect();
}
main();
