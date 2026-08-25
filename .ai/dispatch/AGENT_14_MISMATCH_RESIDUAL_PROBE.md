# AGENT 14 — The behavior↔capital MISMATCH residual (RESEARCH PROBE, forward-gated)

Lane: RESEARCH ONLY. **Filed 2026-07-14.** This is the "advanced / non-obvious" candidate from
`ADVANCED_APPLICATIONS_2026-07-13.md` (candidate A). It is the most novel idea in the program — and the
least validated. It is dispatched deliberately as a **probe with a validation gate**, NOT a shipped
signal. Do not surface it in any product until it clears §3.

**Anchor docs:**
1. `.ai/context/ADVANCED_APPLICATIONS_2026-07-13.md` §A (the candidate).
2. `.ai/context/AGENT_13_DELIVERABLES_CONSOLIDATED_2026-07-14.md` §2 (owner's demotion + why).
3. `.ai/context/CAPITAL_EMBEDDING_LEVERAGE_2026-07-13.md` (Findings 1–4, the kNN paths).

## 0. GATE
Runs AFTER AGENT_13's scorer + combined-query helper exist (it reuses both kNN paths). Read-only on :5434.

## 1. The idea (stated honestly)
Per wallet, diff two neighborhood-PnL estimates:
`gap = mean(capital-kNN neighbor PnL) − mean(behavior-kNN neighbor PnL)`.
- **High positive gap** = behavior-peers lose but capital-peers win → a candidate hidden-edge / informed
  wallet sitting in the winners' capital region while trading like a common (losing) style.
- **High negative gap** = looks like a disciplined style, performs far worse → a candidate fade / risk /
  soon-to-underperform wallet.
The pitch: surfaces wallets INVISIBLE to either lens alone, cheap (both paths exist), no new data.

## 2. The problem this probe must resolve BEFORE anyone believes it
The only evidence today is a **40-wallet** spread (−435…+426). That is an anecdote, not validation.
Two null hypotheses must be killed:
- **H0-noise:** the gap is just `dataQuality` corruption — untracked-transfer PnL inflation making a
  wallet's capital-neighborhood look rich. If so, the "edge" is an accounting artifact.
- **H0-variance:** the gap is past realized variance with no forward signal — a wallet that got lucky,
  not one with an edge.

## 3. VALIDATION GATE — the probe must run these, report pass/fail honestly
- **(a) dataQuality separability:** recompute the gap at strict dq>0.9 on BOTH neighborhoods and with
  low-dq neighbors excluded. Does the axis survive, or collapse to noise? If it only exists at low dq,
  it's H0-noise → KILL.
- **(b) forward-persistence:** this needs a forward window we may not have on the current copy. Define
  the test precisely (split each wallet's history at time T; compute gap on [.., T], measure whether
  high-positive-gap wallets out-earn their behavior-peers on (T, ..]). **If the current backfill lacks
  the window, WRITE IT DOWN as a deferred-validation item for the next backfill (operator confirmed a
  fresh backfill is coming) — do NOT fake it, do NOT ship on (a) alone.**
- **(c) base-rate honesty:** how many wallets even have BOTH neighborhoods well-populated at dq>0.9?
  If the population is tiny, the feature is a curiosity, not a product. Report the count.

## 4. Deliverable
`.ai/context/MISMATCH_RESIDUAL_PROBE_<date>.md`:
- The gap distribution DB-wide (not 40 wallets) at strict dq, with the base-rate count.
- Result of (a) dataQuality separability — survives or collapses.
- The precisely-defined (b) forward test + its result IF the data supports it, else a clear deferred item.
- Verdict: **GRADUATE** (→ its own build job as a discovery feature) / **DEFER** (needs next backfill) /
  **KILL** (it was H0-noise/variance). Recommend, with the numbers.

## 5. Hard guards
- Read-only. Descriptive. No metric learning. No product surface from this job.
- Do NOT claim novelty as evidence — "nobody diffs two embeddings" is not a reason to believe it; the
  data is. Anchor on the numbers.
- Every neighborhood carries dataQuality; a gap built on transfer-distorted PnL is not a signal.

## 6. Cost
Research-Small/Medium. Two kNN sweeps + honest stats. Its value is in the gate, not the pitch.
