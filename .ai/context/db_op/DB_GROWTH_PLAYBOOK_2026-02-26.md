# DB Growth Playbook (2026-02-26)

## Purpose
Operational runbook for investigating and mitigating PostgreSQL growth in `sova_analyzer` without risking production stability.

## Current Situation (Observed)
- Database size (2026-02-26): `13 GB` (`13967906483` bytes).
- Reported symptom: ~`1 GB/day` growth trend.
- Growth pattern is ingest-driven, not primarily vacuum/bloat-driven.

## Main Problem
Sustained high insert volume into analysis pipeline tables, with heavy index amplification.

## Main Culprits
### 1) `SwapAnalysisInput` (primary pressure)
- Table + indexes total: `~9194 MB`.
- 14-day estimated share of growth: `~60.9%`.
- Estimated average growth: `~404.7 MB/day`.
- Largest index in database:
  - `SwapAnalysisInput_signature_mint_direction_amount_key` = `~3791 MB`.

### 2) `HeliusTransactionCache` (secondary pressure)
- Table + indexes total: `~2105 MB`.
- 14-day estimated share of growth: `~21.3%`.
- Estimated average growth: `~141.7 MB/day`.
- This is cache data by design and should be governed by retention.

### 3) `TokenLot`
- Table + indexes total: `~1136 MB`.
- 14-day estimated share of growth: `~11.3%`.

### 4) `AnalysisResult`
- Table + indexes total: `~638 MB`.
- 14-day estimated share of growth: `~6.5%`.

## Key Evidence
- Dead tuples on biggest table are low:
  - `SwapAnalysisInput`: dead tuple pct `~0.01%`.
  - `HeliusTransactionCache`: dead tuples `0`.
- Interpretation: growth mostly comes from new rows, not vacuum lag.

## Notable Spike Day
- `2026-02-12`: multi-table surge across all four major tables.
- Estimated combined growth from those tables that day: ~`1.57 GB`.

## Wallet Concentration (Pressure Points)
There is concentration among high-activity wallets.
- `SwapAnalysisInput` top wallet in last 14d: `45047` rows.
- `TokenLot` top wallet in last 14d: `16437` rows.
- `AnalysisResult` top wallet in last 14d: `12645` touched rows.

Use this as candidate signal for low-value wallet cleanup policy.

---

## Investigation Procedure (Repeatable)
Run read-only commands from `/home/luna/analyzer`.

1. Check app/container health first
- `pm2 status`
- `docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'`

2. Confirm DB baseline size
- `docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c "SELECT pg_size_pretty(pg_database_size('sova_analyzer')), pg_database_size('sova_analyzer');"`

3. Identify top table/index consumers
- Use `pg_total_relation_size`, `pg_relation_size`, `pg_indexes_size` by table.
- Use `pg_relation_size` on `pg_index` to rank heavy indexes.

4. Attribute growth by day
- Group rows/day over last 14-30 days for:
  - `SwapAnalysisInput.timestamp` (epoch)
  - `HeliusTransactionCache.fetchedAt` (fallback `timestamp`)
  - `TokenLot.createdAt`
  - `AnalysisResult.updatedAt`

5. Check bloat pressure separately
- `pg_stat_user_tables`: `n_live_tup`, `n_dead_tup`, `last_autovacuum`.

6. Identify wallet hotspots
- Top wallets by row counts for each heavy table over 14 days.

---

## Mitigation Strategy (Do Not Execute Blindly)

## Phase 0: Guardrails
- No destructive action without backup/rollback plan.
- Run changes during low-usage window.
- Before and after each change:
  - DB size snapshot
  - API health check
  - PM2 status

## Phase 1: Low-Risk Wins
1. `HeliusTransactionCache` retention policy
- Keep only recent cache horizon (e.g., 7-30 days based on cache hit value).
- Schedule periodic delete by date.
- Expected impact: direct reduction in secondary growth source.

2. Add daily growth telemetry snapshot
- Persist daily table size and row-count snapshots for trend visibility.

## Phase 2: Wallet-Targeted Cleanup Policy
Define low-value wallet criteria (example policy, tune with product needs):
- Not favorited/tracked by any user.
- Not referenced by active hunts.
- No recent API/UI access in N days.
- Falls outside retained cohort list (whales/watchlist/known important wallets).

For candidate wallets, perform staged cleanup:
1. Dry-run count impact per table.
2. Delete dependent historical rows (`SwapAnalysisInput`, `TokenLot`, `AnalysisResult`, optional related cache keys).
3. Keep minimal wallet identity row if needed for referential integrity.
4. Re-measure table/index sizes.

Important: Batch deletes in chunks to avoid long locks and IO spikes.

## Phase 3: Structural Controls
1. Partition `SwapAnalysisInput` by time
- Enables fast retention drop/truncate of old partitions.
- Reduces index maintenance pain on monolithic table.

2. Re-evaluate heavy unique index strategy
- `SwapAnalysisInput_signature_mint_direction_amount_key` is very large.
- Validate whether current uniqueness dimensions are all required.
- Consider safer alternatives only after duplicate-semantic review and query-plan validation.

## Phase 4: Optional Deep Cleanup
- Use `pg_repack` or targeted maintenance only after retention/partition work.
- Avoid major rewrite operations during peak hours.

---

## Rollback Expectations (Per Change)
For each cleanup job:
- Keep SQL and output logs.
- Keep pre/post row counts by table.
- Keep backup/snapshot reference.
- If performance regresses, disable cleanup job and restore from backup point.

---

## Decision Framework
- If growth is from inserts and data has low product value: use retention + wallet pruning.
- If growth is from indexes on unavoidable data: partition and revisit index design.
- If growth is from bloat: tune vacuum, but that is not the primary issue currently.

---

## Recommended Next Step (Planning Only)
Create a dry-run SQL pack that outputs:
1. Candidate wallet list by policy.
2. Estimated rows and bytes reclaimable by table.
3. Safe delete order and chunk sizes.

Do not execute deletes until candidate list is reviewed by operator.
