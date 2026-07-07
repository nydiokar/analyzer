# AGENT 1 - SPEC002_T00: manager gate and spec hardening

Lane: DIRECTION / spec governance. You do not implement product code unless the review finds a tiny documentation correction is required. Your job is to turn SPEC-002 from a vision spec into an executable, budget-safe program.

## 0. Boot

Read in order:

1. `.ai/CONTEXT.md` - project state, queue/DB patterns, and architecture constraints.
2. `documentation/specs/SPEC-001-wallet-representation-layer.md` - the representation substrate SPEC-002 depends on.
3. `documentation/specs/SPEC-002-temporal-intelligence-and-the-learned-metric.md` - the spec under review.
4. `prisma/schema.prisma` - verify the named assets exist.
5. `src/core/analysis/similarity/analyzer.ts` and `src/core/analysis/similarity/similarity-service.ts` - current similarity behavior.
6. `src/api/services/wallet-hunt.service.ts` and `src/api/services/radar-snapshot.service.ts` - current label/time-series capture behavior.
7. `.ai/dispatch/DISPATCH_LOG.md` - current dispatch state.

## 1. Current facts to verify, not assume

- The repo currently has `RadarHolding`, `WalletHuntSnapshot`, `CreditTransaction`, `SwapAnalysisInput`, and `SolDailyPrice`.
- The current similarity engine builds sparse token-space vectors per request and discards them.
- `SimilarityAnalyzer.aggregateSimilarityMetrics()` currently returns `clusters: []`; cluster lookup is not persisted.
- SPEC-002 names `WalletVector`, `WalletWalletEdge`, and `WalletClusterMembership`, but these are SPEC-001 planned tables, not current schema tables.
- Therefore SPEC-002 Act 2 is cheap only after SPEC-001 lands. Before that, implementing Act 2 directly risks creating a second representation layer.

## 2. Task

Produce a short direction addendum that answers:

- Is SPEC-002 internally consistent after comparing it to SPEC-001 and current code?
- Which parts are immediately executable, and which are gated by SPEC-001?
- Does SPEC-002 need wording changes so future agents do not treat "mostly free" as "build now before substrate"?
- What exact acceptance gates protect budget: row counts, vector-table existence, graph-table existence, label volume, negative-pair construction, backtest false-positive rate?
- Which dispatch jobs should remain blocked, and which can run read-only now?

## 3. Hard guards

- Do not implement `WalletVector`, graph tables, endpoints, embeddings, or new jobs here.
- Do not update Prisma schema.
- Do not run destructive commands.
- Do not invent a new serving model. If the work belongs in SPEC-001 projections, say so.
- Keep the addendum small. Do not create a broad new roadmap document.

## 4. Deliverables

- Either:
  - a concise addendum section appended to `documentation/specs/SPEC-002-temporal-intelligence-and-the-learned-metric.md`, or
  - a separate `.ai/context/SPEC002_EXECUTION_GATE_YYYY-MM-DD.md` if the addendum would be too large.
- Update `.ai/dispatch/DISPATCH_LOG.md`:
  - move SPEC002_T00 to Completed with a short verdict;
  - unblock or keep blocked SPEC002_T01/T02/T03 with explicit reasons.

## 5. Verification

- Cite observed file paths and schema models in the addendum.
- Run `pnpm run verify` only if you touched TypeScript. If docs-only, no build is required.

## 6. Service boundary checklist

No endpoint, queue consumer, or external-input handler should be added in this job. If you recommend a later handler, write the concurrency, request-size, timeout, malformed-input, and backing-resource questions into that later job instead of solving them here.

