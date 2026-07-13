# What the Capital Embedding Actually Bought Us — live validation + the AGENT_13 setup

**Date:** 2026-07-13 · all numbers are live `psql` / `findSimilar*` runs on :5434.
Purpose: before AGENT_13 (typology), answer "so what?" — prove what the two vectors mean in
*trading* terms, and pick where the value is.

## Step back: what are these two vectors, really?
- **Behavior vector (`WalletVector`, v2, 27-dim)** answers **HOW a wallet trades** — tempo, hold-time,
  sell-skew, session rhythm, mcap positioning, conviction. It is outcome-blind by design.
- **Capital vector (`WalletCapitalVector`, 8-dim + dataQuality)** answers **WHETHER the trading pays** —
  magnitude, realized profitability, efficiency, win-rate, consistency, liquidity, realized-share.
- The whole bet of the representation program is that these are **different questions**. This doc tests
  whether that bet is real, on data.

## Finding 1 — capital-similarity predicts OUTCOME by analogy (strong)
Take a wallet, pull its 30 capital-nearest-neighbors, look at their realized PnL:
| Seed | neighbor avg PnL | neighbor median | % profitable |
|---|---:|---:|---:|
| WINNER (+4,524) | **+1,292** | +847 | **100%** |
| LOSER (−2,282) | **−821** | −342 | **0%** |
| population baseline (vol>100) | −5 | — | ~half |

**Your capital-neighbors share your fate.** 100% vs 0% profitable is not noise. This is
outcome-prediction-by-analogy (the SPEC-002 Act-2 thesis) made real: given a fresh wallet, its capital
neighborhood is a same-population estimate of its likely PnL destiny — with a `dataQuality` on every
neighbor so a transfer-corrupted "winner" can be discounted.

## Finding 2 — behavior does NOT determine success (the orthogonality that justifies two vectors)
500 wallets with the **identical behavior label** (FAST_TRADER, good data quality, vol 100–5000):
- **47% profitable**, avg PnL +7, spread **−514 … +1,509**.
- i.e. "you trade fast" tells you *nothing* about whether you make money. Behavior = the strategy;
  it is not the P&L. **This is exactly why the capital vector had to be a separate embedding, not a dim
  inside the behavior vector.** If we had merged money into `WalletVector` (the tempting shortcut), we
  would have blurred "how" with "whether" and answered neither.

## Finding 3 — capital isolates the WINNING variant *within* a behavior class
Capital-neighbors of a winning FAST_TRADER (+1,509): 24 FAST_TRADER (avg +296) + 6 DAY_TRADER (+155).
Behaviorally coherent AND profitable. So the capital vector doesn't just re-rank by money — it finds
the **"same style, but it works"** sub-cohort. That sub-cohort is a product: *the profitable expression
of a strategy.*

## Finding 4 — the query that was IMPOSSIBLE before is now answerable
"Find wallets like this proven winner, behaviorally AND in capital outcome." Seed = the +4,524 winner:
| neighborhood | n | % profitable | avg PnL |
|---|---:|---:|---:|
| behavior-kNN only | 60 | 92% | +202 |
| capital-kNN only | 60 | **100%** | **+844** |
| **intersection (both)** | 12 | **100%** | +488 |
- Honest nuance: behavior-kNN is already 92% here — a *disciplined* style is itself outcome-correlated,
  so behavior is not purely outcome-blind at the tails. But capital-kNN is the tightest winner-finder,
  and the **intersection is the highest-precision "twins of this winner"** set (fewer, surer).

## So what — where the value is (and what AGENT_13 should maximize)
The two vectors give three distinct, now-provable capabilities. AGENT_13 should build the typology so it
*uses all three*, not just cluster-for-clustering's-sake:

1. **Outcome-by-analogy scoring.** For any wallet: "your capital-neighborhood is X% profitable, median
   PnL Y, dataQuality Z" — a same-population, non-ML, evidence-carrying expectation. This is the single
   most shippable product from AGENT_11 and it needs no typology at all. (Prove it as a scorer first.)
2. **The 2×2 that classifies traders honestly** — the typology's real backbone, not 9 arbitrary
   strategyType labels:
   - **skilled + repeatable** (high capital profitability + high consistency + high dataQuality) =
     the wallets worth copy-trading / alerting on.
   - **skilled-but-lucky** (high profit, LOW consistency) = one-hit wallets; flag, don't trust.
   - **active-but-unprofitable** (high magnitude, negative profit) = volume ≠ skill; the majority.
   - **low-signal** (dust volume / low dataQuality) = un-judgeable; must be filtered, never ranked.
   Behavior vector then says *what strategy* each quadrant runs. That is a typology with a "so what"
   baked in: it answers "is this a good trader, and good at WHAT."
3. **Style→success mapping (DB-wide research).** For each behavior cluster, measure the capital-outcome
   distribution → "which trading styles actually pay, and how consistently." That is the first honest,
   data-backed answer to *"what works in this market"* — a research artifact and a marketing asset.

## Guardrails AGENT_13 inherits from this validation
- **Always carry `dataQuality`.** Finding 1's 100%/0% only holds at dq>0.9; low-dq wallets are noise
  and must be excluded from any "skilled" verdict (untracked transfers / paper gains / dust).
- **Descriptive only** — this is analogy + distribution, NOT a trained skill model. The label NO-GO
  (SPEC002_T03) still stands; do not fit a "will-profit" classifier on these.
- **Precision vs recall is a product choice:** capital-kNN = recall (more candidate winners),
  intersection = precision (surer twins). AGENT_13 should expose both, labeled.
