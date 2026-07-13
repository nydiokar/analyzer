# AGENT 13 — Behavior × Capital: from two embeddings to an honest typology

Lane: RESEARCH (→ thin BUILD). This is the payoff job. It ties together the two vectors — the rebuilt
**behavior** vector (AGENT_12) and the new **capital/outcome** vector (AGENT_11) — into the capability
the whole representation program was aiming at: **DB-wide, honest, multi-axis wallet research**, and the
first principled **behavioral typology** derived from data rather than the two crude hand-labels
(speed × hold) we have today.

**This partially realizes existing foresight, not a new invention.** SPEC-002 §2.3 ("outcome prediction
by analogy") already anticipated joining outcomes to the vector space via k-NN. This job generalizes
that: not just "predict PnL from neighbors," but "define who a wallet IS across behavior AND capital,
and what natural types emerge." Anchor the framing there; do not reinvent §2.3.

## 0. GATE — do not start until both upstream land
- AGENT_12 (behavior vector v2) = DONE + validated (blind-type purity improved, known-connected preserved).
- AGENT_11 (capital embedding) = DONE + gated GREEN (or its Part-A audit explicitly says money is too
  impure to vectorize — in which case this job proceeds behavior-only and says so).
If either is not landed, STOP and report blocked. A typology built on the flawed v1 vector or on
dishonest capital data would bake in exactly the errors REPR-QUAL just exposed.

## 0b. Boot (read in order)
1. `.ai/CONTEXT.md`, `.ai/dispatch/DISPATCH_LOG.md`.
2. `.ai/context/BEHAVIORAL_AXIS_MAP_2026-07-12.md` (the ~10 behavior axes) + the AGENT_12 v2 validation
   doc.
3. The AGENT_11 `CAPITAL_METRICS_AUDIT` doc (the capital axes + the data-quality field).
4. `documentation/specs/SPEC-002-...md` §2.3 (outcome-by-analogy) and Act-3 (labels/moat) — this job is
   the descriptive-stats predecessor to any future learned metric, NOT the learned metric itself.
5. `.ai/context/COLLECTIONS_VECTOR_VALIDATION_2026-07-12.md` (the "behavioral fingerprint vs same
   person" honesty guardrail — carry it forward).
6. `src/core/services/database-service.ts` similarity read helpers (behavior + the new capital one).

## 0c. Target DB
`analyzer-postgres-pg17` (:5434). Read-only for the research; any BUILD output is additive.

## 1. Task — three layers, research-first
### Layer 1 — Combined-query capability (the thing the operator wants NOW)
Prove and expose the queries that were IMPOSSIBLE before, DB-wide over 64k wallets:
- "wallets that **behave** like X" (behavior kNN) — already exists.
- "wallets with **outcomes/capital profile** like X" (capital kNN) — new.
- **"behave like X AND actually make money / AND capital-legit"** (intersect/rank across both spaces,
  gated by the capital data-quality field). This is the "show me everyone who trades like this that
  isn't PnL garbage" query the operator named. Deliver it as a read helper + a proof script on :5434.
- Define HOW to combine honestly: intersection of kNN sets, or rank-fusion, or behavior-first-then-
  capital-filter. Recommend one with evidence; do not average two differently-scaled cosines blindly
  (the AGENT_7 boosting-not-averaging lesson applies).

### Layer 2 — Descriptive typology (the map → types, finally)
Now that the vector spans ~10 honest behavior axes (+ capital), find what natural groupings actually
exist — descriptive statistics only, NO training:
- Characterize the population across the axes (per-axis distributions, the real correlation structure
  post-v2).
- Identify candidate behavioral archetypes as REGIONS in the space (e.g. via simple, explainable
  clustering — k-means/HDBSCAN as a DESCRIPTIVE lens, reported with per-cluster axis profiles, NOT as a
  trained product model). The test for each candidate type: is it legible ("this cluster = fast
  distributors in nano-caps on a US clock, low win-rate"), stable, and NOT just a restatement of the
  existing `strategyType`?
- Explicitly compare emergent types vs the current 9 `strategyType` labels: which existing labels
  fracture into finer real types, which are noise, what NEW types appear that the crude 2-axis system
  couldn't see. THIS is the "typology is the next thing" the operator flagged.

### Layer 3 — "Is this a good trader / what is this trader for?" (behavior → judgment)
The project's north star. With behavior + capital + data-quality in one place, sketch (research, not
ship) how to answer: given a wallet's position in both spaces, what can we SAY about it —
copy-trade-worthy? coordinated-fleet member? nano-cap degen with real edge vs lucky? Tie to SPEC-002
§2.3 (outcome-by-analogy) and Act-3 (the analyst-label moat) as the future learned-metric direction, but
keep THIS job descriptive.

## 2. Deliverable
`.ai/context/BEHAVIOR_CAPITAL_TYPOLOGY_<date>.md`:
- Layer 1: the combined queries, defined + proven on :5434 (+ a thin additive read helper/script).
- Layer 2: the candidate typology — per-type axis profiles, sizes, legibility, vs current strategyType.
- Layer 3: the judgment framework sketch + the honest boundaries (what we can/can't claim; carry the
  "behavioral fingerprint, not same person" and "capital data-quality" guardrails).
- A recommendation on what becomes a real product surface vs what stays research, and whether the
  learned-metric lane (SPEC-002 Act 3) is now worth revisiting given the richer, honest space.

## 3. Hard guards
- GATED on AGENT_11 + AGENT_12. Do not run on v1 vectors or ungated capital data.
- Descriptive statistics only. Clustering is a LENS, not a shipped trained model. No metric learning
  here (that's Act 3, still label-gated per SPEC002_T03 NO-GO).
- Never label a cluster "same person" — "behavioral fingerprint" / "coordinated" only.
- Every capital-based judgment must carry the data-quality flag; never present transfer-distorted PnL
  as skill.
- Additive-only for any BUILD; read-only for the research.

## 4. Cost
Research-Medium. The heavy lifting (two honest vectors) is done by AGENT_11/12; this is the analysis +
a thin combined-query surface. This is where the program stops being "front-end showing some stats" and
becomes real DB-wide wallet research — the stated goal.
