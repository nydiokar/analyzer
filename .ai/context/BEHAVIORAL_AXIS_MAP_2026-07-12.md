# Behavioral-Axis Map — what the vector should encode, and why

**Date:** 2026-07-12
**Type:** read-only research artifact + ground-truth map. No vector code / migration / materializer
touched. Every quantitative claim is reproducible with a single `psql` read against :5434.
**Relationship to prior docs:** this is the **design layer** on top of the fidelity audit
(`METRICS_VECTOR_AUDIT_2026-07-12.md`). The audit answered *"is the current 32-dim vector faithful?"*
(answer: partly — 6 dead dims, a lopsided geometry, redundancy). **This doc answers the bigger
question:** *given every metric we store or compute, which ones carry an **independent behavioral
axis** and therefore earn a place in a DB-wide behavioral coordinate system — and which merely restate
an axis we already have?* It is organized by **behavioral axis**, not by dim number, because the goal
is a faithful multi-axis map of behavior, not a defense of the current dim list.

**The governing rule (compaction, not expansion):** a metric earns a dim **iff** it adds a behavioral
distinction the vector cannot already make. Restating an existing axis (however well-named) is noise.
The win is *more behavioral resolution from fewer honest dims*, not a bigger vector.

**The scope boundary (deliberate, overrulable):** this vector answers **"how does this wallet
behave."** It does **not** encode portfolio magnitude / money / PnL size — those are answered from PnL
tables per-query. The single exception under consideration is one *bounded* holding-conviction signal
(see Axis 5), because the absence of *any* magnitude signal is what makes PURE_HOLDER and LOW_ACTIVITY
indistinguishable. This boundary is what stops the surface from drifting "to the end of the world."
It is stated so it can be overruled on purpose, not by accident.

---

## Part 0 — Method: how a metric is judged (the researcher's test, not coverage arithmetic)

For each candidate metric, four questions in order. A metric must pass all four to earn a dim.

1. **Is it populated?** (else it's a bug or dead weight — e.g. the mcap key-drift, `MCAP-VEC-BUG`.)
2. **Does it restate an existing dim?** Measured by correlation *and* by whether it changes any
   real classification. Correlation alone is not disqualifying — the question is whether the residual
   carries behavior. (A 0.67 correlation can still hide a decisive distinction; a 1.00 correlation
   cannot.)
3. **What behavioral trait does it name, and is that trait anchored in how traders actually behave —
   or is it an artifact of our data/pipeline?** (e.g. `percentOfValueInCurrentHoldings` reads low for
   churners *because* they churn — a symptom re-encoding an existing axis, not a new trait.)
4. **Does it resolve a confusion the current vector demonstrably has?** The strongest evidence a
   metric earns its place: it separates two `strategyType`s the current geometry conflates.

"52% correlation, drop it" is banned. "52% correlation → the residual 48% separates DISTRIBUTOR from
FAST_TRADER, which the current vector confuses 53% of the time, and distributors sell more than they
buy *by definition* so this is anchored, not an artifact → keep as a bounded dim" is the standard.

---

## Part 1 — The behavioral axes (the map)

Each axis = an independent dimension of *how a wallet behaves*. For each: what it means, which stored/
computed metrics carry it, what the current vector does, and the verdict. Dim numbers refer to the
current 32-dim source vector (`buildWalletSourceVector`).

### Axis 1 — Trading SPEED (how fast a position turns over)
- **Metrics:** `percentTradesUnder1Hour` (dim8), `percentTradesUnder4Hours` (dim9), `medianHoldTime`
  (dim3, flip-based), `averageFlipDurationHours` (dim4), `flipperScore` (dim2), `velocityScore`
  (dim20), and dim32 (`dim8 × flipper`).
- **Current state:** **massively over-represented — ~7 dims for ~1.5 real axes.** dim8↔dim32 r=0.98,
  dim8↔dim9 r=0.94, dim2(`flipperScore`)↔dim8 r=0.895 (flipperScore is a *repackaging* of %<1h, not a
  hold-time measure — r=−0.07 with actual `medianHoldTime`), dim20↔dim3 r=−0.87.
- **Verdict:** **collapse to 2 honest dims.** Keep dim8 (fast fraction) + dim3 (median flip hold — the
  granular, continuous speed measure). **Drop** dim32, dim9, dim2, dim20 as redundant restatements.
  This is the largest single source of the lopsided geometry: the speed axis, over-weighted ~4×,
  dominates cosine distance and drowns every other axis (Part 2 of the audit).

### Axis 2 — HOLD posture: OPEN positions (conviction on live bags) — *distinct from Axis 3*
- **Metrics:** `medianActiveHoldingHours` (dim30), `averageCurrentHoldingDurationHours`,
  `medianCurrentHoldingDurationHours`, `percentOfValueInCurrentHoldings` (dim24).
- **Evidence they're one axis:** `medianCurrentHoldingDurationHours` ↔ `medianActiveHoldingHours`
  **r=1.000**; `averageCurrentHoldingDurationHours` ↔ dim30 **r=0.945**. The "current-holding" family
  is the **same metric under different names** — dim30 already carries it.
- **Verdict:** **keep dim30, add nothing here.** The three `*CurrentHolding*` variants are pure
  redundancy with dim30. `percentOfValueInCurrentHoldings` (dim24) is *related but partly a symptom*
  (churners read low because they churn) — keep it but do not treat as an independent conviction axis
  (see Axis 5 for the real conviction signal).

### Axis 3 — HOLD posture: CLOSED round-trips (exit tempo) — **MISSING, orthogonal to Axis 2**
- **Metric:** `medianCompletedHoldTimeHours` (FE-*primary* hold time; **not vectorized**).
- **Evidence it's a separate universe:** vs dim30 (`medianActiveHoldingHours`) **r=0.109**. Different
  token sets by construction — open positions vs closed round-trips. 6,358 wallets have only the open
  signal, 3,946 only the closed signal; neither substitutes for the other.
- **Why it matters behaviorally:** Axis 2 says *"how long is this wallet sitting on its live bags?"*
  (present conviction). Axis 3 says *"when this wallet exits, how long did it hold?"* (historical exit
  tempo). A wallet can hold live bags forever yet flip its closed trades fast, or vice-versa — these
  describe genuinely different traders.
- **Verdict:** **ADD `medianCompletedHoldTimeHours` as a new dim** (log1p, like dim30). Highest-value
  hold-axis gap. (This corrects the fidelity audit's earlier "replace dim30" call, which would have
  deleted Axis 2 to buy Axis 3 — a category error.)

### Axis 4 — DIRECTIONAL FLOW: buy-side vs sell-side skew — **the accumulation/distribution axis**
- **Metrics present:** `tokensWithOnlyBuys` (dim29, accumulation side), `buySellRatio` (dim6),
  `buySellSymmetry` (dim1), `tokensWithBothBuyAndSell` (dim21). Sell-side skew derivable from stored
  `totalSellCount`/`totalBuyCount` as `sellSkew = sells/(buys+sells)`.
- **The gap:** the vector encodes the **accumulation** side (dim29 = only-buys) but **not the
  distribution** side. `tokensWithOnlySells` is **computed by the analyzer but NOT stored** (absent
  from the schema) — so the sell-skew signal never reaches the vector.
- **The evidence this is THE fix for the worst confusion** (DISTRIBUTOR→53% land in FAST_TRADER):
  per-type means of `sellSkew` vs the existing flow dims —

  | strategyType | **sellSkew** (new) | onlyBuys d29 | buySellRatio d6 | symmetry d1 |
  |:--|--:|--:|--:|--:|
  | DISTRIBUTOR | **0.746** | 0.047 | 0.353 | 0.631 |
  | FAST_TRADER | **0.472** | 0.035 | 1.169 | 0.814 |
  | ACCUMULATOR | 0.250 | 0.152 | 4.138 | 0.632 |
  | PURE_HOLDER | 0.000 | 1.000 | 0.000 | 0.000 |

  `sellSkew` cleanly separates DISTRIBUTOR (0.75) from FAST_TRADER (0.47) — a 0.27 gap — exactly where
  dim29 (0.047 vs 0.035, indistinguishable) and dim1 (wrong direction) **fail**. `buySellRatio` (dim6)
  *also* separates them (0.35 vs 1.17), but dim6 is clamp(0,10)/10 and, per the audit, saturated and
  drowned by the speed bloc.
- **Anchoring check:** distributors sell more than they buy *by definition* — this is not a data
  artifact, it is the trait. Passes.
- **Verdict:** **ADD a bounded `sellSkew` dim** (`sells/(buys+sells)`, naturally [0,1]). It completes
  the accumulate↔distribute axis that dim29 only half-encodes, and it is the single most direct fix
  for the DISTRIBUTOR blindness. Re-weight dim6 down or fold it into sellSkew (they share intent).

### Axis 5 — HOLDING CONVICTION / magnitude — **MISSING; the PURE_HOLDER vs LOW_ACTIVITY fix**
- **The confusion:** PURE_HOLDER neighbors land **72% in LOW_ACTIVITY**. Both look like low-flip,
  low-session wallets. The separating fact — *does this wallet hold a real, valued position, or does
  it hold nothing?* — is a **magnitude** question, and the vector has **no magnitude signal at all**
  (only dim5 winRate, a rate). PURE_HOLDER's distinguishing dims (onlyBuys=1.0, pctInHoldings=1.0)
  are extreme but outnumbered by the speed bloc.
- **The tension:** adding raw portfolio value violates the pure-behavior boundary and invites the
  untracked-transfer distortion (money-magnitude is exactly where inter-wallet flow we can't see
  corrupts the signal).
- **Verdict — recommend, don't decide:** add **one bounded holding-conviction dim** — the *minimum*
  magnitude signal that breaks the holder/inactive tie without turning the vector into a
  portfolio-value embedding. Candidate encodings (all clamped/bounded): a normalized "value locked in
  open holdings vs total flow" ratio, or a bounded transform of `percentOfCurrentPortfolioValue`. This
  is the one place I recommend crossing the pure-behavior line, deliberately and minimally. Owner
  rules; I recommend "yes, one bounded dim."

### Axis 6 — SCHEDULE / timing (WHEN, not how) — **MISSING; fully orthogonal, cheap**
- **Metric:** `averageSessionStartHour` (populated on all 64,378; **not vectorized**).
- **Evidence it's a free, independent axis:** correlation with every trading-style dim is **|r| < 0.04**
  (vs fast 0.017, vs hold 0.001, vs buySellRatio −0.013, vs sessionCount 0.032); stddev 6.19 hours.
  Genuinely orthogonal — it shares *no* variance with any existing axis.
- **Why it matters:** a US-hours human and a 24/7 bot with identical trade stats are **identical** to
  the current vector. Schedule is a first-order behavioral/operational signal (timezone, bot cadence,
  coordination — fleets often share a clock).
- **Encoding caveat:** must be **circular** — `(sin(2π·h/24), cos(2π·h/24))`, a 2-dim pair — because
  hour 23 ≈ hour 0. A raw scalar would put midnight-traders maximally far from 1am-traders.
- **Verdict:** **ADD as a sin/cos pair.** Highest signal-per-dim of any candidate: zero redundancy,
  free (already computed), and opens an operational axis (bot/coordination) the vector can't touch.

### Axis 7 — MARKET-CAP POSITIONING (what size tokens they trade) — **DEAD via bug, recoverable**
- **Metrics:** `mcapDistribution` (dims 16-19,25,26 — **DEAD**, key-drift bug `MCAP-VEC-BUG`),
  `dominantEntryMcapBucketShare` (dim27, populated), `avgEntryMcap` (dim28, populated),
  `entryMcapDistributionByCount` (populated, **not vectorized**), `typicalEntryMcapUsd`,
  `entryMcapP25/P75Usd` (spread, not vectorized).
- **Current state:** the *intended* mcap-shape axis is 99.95% zeros (reads legacy keys `nano/micro/…`;
  DB stores `0-10k…1m+`). The vector has only a weak mcap toe-hold via dims 27/28.
- **Why it matters:** nano-cap-degen vs large-cap-rotator is a first-order behavioral difference the
  vector currently cannot see.
- **Verdict:** **FIX the bug, then keep a compacted mcap axis.** Either remap the real dollar-range
  keys or vectorize `entryMcapDistributionByCount` (already populated). Six raw bucket dims is too many
  (they'll correlate); recommend a **compacted 2-3 dim** mcap summary (e.g. weighted-median mcap +
  spread, or low/mid/high concentration) rather than one dim per bucket. Add `entryMcapP25/P75` spread
  only if it survives the redundancy test against the concentration summary.

### Axis 8 — ACTIVITY BREADTH / cadence (how much surface area, over what span)
- **Metrics:** `sessionCount` (dim11), `avgTradesPerSession` (dim12), `uniqueTokensTraded` (dim13),
  `averageTradesPerToken` (dim15), `averageSessionDurationMinutes` (dim23), `activeTradingDays`
  (dim31), `reentryRate` (dim10), `percentageOfUnpairedTokens` (dim22).
- **Current state:** broadly healthy — these carry real, mostly-independent activity signal (dim11↔dim13
  r=0.73 is the only notable overlap, and breadth-of-tokens vs number-of-sessions are defensibly
  distinct). This axis is a soft *activity-magnitude* proxy (more sessions/tokens/days = more active)
  without crossing into money-magnitude — the acceptable kind of magnitude.
- **Verdict:** **keep as-is.** No additions, no drops. This is the part of the current vector that
  works.

### Axis 9 — SEQUENCE / COMPLETION discipline (orderly round-trips vs ragged)
- **Metrics:** `sequenceConsistency` (dim7), `completePairsCount`-ratio (dim14), `buySellSymmetry`
  (dim1), `percentageOfUnpairedTokens` (dim22).
- **Current state:** dim7↔dim14 **r=0.93** — near-duplicate. Both measure "does this wallet close what
  it opens, in order."
- **Verdict:** **keep ONE of dim7/dim14, drop the other.** Keep dim1 (symmetry) and dim22 (unpaired) —
  they carry related-but-distinct completion signal (symmetry = per-token balance; unpaired = fraction
  of dangling positions).

### Axis 10 — OUTCOME (win rate) — the one PnL-ish signal, kept as a rate not a magnitude
- **Metric:** `advancedStats.tokenWinRatePercent` (dim5).
- **Verdict:** **keep.** It's the only performance signal and it's a *rate* (bounded, behavior-adjacent)
  — it does not violate the money boundary. Do NOT add PnL *magnitude* here (see Part 3).

---

## Part 2 — The compaction ledger (every candidate → verdict, one line each)

**Currently vectorized (32 dims) → action:**

| Dim | Metric | Axis | Action |
|:--:|:--|:--|:--|
| 1 | buySellSymmetry | 9 | keep |
| 2 | flipperScore | 1 | **DROP** (repackaged %<1h, r=0.895 w/ dim8) |
| 3 | medianHoldTime | 1 | keep (granular speed) |
| 4 | averageFlipDurationHours | 1 | keep-or-merge w/ dim3 (r=0.78) |
| 5 | tokenWinRatePercent | 10 | keep |
| 6 | buySellRatio | 4 | re-weight down / fold into sellSkew |
| 7 | sequenceConsistency | 9 | **DROP one of {7,14}** (r=0.93) |
| 8 | percentTradesUnder1Hour | 1 | keep (canonical speed) |
| 9 | percentTradesUnder4Hours | 1 | **DROP** (r=0.94 w/ dim8) |
| 10 | reentryRate | 8 | keep |
| 11 | sessionCount | 8 | keep |
| 12 | avgTradesPerSession | 8 | keep |
| 13 | uniqueTokensTraded | 8 | keep |
| 14 | completePairsRatio | 9 | keep (drop dim7 instead) |
| 15 | averageTradesPerToken | 8 | keep |
| 16-19 | mcapDistribution nano/micro/small/mid | 7 | **DEAD — fix bug + compact to Axis-7 summary** |
| 20 | velocityScore | 1 | **DROP** (r=−0.87 w/ dim3) |
| 21 | bothBuySell ratio | 4 | keep |
| 22 | percentageOfUnpairedTokens | 9 | keep |
| 23 | averageSessionDurationMinutes | 8 | keep |
| 24 | percentOfValueInCurrentHoldings | 2/5 | keep (symptom-aware; not the conviction axis) |
| 25-26 | mcapDistribution ultra-micro/large+mega | 7 | **DEAD — same as 16-19** |
| 27 | dominantEntryMcapBucketShare | 7 | keep (populated mcap toe-hold) |
| 28 | avgEntryMcap | 7 | keep (populated) |
| 29 | tokensWithOnlyBuys ratio | 4 | keep (accumulation half of Axis 4) |
| 30 | medianActiveHoldingHours | 2 | keep (open-position conviction) |
| 31 | activeTradingDays | 8 | keep |
| 32 | %<1h × flipper | 1 | **DROP** (r=0.98 w/ dim8) |

**NOT vectorized → verdict:**

| Metric | Populated? | Restates existing? | Verdict |
|:--|:--|:--|:--|
| `medianCompletedHoldTimeHours` | 88% | No (r=0.11 w/ dim30) | **ADD** — Axis 3, orthogonal exit tempo |
| `sellSkew` (from totalSell/totalBuy) | 100% | Partial (max\|r\|0.67) but separates DISTRIBUTOR | **ADD** — Axis 4, bounded |
| `averageSessionStartHour` | 100% | No (\|r\|<0.04, orthogonal) | **ADD** (sin/cos pair) — Axis 6 |
| holding-conviction magnitude | derivable | No magnitude signal exists | **ADD one bounded dim** — Axis 5 (recommend) |
| `entryMcapDistributionByCount` | ~76% | Replaces dead dims 16-19 | **USE to fix Axis 7** |
| `entryMcapP25/P75Usd` (spread) | 76% | Test vs Axis-7 summary | conditional add |
| `averageCurrentHoldingDurationHours` | 100% | **Yes** (r=0.945 w/ dim30) | **drop candidate** — redundant |
| `medianCurrentHoldingDurationHours` | 100% | **Yes** (r=1.000 w/ dim30) | **drop candidate** — identical |
| `percentOfCurrentPortfolioValue` | 100% | Partial (holdings family) | only if Axis-5 encoding needs it |
| `tradingFrequency.*` (json) | — | Yes (∝ sessions/days) | exclude |
| `activeTradingPeriods` (json) | — | Partial (start-hour extracted) | exclude (use start-hour only) |
| `confidenceScore` | 100% | N/A — certainty, not behavior | **use as similarity WEIGHT, not a dim** |
| `strategyType`/`speedCategory`/`flowPattern`/`exitPattern` | — | derived labels | keep as labels; do NOT feed derived labels back as dims |
| `tokenPreferences`/`holdTimeTokenMap` | — | token identities, not behavior | exclude |

**Derived labels are outputs, not inputs.** `strategyType` et al. are *interpretations* of the axes;
feeding them back in as dims would be circular and would bake today's crude 2-axis typology into the
geometry we're trying to enrich. They stay as the thing we *test purity against*, never as dims.

---

## Part 3 — The scope boundary, stated so it can be overruled

**IN scope (behavior):** speed, hold posture (open + closed), directional flow (accumulate/distribute),
schedule, mcap positioning, activity breadth, sequence discipline, win-rate (as a rate). One bounded
holding-conviction dim as the single deliberate magnitude exception.

**OUT of scope (magnitude/money), by design:**
- Portfolio value, trade-size SOL, realized/unrealized PnL magnitude, capital deployed. These live in
  `WalletPnlSummary` / `AdvancedTradeStats` / `mcapBucketPnl` and are answered **per-query from those
  tables**, not embedded in the behavioral coordinate system.
- **Why the line is here:** (1) the thesis is *judge by what a wallet does, not who it is / how rich
  it is*; (2) money-magnitude is exactly where the untracked inter-wallet-transfer distortion corrupts
  the signal — a wallet funded by a sibling shows PnL that isn't its own behavior; (3) magnitude has
  unbounded scale that would dominate cosine geometry and re-create the speed-bloc problem in money
  units; (4) it is the boundary that keeps this a *behavioral* map instead of drifting into a
  full-portfolio embedding "until the end of the world."
- **The one crack:** Axis 5, one *bounded* conviction signal, because *zero* magnitude signal makes
  holder/inactive inseparable. Bounded = clamped/normalized so no whale dominates.

**If the owner wants money in the vector:** that is a separate, deliberate decision to build a *second*
embedding (a "capital/outcome" vector) that can be combined with the behavioral one at query time —
not to pollute the behavioral axis. Recommended, if pursued, as its own spec — not this pass.

---

## Part 4 — What this buys us (the point)

Today the vector resolves ~2 crude axes (speed × hold) plus a token-overlap signal, which is why the
typology collapses to fast/slow × holder/trader and why "similar" means "similar speed" or "shared
tokens" — never a genuine behavioral likeness. The map above turns that into **~10 independent
behavioral axes** carried by **fewer, honest dims** (drop ~6 redundant speed/sequence dims, fix 6 dead
mcap dims, add ~5 for the missing axes: closed-hold, sell-skew, schedule×2, conviction). Net dim count
stays in the same order of magnitude while behavioral *resolution* roughly triples — and every dim can
be defended by a behavioral trait, a redundancy check, and (for the additions) a specific confusion it
resolves.

That is the input a real typology needs. **This doc deliberately stops here** — it maps the axes; it
does not draw the typology. The next step (separate, when commissioned) is to see what natural
behavioral groupings emerge once the vector actually spans these axes, and only then ask "is this a
good trader, what is this trader for" — from behavior onward.

---

## Reproduce
All correlations/means above are single `psql` reads against :5434 (`sova_analyzer`). Representative:
```sql
-- Axis 3 orthogonality
SELECT round(corr("medianActiveHoldingHours","medianCompletedHoldTimeHours")::numeric,3) FROM "WalletBehaviorProfile";        -- 0.109
-- Axis 4 sell-skew separates DISTRIBUTOR from FAST_TRADER
SELECT "strategyType", round(avg("totalSellCount"::float/NULLIF("totalBuyCount"+"totalSellCount",0))::numeric,3)
FROM "WalletBehaviorProfile" WHERE "strategyType" IN ('DISTRIBUTOR','FAST_TRADER') GROUP BY 1;                                  -- 0.746 vs 0.472
-- Axis 2 redundancy (current-holding family = dim30)
SELECT round(corr("medianCurrentHoldingDurationHours","medianActiveHoldingHours")::numeric,3) FROM "WalletBehaviorProfile";    -- 1.000
-- Axis 6 orthogonality
SELECT round(corr("averageSessionStartHour","percentTradesUnder1Hour")::numeric,3) FROM "WalletBehaviorProfile" WHERE "averageSessionStartHour" IS NOT NULL; -- 0.017
```
No vector code, migration, or materializer was touched. `sellSkew` and the schedule encoding are
**recommendations**, not applied changes.
