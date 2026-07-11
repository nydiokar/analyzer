# SPEC_T05 — Real-Data Validation Report

**Date:** 2026-07-11
**Lane:** OPS / verification gate
**Dispatch:** `.ai/dispatch/AGENT_5_SPEC_REALDATA_DEPLOY_GATE.md`
**Path taken:** A (server dump → local restore). Zero production risk.

---

## 0. Environment

> **This DB is a disposable dev copy — safe to mutate, migrate, or wipe.**
> `analyzer-postgres-pg17` (:5434, `sova_analyzer`) is a restore of a server dump, NOT the
> production DB. The operator can re-extract it at any time. Jobs may apply migrations,
> run materializers, and write to it freely, and may drop/recreate the container if needed
> — no production risk, no need to work on a throwaway clone. It is dev, by design.

- Server dump `sova_novec.dump` (4.5 GB, custom format, `pg_dump` 17.x) restored into a **new
  pg17 pgvector container** `analyzer-postgres-pg17` on host port **5434**, DB `sova_analyzer`.
  - The existing `analyzer-postgres` (pg16, port 5433, synthetic set) was left **untouched**.
  - A pg17 container was required because the dump format version (1.16) is newer than pg16's
    `pg_restore`.
  - `TokenLot` and `WalletHuntSnapshot` are empty on this dump (expected per operator).
- Container capped at 6 CPU / 8 GB after an early resource spike (see §3).
- All validation scripts run with:
  `DATABASE_URL="postgresql://postgres:postgres@localhost:5434/sova_analyzer?schema=public" npx ts-node -r tsconfig-paths/register <script>`

---

## 1. Migrations — applied clean, additive-only

`prisma migrate deploy` applied the three pending migrations against the 14.9M-row copy with no
error and no mutation of existing tables:

- `20260707000000_wallet_representation_layer`
- `20260708000000_wallet_vector_history`
- `20260710000000_metric_learning_label`

`pgvector` extension created via `CREATE EXTENSION IF NOT EXISTS vector`. HNSW cosine index
present on `WalletVector.vector`.

---

## 2. Gate-0 counts (real data)

| Metric | Value |
|---|---|
| Wallets | 76,681 |
| SwapAnalysisInput rows | 14,946,661 |
| Distinct mints | 527,902 |
| Non-obvious mints | 501,868 |
| WalletBehaviorProfile | 64,378 |
| AdvancedTradeStats | 63,228 |
| Projected WalletVector rows | 64,378 |
| Projected WalletVector bytes | ~16.5 MB (trivial) |
| Projected WalletTokenEdge rows | 3,065,841 |

### Gate-2 materialized results

| Table | Rows |
|---|---|
| WalletVector | **64,378 (100% of profiles)** |
| PopulationStats | 1 |
| WalletTokenEdge | **3,065,841 (matches projection exactly)** |
| WalletWalletEdge | 0 — **not materialized; see §4** |

### Label reality (moat gate — decisive)

| Label | Value |
|---|---|
| RadarHolding `reviewed` (affirmative) | **0** |
| RadarHolding `unreviewed` | 6 |
| RadarHolding `ignored` | 564 |
| WalletHuntSnapshot | **0** |

⇒ **Learned-metric lane confirmed dead on this data.** Zero positive label mass (no reviewed
holdings, no hunt snapshots). This is the hard, real-count confirmation of the SPEC002_T03
NO-GO. The label-capture instrumentation (already built: provenance columns + hunt archive +
`MetricLearningLabel` ledger) is correct groundwork, but there is nothing to extract yet. **Do
not dispatch any metric-learning work.** The next label action is operational: get analysts
producing `reviewed` verdicts and running hunts, not more code.

---

## 3. Two real bugs found and fixed (synthetic data never exposed them)

Both are in the SPEC-001 backfill/materializer scripts. Neither is a schema or logic error — both
are scale-only failures invisible on the tiny synthetic set.

### 3.1 Vector backfill — unbounded `findMany` blew the Prisma engine buffer

`scripts/spec001-backfill-wallet-vectors.ts` loaded **all** 64,378 profiles (with nested
includes) in one `findMany`. Prisma's query engine failed with `Failed to convert rust String
into napi string` (empty message) — the whole response is serialized as one string across the
napi boundary and exceeds an internal buffer above ~30–50k rows.

**Fix:** keyset-paginate the read by `walletAddress` (2,000/page). Population stats still need all
source vectors, but those are ~8 MB in memory — trivial. Result: **64,378 / 64,378 written.**

### 3.2 Edge materializers — 5-second interactive-transaction timeout

`scripts/spec001-materialize-wallet-token-edges.ts` (and `...wallet-wallet-edges.ts`) wrap a bulk
set-based `INSERT…SELECT` in `prisma.$transaction(async (tx) => …)`. Prisma's default interactive
transaction timeout is **5,000 ms**; the aggregation over 14.9M rows took **63,711 ms** → rolled
back, 0 rows.

**Fix:** pass `{ maxWait: 60_000, timeout: 600_000 }` to both `$transaction` calls. Token-edge
job then completed in ~60s writing 3,065,841 edges.

---

## 4. The wallet-wallet edge materializer is the wrong shape — DO NOT run it as-is

`scripts/spec001-materialize-wallet-wallet-edges.ts` was **killed after 8+ minutes** of CPU-bound
churn (cancelled to protect the dev machine; 0 rows written). Root cause: it is a direct SQL port
of the **old O(n²) correlation analyzer** — the exact thing SPEC-001 was meant to replace:

- `candidate_pairs` self-joins `WalletTokenEdge` (3M rows) on shared mints → for any mint held by
  N wallets, N² pairs.
- `sync_events` then self-joins `SwapAnalysisInput` (14.9M rows) per candidate pair on
  mint+direction+timestamp-window.

The non-obvious-mint filter is the only guard, and on real data it is not enough. This job
persists the old cost with a new table name — it is **not** the leverage the substrate was built
for, and it is hunt/correlation-centric rather than general-purpose.

---

## 5. The substrate's real payoff — proven: database-wide k-NN, no pairwise scan

The 64,378-vector HNSW index answers **"see a wallet → find its nearest siblings across the whole
DB"** as a single indexed query — the general-purpose capability the current similarity service
**cannot** provide (it requires an explicit `walletAddresses[]` ≥ 2 and re-fetches tx per
request; `similarity-service.ts`).

`EXPLAIN ANALYZE` on a literal query vector:

```
Index Scan using "WalletVector_vector_hnsw_idx" on "WalletVector"
Execution Time: ~single-to-low-hundreds ms (cold, ef_search=100)
```

Confirmed: HNSW is used when the query vector is a bound parameter/literal (the real endpoint
shape). This is O(log N) retrieval, not O(N²) pairing.

---

## 6. Recommended redirection (supersedes running the WW materializer)

The spec intent is vector-first. Concrete plan:

1. **Wallet-wallet edges become k-NN-derived, not all-pairs.** For each wallet (or on demand),
   retrieve top-k vector neighbors (cheap: 64k × k), then score **only those candidates** with the
   existing shared-non-obvious-token + sync-event signals. This bounds the expensive scan to a
   tiny candidate set instead of the full pair space. Materialization becomes 64k bounded lookups,
   not a 3M-edge self-join.
2. **Similarity job upgrade (faster + more POVs).** Back the similarity service with:
   - **k-NN retrieval** on `WalletVector` as the candidate generator (enables "wallets like X"
     database-wide — the impossible-today query);
   - blended re-ranking on the small candidate set: behavioral cosine (vector) **+** shared-token
     Jaccard **+** sync-event score = multiple POVs, cheaply;
   - remove the per-request full tx re-fetch for the global case (vectors are precomputed).
3. **Autonomous sibling finding.** A per-wallet k-NN + threshold, run on demand or as a light
   background pass — not a global materialization. This is the "spit out potential siblings when we
   see a wallet" capability, and it costs one indexed query per wallet.
4. **Keep WalletWalletEdge** as an *output cache* of (1), populated from k-NN candidates, not from
   the mint self-join.

This makes the additions leverage across similarity, autonomous sibling detection, and cohort
queries — not just the wallet-hunt case.

---

## 7. Verdicts

| Gate | Verdict |
|---|---|
| SPEC001_T01 close (vectors + token edges on real data) | **GO** — 100% vector coverage, token edges match projection. Remaining: public docs/agent skill; WW edges redirected to §6 not the old scan. |
| SPEC002_T01 (vector history backfill on real data) | **READY** — same env; run the history backfill next with the same pagination/timeout fixes applied if needed. |
| SPEC002_T02 (formation replay) | **Still gated** — needs the §6 k-NN-derived edge model + real fanout bounds, not the killed O(n²) job. |
| SPEC002_T04 ledger threshold (§6 label thresholds) | **NO-GO / PENDING** — 0 reviewed labels, 0 hunt snapshots on this data. Blocked on label *production*, not code. |
| Learned metric (future) | **NO-GO** — no positive label mass exists. |

---

## 8. Housekeeping

- pg17 prod-copy container: `analyzer-postgres-pg17` (port 5434), capped 6 CPU / 8 GB.
- To tear down when done: `docker rm -f analyzer-postgres-pg17 && docker volume rm analyzer-pg17-data`.
- Bug fixes landed in: `scripts/spec001-backfill-wallet-vectors.ts`,
  `scripts/spec001-materialize-wallet-token-edges.ts`,
  `scripts/spec001-materialize-wallet-wallet-edges.ts` (timeout only; the query itself is
  superseded per §6).
