# Data Retention & Tiered Storage Strategy

_Last updated: 2026-06-10_

## Context (measured, not assumed)

- DB: PostgreSQL 17 in Docker (`analyzer-postgres`), database `sova_analyzer` ≈ **24 GB**.
- Host: single OpenVZ/ploop VPS container, **59 GB disk, ~21 GB free**. No ZFS (filesystem is host-managed inside the container — the ZFS tuning advice does not apply).
- Three tables are ~95% of the problem:

  | Table | Total | Rows | Notes |
  |---|---|---|---|
  | `SwapAnalysisInput` | 12 GB | 20.4M | raw events, span **2021-08 → 2026-06** |
  | `TokenLot` | 6.4 GB | 15.2M | **86% `CLOSED`** (13.1M) — historical, resolved |
  | `AnalysisResult` | 3.9 GB | 7.1M | already a per-wallet/token rollup (warm) |

- Largest single object: `SwapAnalysisInput_signature_mint_direction_amount_key` = **3.65 GB** (dedup unique index).
- Warm/aggregate tier is **already built and populated**: only **106** wallets have raw data without a `WalletPnlSummary`. The "compute aggregates before dropping raw" insurance is effectively already in place.

## Architecture decisions

- **Tiering (hot / warm / cold): adopt.** Correct model for this data shape.
- **ClickHouse: rejected** at this scale (20M rows). Revisit only if a single analytics table crosses ~100–200M rows or we leave the VPS.
- **ZFS datasets: rejected** — not possible in a ploop container.
- **Parquet + ZSTD cold archive: adopt**, but it **must live off-box** (object store / separate volume — TBD) or it frees no hot-disk space. Query cold data in place with DuckDB/Polars.
- **Partition-by-time + pre-aggregation: adopt** (aggregation already done).

### Target tiers

- **Hot** — Postgres, `SwapAnalysisInput` range-partitioned monthly on `timestamp`, ~60–90 days live. Retention = `DETACH`/`DROP PARTITION` (instant; replaces the batched-DELETE machinery in `smart-db-prune.ts`).
- **Warm** — Postgres, keep ~forever: `WalletPnlSummary`, `AdvancedTradeStats`, `WalletBehaviorProfile`, `AnalysisResult`, `TokenInfo`.
- **Cold** — Parquet+ZSTD: dump each partition before drop; preserves replay / cost-basis recompute (rpc-full mapper). **Optional / later** — only when raw history is both large *and* rarely queried but must stay recoverable. Not a day-one requirement.

---

## Locked decisions (don't re-litigate these)

1. **TokenLot `CLOSED` = delete, not archive.** Lots are a regenerable *output* of analysis (`replaceTokenLotsForWallet` wipes + rebuilds from `SwapAnalysisInput`), and the only reader skips `status==='CLOSED'`. So: (a) one-time/periodic sweep via `scripts/maintenance/prune-closed-token-lots.ts`; (b) stop persisting them at the source (done — guard in `pnl-analysis-service.ts`). No Parquet archive needed. Reclaims ~5 GB.
2. **Storage backend = the S3 API, not a vendor.** All cold-archive I/O goes through one thin adapter that speaks S3. Provider is a config/env choice, swappable with zero code change:
   - **Now:** local filesystem (or local MinIO) — build & test with no external dependency.
   - **Target:** self-hosted **MinIO** (or Garage) on the planned **2 TB disk** → zero egress, owned hardware. This is the intended steady state.
   - **Escape hatch:** B2 (cheapest at rest) or R2 (zero egress) via the same env swap if off-site is ever wanted.
   - **You do not need to commit now.** Commit to the interface; pick the endpoint when the 2 TB box is up.
3. **ClickHouse / ZFS: not happening** at this scale / in this container.
4. **Off-box archival is a lever, not a default.** At 24 GB the DB is small; most relief comes from (1) deleting regenerable junk and (2) partitioning raw swaps so aging is a clean `DROP PARTITION`. Raw swaps may stay on-box until disk pressure is real.

## The established runbook (steady-state process)

| Cadence | Action | Tool |
|---|---|---|
| Weekly | Prune CLOSED TokenLots (catches any regenerated) | `prune-closed-token-lots.ts --apply` |
| Daily/weekly | Prune old `HeliusTransactionCache` | `smart-db-prune.ts` (existing) |
| Monthly | Ensure next N month partitions exist; archive+drop oldest beyond hot window | partition-maintenance job (Phase 3) |
| On revisit of a cold wallet | Re-fetch from Helius **or** restore its rows from cold archive, then re-analyze | archive-restore service (Phase 3) |
| Always | Warm aggregates kept forever; computed before raw is aged out | already in place (106-wallet gap to backfill) |

---

## Phase 2 — Partition `SwapAnalysisInput` by month (detailed)

This is the structural linchpin. Everything below is specific to the current schema and write paths.

### Why it's low-risk here

- **No inbound FKs** reference `SwapAnalysisInput`.
- **Dedup is app-level** (`database-service.ts` builds a `recordKey` and checks before insert; `createMany` has no `skipDuplicates`/`ON CONFLICT` — it relies on a P2002 try/catch fallback). The DB unique constraint is only a backstop.
- `timestamp` is **deterministic per `signature`** (block time). Adding it to the unique key does not weaken dedup and requires **no ingest code change**.
- Writes touch the table only via `createMany` / `create` (insert) and `updateMany({ where: { id } })` (enrichment). All survive partitioning. (One perf note below.)

### Constraint changes required

Postgres requires the partition key in the PK and every UNIQUE constraint:

- PK: `id` → `@@id([id, timestamp])`. `id` stays a global autoincrement sequence, so practical global uniqueness holds.
- Unique: `(signature, mint, direction, amount)` → `(signature, mint, direction, amount, timestamp)`.
- Secondary indexes carry over as partitioned (local) indexes: `(walletAddress, timestamp)`, `(mint)`.

### Prisma caveat

Prisma 6 has no declarative partitioning. Plan:
- Apply all partition DDL via a **raw SQL migration** (`prisma migrate` with hand-written SQL, or apply out-of-band then baseline). Prisma treats the partitioned parent as an ordinary model for SELECT/INSERT/UPDATE — it does not need to know it's partitioned.
- The only schema.prisma change Prisma "sees" is the composite PK (`@@id([id, timestamp])`).
- **Pre-flight grep**: confirm no `swapAnalysisInput.findUnique({ where: { id } })` / `.update({ where: { id } })` (singular) anywhere — a composite PK breaks by-`id`-alone unique lookups. Current writes use `updateMany({ where: { id } })`, which is unaffected. (Already verified: no singular `findUnique`/`update` on this model in the insert/enrich paths.)
- Perf note: enrichment does `updateMany({ where: { id } })` with no `timestamp` → Postgres can't prune partitions and scans the per-partition `id` index across all live partitions. Acceptable at 60–90 days of partitions; optionally pass `timestamp` alongside `id` for partition pruning.

### Disk-safe migration (21 GB free vs a 12 GB table)

A naive "build new partitioned table, copy all rows, swap" peaks at ~24 GB (source + copy) and **will not fit**. Sequence to keep net disk roughly flat:

**Phase 2a — shrink the tail first (one-shot cold archive).**
Export the ancient span (e.g. everything older than the intended hot window, ~2021–2024) to Parquet+ZSTD off-box, verify row counts, then delete it. This is a one-time run of the Phase 3 exporter and removes the bulk of the 20.4M rows before any structural work, so the remaining live set copies comfortably within free space.

**Phase 2b — build + backfill the partitioned table.**
1. `CREATE TABLE "SwapAnalysisInput_p" (... PARTITION BY RANGE (timestamp))` with the new PK/unique/indexes.
2. Create monthly partitions for the remaining live span + a few future months, plus a `DEFAULT` catch-all as a safety net. (Hand-rolled in the existing `scripts/maintenance` TS style — `postgres:17` ships without `pg_partman`. pg_partman is an alternative if we install the extension.)
3. Backfill month-by-month with `WITH moved AS (DELETE FROM src WHERE timestamp >= a AND timestamp < b RETURNING *) INSERT INTO "SwapAnalysisInput_p" SELECT * FROM moved;` — moves rows so source index space is reclaimed as target grows; net live data stays ~constant. Source heap bloat is irrelevant because the source is dropped at cutover.

**Phase 2c — cutover (short lock).**
`BEGIN; ALTER TABLE "SwapAnalysisInput" RENAME TO "SwapAnalysisInput_legacy"; ALTER TABLE "SwapAnalysisInput_p" RENAME TO "SwapAnalysisInput"; COMMIT;` Re-point the sequence ownership. Keep `_legacy` until verification passes, then `DROP TABLE` (reclaims all bloat at once).

> Advanced low-disk alternative: build the partitioned parent with monthly partitions for new data, then `ATTACH` the existing table as the `DEFAULT` partition (requires first building the 5-column unique index on it). New writes route to monthly partitions; old rows are migrated/archived in the background. Near-zero extra disk and downtime, but more moving parts — use only if Phase 2a can't free enough headroom.

### Verification & rollback

- Per-month `COUNT(*)` parity between `_legacy` and the new partitions.
- Re-run the app-level duplicate check / a `GROUP BY (signature,mint,direction,amount,timestamp) HAVING count > 1` sanity query.
- Rollback = rename back (`_legacy` → canonical) while `_legacy` still exists.

### How retention changes after partitioning

`smart-db-prune.ts`'s `pruneSwapGlobal` / `pruneSwapInactive` batched DELETEs are **replaced** by: archive oldest partition → Parquet → `DETACH`/`DROP`. Consequence to accept consciously: partition drop is **all-or-nothing by time**, while the current protection list is **per-wallet**. Resolution — stop trying to retain individual old raw rows for "protected" wallets in the hot store:

- Cold wallet → value preserved in the **warm summaries** (already computed) + Parquet archive.
- Revisited wallet → one rare **Helius re-fetch** repopulates recent raw rows; it gets promoted back to hot.

The per-wallet protection logic graduates into a first-class `Wallet.tier` (Phase 4) that governs how many partitions stay live / refetch policy — not into per-row exceptions inside a partition.

### Deliverables for Phase 2

1. Raw SQL migration: partitioned parent + constraints + indexes + initial partitions + DEFAULT.
2. `schema.prisma`: `@@id([id, timestamp])`; regenerate client.
3. TS migration runner (Phase 2a archive hook + 2b month-by-month move + 2c cutover) under `scripts/maintenance`, dry-run first.
4. Monthly partition-maintenance job (ensure next N months exist; detach+archive+drop oldest).
5. Update `smart-db-prune.ts` to drop the swap-DELETE paths once partitioning is live.
