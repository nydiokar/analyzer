#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import dotenv from 'dotenv';
import { HeliusApiClient } from 'core/services/helius-api-client';
import { DatabaseService } from 'core/services/database-service';
import type { HeliusTransaction } from '@/types/helius-api';

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

  if (args.verbose) {
    console.log(JSON.stringify({
      args: { ...args, cutoffTs },
      prefilter: {
        fetchAddress,
        candidateCount: candidateSignatures.length,
        sample: candidateSignatures.slice(0, 10),
      },
      buyers: {
        count: detectedBuyers.length,
        wallets: detectedBuyers.map(b => b.walletAddress).slice(0, 20),
      }
    }, null, 2));
  } else {
    console.log(`prefilter candidates=${candidateSignatures.length} fetchAddress=${fetchAddress} buyers=${detectedBuyers.length}`);
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
        });
        if (buyers.size >= limitBuyers) break;
      }
    }
    if (buyers.size >= limitBuyers) break;
  }

  // Return newest→older
  return Array.from(buyers.values()).sort((a, b) => b.firstBuyTimestamp - a.firstBuyTimestamp);
}


