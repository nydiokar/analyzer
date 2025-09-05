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
        .option('txCountLimit', { type: 'number', default: 500, desc: 'Max signatures to scan per wallet for counts' })
        .option('output', { choices: ['jsonl', 'csv'] as const, default: 'jsonl', desc: 'Output format' })
        .option('outFile', { type: 'string', desc: 'Output file path (defaults per format)' })
        .option('candidateWindow', { type: 'number', default: 300, desc: 'Max latest signatures (<= cutoff) per iteration to parse' })
        .option('creationScan', { choices: ['none', 'full'] as const, default: 'full', desc: 'Wallet creation scan mode (default full: walk pages to earliest signature)' })
        .option('creationSkipIfTokenAccountsOver', { type: 'number', desc: 'Optional: if set, skip full scan when token accounts exceed this' })
        .option('dryRun', { type: 'boolean', default: false })
        .option('verbose', { type: 'boolean', default: false })
    )
    .demandCommand(1)
    .strict()
    .parseAsync() as unknown as { _: [string]; [k: string]: unknown } & Partial<CliArgs>;

  const command = argv._[0];
  if (command !== 'scan') {
    console.error('Unknown command');
    process.exit(1);
  }

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
    txCountLimit: Number(argv.txCountLimit ?? 500),
    output: (argv.output as CliArgs['output']) ?? 'jsonl',
    outFile: (argv.outFile as string | undefined),
    candidateWindow: Number(argv.candidateWindow ?? 300),
    dryRun: Boolean(argv.dryRun),
    verbose: Boolean(argv.verbose),
    creationScan: (argv.creationScan as CliArgs['creationScan']) ?? 'full',
    creationSkipIfTokenAccountsOver: argv.creationSkipIfTokenAccountsOver as number | undefined,
  };

  if (!process.env.HELIUS_API_KEY) {
    console.error('HELIUS_API_KEY is not set in environment.');
    process.exit(1);
  }

  // Instantiate client (DB used only for cache if configured; no writes in this script)
  const dbService = new DatabaseService();
  const heliusClient = new HeliusApiClient({ apiKey: process.env.HELIUS_API_KEY!, network: 'mainnet' }, dbService);

  // Step 1: signatures pre-filter around cutoff
  const fetchAddress = args.mint; // MVP: use mint directly; addressType hooks added later
  const candidateSignatures = await prefilterMintSignaturesBeforeCutoff(
    heliusClient,
    fetchAddress,
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
    if (args.output === 'jsonl') writeJsonl(outfile, enriched, args.mint, cutoffTs);
    else writeCsv(outfile, enriched, args.mint, cutoffTs);
  }

  if (args.verbose) {
    console.log(JSON.stringify({
      args: { ...args, cutoffTs },
      prefilter: {
        fetchAddress,
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
    console.log(`prefilter candidates=${candidateSignatures.length} fetchAddress=${fetchAddress} buyers=${enriched.length}`);
  }
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

function writeJsonl(file: string, rows: EnrichedBuyer[], mint: string, cutoffTs: number) {
  const content = rows.map(r => JSON.stringify(toOutputRow(r, mint, cutoffTs))).join('\n') + '\n';
  fs.appendFileSync(file, content, 'utf8');
  console.log(`wrote ${rows.length} rows → ${file}`);
}

function writeCsv(file: string, rows: EnrichedBuyer[], mint: string, cutoffTs: number) {
  const header = 'wallet,mint,cutoffTs,buyTs,buyIso,signature,tokenAmount,stakeSol,tokenAccountsCount,txCountScanned,walletCreatedAtTs,walletCreatedAtIso,accountAgeDays\n';
  const lines = rows.map(r => {
    const o = toOutputRow(r, mint, cutoffTs);
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
    ].join(',');
  });
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    fs.appendFileSync(file, header, 'utf8');
  }
  fs.appendFileSync(file, lines.join('\n') + '\n', 'utf8');
  console.log(`wrote ${rows.length} rows → ${file}`);
}

function toOutputRow(r: EnrichedBuyer, mint: string, cutoffTs: number) {
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


