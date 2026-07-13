# AGENT_12 — Adversarial Review of the Dispatch Brief (before execution)

**Date:** 2026-07-13 · **Reviewer stance:** senior, hostile-to-the-plan, verify-every-claim.
**Verdict:** Brief is **directionally correct and worth executing**, but it is **NOT complete
enough to build by following literally.** Five gaps below are real and were found by checking the
code + `:5434` real data, not by reading the audit doc. Fix the brief (done — see §6) before a line
of builder code.

Every number here is reproduced live on `analyzer-postgres-pg17` (:5434), 2026-07-13.

---

## 0. What the brief got RIGHT (independently re-verified — do not re-litigate)
- **MCAP-VEC-BUG is live.** `readMcapDistribution` (`wallet-feature-vector.ts:168`) reads
  `nano/ultra-micro/micro/small/mid/large/mega`; DB `mcapDistribution` stores dollar-range keys.
  Live key histogram on 64,378 profiles: `0-10k`=47,927 … `1m+`=24,565 vs legacy `nano`=18,
  `micro`=28, `mega`=17. Dims 16,17,18,19,25,26 are ~99.95% zero. **Confirmed dead.**
- **Add-not-replace for hold-time is correct.** `corr(medianCompletedHoldTimeHours,
  medianActiveHoldingHours) = 0.109` on real data (brief said 0.11). Different scale too:
  avg completed = 10.53h vs avg active = 320.93h. Two genuinely different axes.
- **The drop targets are genuinely redundant.** `corr(flipperScore, %<1h) = 0.894`;
  `corr(%<1h, %<4h) = 0.946`. Collapsing the speed bloc is justified.
- **sellSkew carries new signal.** `corr(sellSkew, buySellSymmetry) = 0.330` — not a duplicate of
  the existing flow dim. Justified add. And `tokensWithOnlySells` genuinely does **NOT** exist as a
  DB column (verified) → sellSkew MUST be derived from stored `totalBuyCount`/`totalSellCount`.
- **Storage width is decoupled from source count.** `WalletVector.vector` is padded to 64 dims
  (`WALLET_VECTOR_STORAGE_DIMENSIONS`); HNSW/edge cosine runs on the padded 64-vector. Changing
  source dims 32→~30 does **not** change storage width, index shape, or edge math. The brief's
  implicit assumption holds — good.

## 1. GAP A (CORRECTNESS) — the new Axis-3 dim has a 12% null-semantics trap
`medianCompletedHoldTimeHours` is populated on **56,762 / 64,378 = 88.2%**. The other 11.8% are
buy-only / still-holding wallets with no closed round-trip. `safeNumber(null) → 0`, and
`log1p(0)=0`, which after standardization reads as **"instant exit"** — the exact opposite of a
never-sold holder. This is the *same class of bug as MCAP* (a wrong value masquerading as a real
one), and the brief does not mention it.
**Required in the builder:** carry an explicit "has-completed-round-trip" signal (either a
companion binary presence dim, or fold presence into the Axis-5 conviction dim so a never-seller
lands in the holder region, not the fast-exit region). Do NOT let missing→0 mean "fast."

## 2. GAP B (LIVE-CUTOVER) — the version bump is an ALL-OR-NOTHING switch, not a rename-swap
`WALLET_VECTOR_SCHEMA_VERSION` is a hard `WHERE schemaVersion = ...` filter in **every** read/write
consumer:
- `upsertWalletVectorForProfile` early-returns if `PopulationStats.schemaVersion != code const`
  (`database-service.ts:3131`) — live imports silently stop writing vectors, no error.
- Reads: `findSimilarWalletVectors`, batch reads, cohort coordination (`:3253/:3287/:3303/:3540/:3575`).
- WW-edge materializer (`spec001-materialize-wallet-wallet-edges.ts:62/75/87`).

**Therefore the instant the code constant flips to 2, every version-filtered surface returns
EMPTY until the full v2 backfill lands.** SURFACE-1 (live in the dashboard) reads these. The brief's
"coordinate the cutover / rebuild in a transaction/rename" is **not achievable as written** because
the filter is a value predicate, not a table name. Realistic options — pick and document ONE:
  - **(preferred) Additive-then-flip:** backfill v2 into `WalletVector`… **but** `WalletVector` PK is
    `walletAddress` with `ON CONFLICT (walletAddress)` (`:3171`) — **one row per wallet, no per-version
    coexistence.** So v2 clobbers v1 in place. You CANNOT keep both v1 and v2 in `WalletVector`
    simultaneously without a schema change (add version to the PK/unique or a shadow table).
  - **(pragmatic) Accept a documented rebuild window:** flip constant → run backfill batch → surfaces
    degrade to "no representation yet" (already a handled empty-state in SURFACE-1) for the window,
    then recover. Acceptable ONLY on a dev/copy or during a maintenance window, and must be stated.
  - **(clean) Shadow-table cutover:** materialize v2 into `WalletVector_v2` + `PopulationStats` row,
    verify, then atomic rename. Costs a migration; the only zero-downtime path.

**This is the single biggest thing the brief underspecifies.** The last agent's failure mode was
"built a parallel copy"; the symmetric failure here is "flip a global switch under a live surface
and blank it." Decide the cutover model explicitly BEFORE touching the constant.

## 3. GAP C (GUARD IS FALSE) — brief §5 "v1 rows may be retained" is wrong for `WalletVector`
Because of the `walletAddress` PK + `ON CONFLICT`, v2 overwrites v1 in `WalletVector`. Retention is
only true for **`WalletVectorHistory`** (append-only, version-scoped). The guard as written invites a
wrong mental model. Corrected in §6.

## 4. GAP D (SCOPE / NO-DUPLICATION) — one builder, one constant, but count the touch-set honestly
The brief says "edit the one `wallet-feature-vector.ts`." True for the *math*, but a dim-count and
key change ripples to these that MUST move in lockstep (else silent shape drift):
- `wallet-feature-vector.ts` — builder array + `readMcapDistribution` + `BehaviorLike` Pick (add
  `medianCompletedHoldTimeHours`, `totalBuyCount`, `totalSellCount`, `averageSessionStartHour`;
  the mcap fix changes which fields are read).
- `wallet-feature-vector.test.ts` — golden vectors change; update, don't delete.
- `PopulationStats` means/scales length = new source dim count (recompute, not edit).
- `standardizeWalletVector` dim-guard messages ("schema v1") — update text.
- Nothing else reads the *source* array positionally (verified: storage is padded 64, edges read
  stored vector). So the blast radius is bounded — but the test + population-stats recompute are
  non-optional, not "optional polish."
**No parallel builder. No `v2`-suffixed duplicate module. Bump the constant in place.**

## 5. GAP E (ACCEPTANCE HARNESS DOESN'T EXIST YET) — the brief assumes a harness it never built
Brief §2 says "re-run the exact harness from the audit." **There is no committed harness script** —
the audit numbers were ad-hoc SQL/queries in the doc. Per-type neighbor purity + confusion matrix
over 100 seeds/type × top-20 HNSW is a real script that must be **written first** and run on v1 to
capture the baseline BEFORE v2 exists (otherwise "prove it's better" has no before-row). This is a
prerequisite task, not a step inside the rebuild. Sequence it first.

---

## 6. Corrected execution order (supersedes brief §1–§3 sequencing)
1. **Write the acceptance harness** (`scripts/spec-agent12-vector-quality-harness.ts`): per-type
   neighbor purity, DISTRIBUTOR→FAST_TRADER / PURE_HOLDER→LOW_ACTIVITY confusion, per-dim frac-zero
   + max-|r| pair, known-connected recovery (Solomon/FLORK/STELLAR). Run on **v1 → save baseline**.
2. **Decide + document the cutover model** (§2). On :5434 (disposable) the rebuild-window path is
   fine; for the eventual prod runbook, note the shadow-table path.
3. **Edit `wallet-feature-vector.ts` in place:** fix mcap (compact 9 dollar-keys → 2–3 dims),
   drop dims 2/9/20/32 + one of 7/14, add Axis 3 (with GAP-A presence handling), Axis 4 sellSkew,
   Axis 6 sin/cos, Axis 5 conviction. Bump `WALLET_VECTOR_SCHEMA_VERSION → 2`, update
   `WALLET_VECTOR_SOURCE_DIMENSIONS`. Update the test goldens.
4. **Re-materialize on :5434 in order:** PopulationStats → WalletVector (v2, clobbers v1) →
   WalletVectorHistory (v2 baseline) → WW edges → clusters → confirm HNSW.
5. **Run harness on v2**, produce `BEHAVIOR_VECTOR_V2_VALIDATION_<date>.md` with before/after.
   GATE: purity up on blind types, no regression on strong types, confusion down, known-connected
   preserved, zero dead dims, no |r|>0.9 pair. If any fails → stop, don't ship a worse substrate.
6. **Live-path audit** (brief §4) + `intel:audit:strict` exit 0 + `pnpm run verify`.

## 7. Go / No-Go
**GO to execute — but only via §6, not brief-literal.** The direction is sound and every core claim
verified. The five gaps are correctness/operational, not fatal. Do NOT flip the version constant
until the harness baseline is captured and the cutover model is written down.
