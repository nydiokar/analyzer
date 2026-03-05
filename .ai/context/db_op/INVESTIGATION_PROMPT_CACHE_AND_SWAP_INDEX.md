# Investigation Prompt: Helius Cache + SwapAnalysisInput Index

## Goal
Determine whether storage/index footprint of:
- `HeliusTransactionCache`
- `SwapAnalysisInput` (especially `signature,mint,direction,amount` unique index)

is justified by real runtime usage, and propose safe changes with measured impact.

## Scope
Focus on:
1. Data lifecycle (write/read paths)
2. Retention requirements
3. Index necessity and usage
4. Performance/storage tradeoffs
5. Migration safety (rollback-ready)

---

## Q1: HeliusTransactionCache Lifecycle and Necessity

### Tasks
1. Trace write paths:
- Find all insert/upsert/write call sites.
- Identify which job types or flows write most rows.

2. Trace read paths:
- Find all read call sites.
- Classify queries by access pattern:
  - by `signature`
  - by `timestamp`
  - mixed

3. Determine retention requirement:
- Verify if any workflow needs cache data older than 30 days.
- Identify correctness dependencies on historical rows.

4. Validate index usage:
- Gather `pg_stat_user_indexes` stats over a reasonable window.
- Confirm practical usage of:
  - `HeliusTransactionCache_pkey`
  - `HeliusTransactionCache_timestamp_idx`
- Determine if `timestamp_idx` is only used for cleanup/maintenance.

5. Produce recommendation:
- Retention window proposal
- Keep/drop/replace index decision
- Estimated GB/day and IO reduction

---

## Q2: SwapAnalysisInput Large Unique Index

Target index:
- `SwapAnalysisInput_signature_mint_direction_amount_key`

### Tasks
1. Explain why uniqueness exists:
- What correctness issue does it protect against?
- Which race/duplicate scenarios it prevents?

2. Measure query usage:
- Runtime reads using this index vs writes only.
- Whether index is mostly enforcement cost vs read benefit.

3. Analyze key design:
- Cardinality/selectivity of `signature,mint,direction,amount`
- Whether this key is over-wide for dedupe purpose.
- Storage amplification vs alternatives.

4. Evaluate alternatives:
- Narrower dedupe key (if safe)
- Partial unique index for recent data only
- Partitioning strategy (time-based) with local indexes
- Application-level dedupe + reduced DB uniqueness burden (if justified)

5. Produce recommendation:
- Keep/modify/drop with explicit risk matrix
- Predicted write-latency/storage impact
- Migration plan with rollback

---

## Additional Audit: “What consumes these tables in lifecycle?”

For both tables, map by lifecycle stage:
- ingestion
- dedupe
- analysis compute
- API serving
- background jobs
- cleanup

List concrete call sites (file/function), then tie to SQL/index access.

---

## Required Evidence

1. Code references:
- File path + function name for each read/write path

2. DB evidence:
- `pg_stat_user_tables`
- `pg_stat_user_indexes`
- table/index size snapshots
- dead tuple/bloat indicators
- EXPLAIN plans for representative hot queries

3. Quantified impact:
- current size contribution
- expected post-change size
- expected perf effect (read/write)

---

## Deliverable Format

1. Current-state lifecycle map (writes/reads by component)
2. Necessary vs legacy data/indexes
3. Ranked change proposals by risk/impact
4. Rollout plan:
- canary scope
- monitoring checks
- rollback procedure

---

## Constraints

- No destructive schema/index changes during investigation.
- No production downtime during evidence gathering.
- Recommendations must be reversible.

