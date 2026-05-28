/**
 * Economic-correctness validation for the clean RPC-full mapper
 * (`src/core/services/rpc-full-mapper.ts`).
 *
 * Unlike the parity-oriented shadow harness, this does NOT treat the Enhanced-derived
 * persisted baseline as ground truth — Enhanced silently records swaps it can't parse
 * as TRANSFER/sol=0. Instead it classifies each signature by ECONOMIC outcome:
 *
 *   agreement       — amounts + value + (optionally) type all match within tolerance
 *   type_only_diff  — same amounts & value, only the interactionType label differs
 *   recovered_value — baseline had ~0 value, clean mapper assigns real value (likely a
 *                     swap Enhanced mislabeled as a 0-cost transfer)  => RPC-full WIN
 *   lost_value      — baseline had value, clean mapper has ~0          => REGRESSION
 *   value_divergence— both have value but they differ beyond tolerance => INVESTIGATE
 *   shape_divergence— mints/amounts don't line up                      => INVESTIGATE
 *
 * Plus a balance self-consistency check on the clean mapper's own SWAP rows.
 *
 * READ-ONLY: persisted SwapAnalysisInput is the comparison set (no Enhanced credits,
 * no /v0/transactions). Only RPC-full `getTransactionsForAddress` is called.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/validate-rpc-full-mapper.ts \
 *     --sample-from-db 30 [--wallets w1,w2] [--limit 100] [--max-pages 2] \
 *     [--out-dir /tmp/rpc-full-validate]
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/core/services/database-service';
import { mapRpcFullToSwapAnalysisInputs, RpcFullMappedRow } from '../src/core/services/rpc-full-mapper';

const RPC_BASE = 'https://mainnet.helius-rpc.com/';
const SOL_USD = 150; // rough SOL-equivalence for combining SOL+USDC magnitudes in metrics only

interface Args {
  wallets: string[];
  sampleFromDb: number;
  sampleOffset: number;
  limit: number;
  maxPages: number;
  outDir: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  return {
    wallets: (get('--wallets') || '').split(',').map((s) => s.trim()).filter(Boolean),
    sampleFromDb: parseInt(get('--sample-from-db') || '0', 10),
    sampleOffset: parseInt(get('--sample-offset') || '0', 10),
    limit: parseInt(get('--limit') || '100', 10),
    maxPages: parseInt(get('--max-pages') || '2', 10),
    outDir: get('--out-dir') || '/tmp/rpc-full-validate',
  };
}

function requireKey(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) {
    console.error('FATAL: HELIUS_API_KEY not in environment. The key is never printed.');
    process.exit(1);
  }
  return key;
}

let gtfaRequests = 0;
async function rpcCall(method: string, params: any[], key: string): Promise<any> {
  const res = await fetch(`${RPC_BASE}?api-key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `val-${method}`, method, params }),
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
      transactionDetails: 'full',
      encoding: 'jsonParsed',
      sortOrder: 'desc',
      limit: PAGE,
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
      filters: { status: 'succeeded', tokenAccounts: 'balanceChanged' },
    };
    if (paginationToken) opts.paginationToken = paginationToken;
    const result = await rpcCall('getTransactionsForAddress', [address, opts], key);
    gtfaRequests++;
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

interface AggVal {
  amount: number;
  sol: number;
  usdc: number;
}
type Row = { mint: string; direction: string; amount: number; associatedSolValue: number; associatedUsdcValue: number; interactionType: string };

const aggKey = (r: { mint: string; direction: string }) => `${r.mint}|${r.direction}`;
function aggregate(rows: Row[]): { byKey: Map<string, AggVal>; type: string | null } {
  const byKey = new Map<string, AggVal>();
  for (const r of rows) {
    const k = aggKey(r);
    const cur = byKey.get(k) || { amount: 0, sol: 0, usdc: 0 };
    cur.amount += Math.abs(r.amount);
    cur.sol += Math.abs(r.associatedSolValue || 0);
    cur.usdc += Math.abs(r.associatedUsdcValue || 0);
    byKey.set(k, cur);
  }
  return { byKey, type: rows[0]?.interactionType ?? null };
}

const relClose = (a: number, b: number, tol: number, eps = 1e-6) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b)) + eps;
const solEq = (sol: number, usdc: number) => sol + usdc / SOL_USD;

interface SigResult {
  signature: string;
  category: string;
  baselineType: string | null;
  cleanType: string | null;
  baselineSol: number;
  baselineUsdc: number;
  cleanSol: number;
  cleanUsdc: number;
  baselineValueSolEq: number;
  cleanValueSolEq: number;
  valueDeltaSolEq: number;
  selfConsistent: boolean | null;
  flags: string[];
}

function classifySig(signature: string, baseRows: Row[], cleanRows: Row[], flags: string[]): SigResult {
  const b = aggregate(baseRows);
  const c = aggregate(cleanRows);
  const baselineSol = baseRows.reduce((a, r) => a + Math.abs(r.associatedSolValue || 0), 0);
  const baselineUsdc = baseRows.reduce((a, r) => a + Math.abs(r.associatedUsdcValue || 0), 0);
  const cleanSol = cleanRows.reduce((a, r) => a + Math.abs(r.associatedSolValue || 0), 0);
  const cleanUsdc = cleanRows.reduce((a, r) => a + Math.abs(r.associatedUsdcValue || 0), 0);
  const baselineValueSolEq = solEq(baselineSol, baselineUsdc);
  const cleanValueSolEq = solEq(cleanSol, cleanUsdc);

  // amount alignment per (mint, direction)
  const keys = new Set<string>([...b.byKey.keys(), ...c.byKey.keys()]);
  let amountsAlign = true;
  let valuesAlign = true;
  for (const k of keys) {
    const bv = b.byKey.get(k);
    const cv = c.byKey.get(k);
    // ignore pure rent-dust phantom rows (amount 0) on either side
    const bAmt = bv?.amount ?? 0;
    const cAmt = cv?.amount ?? 0;
    if (bAmt === 0 && cAmt === 0) continue;
    if (!bv || !cv) {
      // a mint/direction present on only one side; tolerate tiny dust (<1e-4 of nothing)
      if ((bAmt || cAmt) > 0) amountsAlign = false;
      continue;
    }
    if (!relClose(bAmt, cAmt, 0.02)) amountsAlign = false;
    if (!relClose(solEq(bv.sol, bv.usdc), solEq(cv.sol, cv.usdc), 0.05, 0.01)) valuesAlign = false;
  }

  // Price-independent correctness invariant: every leg of a clean SWAP should carry
  // a non-zero associated value. A zero-value SWAP leg means we recognized a swap but
  // failed to assign its notional — the real under-valuation risk. (We deliberately do
  // NOT compare in-value vs out-value: SOL<->stable legs can't be balanced without a
  // price, which would produce false failures.)
  let selfConsistent: boolean | null = null;
  if (c.type === 'SWAP') {
    selfConsistent = true;
    for (const v of c.byKey.values()) {
      if (solEq(v.sol, v.usdc) < 1e-6) {
        selfConsistent = false;
        break;
      }
    }
  }

  const baselineHasValue = baselineValueSolEq >= 0.005;
  const cleanHasValue = cleanValueSolEq >= 0.005;
  const valueDeltaSolEq = cleanValueSolEq - baselineValueSolEq;

  let category: string;
  if (!amountsAlign) {
    category = 'shape_divergence';
  } else if (!baselineHasValue && cleanHasValue) {
    category = 'recovered_value';
  } else if (baselineHasValue && !cleanHasValue) {
    category = 'lost_value';
  } else if (valuesAlign) {
    category = b.type === c.type ? 'agreement' : 'type_only_diff';
  } else {
    category = 'value_divergence';
  }

  return {
    signature,
    category,
    baselineType: b.type,
    cleanType: c.type,
    baselineSol: +baselineSol.toFixed(4),
    baselineUsdc: +baselineUsdc.toFixed(2),
    cleanSol: +cleanSol.toFixed(4),
    cleanUsdc: +cleanUsdc.toFixed(2),
    baselineValueSolEq: +baselineValueSolEq.toFixed(4),
    cleanValueSolEq: +cleanValueSolEq.toFixed(4),
    valueDeltaSolEq: +valueDeltaSolEq.toFixed(4),
    selfConsistent,
    flags,
  };
}

async function resolveWallets(args: Args): Promise<string[]> {
  const set = new Set<string>(args.wallets);
  if (args.sampleFromDb > 0) {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT "walletAddress" FROM "SwapAnalysisInput" GROUP BY "walletAddress" ORDER BY MAX("timestamp") DESC LIMIT ${Math.floor(args.sampleFromDb)} OFFSET ${Math.floor(args.sampleOffset)}`,
    )) as Array<{ walletAddress: string }>;
    for (const r of rows) set.add(r.walletAddress);
  }
  return Array.from(set);
}

async function runWallet(wallet: string, args: Args, key: string) {
  const dbRows = (await prisma.swapAnalysisInput.findMany({
    where: { walletAddress: wallet },
    select: { signature: true, mint: true, direction: true, amount: true, associatedSolValue: true, associatedUsdcValue: true, interactionType: true },
  })) as any[];
  const persistedSigs = new Set(dbRows.map((r) => r.signature));
  const baseBySig = new Map<string, Row[]>();
  for (const r of dbRows) {
    const a = baseBySig.get(r.signature) || [];
    a.push(r);
    baseBySig.set(r.signature, a);
  }

  const rawBySig = await fetchRpcFull(wallet, args.limit, args.maxPages, key);
  const overlap = [...rawBySig.keys()].filter((s) => persistedSigs.has(s));

  const results: SigResult[] = [];
  for (const sig of overlap) {
    const { rows, flags } = mapRpcFullToSwapAnalysisInputs(wallet, [rawBySig.get(sig)]);
    results.push(classifySig(sig, baseBySig.get(sig) || [], rows, flags[sig] || []));
  }

  const catCounts: Record<string, number> = {};
  let recoveredSol = 0;
  let recoveredUsdc = 0;
  let lostSol = 0;
  let lostUsdc = 0;
  let selfConsistFail = 0;
  let selfConsistChecked = 0;
  for (const r of results) {
    catCounts[r.category] = (catCounts[r.category] || 0) + 1;
    if (r.category === 'recovered_value') {
      recoveredSol += Math.max(0, r.cleanSol - r.baselineSol);
      recoveredUsdc += Math.max(0, r.cleanUsdc - r.baselineUsdc);
    }
    if (r.category === 'lost_value') {
      lostSol += Math.max(0, r.baselineSol - r.cleanSol);
      lostUsdc += Math.max(0, r.baselineUsdc - r.cleanUsdc);
    }
    if (r.selfConsistent !== null) {
      selfConsistChecked++;
      if (!r.selfConsistent) selfConsistFail++;
    }
  }

  return { wallet, persistedSigs: persistedSigs.size, discovered: rawBySig.size, overlap: overlap.length, catCounts, recoveredSol: +recoveredSol.toFixed(3), recoveredUsdc: +recoveredUsdc.toFixed(1), lostSol: +lostSol.toFixed(3), lostUsdc: +lostUsdc.toFixed(1), selfConsistChecked, selfConsistFail, results };
}

async function main() {
  const args = parseArgs();
  const key = requireKey();
  const wallets = await resolveWallets(args);
  if (wallets.length === 0) {
    console.error('No wallets. Provide --wallets or --sample-from-db <N>.');
    process.exit(1);
  }
  fs.mkdirSync(args.outDir, { recursive: true });
  console.log(`Validate clean RPC-full mapper: ${wallets.length} wallet(s), limit=${args.limit} maxPages=${args.maxPages}`);

  const agg = {
    generatedAt: new Date().toISOString(),
    walletsTested: wallets.length,
    catCounts: {} as Record<string, number>,
    totalOverlap: 0,
    recoveredSol: 0,
    recoveredUsdc: 0,
    lostSol: 0,
    lostUsdc: 0,
    selfConsistChecked: 0,
    selfConsistFail: 0,
    perWallet: [] as any[],
  };
  const allResults: Array<SigResult & { wallet: string }> = [];

  for (const w of wallets) {
    try {
      const r = await runWallet(w, args, key);
      agg.perWallet.push({ ...r, results: undefined });
      agg.totalOverlap += r.overlap;
      agg.recoveredSol += r.recoveredSol;
      agg.recoveredUsdc += r.recoveredUsdc;
      agg.lostSol += r.lostSol;
      agg.lostUsdc += r.lostUsdc;
      agg.selfConsistChecked += r.selfConsistChecked;
      agg.selfConsistFail += r.selfConsistFail;
      for (const [k, v] of Object.entries(r.catCounts)) agg.catCounts[k] = (agg.catCounts[k] || 0) + v;
      for (const res of r.results) allResults.push({ ...res, wallet: w });
      fs.writeFileSync(path.join(args.outDir, `${w}.json`), JSON.stringify(r, null, 2));
      console.log(`${w.slice(0, 6)}…  overlap=${r.overlap} recovered=${r.recoveredSol}SOL/${r.recoveredUsdc}USDC lost=${r.lostSol}SOL/${r.lostUsdc}USDC cats=${JSON.stringify(r.catCounts)}`);
    } catch (e: any) {
      console.error(`${w.slice(0, 6)}… FAILED: ${e.message}`);
    }
  }
  agg.recoveredSol = +agg.recoveredSol.toFixed(3);
  agg.recoveredUsdc = +agg.recoveredUsdc.toFixed(1);
  agg.lostSol = +agg.lostSol.toFixed(3);
  agg.lostUsdc = +agg.lostUsdc.toFixed(1);

  // spot-check export: worst/biggest per actionable category, with Solscan links
  const link = (s: string) => `https://solscan.io/tx/${s}`;
  const pick = (cat: string, sortKey: (r: SigResult) => number, n = 15) =>
    allResults
      .filter((r) => r.category === cat)
      .sort((a, b) => sortKey(b) - sortKey(a))
      .slice(0, n)
      .map((r) => ({ wallet: r.wallet, sig: r.signature, link: link(r.signature), baselineType: r.baselineType, cleanType: r.cleanType, baseline: `${r.baselineSol}SOL/${r.baselineUsdc}USDC`, clean: `${r.cleanSol}SOL/${r.cleanUsdc}USDC`, valueDeltaSolEq: r.valueDeltaSolEq, selfConsistent: r.selfConsistent, flags: r.flags }));

  const spotCheck = {
    recovered_value_top: pick('recovered_value', (r) => r.valueDeltaSolEq),
    lost_value_top: pick('lost_value', (r) => -r.valueDeltaSolEq),
    value_divergence_top: pick('value_divergence', (r) => Math.abs(r.valueDeltaSolEq)),
    shape_divergence_top: pick('shape_divergence', (r) => Math.abs(r.valueDeltaSolEq)),
    self_consistency_failures: allResults.filter((r) => r.selfConsistent === false).slice(0, 20).map((r) => ({ wallet: r.wallet, sig: r.signature, link: link(r.signature), cleanValueSolEq: r.cleanValueSolEq, flags: r.flags })),
  };

  fs.writeFileSync(path.join(args.outDir, 'summary.json'), JSON.stringify(agg, null, 2));
  fs.writeFileSync(path.join(args.outDir, 'spot-check.json'), JSON.stringify(spotCheck, null, 2));

  console.log('\n=== VALIDATION SUMMARY ===');
  console.log(`wallets=${agg.walletsTested} overlapSigs=${agg.totalOverlap}`);
  console.log(`categories: ${JSON.stringify(agg.catCounts)}`);
  const pct = (n: number) => ((100 * n) / Math.max(agg.totalOverlap, 1)).toFixed(1);
  for (const [k, v] of Object.entries(agg.catCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v} (${pct(v)}%)`);
  console.log(`recovered value: +${agg.recoveredSol} SOL / +${agg.recoveredUsdc} USDC  |  lost value: -${agg.lostSol} SOL / -${agg.lostUsdc} USDC`);
  console.log(`self-consistency: ${agg.selfConsistChecked - agg.selfConsistFail}/${agg.selfConsistChecked} balanced SPL-to-SPL swaps`);
  console.log(`RPC-full getTransactionsForAddress requests: ${gtfaRequests} (~${gtfaRequests * 100} credits)`);
  console.log(`Output: ${args.outDir}/summary.json + spot-check.json + per-wallet`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Validation failed:', e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
