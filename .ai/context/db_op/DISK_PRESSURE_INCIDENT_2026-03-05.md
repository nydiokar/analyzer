# Disk Pressure Incident - 2026-03-05

## Why this file exists
This document is the "do not rediscover everything again" handoff for this incident.
Use it first in future disk-pressure sessions.

## Incident Summary
- Host root filesystem reached critical usage (~94-96%).
- Main consumer identified as PostgreSQL Docker volume.
- `sova-backend-api` had a prior outage window where Redis/Postgres connections dropped around `2026-03-05 19:41:50` local logs.
- Services recovered and remained online during cleanup work.

## Storage Attribution (key finding)
- `docker system df -v` showed:
  - `analyzer-pgdata17` volume: ~18.45 GB (dominant)
  - `observability_prometheus-data`: ~1.01 GB
  - Docker images reclaimable: ~2.41 GB
- Therefore, DB data (not app binaries) is the primary long-term pressure.

## DB Growth Facts (during incident)
- Database size observed around `16-17 GB` (`sova_analyzer`).
- Largest pressure tables:
  - `SwapAnalysisInput` (largest)
  - `HeliusTransactionCache`
  - `TokenLot`
  - `AnalysisResult`
- Growth is largely ingest-driven (not primarily dead-tuple bloat on largest tables).

## Cleanup Artifacts Added/Changed
1. New smart cleanup script:
   - `scripts/maintenance/smart-db-prune.ts`
2. Existing cleanup script fixed for non-`id` PK tables:
   - `src/helpers/db/db-cleanup.ts`
3. Runbook:
   - `.ai/context/db_op/ONLINE_DB_CLEANUP_RUNBOOK_2026-03-05.md`

## Smart Cleanup Policy Implemented
Current high-impact safe policy (online):
- Prune `HeliusTransactionCache` older than 30 days.
- Prune `SwapAnalysisInput` older than 30 days only when wallet is NOT protected.
- Protected wallets:
  - Favorited wallets (`UserFavoriteWallet`)
  - Wallets with notes (`WalletNote`)
  - Wallets active in last N days (`Wallet.lastSuccessfulFetchTimestamp` or `newestProcessedTimestamp`)
    - during run: 7 days

This avoids blind deletion of wallets users care about while still reclaiming large stale history.

## Why filesystem % may not drop quickly
Deleting rows frees pages **inside Postgres** for reuse. It often does not immediately shrink host filesystem usage.
Immediate host-space shrink usually needs table rewrite tools (`pg_repack`) or dump/restore.

## Commands Used (core)

### 1) Live cleanup execution (foreground)
```bash
cd /home/luna/analyzer
stdbuf -oL -eL npx ts-node -r tsconfig-paths/register scripts/maintenance/smart-db-prune.ts \
  --apply \
  --pruneHelius \
  --pruneSwapGlobal \
  --no-pruneSwapInactive \
  --heliusOlderThanDays 30 \
  --swapGlobalOlderThanDays 30 \
  --protectRecentWalletDays 7 \
  --protectFavoritedWallets \
  --protectNotedWallets \
  --batchSize 10000 \
  --pauseMs 30 \
  --maxBatches 1200 | tee -a /tmp/smart-db-prune-live.log
```

### 2) Health checks
```bash
pm2 status
df -h /
docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c \
"SELECT pg_size_pretty(pg_database_size('sova_analyzer')), pg_database_size('sova_analyzer');"
```

### 3) Remaining old data checks
```bash
docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c \
"SELECT count(*) AS helius_total,
        sum(CASE WHEN to_timestamp(\"timestamp\") < now()-interval '30 days' THEN 1 ELSE 0 END) AS helius_older_30d
 FROM \"HeliusTransactionCache\";"
```

```bash
docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c \
"WITH protected AS (
   SELECT DISTINCT \"walletAddress\" FROM \"UserFavoriteWallet\"
   UNION
   SELECT DISTINCT \"walletAddress\" FROM \"WalletNote\"
   UNION
   SELECT address AS \"walletAddress\" FROM \"Wallet\"
   WHERE \"lastSuccessfulFetchTimestamp\" >= now()-interval '7 days'
      OR COALESCE(\"newestProcessedTimestamp\",0) >= extract(epoch from now()-interval '7 days')::bigint
 )
 SELECT count(*) AS swap_total,
        sum(CASE WHEN to_timestamp(\"timestamp\") < now()-interval '30 days' THEN 1 ELSE 0 END) AS swap_older_30d_all,
        sum(CASE WHEN to_timestamp(\"timestamp\") < now()-interval '30 days'
                  AND \"walletAddress\" NOT IN (SELECT \"walletAddress\" FROM protected)
                 THEN 1 ELSE 0 END) AS swap_older_30d_eligible
 FROM \"SwapAnalysisInput\";"
```

## Open Decisions (next session)
1. Whether to keep `protectRecentWalletDays=7` or increase/decrease.
2. Whether to add periodic cron job for smart prune.
3. When to schedule physical shrink (`pg_repack` or dump/restore).
4. Whether to prune old Docker images immediately (`docker image prune -a`) for quick non-DB relief.

## Risk Notes
- `SwapAnalysisInput` pruning can reduce historical analysis depth for pruned wallets.
- Protecting favorited/noted/recent wallets is mandatory safety baseline.
- Never run `VACUUM FULL` on hot path during peak usage.

## Recommended next operational sequence
1. Let current smart prune complete.
2. Re-measure:
   - old-row counts
   - DB size
   - host disk %
3. Reclaim easy host space:
   - Docker image prune (after verifying unused images)
4. Plan physical shrink window if host disk % remains high.
