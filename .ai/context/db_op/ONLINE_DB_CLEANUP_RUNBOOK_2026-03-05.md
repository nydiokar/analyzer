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

## Data Retention Policy (Finalized)
### Keep (lightweight cold-cache / results)
- `AnalysisResult`
- `WalletPnlSummary`
- `WalletBehaviorProfile`
- `HolderProfileSnapshot`
- Other small user-facing summary/snapshot tables

### Prune (heavy raw history)
- `HeliusTransactionCache`: keep 30 days
- `SwapAnalysisInput`: keep recent horizon (30 days in current ops policy), prune older rows with wallet protections

### Optional orphan cleanup (derived heavy rows)
- `TokenLot` orphan rows (wallet has no `SwapAnalysisInput`) can be pruned.
- `AnalysisResult` orphan rows can be pruned (already done in incident).

Reasoning:
- Keep lightweight snapshots/results so inactive wallets can still be served quickly.
- Remove heavy raw ingest history to control growth.

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
  --pruneHelius \
  --pruneSwapGlobal \
  --pruneOrphanTokenLot \
  --no-pruneSwapInactive \
  --heliusOlderThanDays 30 \
  --swapGlobalOlderThanDays 30 \
  --protectRecentWalletDays 7 \
  --protectFavoritedWallets \
  --protectNotedWallets \
  --protectWalletFile /tmp/protect-wallets.txt
```

### Safe Apply Command (Recommended Weekly)
```bash
npx ts-node -r tsconfig-paths/register scripts/maintenance/smart-db-prune.ts \
  --apply \
  --pruneHelius \
  --pruneSwapGlobal \
  --no-pruneSwapInactive \
  --no-pruneOrphanAnalysisResult \
  --no-pruneOrphanTokenLot \
  --heliusOlderThanDays 30 \
  --swapGlobalOlderThanDays 30 \
  --protectRecentWalletDays 7 \
  --protectFavoritedWallets \
  --protectNotedWallets \
  --protectWalletFile /tmp/protect-wallets.txt \
  --batchSize 10000 \
  --pauseMs 30 \
  --maxBatches 1200
```

### Optional Apply (include orphan `TokenLot` cleanup)
```bash
npx ts-node -r tsconfig-paths/register scripts/maintenance/smart-db-prune.ts \
  --apply \
  --pruneHelius \
  --pruneSwapGlobal \
  --pruneOrphanTokenLot \
  --no-pruneSwapInactive \
  --no-pruneOrphanAnalysisResult \
  --heliusOlderThanDays 30 \
  --swapGlobalOlderThanDays 30 \
  --protectRecentWalletDays 7 \
  --protectFavoritedWallets \
  --protectNotedWallets \
  --protectWalletFile /tmp/protect-wallets.txt \
  --batchSize 10000 \
  --pauseMs 30 \
  --maxBatches 1200
```

### Optional Compaction In Same Script
Use only when headroom is adequate.
```bash
--reindexAfterCleanup
```
Include the heaviest unique swap index only intentionally:
```bash
--reindexLargeUniqueSwapIndex
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
  - Run heavy-data prune apply command above (`Helius` + `SwapAnalysisInput` global with protections).
  - Cap with `--maxBatches` to avoid long maintenance windows.
- Monthly:
  - Reassess table/index size breakdown and dead tuples.
  - Optional orphan `TokenLot` prune pass.
  - Optional concurrent reindex wave if index bloat grows.

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

## Next-Level Cleanup
- Add metrics output (JSON report) from prune script for trend dashboarding.
- Add cron with conservative caps and alerting on failures.
- Maintain `/tmp/protect-wallets.txt` (or move to stable path) for always-protected wallets.
