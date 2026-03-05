# Online DB Cleanup Runbook (No-Downtime First)

Date: 2026-03-05  
Owner: Sova backend ops

## Goals
- Keep production API online during maintenance.
- Reclaim database working space safely.
- Avoid deleting user-critical data blindly.
- Establish repeatable weekly/monthly cleanup.

## Current Facts (2026-03-05)
- Root disk is constrained: ~94% used.
- DB size is ~16 GB.
- Largest growth sources:
  - `SwapAnalysisInput`
  - `HeliusTransactionCache`
  - `TokenLot`
  - `AnalysisResult`
- Immediate low-risk cleanup target: `HeliusTransactionCache` (cache table).

## Safety Rules
1. Always run in dry-run first.
2. Use batched deletes only (small batch size + pause).
3. Never delete `AnalysisResult` / `TokenLot` by age unless explicitly planned and tested.
4. Exclude user-signaled wallets from history pruning (`favorites`, `wallet notes`).
5. Keep maintenance bounded with `--maxBatches`.
6. Re-check PM2 and logs after every apply run.

## Data Retention Policy (Recommended)
- `HeliusTransactionCache`: keep 30 days.
- `SwapAnalysisInput`: keep all by default; optional inactive-wallet pruning only.
- `AnalysisResult`: keep.
- `TokenLot`: keep.

Reasoning:
- `HeliusTransactionCache` is regeneration-friendly and safest to prune.
- `SwapAnalysisInput` is source history for deeper analysis; aggressive global pruning can degrade analysis depth and force costly re-sync.

## Script
- Script: `scripts/maintenance/smart-db-prune.ts`
- Default mode: dry-run
- Requires explicit `--apply` for deletion

### Dry-Run Commands
```bash
npx ts-node -r tsconfig-paths/register scripts/maintenance/smart-db-prune.ts
```

```bash
npx ts-node -r tsconfig-paths/register scripts/maintenance/smart-db-prune.ts \
  --pruneSwapInactive \
  --swapOlderThanDays 120 \
  --walletInactiveDays 90 \
  --minWalletOldRows 3000 \
  --maxWallets 400
```

### Safe Apply Command (Recommended Weekly)
```bash
npx ts-node -r tsconfig-paths/register scripts/maintenance/smart-db-prune.ts \
  --apply \
  --pruneHelius \
  --no-pruneSwapInactive \
  --heliusOlderThanDays 30 \
  --batchSize 1500 \
  --pauseMs 75 \
  --maxBatches 300
```

## Monitoring Before/After
```bash
pm2 status
pm2 logs sova-backend-api --lines 80 --nostream
docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c \
"SELECT pg_size_pretty(pg_database_size('sova_analyzer')), pg_database_size('sova_analyzer');"
```

```bash
docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c \
"SELECT count(*) AS helius_total,
        sum(CASE WHEN to_timestamp(\"timestamp\") < now()-interval '30 days' THEN 1 ELSE 0 END) AS helius_older_30d
 FROM \"HeliusTransactionCache\";"
```

## Routine Cadence
- Weekly (off-peak):
  - Run Helius prune apply command above.
  - Cap with `--maxBatches` to avoid long maintenance windows.
- Monthly:
  - Run inactive-wallet dry-run report.
  - Only apply inactive swap prune if candidate set is meaningful and reviewed.
  - Reassess table/index size breakdown and dead tuples.

## About Disk Reclaim vs DB Reuse
- Batched deletes free logical space inside Postgres for reuse.
- They usually do **not** immediately shrink filesystem usage.
- This is expected and not a failure.

## pg_repack Decision
- `pg_repack` is the right tool for online physical shrink with low lock impact.
- It is **not installed** currently.
- Do **not** install yet while disk headroom is this tight (needs temporary extra space during rebuild).

Install/use `pg_repack` when:
1. You have additional free disk headroom (recommended several GB beyond current pressure).
2. You can run during off-peak.
3. You have verified backup + rollback plan.

## Rollback / Stop Plan
- Script is incremental; stop safely by terminating process:
```bash
pkill -f 'scripts/maintenance/smart-db-prune.ts'
```
- No schema changes are made by this script.
- If API errors spike, stop prune and inspect:
  - PM2 logs
  - Postgres container health
  - Redis connectivity

## Next-Level Cleanup (Planned, Not Automatic Yet)
- Add an archive table strategy for very old `SwapAnalysisInput` instead of direct deletion.
- Add metrics output (JSON report) from prune script for trend dashboarding.
- Add cron with conservative caps and alerting on failures.
