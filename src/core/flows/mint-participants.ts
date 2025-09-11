import * as fs from 'fs';
import * as path from 'path';
import type { HeliusTransaction } from '@/types/helius-api';
import { HeliusApiClient } from '../services/helius-api-client';
import { DatabaseService } from '../services/database-service';
import { mapHeliusTransactionsToIntermediateRecords } from '../services/helius-transaction-mapper';

export type AddressType = 'mint' | 'bonding-curve' | 'auto';

export interface MintParticipantsParams {
  mint: string;
  cutoffTs: number;
  addressType: AddressType;
  sourceWallet?: string; // tracked wallet (formerly bondingCurve)
  limitBuyers?: number; // ignored if windowSeconds provided
  windowSeconds?: number; // if set, collect buyers within [cutoffTs - windowSeconds, cutoffTs]
  txCountLimit: number;
  output?: 'jsonl' | 'csv' | 'none';
  outFile?: string;
  candidateWindow: number;
  creationScan: 'none' | 'full';
  verbose?: boolean;
  creationSkipIfTokenAccountsOver?: number;
  excludeWallets?: string[];
}

export interface DetectedBuyer {
  walletAddress: string;
  firstBuyTimestamp: number;
  firstBuySignature: string;
  tokenAmount: number;
  tx?: HeliusTransaction;
}

export interface EnrichedBuyer extends DetectedBuyer {
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

export interface RunFlowMeta {
  runScannedAtIso?: string;
  runSource?: 'mint' | 'bonding-curve' | 'auto';
}

export interface RunMintParticipantsResult {
  buyers: EnrichedBuyer[];
  writtenCount?: number;
  outfile?: string;
}

export async function runMintParticipantsFlow(
  heliusClient: HeliusApiClient,
  _dbService: DatabaseService, // reserved for future DB writes; currently unused here
  params: MintParticipantsParams,
  meta?: RunFlowMeta
): Promise<RunMintParticipantsResult> {
  // Block SOL/WSOL mint addresses completely
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  if (params.mint === SOL_MINT) {
    throw new Error(`Mint-participants analysis is not supported for SOL/WSOL (${SOL_MINT}). Only SPL tokens are supported.`);
  }

  const fetchAddresses = determineFetchAddresses(params);
  const candidateSignatures = await prefilterSignaturesBeforeCutoffMulti(
    heliusClient,
    fetchAddresses,
    params.cutoffTs,
    params.candidateWindow
  );

  const detectedBuyers = await detectLastBuyersFromCandidates(
    heliusClient,
    params.mint,
    candidateSignatures,
    params.limitBuyers ?? 20,
    params.cutoffTs,
    params.windowSeconds
  );

  // Optionally exclude specific wallets from enrichment to speed up processing
  const buyersToEnrich = (params.excludeWallets && params.excludeWallets.length > 0)
    ? detectedBuyers.filter(b => !params.excludeWallets!.includes(b.walletAddress))
    : detectedBuyers;

  const enriched = await enrichBuyers(
    heliusClient,
    params.mint,
    buyersToEnrich,
    params.txCountLimit,
    params.creationScan,
    Boolean(params.verbose),
    params.creationSkipIfTokenAccountsOver
  );

  let writtenCount: number | undefined;
  let outfile: string | undefined;
  const outFormat = params.output || 'none';
  if (outFormat !== 'none') {
    outfile = resolveOutPath(params.outFile, outFormat);
    ensureDir(path.dirname(outfile));
    if (outFormat === 'jsonl') {
      writtenCount = writeJsonl(outfile, enriched, params.mint, params.cutoffTs, meta);
    } else {
      writtenCount = writeCsv(outfile, enriched, params.mint, params.cutoffTs, meta);
    }
  }

  return { buyers: enriched, writtenCount, outfile };
}

function determineFetchAddresses(args: { addressType: AddressType; mint: string; sourceWallet?: string }): string[] {
  if (args.addressType === 'mint') return [args.mint];
  if (args.addressType === 'bonding-curve') return args.sourceWallet ? [args.sourceWallet] : [args.mint];
  const addresses: string[] = [];
  if (args.sourceWallet) addresses.push(args.sourceWallet);
  addresses.push(args.mint);
  return Array.from(new Set(addresses));
}

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

    for (const info of page) {
      const bt = (info as any).blockTime as number | undefined;
      if (typeof bt === 'number' && bt <= cutoffTs) {
        filtered.push({ signature: info.signature, blockTime: bt });
        if (filtered.length >= candidateWindow) break;
      }
    }

    before = page[page.length - 1].signature;
    if (page.length < pageLimit) break;
  }

  return filtered.map((x) => x.signature);
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

async function detectLastBuyersFromCandidates(
  heliusClient: HeliusApiClient,
  mintAddress: string,
  candidateSignatures: string[],
  limitBuyers: number,
  cutoffTs: number,
  windowSeconds?: number
): Promise<DetectedBuyer[]> {
  const allTxs: HeliusTransaction[] = [];
  const BATCH = 100;

  for (let i = 0; i < candidateSignatures.length; i += BATCH) {
    const batch = candidateSignatures.slice(i, i + BATCH);
    try {
      const txs: HeliusTransaction[] = await (heliusClient as any)['getTransactionsBySignatures'](batch);
      for (const tx of txs) {
        if (!tx) continue;
        if (typeof tx.timestamp === 'number' && tx.timestamp <= cutoffTs) {
          allTxs.push(tx);
        }
      }
    } catch {
      // ignore batch errors
    }
  }

  allTxs.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

  const lowerBound = windowSeconds ? Math.max(0, cutoffTs - windowSeconds) : undefined;
  const buyers = new Map<string, DetectedBuyer>();

  for (const tx of allTxs) {
    if (!tx.tokenTransfers) continue;
    if (windowSeconds && typeof tx.timestamp === 'number' && (tx.timestamp < (lowerBound as number))) {
      // older than window; since sorted desc, we can break
      break;
    }
    
    // Skip transactions that only involve SOL or WSOL (native transfers)
    // Only process transactions that have actual SPL token transfers beyond just SOL/WSOL
    const hasNonSolTokenTransfers = tx.tokenTransfers.some(tr => 
      tr.mint && 
      tr.mint !== 'So11111111111111111111111111111111111111112' // Skip WSOL
    );
    
    if (!hasNonSolTokenTransfers) {
      continue; // Skip SOL/WSOL-only transactions
    }
    const receivedByWallet = new Map<string, number>();
    for (const tr of tx.tokenTransfers) {
      if (tr.mint !== mintAddress) continue;
      if (!tr.toUserAccount) continue;
      if (typeof tr.tokenAmount !== 'number') continue;
      const w = tr.toUserAccount;
      if (w === mintAddress) continue;
      receivedByWallet.set(w, (receivedByWallet.get(w) || 0) + Math.max(0, tr.tokenAmount));
    }
    for (const [walletAddress, tokenAmount] of receivedByWallet) {
      if (tokenAmount <= 0) continue;
      if (!buyers.has(walletAddress)) {
        buyers.set(walletAddress, {
          walletAddress,
          firstBuyTimestamp: tx.timestamp!,
          firstBuySignature: (tx as any).signature,
          tokenAmount,
          tx,
        });
        if (!windowSeconds && buyers.size >= limitBuyers) break;
      }
    }
    if (!windowSeconds && buyers.size >= limitBuyers) break;
  }

  const arr = Array.from(buyers.values());
  const withinWindow = windowSeconds
    ? arr.filter((b) => b.firstBuyTimestamp >= (lowerBound as number) && b.firstBuyTimestamp <= cutoffTs)
    : arr;
  return withinWindow.sort((a, b) => b.firstBuyTimestamp - a.firstBuyTimestamp);
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
  const CONCURRENCY = 6;
  let index = 0;
  async function worker() {
    while (index < buyers.length) {
      const i = index++;
      const b = buyers[i];
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

  let pages = 0;
  const MAX_PAGES = 50;
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
  runMeta?: RunFlowMeta
): number {
  const existing = buildExistingKeySetFromJsonl(file);
  const fresh = rows.filter(r => !existing.has(`${r.walletAddress}|${r.firstBuySignature}`));
  if (fresh.length === 0) {
    if (!fs.existsSync(file)) ensureDir(path.dirname(file));
    return 0;
  }
  const content = fresh.map(r => JSON.stringify(toOutputRow(r, mint, cutoffTs, runMeta))).join('\n') + '\n';
  fs.appendFileSync(file, content, 'utf8');
  return fresh.length;
}

function writeCsv(
  file: string,
  rows: EnrichedBuyer[],
  mint: string,
  cutoffTs: number,
  runMeta?: RunFlowMeta
): number {
  const header = 'wallet,mint,cutoffTs,buyTs,buyIso,signature,tokenAmount,stakeSol,tokenAccountsCount,txCountScanned,walletCreatedAtTs,walletCreatedAtIso,accountAgeDays,creationScanMode,creationScanPages,runScannedAtIso,runSource\n';
  const existing = buildExistingKeySetFromCsv(file);
  const fresh = rows.filter(r => !existing.has(`${r.walletAddress}|${r.firstBuySignature}`));
  if (fresh.length === 0) {
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
      fs.appendFileSync(file, header, 'utf8');
    }
    return 0;
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
      o.runScannedAtIso ?? '',
      o.runSource ?? '',
    ].join(',');
  });
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    fs.appendFileSync(file, header, 'utf8');
  }
  fs.appendFileSync(file, lines.join('\n') + '\n', 'utf8');
  return fresh.length;
}

function toOutputRow(
  r: EnrichedBuyer,
  mint: string,
  cutoffTs: number,
  runMeta?: RunFlowMeta
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
  if (value > 1000) {
    const maybeSol = value / 1e9;
    if (maybeSol < 1000) return maybeSol;
  }
  return value;
}


