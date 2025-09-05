#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import { HeliusApiClient } from 'core/services/helius-api-client';
import { DatabaseService } from 'core/services/database-service';
import type { HeliusTransaction } from '@/types/helius-api';
import { mapHeliusTransactionsToIntermediateRecords } from 'core/services/helius-transaction-mapper';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

interface CliArgs {
  mint: string;
  until: string;
  limitBuyers: number;
  addressType: 'mint' | 'bonding-curve' | 'auto';
  bondingCurve?: string;
  txCountLimit: number;
  output: 'jsonl' | 'csv';
  outFile?: string;
  candidateWindow: number;
  dryRun?: boolean;
  verbose?: boolean;
  creationScan?: 'none' | 'full';
  creationSkipIfTokenAccountsOver?: number;
}

function parseCutoff(until: string): number {
  // Accept unix seconds, unix ms, or ISO
  if (/^\d{10}$/.test(until)) return parseInt(until, 10);
  if (/^\d{13}$/.test(until)) return Math.floor(parseInt(until, 10) / 1000);
  const d = new Date(until);
  if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  throw new Error(`Invalid until timestamp: ${until}`);
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('mint-participants')
    .command('scan', 'Scan last N buyers before a cutoff for a mint', (y) =>
      y
        .option('mint', { type: 'string', demandOption: true, desc: 'Token mint address' })
        .option('until', { type: 'string', demandOption: true, desc: 'Cutoff time (ISO, unix s, or unix ms)' })
        .option('limitBuyers', { type: 'number', default: 20, desc: 'Number of last buyers to return' })
        .option('addressType', { choices: ['mint', 'bonding-curve', 'auto'] as const, default: 'auto', desc: 'Source address type' })
        .option('bondingCurve', { type: 'string', desc: 'Bonding-curve address (use with --addressType bonding-curve or auto)' })
        .option('txCountLimit', { type: 'number', default: 500, desc: 'Max signatures to scan per wallet for counts' })
        .option('output', { choices: ['jsonl', 'csv'] as const, default: 'jsonl', desc: 'Output format' })
        .option('outFile', { type: 'string', desc: 'Output file path (defaults per format)' })
        .option('candidateWindow', { type: 'number', default: 300, desc: 'Max latest signatures (<= cutoff) per iteration to parse' })
        .option('creationScan', { choices: ['none', 'full'] as const, default: 'full', desc: 'Wallet creation scan mode (default full: walk pages to earliest signature)' })
        .option('creationSkipIfTokenAccountsOver', { type: 'number', desc: 'Optional: if set, skip full scan when token accounts exceed this' })
        .option('dryRun', { type: 'boolean', default: false })
        .option('verbose', { type: 'boolean', default: false })
    )
    .command('parse', 'Reduce mint-participants JSONL into a minimal mutual schema', (y) =>
      y
        .option('inFile', { type: 'string', desc: 'Input JSONL file (defaults to analyses/mint_participants/index.jsonl)' })
        .option('outFile', { type: 'string', desc: 'Output file path (default analyses/mint_participants/mutual.jsonl or .csv)' })
        .option('output', { choices: ['jsonl', 'csv'] as const, default: 'jsonl', desc: 'Output format' })
    )
    .demandCommand(1)
    .strict()
    .parseAsync() as unknown as { _: [string]; [k: string]: unknown } & Partial<CliArgs>;

  const command = argv._[0];
  if (command !== 'scan' && command !== 'parse') {
    console.error('Unknown command');
    process.exit(1);
  }

  // scan subcommand
  if (command === 'scan') {
    // Validate core args
  const mint = String(argv.mint || '').trim();
  const untilStr = String(argv.until || '').trim();
  if (!mint) {
    console.error('mint is required');
    process.exit(1);
  }
  if (!untilStr) {
    console.error('until is required');
    process.exit(1);
  }

  let cutoffTs: number;
  try {
    cutoffTs = parseCutoff(untilStr);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
    return; // TS narrow
  }

  const args: CliArgs = {
    mint,
    until: untilStr,
    limitBuyers: Number(argv.limitBuyers ?? 20),
    addressType: (argv.addressType as CliArgs['addressType']) ?? 'auto',
    bondingCurve: (argv.bondingCurve as string | undefined),
    txCountLimit: Number(argv.txCountLimit ?? 500),
    output: (argv.output as CliArgs['output']) ?? 'jsonl',
    outFile: (argv.outFile as string | undefined),
    candidateWindow: Number(argv.candidateWindow ?? 300),
    dryRun: Boolean(argv.dryRun),
    verbose: Boolean(argv.verbose),
    creationScan: (argv.creationScan as CliArgs['creationScan']) ?? 'full',
    creationSkipIfTokenAccountsOver: argv.creationSkipIfTokenAccountsOver as number | undefined,
  };

  // Apply safe default skip threshold for massive wallets when doing creation scans
  if (args.creationScan === 'full' && (args.creationSkipIfTokenAccountsOver == null)) {
    args.creationSkipIfTokenAccountsOver = 10000;
  }

  if (!process.env.HELIUS_API_KEY) {
    console.error('HELIUS_API_KEY is not set in environment.');
    process.exit(1);
  }

  // Instantiate client (DB used only for cache if configured; no writes in this script)
  const dbService = new DatabaseService();
  const heliusClient = new HeliusApiClient({ apiKey: process.env.HELIUS_API_KEY!, network: 'mainnet' }, dbService);

  // Step 1: signatures pre-filter around cutoff using one or more addresses
  const fetchAddresses = determineFetchAddresses(args);
  const candidateSignatures = await prefilterSignaturesBeforeCutoffMulti(
    heliusClient,
    fetchAddresses,
    cutoffTs,
    args.candidateWindow
  );

  // Step 2: fetch parsed details for candidates and detect last N buyers
  const detectedBuyers = await detectLastBuyersFromCandidates(
    heliusClient,
    args.mint,
    candidateSignatures,
    args.limitBuyers,
    cutoffTs
  );

  // Step 3: per-buyer stats and stake (concurrency-capped)
  const enriched = await enrichBuyers(
    heliusClient,
    args.mint,
    detectedBuyers,
    args.txCountLimit,
    args.creationScan || 'none',
    Boolean(args.verbose),
    args.creationSkipIfTokenAccountsOver
  );

  // Step 4: output
  if (!args.dryRun) {
    const outfile = resolveOutPath(args.outFile, args.output);
    ensureDir(path.dirname(outfile));
    const runScannedAtIso = new Date().toISOString();
    const runSource = args.addressType;
    if (args.output === 'jsonl') writeJsonl(outfile, enriched, args.mint, cutoffTs, { runScannedAtIso, runSource });
    else writeCsv(outfile, enriched, args.mint, cutoffTs, { runScannedAtIso, runSource });
  }

  if (args.verbose) {
    console.log(JSON.stringify({
      args: { ...args, cutoffTs },
      prefilter: {
        fetchAddresses,
        candidateCount: candidateSignatures.length,
        sample: candidateSignatures.slice(0, 10),
      },
      buyers: {
        count: enriched.length,
        rows: enriched.slice(0, 20).map(r => ({
          wallet: r.walletAddress,
          ts: r.firstBuyTimestamp,
          iso: new Date(r.firstBuyTimestamp * 1000).toISOString(),
          tokenAmount: r.tokenAmount,
          stakeSol: r.stakeSol,
        }))
      }
    }, null, 2));
  } else {
    console.log(`prefilter candidates=${candidateSignatures.length} fetchAddresses=${JSON.stringify(fetchAddresses)} buyers=${enriched.length}`);
  }
    return;
  }

  // parse subcommand
  const inFile = (argv as any).inFile as string | undefined;
  const outFormat = ((argv as any).output as 'jsonl' | 'csv') ?? 'jsonl';
  const inPath = inFile || path.join(process.cwd(), 'analyses', 'mint_participants', 'index.jsonl');
  const outFile = (argv as any).outFile as string | undefined || path.join(process.cwd(), 'analyses', 'mint_participants', outFormat === 'jsonl' ? 'mutual.jsonl' : 'mutual.csv');
  ensureDir(path.dirname(outFile));
  if (!fs.existsSync(inPath)) {
    console.error(`Input not found: ${inPath}`);
    process.exit(1);
  }
  const records = readJsonl(inPath);
  const minimal = records.map(mapToMutualRecord);
  if (outFormat === 'jsonl') {
    const content = minimal.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(outFile, content, 'utf8');
  } else {
    const header = 'wallet,mint,buyTs,buyIso,signature,tokenAmount,stakeSol,accountAgeDays,creationScanMode,creationScanPages,runScannedAtIso,runSource\n';
    const lines = minimal.map(r => [
      r.wallet,
      r.mint,
      r.buyTs,
      r.buyIso,
      r.signature,
      r.tokenAmount,
      r.stakeSol,
      r.accountAgeDays ?? '',
      r.creationScanMode ?? '',
      r.creationScanPages ?? '',
      r.runScannedAtIso ?? '',
      r.runSource ?? '',
    ].join(','));
    fs.writeFileSync(outFile, header + lines.join('\n') + '\n', 'utf8');
  }
  console.log(`wrote ${minimal.length} mutual rows → ${outFile}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

async function prefilterMintSignaturesBeforeCutoff(
  heliusClient: HeliusApiClient,
  address: string,
  cutoffTs: number,
  candidateWindow: number
): Promise<string[]> {
  const filtered: { signature: string; blockTime?: number | null }[] = [];
  let before: string | null = null;
  const pageLimit = 1000;

  while (filtered.length < candidateWindow) {
    const page: Array<{ signature: string; blockTime?: number | null }> = await (heliusClient as any)['getSignaturesViaRpcPage'](
      address,
      pageLimit,
      before
    );
    if (!page || page.length === 0) break;

    // RPC returns newest→older; apply cutoff filtering
    for (const info of page) {
      const bt = (info as any).blockTime as number | undefined;
      if (typeof bt === 'number' && bt <= cutoffTs) {
        filtered.push({ signature: info.signature, blockTime: bt });
        if (filtered.length >= candidateWindow) break;
      }
    }

    before = page[page.length - 1].signature; // move older
    if (page.length < pageLimit) break; // end
  }

  return filtered.map((x) => x.signature);
}

function determineFetchAddresses(args: CliArgs): string[] {
  if (args.addressType === 'mint') return [args.mint];
  if (args.addressType === 'bonding-curve') return args.bondingCurve ? [args.bondingCurve] : [args.mint];
  // auto: prefer provided bonding-curve if any, plus mint as fallback to maximize coverage
  const addresses: string[] = [];
  if (args.bondingCurve) addresses.push(args.bondingCurve);
  addresses.push(args.mint);
  return Array.from(new Set(addresses));
}

async function prefilterSignaturesBeforeCutoffMulti(
  heliusClient: HeliusApiClient,
  addresses: string[],
  cutoffTs: number,
  candidateWindow: number
): Promise<string[]> {
  const perAddress = Math.max(1, Math.floor(candidateWindow / Math.max(1, addresses.length)));
  const all: Set<string> = new Set();
  for (const addr of addresses) {
    const sigs = await prefilterMintSignaturesBeforeCutoff(heliusClient, addr, cutoffTs, perAddress);
    for (const s of sigs) all.add(s);
  }
  return Array.from(all);
}

interface DetectedBuyer {
  walletAddress: string;
  firstBuyTimestamp: number;
  firstBuySignature: string;
  tokenAmount: number;
  tx?: HeliusTransaction;
}

async function detectLastBuyersFromCandidates(
  heliusClient: HeliusApiClient,
  mintAddress: string,
  candidateSignatures: string[],
  limitBuyers: number,
  cutoffTs: number
): Promise<DetectedBuyer[]> {
  const allTxs: HeliusTransaction[] = [];
  const BATCH = 100;

  // Fetch all candidate txs first, then globally sort by timestamp desc
  for (let i = 0; i < candidateSignatures.length; i += BATCH) {
    const batch = candidateSignatures.slice(i, i + BATCH);
    try {
      const txs: HeliusTransaction[] = await (heliusClient as any)['getTransactionsBySignatures'](batch);
      for (const tx of txs) {
        if (tx && typeof tx.timestamp === 'number' && tx.timestamp <= cutoffTs) {
          allTxs.push(tx);
        }
      }
    } catch {
      // ignore batch errors
    }
  }

  allTxs.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  const buyers = new Map<string, DetectedBuyer>();
  for (const tx of allTxs) {
    if (!tx.tokenTransfers) continue;
    // Aggregate received amount per wallet for this mint in this tx
    const receivedByWallet = new Map<string, number>();
    for (const tr of tx.tokenTransfers) {
      if (tr.mint !== mintAddress) continue;
      if (!tr.toUserAccount) continue;
      if (typeof tr.tokenAmount !== 'number') continue;
      const w = tr.toUserAccount;
      if (w === mintAddress) continue; // skip mint itself
      receivedByWallet.set(w, (receivedByWallet.get(w) || 0) + Math.max(0, tr.tokenAmount));
    }
    for (const [walletAddress, tokenAmount] of receivedByWallet) {
      if (tokenAmount <= 0) continue;
      if (!buyers.has(walletAddress)) {
        buyers.set(walletAddress, {
          walletAddress,
          firstBuyTimestamp: tx.timestamp!,
          firstBuySignature: tx.signature,
          tokenAmount,
          tx,
        });
        if (buyers.size >= limitBuyers) break;
      }
    }
    if (buyers.size >= limitBuyers) break;
  }

  // Return newest→older
  return Array.from(buyers.values()).sort((a, b) => b.firstBuyTimestamp - a.firstBuyTimestamp);
}

// ---- Enrichment ----

interface EnrichedBuyer extends DetectedBuyer {
  stakeSol: number;
  stats: {
    tokenAccountsCount: number;
    txCountScanned: number;
    creationScanMode: 'first_page' | 'full' | 'capped';
    creationScanPages: number;
    firstSeenTs?: number | null;
    accountAgeDays?: number | null;
  };
}

async function enrichBuyers(
  heliusClient: HeliusApiClient,
  mintAddress: string,
  buyers: DetectedBuyer[],
  txCountLimit: number,
  creationScan: 'none' | 'full',
  verbose: boolean,
  creationSkipIfTokenAccountsOver?: number
): Promise<EnrichedBuyer[]> {
  const results: EnrichedBuyer[] = [];

  // Simple concurrency cap
  const CONCURRENCY = 6;
  let index = 0;
  async function worker() {
    while (index < buyers.length) {
      const i = index++;
      const b = buyers[i];
      // Fetch token accounts count first to decide creation-scan behavior safely
      const tokenAccountsCount = await getTokenAccountsCount(heliusClient, b.walletAddress);
      const shouldFullScan = creationScan === 'full' && (!creationSkipIfTokenAccountsOver || tokenAccountsCount <= creationSkipIfTokenAccountsOver);

      const [txCountData, stakeSol] = await Promise.all([
        getTxCounts(heliusClient, b.walletAddress, txCountLimit, shouldFullScan, verbose),
        computeStakeSolForBuy(heliusClient, mintAddress, b),
      ]);

      const firstSeenTs = txCountData.firstSeenTs ?? null;
      const accountAgeDays = firstSeenTs ? Math.max(0, Math.floor((Date.now() / 1000 - firstSeenTs) / 86400)) : null;

      results[i] = {
        ...b,
        stakeSol,
        stats: {
          tokenAccountsCount,
          txCountScanned: txCountData.count,
          creationScanMode: txCountData.mode,
          creationScanPages: txCountData.pages,
          firstSeenTs,
          accountAgeDays,
        },
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, buyers.length) }, () => worker()));
  return results;
}

async function getTokenAccountsCount(heliusClient: HeliusApiClient, owner: string): Promise<number> {
  try {
    // Use defaults: SPL token program + jsonParsed
    const res = await heliusClient.getTokenAccountsByOwner(owner);
    const arr = (res as any).value as any[] | undefined;
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

async function getTxCounts(
  heliusClient: HeliusApiClient,
  owner: string,
  limit: number,
  fullScan: boolean,
  verbose: boolean
): Promise<{ count: number; firstSeenTs?: number; mode: 'first_page' | 'full' | 'capped'; pages: number }> {
  let total = 0;
  let before: string | null = null;
  const pageLimit = Math.min(1000, Math.max(1, limit));
  let firstSeen: number | undefined;

  if (!fullScan) {
    const firstPage: Array<{ signature: string; blockTime?: number | null }> = await (heliusClient as any)['getSignaturesViaRpcPage'](owner, limit, null);
    total = firstPage.length;
    if (firstPage.length > 0) {
      const last = firstPage[firstPage.length - 1];
      firstSeen = typeof last.blockTime === 'number' ? last.blockTime : undefined;
    }
    return { count: total, firstSeenTs: firstSeen, mode: 'first_page', pages: 1 };
  }

  // Full scan to earliest
  let pages = 0;
  const MAX_PAGES = 50; // safety guard (~50k signatures) to avoid hangs
  while (true) {
    const page: Array<{ signature: string; blockTime?: number | null }> = await (heliusClient as any)['getSignaturesViaRpcPage'](owner, pageLimit, before);
    if (!page || page.length === 0) break;
    total += page.length;
    before = page[page.length - 1].signature;
    pages++;
    if (verbose && pages % 10 === 0) {
      console.log(`[creation-scan] owner=${owner} pages=${pages} total=${total}`);
    }
    if (pages >= MAX_PAGES) {
      if (verbose) console.warn(`[creation-scan] owner=${owner} hit MAX_PAGES=${MAX_PAGES}; stopping early.`);
      const last = page[page.length - 1];
      firstSeen = typeof last.blockTime === 'number' ? last.blockTime : undefined;
      return { count: total, firstSeenTs: firstSeen, mode: 'capped', pages };
    }
    if (page.length < pageLimit) {
      const last = page[page.length - 1];
      firstSeen = typeof last.blockTime === 'number' ? last.blockTime : undefined;
      return { count: total, firstSeenTs: firstSeen, mode: 'full', pages };
    }
  }
  return { count: total, firstSeenTs: firstSeen, mode: 'full', pages };
}

async function computeStakeSolForBuy(
  heliusClient: HeliusApiClient,
  mintAddress: string,
  buyer: DetectedBuyer
): Promise<number> {
  try {
    const tx = buyer.tx || (await (heliusClient as any)['getTransactionsBySignatures']([buyer.firstBuySignature]))[0];
    if (!tx) return 0;
    const mapped = mapHeliusTransactionsToIntermediateRecords(buyer.walletAddress, [tx]);
    const rows = mapped.analysisInputs || [];
    let stake = 0;
    for (const r of rows as any[]) {
      if (r.mint === mintAddress && r.direction === 'in') {
        const v = typeof r.associatedSolValue === 'number' ? r.associatedSolValue : 0;
        stake += v;
      }
    }
    return stake;
  } catch {
    return 0;
  }
}

function resolveOutPath(outFile: string | undefined, format: 'jsonl' | 'csv'): string {
  if (outFile) return outFile;
  const dir = path.join(process.cwd(), 'analyses', 'mint_participants');
  const name = format === 'jsonl' ? 'index.jsonl' : 'index.csv';
  return path.join(dir, name);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJsonl(file: string): any[] {
  const out: any[] = [];
  try {
    const data = fs.readFileSync(file, 'utf8');
    const lines = data.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch {}
    }
  } catch {}
  return out;
}

function mapToMutualRecord(o: any) {
  return {
    wallet: o.wallet,
    mint: o.mint,
    buyTs: o.buyTs,
    buyIso: o.buyIso,
    signature: o.signature,
    tokenAmount: o.tokenAmount,
    stakeSol: o.stakeSol,
    accountAgeDays: o.accountAgeDays,
    creationScanMode: o.creationScanMode,
    creationScanPages: o.creationScanPages,
    runScannedAtIso: o.runScannedAtIso,
    runSource: o.runSource,
  };
}

function buildExistingKeySetFromJsonl(file: string): Set<string> {
  const set = new Set<string>();
  if (!fs.existsSync(file)) return set;
  try {
    const data = fs.readFileSync(file, 'utf8');
    const lines = data.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj && obj.wallet && obj.signature) {
          set.add(`${obj.wallet}|${obj.signature}`);
        }
      } catch {}
    }
  } catch {}
  return set;
}

function buildExistingKeySetFromCsv(file: string): Set<string> {
  const set = new Set<string>();
  if (!fs.existsSync(file)) return set;
  try {
    const data = fs.readFileSync(file, 'utf8');
    const lines = data.split(/\r?\n/);
    // skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      const parts = line.split(',');
      if (parts.length < 6) continue;
      const wallet = parts[0];
      const signature = parts[5];
      if (wallet && signature) set.add(`${wallet}|${signature}`);
    }
  } catch {}
  return set;
}

function writeJsonl(
  file: string,
  rows: EnrichedBuyer[],
  mint: string,
  cutoffTs: number,
  runMeta: { runScannedAtIso: string; runSource: 'mint' | 'bonding-curve' | 'auto' }
) {
  const existing = buildExistingKeySetFromJsonl(file);
  const fresh = rows.filter(r => !existing.has(`${r.walletAddress}|${r.firstBuySignature}`));
  if (fresh.length === 0) {
    console.log(`no new rows (dedupe) → ${file}`);
    return;
  }
  const content = fresh.map(r => JSON.stringify(toOutputRow(r, mint, cutoffTs, runMeta))).join('\n') + '\n';
  fs.appendFileSync(file, content, 'utf8');
  console.log(`wrote ${fresh.length} rows → ${file}`);
}

function writeCsv(
  file: string,
  rows: EnrichedBuyer[],
  mint: string,
  cutoffTs: number,
  runMeta: { runScannedAtIso: string; runSource: 'mint' | 'bonding-curve' | 'auto' }
) {
  const header = 'wallet,mint,cutoffTs,buyTs,buyIso,signature,tokenAmount,stakeSol,tokenAccountsCount,txCountScanned,walletCreatedAtTs,walletCreatedAtIso,accountAgeDays,creationScanMode,creationScanPages,runScannedAtIso,runSource\n';
  const existing = buildExistingKeySetFromCsv(file);
  const fresh = rows.filter(r => !existing.has(`${r.walletAddress}|${r.firstBuySignature}`));
  if (fresh.length === 0) {
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
      fs.appendFileSync(file, header, 'utf8');
    }
    console.log(`no new rows (dedupe) → ${file}`);
    return;
  }
  const lines = fresh.map(r => {
    const o = toOutputRow(r, mint, cutoffTs, runMeta);
    return [
      o.wallet,
      o.mint,
      o.cutoffTs,
      o.buyTs,
      o.buyIso,
      o.signature,
      o.tokenAmount,
      o.stakeSol,
      o.tokenAccountsCount,
      o.txCountScanned,
      o.walletCreatedAtTs ?? '',
      o.walletCreatedAtIso ?? '',
      o.accountAgeDays ?? '',
      o.creationScanMode,
      o.creationScanPages,
      o.runScannedAtIso,
      o.runSource,
    ].join(',');
  });
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    fs.appendFileSync(file, header, 'utf8');
  }
  fs.appendFileSync(file, lines.join('\n') + '\n', 'utf8');
  console.log(`wrote ${fresh.length} rows → ${file}`);
}

function toOutputRow(
  r: EnrichedBuyer,
  mint: string,
  cutoffTs: number,
  runMeta?: { runScannedAtIso: string; runSource: 'mint' | 'bonding-curve' | 'auto' }
) {
  const walletCreatedAtTs = r.stats.firstSeenTs ?? undefined;
  const walletCreatedAtIso = walletCreatedAtTs ? new Date(walletCreatedAtTs * 1000).toISOString() : undefined;
  return {
    wallet: r.walletAddress,
    mint,
    cutoffTs,
    buyTs: r.firstBuyTimestamp,
    buyIso: new Date(r.firstBuyTimestamp * 1000).toISOString(),
    signature: r.firstBuySignature,
    tokenAmount: r.tokenAmount,
    stakeSol: normalizeStake(r.stakeSol),
    tokenAccountsCount: r.stats.tokenAccountsCount,
    txCountScanned: r.stats.txCountScanned,
    walletCreatedAtTs,
    walletCreatedAtIso,
    accountAgeDays: r.stats.accountAgeDays,
    creationScanMode: r.stats.creationScanMode,
    creationScanPages: r.stats.creationScanPages,
    runScannedAtIso: runMeta?.runScannedAtIso,
    runSource: runMeta?.runSource,
  };
}

function normalizeStake(value: number): number {
  // Guard against accidental lamports written as SOL
  if (value > 1000) {
    const maybeSol = value / 1e9;
    if (maybeSol < 1000) return maybeSol;
  }
  return value;
}


