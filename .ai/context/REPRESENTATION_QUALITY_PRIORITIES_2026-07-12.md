# Representation Quality — the real priorities (dimensions, typology, similarity certainty)

**Date:** 2026-07-12
**Status:** priorities + first read-only findings. NOT a research job yet — these are the
questions that must be answered before we trust the vector as *the* behavior map.
**Origin:** product-owner flagged that the 32-dim vector was built by an under-specified agent
pass ("what else could we do") and nobody ever reviewed *which* metrics became dimensions or
whether those dimensions actually define behavior. Verified on :5434 that this concern is real.

---

## The core realization

The whole project premise is: **map behavior as widely and accurately as possible, then judge a
wallet by *what it does* — not who it is.** That only holds if the vector is a *faithful* map of
behavior. Right now it is a **partial** map, built by unreviewed dimension choices. Before we
build products on top of it (catalog surfaces, reputation, cohort search), we owe three checks.

## Priority 1 — Map the metrics ↔ vectors (which metrics became dimensions, and which valuable ones did NOT)

**The gap:** `WalletBehaviorProfile` has ~55 fields. The vector
(`src/core/representations/wallet-feature-vector.ts`) uses **32 dims drawn from ~24 of them**.
No document records *which* metrics were chosen, why, or what was left out. That map does not
exist. It must.

**Confirmed NOT in the vector (candidates that may matter):**
- `strategyType`, `speedCategory`, `exitPattern`, `flowPattern`, `tradingStyle` — the
  human-legible types the system *already derives* (not fed back into the vector).
- `averageSessionStartHour` — *when* they trade (timezone / bot-schedule signal).
- `confidenceScore` — profile certainty (should probably *weight* similarity, not be a raw dim).
- `typicalEntryMcapUsd`, `entryMcapP25/P75Usd`, `mcapBucketPnl` — richer mcap positioning
  (only coarse `mcapDistribution` buckets made it in).
- `totalTradeCount` / raw volume — deliberately excluded (no magnitude axis; see below).
- `medianCompletedHoldTimeHours` — **the actual round-trip hold time.** The vector instead uses
  `medianActiveHoldingHours` (dim 30), which is inflated by how long a wallet *stays active* in a
  token, not how long it *holds a position*. **Suspected wrong-dimension choice** — this is
  exactly the type of thing this map is meant to catch, and it plausibly explains some
  mis-groupings.

**Deliverable:** a table — every behavior metric → {in-vector dim # | excluded, why}. Then a
short judgement column: keep / drop / replace (e.g. `medianActiveHoldingHours` →
`medianCompletedHoldTimeHours`). This is the audit nobody did.

## Priority 2 — Which dimensions actually DEFINE behavior (contribution / significance)

We do not know which of the 32 dims carry signal vs. noise vs. are misleading-under-conditions
(e.g. `percentOfValueInCurrentHoldings` reads low for a high-churn wallet purely *because* it
churns — a symptom mistaken for a trait). We need a legible sense of dimension contribution so we
can build an **accurate typology with high certainty**, not a lousy baseline.

**First read-only finding (2026-07-12, single-seed-per-type probe, directional):** measured what
% of a seed's 20 nearest vector neighbors share its `strategyType`:

| strategyType | neighbor purity | reading |
|---|---|---|
| FAST_TRADER | **85%** | vector separates this cleanly |
| ACCUMULATOR | **80%** | clean |
| SWING_TRADER | 65% | moderate |
| LOW_ACTIVITY | 60% | moderate |
| DISTRIBUTOR | **10%** | vector nearly blind |
| PURE_HOLDER | **0%** | vector fully blind |

**Interpretation:** the vector is **strong on the active-trading axis** (fast churn vs.
accumulation) and **blind on the holding / distribution axis** (holders and distributors scatter
instead of grouping). Holders are defined by *not selling* (`tokensWithOnlyBuys`, low sell
activity), and distributors by sell-side flow — both weakly weighted vs. the flip/hold dims that
dominate the geometry. This is a **concrete, fixable** finding: the map has a lopsided emphasis.
(Caveat: single-seed probe, n=1 per type; a real pass should sample many seeds per type.)

**Deliverable:** a proper per-dimension contribution pass (variance, per-type separability,
redundancy/correlation between dims) → a ranked "which dims earn their place" table, feeding a
decision on re-weighting or swapping dims. No ML required — this is descriptive statistics.

## Priority 3 — Similarity/clustering must be provably as-confident-or-better than the old way

**This was the ORIGINAL goal** and outranks everything above: the whole reason for the rewrite
was to get **the same or better similarity + clustering results, faster.** The other explorations
are extra. Status so far (from `COLLECTIONS_VECTOR_VALIDATION_2026-07-12.md`): on operator-
verified known-connected wallets the new engine recovers fleets at 100% and ~1.5ms, and correctly
declines no-signal pairs. That is strong — but it is not yet a *systematic* proof.

**Deliverable:** a repeatable correctness harness — run the known-connected collections (and any
other ground truth) through both the old and new paths, measure precision/recall/latency, and
gate: new ≥ old on confidence, new < old on latency. Until that harness exists and passes, treat
"similarity is proven" as *probable, not certain*.

---

## Read-only side-findings (closed this pass, for the record)

- **Zero-trade wallets are benign.** The 12,303 wallets without a vector: **10,805 (88%) are
  classified `SYSTEM`** (AMMs / LP / program / protocol addresses), 1,478 `unknown`
  (counterparty-only, never analyzed), 18 `normal`. `knownLabel` set on 10,859. They *correctly*
  have no behavior profile — you don't vectorize a Raydium pool. **Not a data-hygiene issue.**
  (Confirms the "coverage is not a gap" conclusion from a second angle.)
- **The vector has no money/magnitude axis by design** — no portfolio value, no trade-size, no
  PnL magnitude. So "is this a good trader, or is the PnL garbage for a measurable reason
  (inter-wallet transfers we can't track)" is a question the current vector *structurally cannot
  answer*. That is the honest boundary of "behavior" as encoded today — flag for the Priority-1
  judgement (do we want a bounded magnitude axis, or keep behavior pure and answer money
  questions from PnL tables separately?).

## Sequencing note
Priority 3 (similarity certainty) is the gate — it protects the original goal. Priorities 1 and 2
are the "make the map faithful" work that makes every catalog surface trustworthy. None of the
three is a build job; they are audits/harnesses. The catalog surfacing work (SURFACE-1 / AGENT_10)
can proceed in parallel *because* the known-connected validation already showed the engine is at
least as good as before for the fleet/coordination case it will surface first.
