# AGENT 11 — Capital / Outcome Embedding (the money axis, as a SECOND vector)

Lane: RESEARCH → BUILD / representation. This adds a **separate** capital-outcome embedding beside the
behavioral vector — never inside it. It exists because the behavior vector is pure-behavior **by
design** (`.ai/context/BEHAVIORAL_AXIS_MAP_2026-07-12.md` Part 3), so money questions ("is this a good
trader, or is the PnL garbage?") are structurally unanswerable in it. The money data already exists at
~98% coverage; this is cheap because the road is already paved.

## 0. Boot (read in order)
1. `.ai/CONTEXT.md` (REPR-QUAL, MCAP-VEC-BUG rows) and `.ai/dispatch/DISPATCH_LOG.md`.
2. `.ai/context/METRICS_VECTOR_AUDIT_2026-07-12.md` — the fidelity method (how a dim is judged).
3. `.ai/context/BEHAVIORAL_AXIS_MAP_2026-07-12.md` — the axis-map + compaction method + the money
   scope boundary you are now deliberately extending.
4. `src/core/representations/wallet-feature-vector.ts` — the builder pattern you will MIRROR (do not
   fork the behavior builder; write a sibling `capital-feature-vector.ts`).
5. `scripts/spec001-backfill-wallet-vectors.ts` — the backfill/standardization/PopulationStats pattern.
6. `src/core/services/database-service.ts` `upsertWalletVectorForProfile` (~line 3126) — the LIVE
   write-path you must extend so the capital vector self-populates too.
7. `prisma/schema.prisma` models `WalletPnlSummary`, `AdvancedTradeStats`, `WalletBehaviorProfile`
   (mcapBucketPnl / entryMcap* fields).

## 0b. Target DB
Real-data copy `analyzer-postgres-pg17` (:5434, `sova_analyzer`),
`DATABASE_URL="postgresql://postgres:postgres@localhost:5434/sova_analyzer?schema=public"`. Disposable
restore — safe to migrate/backfill/wipe. Every claim reproducible with one `psql` read.

## 1. Why this is cheap (verified 2026-07-12)
The money data is already computed and persisted at behavioral-population coverage:
`WalletPnlSummary` = **64,271 rows**, `AdvancedTradeStats` = **63,228 rows** vs `WalletVector` =
**64,378**. No new collection, no new compute — this is "point the machinery we already built at
columns that already exist."

---

## PART A — UNDERSTAND THE MONEY DATA before turning it into dimensions
*(This mirrors what the behavior lane did TWICE: first the substrate built the metrics blind, then
REPR-QUAL audited which ones are honest, independent, and worth vectorizing. Do the audit FIRST here so
we never ship a capital vector with a dead-dim / redundancy problem like the behavior vector had.)*

Deliverable A = a read-only research doc `.ai/context/CAPITAL_METRICS_AUDIT_<date>.md`, same rigor as
the behavior audit. Answer, with SQL on :5434:

1. **Inventory.** Every money/outcome metric we STORE or COMPUTE — `WalletPnlSummary`
   (realized/unrealized/net PnL SOL+USD, totalVolume, realizedPnlToTotalVolumeRatio,
   averageRealizedPnlPerExecutedSwap, …), `AdvancedTradeStats` (medianPnlPerToken, trimmedMean,
   tokenWinRatePercent, standardDeviationPnl, medianPnlToVolatilityRatio, weightedEfficiencyScore,
   averagePnlPerDayActiveApprox), `WalletBehaviorProfile.mcapBucketPnl`, `riskMetrics` (avg/largest tx
   SOL). Population + null-rate for each.
2. **The compaction test (same as behavior).** For each candidate: is it populated? does it restate
   another money metric (correlation)? what does it MEAN (a rate? a magnitude? an efficiency? a
   risk/volatility?)? Cluster them into **capital AXES** — expect roughly: *magnitude* (how much
   capital moves), *profitability* (net outcome), *efficiency* (PnL per unit volume/trade),
   *consistency/risk* (volatility, win-rate stability). Kill redundancy the way the behavior audit
   killed the 4 speed-copies.
3. **The honesty flag — CRITICAL and unique to money.** Money magnitude is corrupted by **untracked
   inter-wallet transfers** (a wallet funded by a sibling shows PnL that isn't its own behavior).
   Quantify where this bites: what fraction of wallets have `hasIncompleteHistory` /
   incomplete-enrichment flags, extreme unrealized-vs-realized skew, or PnL implausible vs volume?
   Recommend a **per-wallet data-quality/confidence field** that must ride with any capital score so
   downstream never treats a capital-vector neighbor as ground-truth "skilled."
4. **Bounding.** Money has unbounded scale (a whale's PnL is 1000× a retail wallet's). Recommend the
   bounded transform per axis (log + winsorize/clamp, or rank/quantile normalization) so no whale
   dominates cosine geometry — the exact failure the behavior audit found in the over-weighted speed
   bloc, but worse in money units. **No dim may be unbounded.**

**Gate:** if Part A finds the money metrics are too impure/incomplete to vectorize honestly, STOP and
report — a dishonest capital vector is worse than none. (This is the same discipline as the SPEC002_T03
label NO-GO.)

## PART B — BUILD the capital embedding (only if Part A gates GREEN)
Additive-only, mirroring the behavior substrate exactly:
- `src/core/representations/capital-feature-vector.ts` — `buildCapitalSourceVector(source)` returning
  the Part-A-approved bounded dims (expect ~6–10), + `computeCapitalPopulationStats` /
  `standardizeCapitalVector`, schema-versioned, tested like `wallet-feature-vector.test.ts`.
- Additive migration: `WalletCapitalVector(walletAddress, schemaVersion, vector, sourceVector,
  dataQuality, builtAt)` + its own `CapitalPopulationStats` singleton + an HNSW cosine index. Do NOT
  overload `WalletVector`.
- Backfill script mirroring `spec001-backfill-wallet-vectors.ts` (keyset-paginated read, batched
  writes, PopulationStats first).
- **Extend the LIVE write-path** so `upsertWalletBehaviorProfile` / the PnL-summary write also upserts
  the capital vector in-transaction — so it self-populates on live imports, NOT retrospective-only
  (match the behavior vector's live behavior; see AGENT_12 for the pipeline-integration audit).
- A bounded DB read helper `findSimilarCapitalVectors(wallet, k)` (mirror `findSimilarWalletVectors`).
- **NO new /intel contract, NO UI in this job** (surfacing is a later job). Additive DB + builder +
  backfill only.

## 2. Hard guards
- Capital vector is SEPARATE from the behavior vector — never merge money into `WalletVector`.
- No unbounded dims. No raw portfolio value / raw PnL as a dim — bounded transforms only.
- Every capital neighbor result must carry the data-quality/confidence field from Part A.
- No ML, no training — descriptive stats + deterministic bounded transforms only (k-NN is allowed as a
  READ, it is not training).
- Mirror the existing builder/backfill/standardization pattern; do not invent a parallel architecture.
- Read-only on :5434 for Part A; additive-only for Part B.

## 3. Acceptance
- Part A doc: every axis defended by SQL (population, redundancy corr, meaning, bounding, honesty).
- Part B (if green): capital vector covers ≥99% of wallets with a `WalletPnlSummary`; backfill
  idempotent; live write-path extended + proven (import→capital vector appears in same tx);
  `pnpm run verify` + focused tests pass; `intel:audit:strict` still exit 0 (no contract drift).
- Service-boundary checklist (§CLAUDE.md 7) applied to the backfill job + any read helper.

## 4. Estimated cost
Part A: ~1 focused pass (read-only). Part B: small — days, not weeks — because data + builder pattern +
backfill + live-write hook all already exist for behavior. The expensive part (computing wallet-level
money metrics at scale) is DONE.
