# Advanced / Higher-Leverage Applications of the Two-Vector Substrate

**Date:** 2026-07-13 · **Method:** divergent (transfer from solved domains, no judging) → convergent
(pressure-test the top candidates on :5434). Two candidates already validated live (below). This is the
"what are the *advanced* applications, not the first obvious one" answer.

## On the method (so the next agent generates the same way, not narrower)
Creativity here = **combinatorial recombination at volume, then selection** (Boden; Guilford's
divergent→convergent). The specific high-yield moves used:
1. **Transfer** — steal the STRUCTURE of a solved problem from a distant domain (credit, recsys,
   epidemiology, sports EV, fraud), not the surface. Apply it to wallets.
2. **Transformational move** (Boden's third kind) — name the constraint everyone assumes, then break it.
   Ours: "a wallet is described by ONE vector." We broke it (behavior + capital). The next break is
   "…and both are static" → add time.
3. **Residual thinking** — the information is often in the DIFFERENCE between two models, not either one.
Rule: generate wide first, judge second. The failure mode is premature convergence (copy the first
dashboard we see). Ground every survivor in a live query before believing it.

## Locked / already-owned (EXCLUDE from "new") 
Outcome-by-analogy scorer, the skilled/lucky/active-unprofitable/low-signal 2×2, style→success mapping,
cohort coordination rings, drift on behavior. (See CAPITAL_EMBEDDING_LEVERAGE_2026-07-13.md.)

## The candidate set (7 transfers), ranked after convergence

### ★ VALIDATED — A. The behavior↔capital MISMATCH residual ("trades like the crowd, earns like a pro")
Transfer: fraud/anomaly detection = distance-to-normal. Move: the residual between a wallet's
**behavior-neighborhood PnL** and its **capital-neighborhood PnL** is itself a signal no single vector
shows. Live test (40 wallets, dq>0.9): the gap spans **−435 … +426** — a wide real axis.
- **High positive gap** = behavior-peers lose (avg −388) but capital-peers win (avg +597) → an
  informed/edge wallet hiding inside a common style. **This is a discovery signal for non-obvious alpha
  wallets** — the ones you'd never find by filtering on "looks like a pro."
- **High negative gap** = looks like a disciplined style, performs far worse (self −718) → an
  underperformer / tilting / soon-to-blow-up wallet. A **fade / risk signal.**
- Why it's advanced: nobody diffs two embeddings. It is cheap (we have both kNN paths), needs no new
  data, and surfaces wallets invisible to either lens alone. **Build next after AGENT_13's scorer.**

### ★ VALIDATED (with a refinement) — B. Smart-money live feed from a capital-DEFINED cohort
Transfer: recsys ("users like you are buying X"). Move: define the skilled+repeatable quadrant by
capital axes (not a hand-picked list), then surface what they concentrate in. Live test (800-wallet
skilled cohort): token enrichment vs population is **1.5× for infra (USDC/USDT/pump.fun mint = noise)
but 4–7.5× for the real tail** (specific mints where the skilled cohort is 4–7× over-represented).
- Refinement the data demands: **exclude stablecoins/infra, rank by enrichment not raw holders.** Then
  it's a genuine smart-money concentration signal.
- Why it's advanced + monetizable: the cohort is *derived* (behavior+capital), self-maintaining via the
  live write-path, and dataQuality-filtered — not a fragile curated list. With per-token timestamps this
  becomes a **live "smart money is accumulating T" feed** — the most sellable artifact in the program.

### Strong, not yet tested (worth a convergence pass before AGENT_13 finalizes)
- **C. Calibrated wallet credit score + reason codes** (transfer: FICO). Not "skilled/not" but "wallets
  in this capital region go on to profit P% ± CI," with the driving axes as reason codes. Turns the
  scorer from a label into a *calibrated probability* — the honest, defensible framing. Uses the
  outcome-by-analogy result we already proved (winner nbhd 100% / loser 0%).
- **D. Process-vs-outcome (poker EV).** Transfer: separate skill from variance. A high-consistency,
  high-realized-share wallet in a temporary drawdown = "buy the trader on the dip"; a lucky/inconsistent
  winner = fade. Anti-momentum ON TRADERS. We have consistency + realized-share axes to build it.
- **E. Coordination × capital (epidemiology index-case).** Transfer: R0/index case. Condition the
  materialized cluster rings on the cluster's *capital quality*: a KNOWN-PROFITABLE cluster starting to
  co-buy a token = leading indicator, distinct from a random-wallet cluster. Fuses our two owned assets
  (clusters + capital) — high-leverage, none built.

### The transformational move (bigger, its own spec) — F. Capital TRAJECTORY
We version behavior (`WalletVectorHistory`, 128k rows) but **snapshot capital (no history)**. Break that:
add `WalletCapitalVectorHistory`. Then the killer question: **does a DRIFT in a wallet's behavior vector
PRECEDE a change in its capital outcome?** i.e. detect a pro going cold (or a wallet leveling up) *before*
the PnL confirms it. This is the true Act-2 "several steps ahead" and the deepest moat; it's a new spec,
not an AGENT_13 sub-task. Flag it, don't smuggle it in.

## Recommendation for AGENT_13 (how to maximize impact)
Do NOT build a generic clustering typology. Build, in this order, because each is proven or one query
from proven:
1. **The calibrated outcome-by-analogy scorer (C)** — most shippable, already-proven core, no typology
   needed. Ship value first.
2. **The 2×2 typology** (locked) as the classification backbone, dataQuality-gated.
3. **The mismatch-residual finder (A)** as the flagship *discovery* feature — it is the most novel,
   validated, and cheap; it is what makes this "advanced," not "another dashboard."
Defer B (needs infra-filter + timestamps → own feed job), E and F (own specs). Everything descriptive —
the learned-metric NO-GO still stands.
