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
import { runMintParticipantsFlow } from '../core/flows/mint-participants';

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
  windowSeconds?: number;
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
        .option('windowSeconds', { type: 'number', desc: 'Use time window [cutoff-window, cutoff] instead of limitBuyers' })
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
    windowSeconds: argv.windowSeconds as number | undefined,
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

  const runRes = await runMintParticipantsFlow(
    heliusClient,
    dbService,
    {
      mint: args.mint,
      cutoffTs,
      addressType: args.addressType,
      sourceWallet: args.bondingCurve,
      limitBuyers: args.limitBuyers,
      windowSeconds: args.windowSeconds,
      txCountLimit: args.txCountLimit,
      output: args.dryRun ? 'none' : args.output,
      outFile: args.outFile,
      candidateWindow: args.candidateWindow,
      creationScan: args.creationScan || 'none',
      verbose: Boolean(args.verbose),
      creationSkipIfTokenAccountsOver: args.creationSkipIfTokenAccountsOver,
    },
    { runScannedAtIso: new Date().toISOString(), runSource: args.addressType }
  );

  if (args.verbose) {
    console.log(JSON.stringify({ args: { ...args, cutoffTs }, result: { written: runRes.writtenCount, outfile: runRes.outfile, buyers: runRes.buyers.length } }, null, 2));
  } else {
    console.log(`buyers=${runRes.buyers.length} written=${runRes.writtenCount ?? 0}`);
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

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}


