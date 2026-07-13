# Behavior Vector v2 — Validation (before/after)

**Date:** 2026-07-13 · **DB:** `analyzer-postgres-pg17` (:5434) · **Harness:**
`scripts/spec-agent12-vector-quality-harness.ts` (100 seeds/type, k=20, deterministic).
Raw JSON: `BEHAVIOR_VECTOR_V1_BASELINE_2026-07-13.json` (v1) /
`BEHAVIOR_VECTOR_V2_VALIDATION_2026-07-13.json` (v2).

## Verdict: GO — v2 beats v1 on every acceptance gate.
- Blind-type purity UP, strong types NOT regressed (up), named confusions DOWN,
  zero dead dims, no |r|>0.9 pair, known-connected recovery preserved, downstream
  re-materialized, live write-path emits v2.

## What changed (schema v1 32-dim → v2 27-dim)
- **FIX** MCAP-VEC-BUG: `readMcapDistribution` now reads the real dollar-range keys
  (`0-10k…1m+`) and compacts them to ONE honest positioning dim (weighted-median
  bucket rank). The 6 dead one-hot mcap dims are gone.
- **DROP** (redundant, evidence in audit): flipperScore, %<4h, velocityScore,
  %<1h×flipper, completePairsRatio, mcap.concentration (r=0.98 w/ dominantMcapShare),
  mcap.highCapShare (r=0.95 w/ weightedMedian in standardized space), onlyBuysRatio
  (r=−0.95 w/ bothBuySellRatio).
- **ADD**: medianCompletedHoldTimeHours (closed round-trip tempo, ⊥ dim30 r=0.109)
  **+ an explicit presence flag** (GAP A: null on 11.8% buy-only wallets — 0 would
  misread as "instant exit"); sellSkew = sells/(buys+sells) from stored counts;
  session-start hour as circular sin/cos; one merged holding-conviction dim.
- **RE-WEIGHT** (`WALLET_VECTOR_AXIS_WEIGHTS`, applied to the standardized z-score so
  it survives scale-normalization): down-weight the speed/activity bloc that
  dominated v1 geometry (0.6–0.8×), up-weight the holder/sell-skew/hold axes
  (1.3–1.8×). Descriptive hand-set weights — NO learned weights.
- Storage width unchanged (64, padded) → pgvector column, HNSW index, edge/cosine
  math untouched.

## Per-type neighbor purity (fraction of top-20 neighbors sharing the seed's type)
| Type | v1 | v2 | Δ |
|---|---:|---:|---:|
| FAST_TRADER [strong] | 0.886 | **0.905** | +0.019 |
| LOW_ACTIVITY [strong] | 0.809 | **0.886** | +0.077 |
| ACCUMULATOR | 0.606 | **0.713** | +0.107 |
| DAY_TRADER | 0.685 | 0.639 | −0.046 |
| DISTRIBUTOR [BLIND] | 0.260 | **0.547** | **+0.287** |
| POSITION_TRADER | 0.408 | **0.500** | +0.092 |
| SWING_TRADER | 0.489 | **0.499** | +0.010 |
| PURE_HOLDER [BLIND] | 0.238 | **0.289** | +0.051 |
| BALANCED_TRADER | 0.078 | **0.164** | +0.086 |

(DAY_TRADER dips slightly — mass shifts to the now-separable DISTRIBUTOR/PURE_HOLDER;
net win. BALANCED_TRADER stays low: n=145, genuinely diffuse "average" label — not a
target of this pass.)

## Named confusions (the audit gate)
| Confusion | v1 | v2 | Δ |
|---|---:|---:|---:|
| DISTRIBUTOR → FAST_TRADER | 0.634 | **0.391** | −0.243 |
| PURE_HOLDER → LOW_ACTIVITY | 0.762 | **0.711** | −0.051 |

## Per-dim health
| | v1 | v2 |
|---|---|---|
| dims | 32 | 27 |
| dead dims (frac-zero ≥ 0.9) | [15,16,17,18,24,25] (6 mcap) | **[]** |
| max \|pearson r\| pair | dim7↔dim31 = 0.98 | dim5↔dim13 = **0.81** |

## Known-connected recovery (regression gate — `surface1-representation-batch-smoke.ts`)
Cohort of 9 on v2: Solomon fleet (4) → one ring (size 4); FLORK fleet (3) → one ring;
**STELLAR → vector present but cluster=NONE, in neither ring.** 2 DB-wide rings + 4
internal edges — identical shape to the v1 acceptance. **No regression.**

## Downstream re-materialization (all on :5434, idempotent, counts reported)
PopulationStats (v2, 27 dims) → WalletVector **64,378 v2 / 0 v1** (ON CONFLICT clobber,
as GAP-C predicted — no v1 residue) → WalletVectorHistory **64,378 v2** → WW edges
**2,582 distinct (807 stale pruned)** → clusters **117 / 417 memberships**.

## Live-pipeline integration (brief §4)
`upsertWalletVectorForProfile` gates on `PopulationStats.schemaVersion === code const`
(both = 2) and calls `buildWalletSourceVector` (v2). A live wallet import is placed into
the v2 coordinate system in-transaction automatically. Only PopulationStats recompute is
a batch op (done, needed once per schema bump). **No live path bypasses the vector
write. No gap.**

## Cutover model used (adversarial-review GAP B)
Rebuild-window on the disposable :5434 copy: constant flipped → PopulationStats + all
vectors re-backfilled (ON CONFLICT clobber) → downstream re-materialized. For a PROD
cutover this path would blank version-filtered surfaces during the window; the prod
runbook is the **shadow-table** path (`WalletVector_v2` + atomic rename) — deferred until
a prod cutover is real (not built now; YAGNI).

## Build/contract
Backend + vector unit tests (4/4, incl. GAP-A never-seller test) pass; backend `tsc`
clean; `intel:audit:strict` exit 0 (27-dim count is internal, no DTO/contract leak; the
listed failures are pre-existing sova-intel docs-coverage gaps under GUIDE-1).

## Pre-existing bug fixed in passing
`scripts/spec002-backfill-wallet-vector-history.ts:84` had stray backticks inside a SQL
comment **inside a tagged template literal**, which closed the `$executeRaw` template and
made the script uncompilable (`TS2304: Cannot find name 'vector'`). It could never have
run as committed. Fixed (removed the backticks) — required to re-materialize history.
