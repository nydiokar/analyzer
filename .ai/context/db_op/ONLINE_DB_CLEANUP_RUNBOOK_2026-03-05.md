# Online DB Cleanup Runbook (No-Downtime First)

Date: 2026-03-05  
Owner: Sova backend ops

## Goals
- Keep production API online during maintenance.
- Reclaim database working space safely.
- Avoid deleting user-critical data blindly.
- Establish repeatable weekly/monthly cleanup.

## Current Facts
- 2026-03-05 incident baseline:
  - Root disk was constrained: ~94% used.
  - DB size was ~16 GB.
- 2026-03-23 cleanup outcome:
  - `smart-db-prune` + `pg_repack` reclaimed major space without taking the API down.
  - DB size after repack: `9,438,443,187` bytes (`9001 MB`).
  - Host free disk after repack: `28G`.
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
5. For protected-wallet global prune, protect recent wallets and "good behavior" wallets explicitly by command flags, not assumptions.
6. `pruneSwapGlobal` fully excludes protected wallets from old-row deletion; it does not partially trim protected wallets.
7. `pruneSwapInactive` is a different path and does not use the full protected-wallet set.
8. Keep maintenance bounded with `--maxBatches`.
9. Re-check PM2 and logs after every apply run.

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

### Dry-Run Command Matching Current Protection Policy
Use this when the intended rule is:
- protect favorites
- protect wallets touched in last 14 days
- protect "better than Momentum" behavior (start at `INTRADAY`, not `MOMENTUM`)
- keep snapshots/results longer than raw swap history

```bash
pnpm db:smart-prune --pruneHelius false --pruneSwapInactive false --pruneSwapGlobal true --pruneOrphanAnalysisResult false --pruneOrphanTokenLot false --swapGlobalOlderThanDays 30 --protectRecentWalletDays 14 --protectSpeedCategories INTRADAY,DAY_TRADER,SWING,POSITION,HODLER --protectStrategyTypes DAY_TRADER,SWING_TRADER,POSITION_TRADER,PURE_HOLDER --protectTradingStyleKeywords INTRADAY,DAY_TRADER,SWING,POSITION,HODLER
```

Notes:
- `MOMENTUM` means under 30 minutes; if the intent is "holds longer than Momentum", protection starts at `INTRADAY`.
- Current script has no built-in KOL protection source yet.
- `HolderProfileSnapshot` and other snapshot tables are not touched by this prune script.
- The prune script now prints a protection breakdown in dry-run output so you can see how many wallets and old rows each rule protects.

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
- It is installed and verified on production as of 2026-03-23.
- Low-risk maintenance wrapper: `scripts/maintenance/pg-repack-maintenance.sh`
- Default scope repacks:
  - `HeliusTransactionCache`
  - `AnalysisResult`
  - `TokenLot`
- `SwapAnalysisInput` is excluded unless explicitly requested with `--include-swap`.

Use `pg_repack` when:
1. You have additional free disk headroom (recommended several GB beyond current pressure).
2. You can run during off-peak.
3. You have verified backup + rollback plan.

### Verified Command
Preview:
```bash
bash scripts/maintenance/pg-repack-maintenance.sh
```

Apply standard tables:
```bash
bash scripts/maintenance/pg-repack-maintenance.sh --apply
```

Apply including `SwapAnalysisInput`:
```bash
bash scripts/maintenance/pg-repack-maintenance.sh --apply --include-swap
```

### Verified 2026-03-23 Outcome
- Medium-table repack reclaimed about `2.96 GB`.
- Full run including `SwapAnalysisInput` finished successfully.
- Host free disk increased to `28G`.
- `SwapAnalysisInput` shrank to about `4132 MB`.
- PM2 services remained online throughout.

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
