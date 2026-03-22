#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const STABLE_MINTS: readonly string[] = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
];
const DOCKER_CONTAINER = 'analyzer-postgres';
const DB_USER = 'postgres';
const DB_NAME = 'sova_analyzer';

type PreviewRow = {
  id: number;
  walletAddress: string;
  signature: string;
  timestamp: number;
};

type DeleteBatchResult = {
  deletedCount: number;
  minId: number;
  maxId: number;
};

type DeleteRunSummary = {
  deletedRows: number;
  batches: number;
  lastProcessedId: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCandidatePredicate(startAfterId: number, endAtId?: number): string {
  const endAtIdPredicate = endAtId ? `AND s.id <= ${endAtId}` : '';
  const stableMintsSql = STABLE_MINTS.map((mint) => `'${mint}'`).join(', ');

  return `
    FROM "SwapAnalysisInput" s
    WHERE s.id > ${startAfterId}
      ${endAtIdPredicate}
      AND s."mint" = '${SOL_MINT}'
      AND EXISTS (
        SELECT 1
        FROM "SwapAnalysisInput" x
        WHERE x."signature" = s."signature"
          AND x."mint" <> '${SOL_MINT}'
          AND x."mint" NOT IN (${stableMintsSql})
      )
  `;
}

function runPsql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      DOCKER_CONTAINER,
      'psql',
      '-U',
      DB_USER,
      '-d',
      DB_NAME,
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-F',
      '\t',
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  ).trim();
}

async function previewCandidates(startAfterId: number, endAtId: number | undefined, sampleSize: number): Promise<PreviewRow[]> {
  const sql = `
    SELECT s.id, s."walletAddress", s."signature", s."timestamp"
    ${buildCandidatePredicate(startAfterId, endAtId)}
    ORDER BY s.id ASC
    LIMIT ${sampleSize};
  `;

  const output = runPsql(sql);
  if (!output) {
    return [];
  }

  return output.split('\n').map((line) => {
    const [id, walletAddress, signature, timestamp] = line.split('\t');
    return {
      id: Number(id),
      walletAddress,
      signature,
      timestamp: Number(timestamp),
    };
  });
}

async function deleteBatch(startAfterId: number, endAtId: number | undefined, batchSize: number): Promise<DeleteBatchResult> {
  const sql = `
    WITH to_del AS (
      SELECT s.id
      ${buildCandidatePredicate(startAfterId, endAtId)}
      ORDER BY s.id ASC
      LIMIT ${batchSize}
    ),
    deleted AS (
      DELETE FROM "SwapAnalysisInput" d
      USING to_del
      WHERE d.id = to_del.id
      RETURNING d.id
    )
    SELECT
      COUNT(*)::int AS "deletedCount",
      COALESCE(MIN(id), 0)::int AS "minId",
      COALESCE(MAX(id), 0)::int AS "maxId"
    FROM deleted;
  `;

  const output = runPsql(sql);
  if (!output) {
    return { deletedCount: 0, minId: 0, maxId: 0 };
  }

  const [deletedCount, minId, maxId] = output.split('\t');
  return {
    deletedCount: Number(deletedCount),
    minId: Number(minId),
    maxId: Number(maxId),
  };
}

async function vacuumAnalyze(): Promise<void> {
  console.log('Running VACUUM (ANALYZE) on SwapAnalysisInput so freed space becomes reusable.');
  runPsql('VACUUM (ANALYZE) "SwapAnalysisInput";');
}

async function runDeleteLoop(options: {
  batchSize: number;
  pauseMs: number;
  maxBatches: number;
  startAfterId: number;
  endAtId?: number;
}): Promise<DeleteRunSummary> {
  let deletedRows: number = 0;
  let batches: number = 0;
  let lastProcessedId: number = options.startAfterId;

  while (batches < options.maxBatches) {
    const result = await deleteBatch(lastProcessedId, options.endAtId, options.batchSize);
    if (result.deletedCount === 0) {
      break;
    }

    deletedRows += result.deletedCount;
    batches += 1;
    lastProcessedId = result.maxId;

    console.log(
      `[Delete] batch=${batches} deleted=${result.deletedCount} totalDeleted=${deletedRows} idRange=${result.minId}-${result.maxId}`,
    );

    if (options.pauseMs > 0) {
      await sleep(options.pauseMs);
    }
  }

  return {
    deletedRows,
    batches,
    lastProcessedId,
  };
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('prune-redundant-so111')
    .usage('$0 [options]')
    .option('apply', {
      type: 'boolean',
      default: false,
      description: 'Execute deletes. Default is dry-run preview only.',
    })
    .option('batchSize', {
      type: 'number',
      default: 500,
      description: 'Rows deleted per batch.',
    })
    .option('pauseMs', {
      type: 'number',
      default: 200,
      description: 'Pause between batches to reduce write pressure.',
    })
    .option('maxBatches', {
      type: 'number',
      default: 200,
      description: 'Safety cap on the number of delete batches per run.',
    })
    .option('startAfterId', {
      type: 'number',
      default: 0,
      description: 'Resume after this SwapAnalysisInput.id.',
    })
    .option('endAtId', {
      type: 'number',
      description: 'Optional upper id bound for a tightly bounded cleanup run.',
    })
    .option('sampleSize', {
      type: 'number',
      default: 10,
      description: 'Preview this many candidate rows before apply.',
    })
    .option('vacuumAnalyze', {
      type: 'boolean',
      default: false,
      description: 'Run VACUUM (ANALYZE) on SwapAnalysisInput after deletes complete.',
    })
    .strict()
    .help()
    .alias('help', 'h')
    .parse();

  console.log(`Mode: ${argv.apply ? 'APPLY' : 'DRY_RUN'}`);
  console.log(
    `Config: batchSize=${argv.batchSize}, pauseMs=${argv.pauseMs}, maxBatches=${argv.maxBatches}, startAfterId=${argv.startAfterId}, endAtId=${argv.endAtId ?? 'none'}, vacuumAnalyze=${argv.vacuumAnalyze}`,
  );

  const previewRows = await previewCandidates(argv.startAfterId, argv.endAtId, argv.sampleSize);
  if (previewRows.length === 0) {
    console.log('No candidate rows found in the requested id window.');
    return;
  }

  const previewSummary = previewRows
    .map((row) => `${row.id}:${row.walletAddress}:${row.signature}:${row.timestamp}`)
    .join(' | ');
  console.log(`Preview (${previewRows.length} rows): ${previewSummary}`);

  if (!argv.apply) {
    console.log('Dry-run only. Re-run with --apply to execute bounded deletes.');
    return;
  }

  const summary = await runDeleteLoop({
    batchSize: argv.batchSize,
    pauseMs: argv.pauseMs,
    maxBatches: argv.maxBatches,
    startAfterId: argv.startAfterId,
    endAtId: argv.endAtId,
  });

  console.log(
    `Delete summary: deletedRows=${summary.deletedRows}, batches=${summary.batches}, lastProcessedId=${summary.lastProcessedId}`,
  );

  if (argv.vacuumAnalyze && summary.deletedRows > 0) {
    await vacuumAnalyze();
  }
}

main()
  .catch((error: unknown) => {
    console.error('prune-redundant-so111 failed', error);
    process.exit(1);
  });
