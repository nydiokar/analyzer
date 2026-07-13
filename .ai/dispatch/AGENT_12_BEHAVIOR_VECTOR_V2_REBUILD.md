# AGENT 12 — Behavior Vector v2 Rebuild (apply the axis map) + live-pipeline integration audit

> **⚠️ READ FIRST — this brief was adversarially reviewed 2026-07-13 and is NOT complete enough to
> follow literally.** See `.ai/context/AGENT_12_ADVERSARIAL_REVIEW_2026-07-13.md`. Every core claim
> was verified live on :5434 and holds, but FIVE gaps were found — execute via the review's
> **corrected order (§6)**, not this brief's §1–§3 sequencing. Non-negotiable additions:
> - **GAP A:** `medianCompletedHoldTimeHours` is null on 11.8% (buy-only wallets). missing→0 reads as
>   "instant exit" — WRONG for a never-seller. Carry a presence signal; don't let 0 mean fast.
> - **GAP B (biggest):** `WALLET_VECTOR_SCHEMA_VERSION` is a hard `WHERE` filter in every read/write +
>   the WW-edge script. Flipping it = **all version-filtered surfaces go EMPTY** until v2 backfill
>   completes. `WalletVector` PK is `walletAddress` (`ON CONFLICT`) → **v2 clobbers v1, no coexistence.**
>   Decide + document the cutover model (rebuild-window on :5434 is fine; shadow-table for prod) BEFORE
>   touching the constant.
> - **GAP C:** brief §5 "v1 rows may be retained" is FALSE for `WalletVector` (only `WalletVectorHistory`
>   is append-only/version-scoped).
> - **GAP D:** the test goldens + PopulationStats recompute are NOT optional. One builder, one constant,
>   bump in place — no `v2`-suffixed parallel module.
> - **GAP E:** the "re-run the audit harness" does NOT exist as a committed script. WRITE it first, run
>   on v1 to capture the baseline, THEN build v2. It is a prerequisite, not a step inside the rebuild.

Lane: BUILD / representation. This is the direct continuation of the REPR-QUAL audit: the audit produced
a validated map of what's dead / redundant / missing in the current 32-dim behavior vector. This job
**spends that map** — rebuilds the vector to schema v2, and confirms the whole thing self-populates on
live imports. Products (SURFACE-1) are ALREADY shipping on the current, known-flawed v1 vector, so this
is not optional polish — it's correcting the substrate under a live surface.

## 0. Boot (read in order)
1. `.ai/CONTEXT.md` (REPR-QUAL + MCAP-VEC-BUG rows), `.ai/dispatch/DISPATCH_LOG.md`.
2. `.ai/context/BEHAVIORAL_AXIS_MAP_2026-07-12.md` — **the spec for this job.** Part 2 (compaction
   ledger) is the literal keep/drop/add list.
3. `.ai/context/METRICS_VECTOR_AUDIT_2026-07-12.md` — the evidence behind each call.
4. `src/core/representations/wallet-feature-vector.ts` — what you are editing (bump
   `WALLET_VECTOR_SCHEMA_VERSION` → 2).
5. `src/core/services/database-service.ts` `upsertWalletVectorForProfile` (~3126), `appendWalletVectorHistory`,
   `findSimilarWalletVectors` — the live write + read paths.
6. `scripts/spec001-backfill-wallet-vectors.ts`, `scripts/spec002-backfill-wallet-vector-history.ts`,
   `scripts/spec001-materialize-wallet-wallet-edges.ts` — must be re-run after a v2 rebuild.
7. `documentation/specs/SPEC-001-wallet-representation-layer.md` (vector contract),
   `documentation/specs/SPEC-002-...md` §2.1 (drift — it is population-invariant over the RAW source
   vector, so a v2 schema is a clean break, not spurious drift).

## 0b. Target DB
`analyzer-postgres-pg17` (:5434) as above. Additive/rebuild on the disposable copy; every change proven
there before it's called done.

## 1. Task — apply the map (from `BEHAVIORAL_AXIS_MAP_2026-07-12.md` Part 2)
1. **FIX the dead mcap dims (`MCAP-VEC-BUG`).** `readMcapDistribution` reads legacy keys
   (`nano/micro/…`); DB stores `0-10k…1m+`. Either remap the real dollar-range keys or read the
   already-populated `entryMcapDistributionByCount`, then COMPACT to ~2–3 mcap dims (weighted-median
   mcap + spread/concentration) rather than 6 raw buckets.
2. **DROP redundant dims:** dim2 (flipperScore), dim9 (%<4h), dim20 (velocityScore), dim32 (%<1h×flipper),
   and one of dim7/dim14 (sequence pair, r=0.93). Evidence: audit §2C.
3. **ADD the missing axes:**
   - Axis 3 — `medianCompletedHoldTimeHours` (closed round-trip exit tempo; ⊥ dim30 r=0.11).
   - Axis 4 — `sellSkew = totalSellCount/(totalBuyCount+totalSellCount)`, bounded [0,1] (separates
     DISTRIBUTOR 0.75 from FAST_TRADER 0.47 where existing flow dims fail). NB `tokensWithOnlySells` is
     computed-but-NOT-stored — derive sellSkew from the stored counts.
   - Axis 6 — `averageSessionStartHour` as a **circular sin/cos PAIR** (⊥ everything, |r|<0.04). Raw
     scalar is wrong (hour 23 ≈ hour 0).
   - Axis 5 — ONE bounded holding-conviction dim (the PURE_HOLDER vs LOW_ACTIVITY fix — 72% confusion).
     This is the single deliberate magnitude signal allowed IN the behavior vector; keep it bounded.
4. **KEEP** dim30 (`medianActiveHoldingHours`) — it is the open-position axis, orthogonal to the new
   Axis 3. (The audit's earlier "replace" was corrected to "keep + add sibling.")
5. **Re-weighting (optional, evidence-gated):** the speed bloc dominated geometry. After the drops,
   re-measure; if the speed axis still over-weights, apply a hand-set per-axis weight (down-weight
   speed, up-weight sell-skew/holding). Descriptive only — NO learned weights in this job.

## 2. Prove the rebuild is BETTER, not just different (the acceptance bar)
Re-run the exact harness from the audit on v2 and show movement in the right direction:
- **Per-type neighbor purity** (100 seeds/type, top-20 HNSW). v2 must IMPROVE the blind types
  (DISTRIBUTOR 0.25→up, PURE_HOLDER 0.25→up) WITHOUT materially regressing the strong types
  (FAST_TRADER 0.90, LOW_ACTIVITY 0.80).
- **Confusion matrix**: DISTRIBUTOR→FAST_TRADER (was 53%) and PURE_HOLDER→LOW_ACTIVITY (was 72%) must
  drop.
- **Known-connected recovery** (`COLLECTIONS_VECTOR_VALIDATION_2026-07-12.md`): Solomon/FLORK fleets
  must STILL recover 100% and STELLAR must STILL correctly not-link. No regression on the proven case.
- **Per-dim stats on v2**: no dead dims (frac_zero < 0.9 for every dim), no pair with |r| > 0.9.
- Deliver a short `.ai/context/BEHAVIOR_VECTOR_V2_VALIDATION_<date>.md` with before/after tables.

## 3. Re-materialize the downstream (v2 changes everything downstream)
Because the source vector changes, in order: recompute `PopulationStats` → backfill `WalletVector` v2 →
backfill `WalletVectorHistory` (new v2 baseline; drift is version-scoped so no spurious cross-version
drift) → re-run WW-edge materializer → re-run cluster materializer. Confirm HNSW index rebuilt. All on
:5434, idempotent, counts reported.

## 4. Live-pipeline integration audit (answer definitively, in writing)
Confirm and document that a wallet imported LIVE gets its v2 vector automatically:
`upsertWalletBehaviorProfile` → `upsertWalletVectorForProfile` builds+standardizes+writes in-tx against
the `PopulationStats` singleton. State clearly in the validation doc: **live wallets are placed into the
existing coordinate system automatically; only PopulationStats recompute is a batch op (needed after a
schema/version bump like this one, not per-insert).** If any live path does NOT trigger the vector write
(e.g. a processor that writes the profile outside `upsertWalletBehaviorProfile`), FILE it as a gap.

## 5. Hard guards
- Additive schema-version bump (v1 rows may be retained or migrated; do NOT silently corrupt v1).
- No parallel builder — edit the one `wallet-feature-vector.ts`, bump the version constant.
- No ML / no learned weights. Bounded transforms + descriptive validation only.
- SURFACE-1 consumes `WalletVector` live — coordinate the cutover so the dashboard never reads a
  half-rebuilt table (rebuild in a transaction/rename, or accept a brief documented rebuild window).
- `intel:audit:strict` exit 0 (the vector is behind bounded endpoints; dim count is internal, but
  confirm no DTO/contract shape leaked the dim count).

## 6. Acceptance
- v2 validation doc shows purity up on blind types, confusion down, known-connected preserved, no dead
  dims, no |r|>0.9 pair.
- Downstream (history/edges/clusters) re-materialized + counts reported.
- Live write-path proven to emit v2 vectors on import.
- `pnpm run verify` + focused builder tests pass.

## 7. Cost
Medium. The builder edit is small; the weight/validation loop and the downstream re-materialization are
the real work. Days. This is the highest-leverage single job post-audit — it makes the substrate every
product reads actually trustworthy.
