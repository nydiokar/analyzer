import 'dotenv/config';
import axios from 'axios';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Prisma } from '@prisma/client';
import { DatabaseService, prisma } from '../src/core/services/database-service';
import { mapHeliusTransactionsToIntermediateRecords } from '../src/core/services/helius-transaction-mapper';
import type { HeliusTransaction } from '../src/types/helius-api';

const HELIUS_API_URL = `https://api.helius.xyz/v0/transactions/?api-key=${process.env.HELIUS_API_KEY ?? ''}`;

type CandidateRow = {
  walletAddress: string;
  signature: string;
  mint: string;
  direction: string;
  amount: number;
  associatedSolValue: number;
  associatedUsdcValue: number | null;
  interactionType: string;
  feeAmount: number | null;
  feePercentage: number | null;
};

type WalletSignature = {
  walletAddress: string;
  signature: string;
};

type Args = {
  wallet?: string;
  mint?: string;
  signature?: string[];
  limit: number;
  apply: boolean;
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function uniqueWalletSignatures(rows: WalletSignature[]): WalletSignature[] {
  const seen = new Set<string>();
  const unique: WalletSignature[] = [];
  for (const row of rows) {
    const key = `${row.walletAddress}:${row.signature}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

async function fetchParsedTransactions(signatures: string[]): Promise<Map<string, HeliusTransaction>> {
  const transactionsBySignature = new Map<string, HeliusTransaction>();
  for (const signatureChunk of chunk(signatures, 100)) {
    const { data } = await axios.post(HELIUS_API_URL, { transactions: signatureChunk });
    const transactions = data as HeliusTransaction[];
    for (const tx of transactions) {
      if (tx?.signature) {
        transactionsBySignature.set(tx.signature, tx);
      }
    }
  }
  return transactionsBySignature;
}

async function findCandidates(args: Args): Promise<CandidateRow[]> {
  const where: Prisma.SwapAnalysisInputWhereInput = {
    interactionType: 'TRANSFER',
    OR: [
      { associatedSolValue: { not: 0 } },
      { associatedUsdcValue: { not: 0 } },
      { feeAmount: { not: null } },
      { feePercentage: { not: null } },
    ],
  };

  if (args.wallet) where.walletAddress = args.wallet;
  if (args.mint) where.mint = args.mint;
  if (args.signature && args.signature.length > 0) where.signature = { in: args.signature };

  return prisma.swapAnalysisInput.findMany({
    where,
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: args.limit,
    select: {
      walletAddress: true,
      signature: true,
      mint: true,
      direction: true,
      amount: true,
      associatedSolValue: true,
      associatedUsdcValue: true,
      interactionType: true,
      feeAmount: true,
      feePercentage: true,
    },
  });
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option('wallet', {
      type: 'string',
      describe: 'Restrict repair to one wallet. Required when using --signature for absent/missing rows.',
    })
    .option('mint', {
      type: 'string',
      describe: 'Restrict repair to one token mint.',
    })
    .option('signature', {
      type: 'array',
      string: true,
      describe: 'Explicit signature(s) to remap. Can create corrected rows for --wallet even if no stale row exists.',
    })
    .option('limit', {
      type: 'number',
      default: 250,
      describe: 'Maximum stale transfer rows to scan from DB.',
    })
    .option('apply', {
      type: 'boolean',
      default: false,
      describe: 'Write remapped rows. Default is dry-run.',
    })
    .strict()
    .parseAsync() as Args;

  if (!process.env.HELIUS_API_KEY) {
    throw new Error('HELIUS_API_KEY is required.');
  }

  const signatureArgs = argv.signature ?? [];
  const staleCandidates = await findCandidates(argv);
  const explicitPairs: WalletSignature[] =
    argv.wallet && signatureArgs.length > 0
      ? signatureArgs.map(signature => ({ walletAddress: argv.wallet!, signature }))
      : [];

  const walletSignatures = uniqueWalletSignatures([
    ...staleCandidates.map(row => ({ walletAddress: row.walletAddress, signature: row.signature })),
    ...explicitPairs,
  ]);

  if (walletSignatures.length === 0) {
    console.log('No candidate wallet/signature pairs found.');
    return;
  }

  const signatures = Array.from(new Set(walletSignatures.map(row => row.signature)));
  console.log(`${argv.apply ? 'APPLY' : 'DRY RUN'}: remapping ${walletSignatures.length} wallet/signature pair(s), ${signatures.length} unique signature(s).`);
  console.log(`Stale DB transfer candidates: ${staleCandidates.length}`);

  const transactionsBySignature = await fetchParsedTransactions(signatures);
  const db = new DatabaseService();

  let mappedRows = 0;
  let savedRows = 0;
  let missingTransactions = 0;

  for (const pair of walletSignatures) {
    const tx = transactionsBySignature.get(pair.signature);
    if (!tx) {
      missingTransactions++;
      console.warn(`Missing parsed transaction from Helius: ${pair.signature}`);
      continue;
    }

    const mappingResult = mapHeliusTransactionsToIntermediateRecords(pair.walletAddress, [tx]);
    const rows = mappingResult.analysisInputs;
    mappedRows += rows.length;

    const transferRows = rows.filter(row => row.interactionType === 'TRANSFER');
    for (const row of transferRows) {
      console.log(
        [
          row.walletAddress,
          row.signature,
          row.mint,
          row.direction,
          `amount=${row.amount}`,
          `sol=${row.associatedSolValue}`,
          `usdc=${row.associatedUsdcValue ?? null}`,
          `fee=${row.feeAmount ?? null}`,
        ].join(' | '),
      );
    }

    if (argv.apply && rows.length > 0) {
      const result = await db.saveSwapAnalysisInputs(rows);
      savedRows += result.count;
    }
  }

  console.log('');
  console.log(`Mapped rows: ${mappedRows}`);
  console.log(`Saved/updated rows: ${savedRows}`);
  console.log(`Missing transactions: ${missingTransactions}`);
  if (!argv.apply) {
    console.log('Dry-run only. Re-run with --apply to write updates.');
  }
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
