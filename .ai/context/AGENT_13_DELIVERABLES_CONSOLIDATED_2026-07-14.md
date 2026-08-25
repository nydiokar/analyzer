# AGENT_13 — Consolidated Deliverables & Owner Review

**Date:** 2026-07-14 · **Author:** owner review pass over the two agent conversations
(`CAPITAL_EMBEDDING_LEVERAGE_2026-07-13.md` = the "so what", `ADVANCED_APPLICATIONS_2026-07-13.md`
= the "advanced" pass). Purpose: distill both into one unambiguous work order, separate **proven /
shippable** from **promising / must-gate**, and record the owner's agree/disagree so AGENT_13 does
not over-claim.

Read this together with the existing dispatch `.ai/dispatch/AGENT_13_BEHAVIOR_CAPITAL_TYPOLOGY.md`.
Where they conflict, **this doc's precision constraints win**; the dispatch's scope stands.

---

## 1. What is actually true (verified, use as foundation)
- Two separate vectors exist in schema: `WalletVector` (behavior, v2, 27-dim) and
  `WalletCapitalVector` (8-dim + dataQuality). Confirmed in `prisma/schema.prisma`.
- **Behavior does not determine success** (500 identical-label FAST_TRADER wallets = 47% profitable,
  −514…+1,509). This is the empirical justification for two vectors. SOLID — build on it.
- **Capital-kNN predicts outcome by analogy** at the tails (winner nbhd 100% profitable, loser 0%,
  pop baseline ~half) — but ONLY at `dataQuality > 0.9`. The gate is load-bearing, not optional.
- `WalletVectorHistory` accumulates (128k rows). `WalletCapitalVector` is a **snapshot with no
  history table**. Confirmed. This is a silent, compounding data loss (see §4).

## 2. Owner review — what to trust vs discount
| Claim in agent docs | Owner verdict |
|---|---|
| Scorer-first, then 2×2, then discovery | **AGREE.** Correct sequencing; ship proven value first. |
| dataQuality is a hard gate on every skilled verdict | **AGREE — non-negotiable.** Without it, "skilled" = a lie. |
| Behavior & capital are "two orthogonal lenses" | **DISCOUNT the word orthogonal.** Finding 4 shows behavior-kNN already 92% at the winner tail → they correlate at the tails. AGENT_13 MUST **measure the actual behavior↔capital correlation** and state it, not assume independence. |
| Mismatch-residual = "flagship discovery of hidden alpha wallets" | **PARTIALLY — demote to gated research probe.** −435…+426 on **40 wallets** is an anecdote, not validation. Could be measuring PnL corruption, not insight. Needs a forward-persistence test before it's a shipped signal. |
| "Nobody diffs two embeddings / genuinely novel" | **DROP the novelty claim.** Residual-between-models is standard (ensembles, quant). Anchor value on "it works on our data," not on being first. |
| Capital trajectory (F) is the deepest moat, deferred | **AGREE it's the moat; DISAGREE with fully deferring the data capture** (see §4). |
| Smart-money cohort feed (B) | **AGREE, deferred** — needs infra/stablecoin filter + per-token timestamps; own job. |

## 3. The work order for AGENT_13 (research-first, descriptive only)

### DELIVERABLE 1 — Combined-query capability (pipe + proof) — SHIP
The queries impossible before, proven DB-wide on :5434, exposed as a thin additive read helper:
- behavior-kNN (exists) · capital-kNN (new) · **behave-like-X-AND-capital-legit** (intersect / rank-fuse, dataQuality-gated).
- **Decide the combine method with evidence** — intersection vs rank-fusion vs behavior-first-then-capital-filter. Do NOT average two differently-scaled cosines (AGENT_7 boosting-not-averaging lesson).
- **Also report the behavior↔capital correlation** across the population — this settles the "orthogonal?" question and sizes how much the second vector actually adds.

### DELIVERABLE 2 — Calibrated outcome-by-analogy scorer — SHIP (do first)
For any wallet: "your capital-neighborhood is X% profitable, median PnL Y, dataQuality Z, n neighbors."
- Frame as a **calibrated expectation with a confidence interval + reason codes** (FICO transfer, candidate C), NOT a binary skilled/not label. Honest and defensible.
- Needs no typology. Prove it as a standalone scorer on :5434 first. This is the single most shippable artifact.

### DELIVERABLE 3 — The honest 2×2 typology — SHIP (backbone)
Replace the 9 arbitrary `strategyType` labels with a legible 2×2, dataQuality-gated:
- **skilled + repeatable** (high profitability + high consistency + high dq) → copy-trade / alert candidates.
- **skilled-but-lucky** (high profit, low consistency) → flag, don't trust.
- **active-but-unprofitable** (high magnitude, negative profit) → the majority; volume ≠ skill.
- **low-signal** (dust / low dq) → filter, never rank.
- Behavior vector then answers *what strategy* each quadrant runs → "good trader, and good at WHAT."
- Explicitly compare emergent regions vs the current 9 labels: which fracture into real finer types, which are noise, what NEW types appear. Clustering is a **descriptive lens, not a trained model.**

### DELIVERABLE 4 — Mismatch-residual finder — RESEARCH PROBE ONLY (gated)
Diff behavior-nbhd PnL vs capital-nbhd PnL per wallet. Report the axis, but **do not ship it as a
signal** until it passes:
- (a) forward-persistence: do high-positive-gap wallets keep outperforming their behavior-peers *after* the measurement window, or is it past variance?
- (b) separability from dataQuality noise: is the gap just untracked-transfer PnL inflation?
Deliver as a written probe with a live query + an honest "not yet forward-validated" label. If it
survives, it becomes its own build job.

### DELIVERABLE 5 — Judgment-framework sketch (research) — north star
Given a wallet's position in both spaces + dq, what can we honestly SAY (copy-worthy / coordinated /
real-edge-vs-lucky)? Tie to SPEC-002 §2.3 (outcome-by-analogy) and Act-3 (analyst-label moat) as the
FUTURE learned-metric direction. Keep THIS job descriptive — the label NO-GO (SPEC002_T03) stands.

## 4. Owner-added action, do NOT wait for a spec — START CAPITAL HISTORY CAPTURE
`WalletCapitalVector` has no history table. Every day without it is data we can never reconstruct,
and it's the exact input the moat feature (capital trajectory / drift-precedes-PnL) needs.
- **Cheap, additive, irreversible-if-skipped.** Add `WalletCapitalVectorHistory` (mirror
  `WalletVectorHistory`) and start snapshotting on the existing capital write-path — NOW, in parallel
  with AGENT_13, not gated behind the trajectory spec.
- This is separate from AGENT_13's descriptive scope; flag it as a tiny standalone build job.

## 5. Deferred (own specs — flag, do not smuggle into AGENT_13)
- **B. Smart-money live feed** from the capital-defined cohort (infra-filtered, timestamped). Most monetizable; needs its own job.
- **E. Coordination × capital** — condition materialized cluster rings on cluster capital-quality (known-profitable cluster co-buying = leading indicator).
- **F. Capital trajectory / drift-precedes-outcome** — the moat. Its own SPEC-002 Act-2 spec. (Data capture in §4 unblocks it early.)

## 6. Hard guards (carry all)
- GATED on AGENT_11 (GREEN) + AGENT_12 (DONE). Do not run on v1 vectors or ungated capital data.
- Descriptive statistics only. Clustering is a lens, not a shipped trained model. No metric learning.
- Every capital-based judgment carries `dataQuality`; never present transfer-distorted PnL as skill.
- Never label a cluster "same person" — "behavioral fingerprint" / "coordinated" only.
- Additive-only for BUILD; read-only for research.
- **Do not over-claim novelty.** Anchor every survivor on a live :5434 query, not on being first.
