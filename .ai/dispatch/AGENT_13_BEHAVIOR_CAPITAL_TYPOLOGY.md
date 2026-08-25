# AGENT 13 — Behavior × Capital: the shippable payoff (combined query + scorer + honest 2×2)

Lane: RESEARCH → thin BUILD. **Rewritten 2026-07-14** after the AGENT_11/12 live-validation pass.
This job is now scoped DOWN to only the proven, shippable spine. The exciting-but-unvalidated and the
new-substrate ideas were split out (AGENT_14 = residual probe; SPEC-003 = capital trajectory; AGENT_15 =
smart-money feed). Do NOT pull those back in — see §5.

**Anchor docs (read in order):**
1. `.ai/context/AGENT_13_DELIVERABLES_CONSOLIDATED_2026-07-14.md` — the owner review; **its precision
   constraints override anything softer here.**
2. `.ai/context/CAPITAL_EMBEDDING_LEVERAGE_2026-07-13.md` — the four live findings this job spends.
3. `.ai/CONTEXT.md`, `.ai/dispatch/DISPATCH_LOG.md`.
4. `.ai/context/BEHAVIORAL_AXIS_MAP_2026-07-12.md` (behavior axes) + `CAPITAL_METRICS_AUDIT_2026-07-13.md`
   (capital axes + dataQuality field).
5. `documentation/specs/SPEC-002-...md` §2.3 (outcome-by-analogy — anchor there, do not reinvent).
6. `src/core/services/database-service.ts` similarity read helpers (behavior + `findSimilarCapitalVectors`).

## 0. GATE — both upstream landed
AGENT_11 (capital embedding) = DONE + GREEN. AGENT_12 (behavior vector v2) = DONE + validated. Cleared.

## 0b. Data note (operator, 2026-07-14)
The :5434 pg17 copy is the real production data; the server is live and still gathering. Embeddings were
built + are being tested here **now**; a fresh backfill happens later. So: **any claim that needs more
data or a forward window than we have today is not a failure — WRITE IT DOWN as a deferred-validation
item** (see §4) so the next agent proves it on the next backfill. Do not fake-validate to look finished.

## 0c. Target DB
`analyzer-postgres-pg17` (:5434). Read-only for research; any BUILD output is additive.

## 1. Task — three shippable deliverables

### DELIVERABLE 1 — Combined-query capability (the query the operator named)
Prove + expose, DB-wide over 64k wallets, as a thin additive read helper + proof script on :5434:
- behavior-kNN (exists) · capital-kNN (`findSimilarCapitalVectors`, new) ·
  **"behave like X AND capital-legit / makes money"** (dataQuality-gated).
- **Decide the combine method with evidence** — intersection of kNN sets vs rank-fusion vs
  behavior-first-then-capital-filter. Recommend ONE. Do NOT average two differently-scaled cosines
  (AGENT_7 boosting-not-averaging lesson).
- **MANDATORY measurement — settle "orthogonal?":** compute the population-level relationship between
  behavior-neighborhood and capital-neighborhood (correlation of the two kNN rankings / PnL agreement).
  Finding 4 already shows behavior-kNN is 92% profitable at the winner tail → the two are NOT cleanly
  independent. State the real number. It sizes how much the second vector actually adds; the whole
  two-vector value rides on this not being ~1.0.

### DELIVERABLE 2 — Calibrated outcome-by-analogy scorer (build FIRST; most shippable)
For any wallet: "your capital-neighborhood is X% profitable, median PnL Y, n neighbors, dataQuality Z."
- Frame as a **calibrated expectation + confidence interval + reason codes** (which capital axes drive
  it), NOT a binary skilled/not label. Honest and defensible (FICO-style framing).
- Needs no typology. Prove as a standalone scorer on :5434 first. This is the single most shippable
  artifact from the whole AGENT_11 line.
- **dataQuality is a hard gate** — Finding 1's 100%/0% split only holds at dq>0.9. Every score carries
  and filters on it. A transfer-corrupted "winner" must be discounted, not ranked.

### DELIVERABLE 3 — The honest 2×2 typology (the classification backbone)
Replace the 9 arbitrary `strategyType` labels with a legible, dataQuality-gated 2×2:
- **skilled + repeatable** (high profitability + high consistency + high dq) → copy-trade / alert.
- **skilled-but-lucky** (high profit, LOW consistency) → flag, don't trust.
- **active-but-unprofitable** (high magnitude, negative profit) → the majority; volume ≠ skill.
- **low-signal** (dust / low dq) → filter, never rank.
- Behavior vector then answers *what strategy* each quadrant runs → "good trader, and good at WHAT."
- Compare emergent regions vs the current 9 labels: which fracture into real finer types, which are
  noise, what NEW types appear. **Clustering is a DESCRIPTIVE LENS, not a trained/shipped model.**
- The per-type axis profile must be legible ("fast distributors in nano-caps on a US clock, low win-rate")
  and NOT just a restatement of `strategyType`.

## 2. Deliverable file
`.ai/context/BEHAVIOR_CAPITAL_TYPOLOGY_<date>.md`:
- D1: the combined queries defined + proven on :5434 (+ thin additive read helper/script) + the
  measured behavior↔capital relationship number.
- D2: the calibrated scorer, proven, with CI + reason-code framing.
- D3: the 2×2 with per-type axis profiles, sizes, legibility, vs current strategyType.
- A recommendation on what becomes a real product surface vs what stays research.
- **A "deferred validation" section** listing anything that needs the next backfill / a forward window
  to prove (feed it forward — the next agent picks it up).

## 3. Hard guards (all carry)
- Descriptive statistics only. Clustering is a LENS, not a shipped trained model. No metric learning
  (that's SPEC-002 Act 3, still label-NO-GO per SPEC002_T03).
- Every capital judgment carries `dataQuality`; never present transfer-distorted PnL as skill.
- Never label a cluster "same person" — "behavioral fingerprint" / "coordinated" only.
- **Do NOT over-claim novelty.** Anchor every survivor on a live :5434 query, not on being first.
- Additive-only for BUILD; read-only for research.
- **Stay in scope.** The mismatch residual = AGENT_14. Capital trajectory = SPEC-003. Smart-money feed
  = AGENT_15. If you find yourself building any of those, STOP and note it forward instead.

## 4. Cost
Research-Medium. Heavy lifting (two honest vectors) is done. This is analysis + a thin combined-query
surface + a scorer. This is where the program stops being "front-end stats" and becomes real DB-wide
wallet research.
