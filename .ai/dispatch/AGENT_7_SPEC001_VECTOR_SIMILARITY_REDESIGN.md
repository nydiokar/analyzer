# AGENT 7 - SPEC001_T06: vector-first similarity + k-NN sibling finding

Lane: BUILD / general-purpose leverage. This job turns the persisted `WalletVector` substrate
into database-wide capability and **replaces** the killed O(n²) wallet-wallet materializer. It is
the spec's actual intent: the vector exists so the expensive pairwise scan is no longer needed.

## 0. Boot

Read in order:

1. `.ai/CONTEXT.md`.
2. `.ai/context/SPEC_T05_REALDATA_VALIDATION_2026-07-11.md` — §4 (why WW materializer is wrong),
   §5 (k-NN proven on real data), §6 (this plan).
3. `documentation/specs/SPEC-001-wallet-representation-layer.md` — kNN / global similarity intent.
4. `src/core/analysis/similarity/similarity-service.ts` and `.../similarity/analyzer.ts` — the
   current per-request, walletAddresses[]≥2, tx-refetch design.
5. `src/api/services/similarity.service.ts`, `src/api/controllers/intel.controller.ts` — public
   surface + existing bounded kNN read helper in `database-service.ts`.
6. `scripts/spec001-materialize-wallet-wallet-edges.ts` — the O(n²) scan being replaced.
7. `src/config/constants.ts` `CLUSTERING_CONFIG` — shared-token / sync-event weights to reuse.

## 1. Problem (proven on real data)

- The current similarity service **cannot** answer "find wallets similar to X across the DB": it
  requires an explicit `walletAddresses[]` of ≥2 and re-fetches transactions per request.
- The wallet-wallet edge materializer is a SQL port of the old O(n²) correlation scan; it was
  killed after 8 min on real data (candidate_pairs self-join on shared mints + sync_events
  self-join over 14.9M rows). It persists the old cost, is hunt/correlation-centric, and does not
  generalize.
- Meanwhile the 64,378-vector HNSW index answers per-wallet k-NN in ~ms (SPEC_T05 §5). That is the
  cheap, general primitive.

## 2. Task

1. **k-NN candidate generator (DB read).** A bounded read: given a wallet address (or a raw
   vector), return top-k nearest `WalletVector` neighbors by cosine, using the HNSW index with a
   **bound/literal query vector** (a subquery seed defeats the index — SPEC_T05 §5). Parameterize
   `k` and `ef_search`. Reuse/extend the existing kNN helper in `database-service.ts` if present.
2. **Vector-first similarity job upgrade.** Add a mode that:
   - retrieves the k-NN candidate set for a seed wallet (enables "wallets like X" — the
     impossible-today query),
   - re-ranks **only that small candidate set** with a blended score = behavioral cosine (vector)
     + shared-non-obvious-token Jaccard + sync-event score (reuse `CLUSTERING_CONFIG` weights),
   - does **not** re-fetch full tx for the global case (vectors are precomputed); tx-based signals
     are computed only for the ≤k candidates when the caller asks for the deeper POV.
   - Preserve the existing explicit-`walletAddresses[]` path for backward compatibility; this is
     additive.
3. **Autonomous sibling finding.** A per-wallet "siblings" read: k-NN + a similarity threshold →
   candidate siblings, on demand. Optionally a light background pass that caches results; NOT a
   global all-pairs materialization.
4. **`WalletWalletEdge` as an output cache.** Repopulate it (if kept) from k-NN candidates +
   blended score, per wallet — 64k bounded lookups, not a 3M-edge self-join. Retire or clearly
   deprecate `scripts/spec001-materialize-wallet-wallet-edges.ts`'s O(n²) query.

## 3. Hard guards

- No global all-pairs scan. Every expensive (tx-level / sync-event) computation runs on a bounded
  ≤k candidate set, never the full pair space.
- k-NN queries must pass the query vector as a **bound parameter/literal** so HNSW is used
  (verify with `EXPLAIN ANALYZE` showing `Index Scan using WalletVector_vector_hnsw_idx`).
- Additive to the public API: do not break the existing `walletAddresses[]` similarity contract or
  SDK types. New capability is a new mode/endpoint.
- Apply the pagination + `$transaction` timeout lessons from SPEC_T05 §3 to any new bulk script.
- Reuse existing weights/config; do not invent a new scoring scheme without justification.

## 4. Validation env

- Real-data copy: `analyzer-postgres-pg17` (port 5434), DB `sova_analyzer`, 64,378 vectors +
  3,065,841 token edges already materialized.
  `DATABASE_URL="postgresql://postgres:postgres@localhost:5434/sova_analyzer?schema=public"`.
- Prove the k-NN path with `EXPLAIN ANALYZE` on a real seed wallet before wiring the service.

## 5. Deliverables

- k-NN candidate-generator read (helper + optional endpoint), HNSW-verified.
- Additive vector-first similarity mode with blended re-rank on the candidate set.
- Autonomous per-wallet sibling read.
- `WalletWalletEdge` repopulation from k-NN candidates (bounded), replacing the O(n²) script.
- Benchmarks on the real copy: k-NN latency, candidate-set size, end-to-end similarity latency vs
  the old path.
- Update `.ai/dispatch/DISPATCH_LOG.md` and note whether SPEC002_T02 (formation replay) is
  unblocked by the new bounded edge model.

## 6. Acceptance

- "Wallets like X across the DB" returns ranked siblings for an arbitrary real seed wallet in
  interactive time (target: tens of ms for retrieval, bounded re-rank cost).
- `EXPLAIN ANALYZE` confirms HNSW index usage on the retrieval query.
- No code path performs an all-pairs or full-table self-join for the general similarity case.
- Existing explicit-`walletAddresses[]` similarity output is unchanged (regression-checked).

## 7. Service boundary checklist

- Concurrency: k-NN reads are cheap but callable repeatedly; cap `k` and `ef_search`, and bound
  the re-rank candidate set. Similarity job stays queue-backed.
- Memory at scale: never materialize the full pair space; stream/limit candidates.
- Request size: cap `k` and any batch of seed wallets.
- Timeout: retrieval is one indexed query; the bounded re-rank has a fixed ceiling (≤k). Any bulk
  cache-repopulation script uses the SPEC_T05 timeout budget.
- Malformed input: validate seed wallet address; return structured error if the wallet has no
  vector (not all wallets have a behavior profile — 64,378 of 76,681).
- Backing resources: on DB/index failure, structured error; never fall back to the O(n²) scan.
