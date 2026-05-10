import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { prisma } from '../src/core/services/database-service';

type Args = {
  threshold: number;
  wallet?: string;
  apply: boolean;
};

type DamagedWallet = {
  walletAddress: string;
  totalBuys: number;
  buggedBuys: number;
  bugPct: number;
  totalAllRows: number;
};

async function findDamagedWallets(threshold: number, singleWallet?: string): Promise<DamagedWallet[]> {
  // Build the optional wallet filter as a raw fragment
  const walletFilter = singleWallet
    ? prisma.$queryRaw<DamagedWallet[]>`
        WITH damage AS (
          SELECT
            "walletAddress",
            COUNT(*) FILTER (WHERE direction = 'in' AND "interactionType" = 'SWAP') AS total_buys,
            COUNT(*) FILTER (
              WHERE direction = 'in' AND "interactionType" = 'SWAP'
                AND "associatedSolValue" > 0 AND "associatedSolValue" < 0.05
                AND "feePercentage" > 10
            ) AS bugged_buys
          FROM "SwapAnalysisInput"
          WHERE "walletAddress" = ${singleWallet}
          GROUP BY "walletAddress"
        ),
        ratios AS (
          SELECT
            "walletAddress",
            total_buys::int,
            bugged_buys::int,
            ROUND(100.0 * bugged_buys / NULLIF(total_buys, 0), 1)::float AS "bugPct"
          FROM damage
          WHERE bugged_buys > 0
            AND ROUND(100.0 * bugged_buys / NULLIF(total_buys, 0), 1) >= ${threshold}
        ),
        all_rows AS (
          SELECT s."walletAddress", COUNT(*)::int AS total_all_rows
          FROM "SwapAnalysisInput" s
          JOIN ratios r ON r."walletAddress" = s."walletAddress"
          GROUP BY s."walletAddress"
        )
        SELECT
          r."walletAddress",
          r.total_buys AS "totalBuys",
          r.bugged_buys AS "buggedBuys",
          r."bugPct",
          a.total_all_rows AS "totalAllRows"
        FROM ratios r
        JOIN all_rows a ON a."walletAddress" = r."walletAddress"
        ORDER BY r."bugPct" DESC, a.total_all_rows DESC
      `
    : prisma.$queryRaw<DamagedWallet[]>`
        WITH damage AS (
          SELECT
            "walletAddress",
            COUNT(*) FILTER (WHERE direction = 'in' AND "interactionType" = 'SWAP') AS total_buys,
            COUNT(*) FILTER (
              WHERE direction = 'in' AND "interactionType" = 'SWAP'
                AND "associatedSolValue" > 0 AND "associatedSolValue" < 0.05
                AND "feePercentage" > 10
            ) AS bugged_buys
          FROM "SwapAnalysisInput"
          GROUP BY "walletAddress"
        ),
        ratios AS (
          SELECT
            "walletAddress",
            total_buys::int,
            bugged_buys::int,
            ROUND(100.0 * bugged_buys / NULLIF(total_buys, 0), 1)::float AS "bugPct"
          FROM damage
          WHERE bugged_buys > 0
            AND ROUND(100.0 * bugged_buys / NULLIF(total_buys, 0), 1) >= ${threshold}
        ),
        all_rows AS (
          SELECT s."walletAddress", COUNT(*)::int AS total_all_rows
          FROM "SwapAnalysisInput" s
          JOIN ratios r ON r."walletAddress" = s."walletAddress"
          GROUP BY s."walletAddress"
        )
        SELECT
          r."walletAddress",
          r.total_buys AS "totalBuys",
          r.bugged_buys AS "buggedBuys",
          r."bugPct",
          a.total_all_rows AS "totalAllRows"
        FROM ratios r
        JOIN all_rows a ON a."walletAddress" = r."walletAddress"
        ORDER BY r."bugPct" DESC, a.total_all_rows DESC
      `;

  return walletFilter;
}

async function wipeWallet(walletAddress: string, apply: boolean): Promise<{
  swapRows: number;
  analysisResults: number;
  tokenLots: number;
  pnlSummary: number;
  behaviorProfile: number;
}> {
  if (!apply) {
    // Dry-run: just count what would be deleted
    const [swapRows, analysisResults, tokenLots, pnlSummary, behaviorProfile] = await Promise.all([
      prisma.swapAnalysisInput.count({ where: { walletAddress } }),
      prisma.analysisResult.count({ where: { walletAddress } }),
      prisma.tokenLot.count({ where: { walletAddress } }),
      prisma.walletPnlSummary.count({ where: { walletAddress } }),
      prisma.walletBehaviorProfile.count({ where: { walletAddress } }),
    ]);
    return { swapRows, analysisResults, tokenLots, pnlSummary, behaviorProfile };
  }

  // Delete derived data and raw swap rows, then reset sync state on the Wallet row.
  // Order matters: delete dependents before parents where there are FK constraints.
  const [swapRows, analysisResults, tokenLots, pnlSummary, behaviorProfile] = await Promise.all([
    prisma.swapAnalysisInput.deleteMany({ where: { walletAddress } }),
    prisma.analysisResult.deleteMany({ where: { walletAddress } }),
    prisma.tokenLot.deleteMany({ where: { walletAddress } }),
    prisma.walletPnlSummary.deleteMany({ where: { walletAddress } }),
    prisma.walletBehaviorProfile.deleteMany({ where: { walletAddress } }),
  ]);

  // Reset sync state so the next query treats this wallet as never-synced.
  await prisma.wallet.update({
    where: { address: walletAddress },
    data: {
      firstProcessedTimestamp: null,
      oldestProcessedSignature: null,
      olderHistorySatisfiedTarget: null,
      newestProcessedSignature: null,
      newestProcessedTimestamp: null,
      lastSuccessfulFetchTimestamp: null,
      analyzedTimestampStart: null,
      analyzedTimestampEnd: null,
    },
  });

  return {
    swapRows: swapRows.count,
    analysisResults: analysisResults.count,
    tokenLots: tokenLots.count,
    pnlSummary: pnlSummary.count,
    behaviorProfile: behaviorProfile.count,
  };
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option('threshold', {
      type: 'number',
      default: 50,
      describe: 'Minimum bug % to qualify a wallet for wiping (default: 50).',
    })
    .option('wallet', {
      type: 'string',
      describe: 'Wipe a single specific wallet regardless of threshold.',
    })
    .option('apply', {
      type: 'boolean',
      default: false,
      describe: 'Execute the wipe. Default is dry-run (counts only).',
    })
    .strict()
    .parseAsync() as Args;

  const damaged = await findDamagedWallets(argv.threshold, argv.wallet);

  if (damaged.length === 0) {
    console.log(`No wallets found with bug% >= ${argv.threshold}.`);
    return;
  }

  const totalBugged = damaged.reduce((s, w) => s + w.buggedBuys, 0);
  const totalRows = damaged.reduce((s, w) => s + w.totalAllRows, 0);

  console.log(`${argv.apply ? 'APPLY' : 'DRY RUN'} — threshold: ${argv.threshold}%`);
  console.log(`Wallets to wipe: ${damaged.length}`);
  console.log(`Total rows to delete: ${totalRows.toLocaleString()} (${totalBugged.toLocaleString()} bugged buys)\n`);

  let totalDeleted = { swapRows: 0, analysisResults: 0, tokenLots: 0, pnlSummary: 0, behaviorProfile: 0 };

  for (const wallet of damaged) {
    const counts = await wipeWallet(wallet.walletAddress, argv.apply);

    console.log(
      `${argv.apply ? 'WIPED' : 'WOULD WIPE'} ${wallet.walletAddress}` +
      `  bug=${wallet.bugPct}%  bugged=${wallet.buggedBuys}/${wallet.totalBuys} buys` +
      `  swap_rows=${counts.swapRows}  ar=${counts.analysisResults}  lots=${counts.tokenLots}` +
      `  pnl=${counts.pnlSummary}  behavior=${counts.behaviorProfile}`,
    );

    totalDeleted.swapRows += counts.swapRows;
    totalDeleted.analysisResults += counts.analysisResults;
    totalDeleted.tokenLots += counts.tokenLots;
    totalDeleted.pnlSummary += counts.pnlSummary;
    totalDeleted.behaviorProfile += counts.behaviorProfile;
  }

  console.log('\n--- Summary ---');
  console.log(`SwapAnalysisInput:   ${totalDeleted.swapRows.toLocaleString()}`);
  console.log(`AnalysisResult:      ${totalDeleted.analysisResults.toLocaleString()}`);
  console.log(`TokenLot:            ${totalDeleted.tokenLots.toLocaleString()}`);
  console.log(`WalletPnlSummary:    ${totalDeleted.pnlSummary.toLocaleString()}`);
  console.log(`WalletBehaviorProfile: ${totalDeleted.behaviorProfile.toLocaleString()}`);

  if (!argv.apply) {
    console.log('\nDry-run only. Re-run with --apply to execute.');
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
