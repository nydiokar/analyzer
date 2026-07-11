# AGENT 2 - SPEC002_T01: vector history and behavioral drift pilot

Lane: BUILD / temporal vectors. This is the cheapest SPEC-002 Act 2 win, but only after the SPEC-001 vector substrate exists or is being implemented in the same accepted architecture.

## 0. Boot

Read in order:

1. `.ai/CONTEXT.md`.
2. `.ai/dispatch/DISPATCH_LOG.md` and the completed SPEC002_T00 verdict.
3. `documentation/specs/SPEC-001-wallet-representation-layer.md` - Phase 1 and the `WalletVector`/`PopulationStats` contract.
4. `documentation/specs/SPEC-002-temporal-intelligence-and-the-learned-metric.md` - Act 2.1 and 2.3.
5. `prisma/schema.prisma`.
6. The implementation files that now write `WalletBehaviorProfile` and `WalletVector` after SPEC-001 lands. If SPEC-001 has not landed, stop and report blocked.
7. `src/queues/processors/analysis-operations.processor.ts` and `src/api/services/behavior.service.ts` - current behavior-analysis write path and cache invalidation pattern.

## 1. Task

Implement the first temporal projection:

- append-only history for wallet behavioral vectors, keyed by wallet, schema version, and build time;
- deterministic drift score between the newest vector and prior vector/window;
- a small read path for "latest drift" only if SPEC002_T00 approves a user/API surface;
- optional k-NN outcome-by-analogy design note if enough `AnalysisResult`/`WalletPnlSummary` data is available, but do not implement outcome prediction unless this job is explicitly expanded.

The product outcome is simple: identify wallets whose behavior changed materially over time.

## 1b. Target DB for migration + backfill

Apply the migration and backfill against the real-data dev copy `analyzer-postgres-pg17`
(:5434, DB `sova_analyzer`),
`DATABASE_URL="postgresql://postgres:postgres@localhost:5434/sova_analyzer?schema=public"`.
**It is a disposable restore of a server dump — safe to migrate, backfill, or wipe.** Not
production; the operator re-extracts it on demand, so work on it directly (no throwaway
clone). This is the "unlocked DB" referenced in the DISPATCH_LOG remaining-work note.

## 2. Root-cause framing

Today, `WalletBehaviorProfile` is one row per wallet and current similarity vectors are rebuilt per request. That overwrites or discards the previous representation, so the system cannot say whether a wallet changed character. The fix is not a new model; it is versioning the representation SPEC-001 already produces.

## 3. Hard guards

- Do not create a parallel vector builder. Reuse SPEC-001's feature-vector builder and `PopulationStats`.
- Do not use token-space vectors for drift. Drift is over fixed behavioral feature vectors only.
- Do not write history on every read if the source profile did not change; avoid row spam.
- Do not run full-wallet backfills concurrently without a bounded queue/concurrency limit.
- Do not add ML, embeddings, sequence modeling, or graph embeddings.
- Keep existing HUD lean. Rich drift analytics belong in fuller profile/behavior surfaces or persisted projections, not the HUD.

## 4. Likely files

Final files depend on SPEC-001 landing, but expect:

- `prisma/schema.prisma` and a new additive migration for `WalletVectorHistory`/drift fields.
- SPEC-001 vector builder/service file.
- `src/api/services/behavior.service.ts` or the service that persists `WalletBehaviorProfile`.
- A small query method in `src/core/services/database-service.ts` or established DB service layer.
- Focused tests next to the vector builder/service.

## 5. Deliverables

- Additive schema only. Suggested shape:
  - `WalletVectorHistory(id, walletAddress, schemaVersion, vector/ref, driftFromPrevious, builtAt, sourceProfileUpdatedAt)`.
  - If storing pgvector twice is too costly, store compact numeric drift metadata plus a reference/hash to `WalletVector`; justify the tradeoff with measured size.
- Deterministic drift calculator with tests:
  - identical vectors -> drift 0;
  - missing prior vector -> null/no drift;
  - schemaVersion mismatch -> no cross-version drift unless explicitly normalized.
- Backfill script or queue job with bounded concurrency.
- Optional read endpoint only if approved by SPEC002_T00.

## 6. Acceptance

- Backfill covers >= 99% of wallets that have current `WalletVector`.
- Running the writer twice without source changes does not create duplicate history rows.
- Drift values are deterministic across reruns.
- No N+1 query pattern in backfill; batch reads/writes where possible.
- `pnpm run verify` passes. Add focused tests where the repo pattern allows.

## 7. Service boundary checklist

If adding an endpoint or queue handler:

- Concurrency: queue/backfill must have an explicit worker concurrency or batch limit.
- Memory at scale: document memory for 100 concurrent requests or make the endpoint O(1) by wallet lookup.
- Request size: endpoint accepts wallet address only or bounded filters.
- Timeout: queue job uses existing BullMQ timeout config; endpoint should not trigger rebuild.
- Malformed input: validate wallet address and schema version.
- Backing resources: DB unavailable should fail per-request/job with structured error; server startup should not depend on backfill success.

