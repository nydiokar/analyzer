#!/usr/bin/env node
/**
 * Prune CLOSED TokenLot rows.
 *
 * WHY THIS IS SAFE:
 *  - TokenLot is a *derived output* of PnL analysis. Re-analyzing a wallet calls
 *    replaceTokenLotsForWallet(), which deletes ALL of the wallet's lots and
 *    rebuilds them from SwapAnalysisInput. Lots are never an input to analysis.
 *  - The only reader (analysis-operations.processor.ts) fetches lots and then
 *    explicitly skips `status === 'CLOSED'`. Nothing consumes closed lots.
 *  - Therefore closed lots are pure dead weight: ~13M rows / ~3.6 GB heap that
 *    can be deleted with zero correctness impact and regenerated for free.
 *
 * Wallet protection (favorites/KOL/etc.) is intentionally NOT applied here:
 * deleting a closed lot is harmless for any wallet because it carries no current
 * position and is reconstructable from swap history.
 *
 * Dry-run by default. Pass --apply to execute.
 */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { prisma } from '../../src/core/services/database-service';
import { createLogger } from '../../src/core/utils/logger';

const logger = createLogger('PruneClosedTokenLots');

async function countClosed(): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count FROM "TokenLot" WHERE status = 'CLOSED';`,
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

async function tableSizePretty(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ size: string }>>(
    `SELECT pg_size_pretty(pg_total_relation_size('public."TokenLot"')) AS size;`,
  );
  return rows[0]?.size ?? 'unknown';
}

async function pruneClosedInBatches(
  batchSize: number,
  pauseMs: number,
  maxBatches: number,
): Promise<number> {
  let deleted = 0;
  let batch = 0;

  while (batch < maxBatches) {
    const count = await prisma.$executeRawUnsafe(
      `WITH to_del AS (
         SELECT id FROM "TokenLot" WHERE status = 'CLOSED' ORDER BY id LIMIT $1
       )
       DELETE FROM "TokenLot" WHERE id IN (SELECT id FROM to_del)`,
      batchSize,
    );

    if (count === 0) break;

    deleted += count;
    batch += 1;
    logger.info(`Batch ${batch}: deleted ${count} closed lots (total ${deleted})`);

    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }

  return deleted;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('prune-closed-token-lots')
    .usage('$0 [options]')
    .option('apply', {
      type: 'boolean',
      default: false,
      description: 'Execute deletes. Default is a dry-run preview.',
    })
    .option('batchSize', {
      type: 'number',
      default: 5000,
      description: 'Rows deleted per batch.',
    })
    .option('pauseMs', {
      type: 'number',
      default: 50,
      description: 'Pause between batches to reduce DB pressure.',
    })
    .option('maxBatches', {
      type: 'number',
      default: 5000,
      description: 'Safety cap: stop after this many batches.',
    })
    .option('vacuumAfter', {
      type: 'boolean',
      default: false,
      description:
        'Run plain VACUUM (ANALYZE) on TokenLot after delete to mark dead space reusable. ' +
        'Note: this does NOT return disk to the OS. To physically shrink the file from ' +
        '~6.4 GB to ~0.9 GB, run a manual `VACUUM FULL "TokenLot";` in a maintenance window ' +
        '(brief exclusive lock) or use pg_repack.',
    })
    .strict()
    .help()
    .alias('help', 'h')
    .parse();

  logger.info(`Mode: ${argv.apply ? 'APPLY' : 'DRY_RUN'}`);

  const [closed, sizeBefore] = await Promise.all([countClosed(), tableSizePretty()]);
  logger.info(`TokenLot total size: ${sizeBefore}. CLOSED rows to prune: ${closed}`);

  if (!argv.apply) {
    logger.info('Dry-run complete. Re-run with --apply to execute.');
    return;
  }

  if (closed === 0) {
    logger.info('Nothing to prune.');
    return;
  }

  const deleted = await pruneClosedInBatches(argv.batchSize, argv.pauseMs, argv.maxBatches);
  logger.info(`Apply complete: deleted ${deleted} closed lots.`);

  if (argv.vacuumAfter) {
    logger.info('Running VACUUM (ANALYZE) "TokenLot" ...');
    await prisma.$executeRawUnsafe(`VACUUM (ANALYZE) "TokenLot";`);
    logger.info('VACUUM complete (space marked reusable; run VACUUM FULL to reclaim disk).');
  }
}

main()
  .catch((error) => {
    logger.error('Fatal error in prune-closed-token-lots', { error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
