import { PrismaClient } from '@prisma/client';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

type Scalar = string | number | bigint | null;
type Row = Record<string, Scalar>;

const prisma = new PrismaClient({
  log: ['error', 'warn'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
        ? `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes('?') ? '&' : '?'}statement_timeout=120000`
        : undefined,
    },
  },
});

function num(value: Scalar): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intFmt(value: Scalar): string {
  const n = num(value);
  return n === null ? '-' : Math.round(n).toLocaleString();
}

function pctFmt(value: Scalar): string {
  const n = num(value);
  return n === null ? '-' : `${n.toFixed(2)}%`;
}

function msFmt(value: Scalar): string {
  const n = num(value);
  if (n === null) return '-';
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(2)}s`;
  return `${(n / 60_000).toFixed(2)}m`;
}

function ratioFmt(value: Scalar): string {
  const n = num(value);
  return n === null ? '-' : `${n.toFixed(2)}x`;
}

function pad(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  if (value.length > width) return value.slice(0, Math.max(1, width - 3)) + '...';
  return align === 'left' ? value.padEnd(width, ' ') : value.padStart(width, ' ');
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((header, idx) =>
    Math.max(header.length, ...rows.map((row) => (row[idx] ? row[idx].length : 0)))
  );
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  console.log(headers.map((h, i) => pad(h, widths[i])).join(' | '));
  console.log(sep);
  for (const row of rows) {
    console.log(
      row
        .map((cell, i) => {
          const right = /(^\d|ms$|s$|m$|%$|x$)/.test(cell);
          return pad(cell, widths[i], right ? 'right' : 'left');
        })
        .join(' | ')
    );
  }
}

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .option('days', {
      type: 'number',
      describe: 'Lookback window in days',
      default: 7,
    })
    .option('top', {
      type: 'number',
      describe: 'Rows per section',
      default: 12,
    })
    .option('deep', {
      type: 'boolean',
      describe: 'Enable heavier trend/tail queries',
      default: false,
    })
    .option('yes-heavy', {
      type: 'boolean',
      describe: 'Acknowledge heavy query warning and proceed',
      default: false,
    })
    .strict()
    .help()
    .parse();

  const days = Math.max(1, Math.floor(argv.days));
  const top = Math.max(3, Math.floor(argv.top));
  const deep = Boolean(argv.deep);
  const yesHeavy = Boolean(argv['yes-heavy']);

  console.log('');
  console.log('DB Performance Report');
  console.log(`Window: last ${days} day(s)`);
  console.log(`Mode: ${deep ? 'DEEP' : 'SAFE'}`);
  console.log('');

  const [analysisRows, activityRows] = await Promise.all([
    prisma.$queryRaw<Array<{ rows: bigint }>>`
      SELECT COUNT(*)::bigint AS rows
      FROM "AnalysisRun"
      WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
    `,
    prisma.$queryRaw<Array<{ rows: bigint }>>`
      SELECT COUNT(*)::bigint AS rows
      FROM "ActivityLog"
      WHERE "timestamp" >= NOW() - (${days} * INTERVAL '1 day')
    `,
  ]);

  const analysisCount = Number(analysisRows[0]?.rows || 0n);
  const activityCount = Number(activityRows[0]?.rows || 0n);
  console.log(`Rows scanned (time-filtered): AnalysisRun=${analysisCount.toLocaleString()}, ActivityLog=${activityCount.toLocaleString()}`);

  if (deep && !yesHeavy && (analysisCount > 500_000 || activityCount > 1_000_000)) {
    console.log('');
    console.log('WARNING: deep mode on this window may be expensive.');
    console.log('Re-run with --yes-heavy to continue, or lower --days.');
    process.exitCode = 2;
    return;
  }

  const [
    runOverview,
    runByService,
    topSlowRuns,
    runByHour,
    activityByAction,
    topRunErrors,
    signaturesCorrelation,
    signaturesBuckets,
    queueWaitSignal,
    failureTimeline,
    recurringSlowWallets,
  ] = await Promise.all([
    prisma.$queryRaw<Array<Row>>`
      SELECT
        COUNT(*)::bigint AS total_runs,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS completed_runs,
        COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed_runs,
        ROUND(AVG("durationMs")::numeric, 2) AS avg_ms,
        ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "durationMs")::numeric, 2) AS p50_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs")::numeric, 2) AS p95_ms,
        ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY "durationMs")::numeric, 2) AS p99_ms
      FROM "AnalysisRun"
      WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
        AND "durationMs" IS NOT NULL
    `,
    prisma.$queryRaw<Array<Row>>`
      SELECT
        "serviceInvoked" AS service,
        COUNT(*)::bigint AS runs,
        COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed,
        ROUND((COUNT(*) FILTER (WHERE status = 'FAILED') * 100.0 / NULLIF(COUNT(*), 0))::numeric, 2) AS fail_rate_pct,
        ROUND(AVG("durationMs")::numeric, 2) AS avg_ms,
        ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "durationMs")::numeric, 2) AS p50_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs")::numeric, 2) AS p95_ms,
        ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY "durationMs")::numeric, 2) AS p99_ms,
        MAX("durationMs")::bigint AS max_ms
      FROM "AnalysisRun"
      WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
        AND "durationMs" IS NOT NULL
      GROUP BY "serviceInvoked"
      HAVING COUNT(*) >= 3
      ORDER BY p95_ms DESC NULLS LAST, runs DESC
      LIMIT ${top}
    `,
    prisma.$queryRaw<Array<Row>>`
      SELECT
        id,
        "serviceInvoked" AS service,
        "walletAddress" AS wallet,
        status,
        "durationMs" AS duration_ms,
        "signaturesConsidered" AS sigs,
        "runTimestamp" AS run_ts
      FROM "AnalysisRun"
      WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
        AND "durationMs" IS NOT NULL
      ORDER BY "durationMs" DESC
      LIMIT ${top}
    `,
    prisma.$queryRaw<Array<Row>>`
      SELECT
        TO_CHAR(DATE_TRUNC('hour', "runTimestamp"), 'YYYY-MM-DD HH24:00') AS hour_slot,
        COUNT(*)::bigint AS runs,
        ROUND(AVG("durationMs")::numeric, 2) AS avg_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs")::numeric, 2) AS p95_ms
      FROM "AnalysisRun"
      WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
        AND "durationMs" IS NOT NULL
      GROUP BY DATE_TRUNC('hour', "runTimestamp")
      HAVING COUNT(*) >= 3
      ORDER BY p95_ms DESC NULLS LAST
      LIMIT ${top}
    `,
    prisma.$queryRaw<Array<Row>>`
      SELECT
        "actionType" AS action,
        COUNT(*)::bigint AS calls,
        COUNT(*) FILTER (WHERE status = 'FAILURE')::bigint AS failed,
        ROUND((COUNT(*) FILTER (WHERE status = 'FAILURE') * 100.0 / NULLIF(COUNT(*), 0))::numeric, 2) AS fail_rate_pct,
        ROUND(AVG("durationMs")::numeric, 2) AS avg_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs")::numeric, 2) AS p95_ms
      FROM "ActivityLog"
      WHERE "timestamp" >= NOW() - (${days} * INTERVAL '1 day')
        AND "durationMs" IS NOT NULL
      GROUP BY "actionType"
      HAVING COUNT(*) >= 5
      ORDER BY p95_ms DESC NULLS LAST, calls DESC
      LIMIT ${top}
    `,
    prisma.$queryRaw<Array<Row>>`
      SELECT
        LEFT(COALESCE("errorMessage", 'UNKNOWN'), 120) AS error_sample,
        COUNT(*)::bigint AS occurrences
      FROM "AnalysisRun"
      WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
        AND status = 'FAILED'
      GROUP BY LEFT(COALESCE("errorMessage", 'UNKNOWN'), 120)
      ORDER BY occurrences DESC
      LIMIT ${top}
    `,
    prisma.$queryRaw<Array<Row>>`
      SELECT
        COUNT(*)::bigint AS samples,
        ROUND(CORR("signaturesConsidered"::double precision, "durationMs"::double precision)::numeric, 4) AS corr
      FROM "AnalysisRun"
      WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
        AND "signaturesConsidered" IS NOT NULL
        AND "durationMs" IS NOT NULL
    `,
    prisma.$queryRaw<Array<Row>>`
      WITH bucketed AS (
        SELECT
          CASE
            WHEN "signaturesConsidered" IS NULL THEN 'unknown'
            WHEN "signaturesConsidered" < 100 THEN '0-99'
            WHEN "signaturesConsidered" < 500 THEN '100-499'
            WHEN "signaturesConsidered" < 1000 THEN '500-999'
            WHEN "signaturesConsidered" < 3000 THEN '1k-3k'
            ELSE '3k+'
          END AS bucket,
          CASE
            WHEN "signaturesConsidered" IS NULL THEN 0
            WHEN "signaturesConsidered" < 100 THEN 1
            WHEN "signaturesConsidered" < 500 THEN 2
            WHEN "signaturesConsidered" < 1000 THEN 3
            WHEN "signaturesConsidered" < 3000 THEN 4
            ELSE 5
          END AS ord,
          "durationMs" AS duration_ms
        FROM "AnalysisRun"
        WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
          AND "durationMs" IS NOT NULL
      )
      SELECT
        bucket,
        COUNT(*)::bigint AS runs,
        ROUND(AVG(duration_ms)::numeric, 2) AS avg_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric, 2) AS p95_ms
      FROM bucketed
      GROUP BY bucket, ord
      ORDER BY ord
    `,
    prisma.$queryRaw<Array<Row>>`
      SELECT
        COUNT(*)::bigint AS notes_with_queue_wait_keyword
      FROM "AnalysisRun"
      WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
        AND notes ILIKE '%queue%wait%'
    `,
    prisma.$queryRaw<Array<Row>>`
      SELECT
        TO_CHAR(DATE_TRUNC('hour', "runTimestamp"), 'YYYY-MM-DD HH24:00') AS hour_slot,
        COUNT(*)::bigint AS total_runs,
        COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed_runs,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS completed_runs,
        ROUND((COUNT(*) FILTER (WHERE status = 'FAILED') * 100.0 / NULLIF(COUNT(*), 0))::numeric, 2) AS fail_rate_pct
      FROM "AnalysisRun"
      WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
      GROUP BY DATE_TRUNC('hour', "runTimestamp")
      HAVING COUNT(*) FILTER (WHERE status = 'FAILED') > 0
      ORDER BY failed_runs DESC, DATE_TRUNC('hour', "runTimestamp") DESC
      LIMIT ${top}
    `,
    prisma.$queryRaw<Array<Row>>`
      WITH threshold AS (
        SELECT
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs") AS global_p95
        FROM "AnalysisRun"
        WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
          AND "durationMs" IS NOT NULL
      )
      SELECT
        ar."walletAddress" AS wallet,
        COUNT(*)::bigint AS runs,
        COUNT(*) FILTER (WHERE ar."durationMs" >= t.global_p95)::bigint AS slow_runs,
        ROUND((COUNT(*) FILTER (WHERE ar."durationMs" >= t.global_p95) * 100.0 / NULLIF(COUNT(*), 0))::numeric, 2) AS slow_ratio_pct,
        ROUND(AVG(ar."durationMs")::numeric, 2) AS avg_ms,
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ar."durationMs")::numeric, 2) AS p95_ms,
        MAX(ar."durationMs")::bigint AS max_ms,
        ROUND(AVG(ar."signaturesConsidered")::numeric, 2) AS avg_sigs
      FROM "AnalysisRun" ar
      CROSS JOIN threshold t
      WHERE ar."runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
        AND ar."durationMs" IS NOT NULL
      GROUP BY ar."walletAddress"
      HAVING COUNT(*) >= 3
         AND COUNT(*) FILTER (WHERE ar."durationMs" >= t.global_p95) >= 2
      ORDER BY slow_runs DESC, slow_ratio_pct DESC, p95_ms DESC
      LIMIT ${top}
    `,
  ]);

  const overview = runOverview[0] || {};
  const corrRow = signaturesCorrelation[0] || {};
  const queueSignal = queueWaitSignal[0] || {};

  console.log('');
  console.log('1) AnalysisRun Overview');
  printTable(
    ['runs', 'completed', 'failed', 'avg', 'p50', 'p95', 'p99'],
    [[
      intFmt(overview.total_runs),
      intFmt(overview.completed_runs),
      intFmt(overview.failed_runs),
      msFmt(overview.avg_ms),
      msFmt(overview.p50_ms),
      msFmt(overview.p95_ms),
      msFmt(overview.p99_ms),
    ]]
  );

  console.log('');
  console.log('2) Slowest Services (by p95)');
  printTable(
    ['service', 'runs', 'fail %', 'avg', 'p50', 'p95', 'p99', 'max'],
    runByService.map((row) => [
      String(row.service ?? '-'),
      intFmt(row.runs),
      pctFmt(row.fail_rate_pct),
      msFmt(row.avg_ms),
      msFmt(row.p50_ms),
      msFmt(row.p95_ms),
      msFmt(row.p99_ms),
      msFmt(row.max_ms),
    ])
  );

  console.log('');
  console.log('3) Worst Individual Runs');
  printTable(
    ['id', 'service', 'status', 'duration', 'sigs', 'runTimestamp', 'wallet'],
    topSlowRuns.map((row) => [
      intFmt(row.id),
      String(row.service ?? '-'),
      String(row.status ?? '-'),
      msFmt(row.duration_ms),
      intFmt(row.sigs),
      String(row.run_ts ?? '-'),
      String(row.wallet ?? '-'),
    ])
  );

  console.log('');
  console.log('4) Hot Time Windows (hourly p95)');
  printTable(
    ['hour', 'runs', 'avg', 'p95'],
    runByHour.map((row) => [
      String(row.hour_slot ?? '-'),
      intFmt(row.runs),
      msFmt(row.avg_ms),
      msFmt(row.p95_ms),
    ])
  );

  console.log('');
  console.log('5) API/Action Hotspots (ActivityLog)');
  printTable(
    ['action', 'calls', 'fail %', 'avg', 'p95'],
    activityByAction.map((row) => [
      String(row.action ?? '-').trim(),
      intFmt(row.calls),
      pctFmt(row.fail_rate_pct),
      msFmt(row.avg_ms),
      msFmt(row.p95_ms),
    ])
  );

  console.log('');
  console.log('6) Top Failure Signatures (AnalysisRun)');
  printTable(
    ['count', 'error sample'],
    topRunErrors.map((row) => [intFmt(row.occurrences), String(row.error_sample ?? '-')])
  );

  console.log('');
  console.log('7) Workload vs Latency');
  printTable(
    ['metric', 'value'],
    [
      ['corr(signatures, durationMs)', String(corrRow.corr ?? '-')],
      ['sample size', intFmt(corrRow.samples)],
    ]
  );

  printTable(
    ['signatures bucket', 'runs', 'avg', 'p95'],
    signaturesBuckets.map((row) => [
      String(row.bucket ?? '-'),
      intFmt(row.runs),
      msFmt(row.avg_ms),
      msFmt(row.p95_ms),
    ])
  );

  console.log('');
  console.log('8) Queue-Wait Visibility Check');
  printTable(
    ['signal', 'value'],
    [
      ['AnalysisRun notes containing "queue wait"', intFmt(queueSignal.notes_with_queue_wait_keyword)],
      ['Conclusion', 'Queue wait is not reliably stored in DB (use logs/Redis/BullMQ for exact wait).'],
    ]
  );

  console.log('');
  console.log('9) Failure Timeline (hour buckets)');
  printTable(
    ['hour', 'total', 'failed', 'completed', 'fail %'],
    failureTimeline.map((row) => [
      String(row.hour_slot ?? '-'),
      intFmt(row.total_runs),
      intFmt(row.failed_runs),
      intFmt(row.completed_runs),
      pctFmt(row.fail_rate_pct),
    ])
  );

  console.log('');
  console.log('10) Recurring Slow Wallet Offenders (>= global p95)');
  printTable(
    ['wallet', 'runs', 'slow runs', 'slow %', 'avg', 'p95', 'max', 'avg sigs'],
    recurringSlowWallets.map((row) => [
      String(row.wallet ?? '-'),
      intFmt(row.runs),
      intFmt(row.slow_runs),
      pctFmt(row.slow_ratio_pct),
      msFmt(row.avg_ms),
      msFmt(row.p95_ms),
      msFmt(row.max_ms),
      intFmt(row.avg_sigs),
    ])
  );

  if (deep) {
    const [tailByService, dayTrend] = await Promise.all([
      prisma.$queryRaw<Array<Row>>`
        WITH stats AS (
          SELECT
            "serviceInvoked" AS service,
            COUNT(*)::bigint AS runs,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY "durationMs") AS p50_ms,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95_ms
          FROM "AnalysisRun"
          WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
            AND "durationMs" IS NOT NULL
          GROUP BY "serviceInvoked"
          HAVING COUNT(*) >= 10
        )
        SELECT
          service,
          runs,
          ROUND(p50_ms::numeric, 2) AS p50_ms,
          ROUND(p95_ms::numeric, 2) AS p95_ms,
          ROUND((p95_ms / NULLIF(p50_ms, 0))::numeric, 2) AS tail_ratio
        FROM stats
        ORDER BY tail_ratio DESC NULLS LAST, p95_ms DESC
        LIMIT ${top}
      `,
      prisma.$queryRaw<Array<Row>>`
        SELECT
          TO_CHAR(DATE_TRUNC('day', "runTimestamp"), 'YYYY-MM-DD') AS day_slot,
          COUNT(*)::bigint AS runs,
          ROUND(AVG("durationMs")::numeric, 2) AS avg_ms,
          ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs")::numeric, 2) AS p95_ms,
          ROUND((COUNT(*) FILTER (WHERE status = 'FAILED') * 100.0 / NULLIF(COUNT(*), 0))::numeric, 2) AS fail_rate_pct
        FROM "AnalysisRun"
        WHERE "runTimestamp" >= NOW() - (${days} * INTERVAL '1 day')
          AND "durationMs" IS NOT NULL
        GROUP BY DATE_TRUNC('day', "runTimestamp")
        ORDER BY DATE_TRUNC('day', "runTimestamp") DESC
        LIMIT ${top}
      `,
    ]);

    console.log('');
    console.log('11) Deep: Tail-Latency Risk (p95/p50)');
    printTable(
      ['service', 'runs', 'p50', 'p95', 'tail ratio'],
      tailByService.map((row) => [
        String(row.service ?? '-'),
        intFmt(row.runs),
        msFmt(row.p50_ms),
        msFmt(row.p95_ms),
        ratioFmt(row.tail_ratio),
      ])
    );

    console.log('');
    console.log('12) Deep: Daily Trend');
    printTable(
      ['day', 'runs', 'avg', 'p95', 'fail %'],
      dayTrend.map((row) => [
        String(row.day_slot ?? '-'),
        intFmt(row.runs),
        msFmt(row.avg_ms),
        msFmt(row.p95_ms),
        pctFmt(row.fail_rate_pct),
      ])
    );
  }

  console.log('');
  console.log('Done. All queries are read-only SELECTs.');
}

main()
  .catch((error) => {
    console.error('Failed to generate DB performance report:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
