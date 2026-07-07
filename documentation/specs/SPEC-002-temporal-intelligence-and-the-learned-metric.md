# SPEC-002 — Temporal Intelligence & the Learned Metric (the several-steps-ahead thesis)

**Status:** Direction / vision spec (companion to SPEC-001)
**Date:** 2026-07-06
**Depends on:** SPEC-001 (representation layer) as its substrate
**Grounded against:** live `analyzer` schema; verified label/time-series assets exist

---

## 0. Why this document exists

SPEC-001 answers "stop discarding representations." That is the **enabling** move, not the
**powerful** one. It makes the product a better *encyclopedia*: static questions — what is
this wallet, who is it like, who is it with. Those are present-tense retrieval capabilities.

This document states the destination SPEC-001 only makes *possible*. The thesis:

> **A wallet is not a point — it is a trajectory through behavior-space over time.
> A coordination cluster is not a set — it is a formation that assembles before an event
> and dissolves after. SPEC-001 computes *where everything is*. The value is in *where
> everything is going*, and in a distance metric your own analysts have proven correct.**

Three acts, in order. Each is only possible because the prior one shipped.

- **Act 1 (SPEC-001):** Stop discarding → wallets become points, relationships become edges.
  Unlocks: global similarity, clustering, coordination-as-lookup. *Descriptive.*
- **Act 2 (this spec, §2):** Add a **time axis** → points become trajectories, edges become
  formations. Unlocks: drift/regime-change detection, cluster-formation as a *leading*
  indicator, outcome prediction by analogy. *Predictive & anomaly-aware.* Nearly free —
  mostly "version the artifacts SPEC-001 already produces and diff them."
- **Act 3 (this spec, §3):** Close the loop with the **analyst-label streams already
  collected** → the distance metric itself becomes learned and verified. Unlocks a moat.
  *This is the one place embeddings are the correct tool — not "embed because embeddings,"
  but "learn a metric your own confirmed labels say is right."*

---

## 1. Unused intelligence assets already in the schema (verified)

The several-steps-ahead move is unlocked by data the system **already collects and does not
use as signal**:

| Asset | What it really is | Where | Currently used as… |
|---|---|---|---|
| `RadarHolding.reviewStatus` + `firstSeenAt`/`lastSeenAt`/`acquiredAt` | **Analyst verdict label stream** + per-holding **time-series** | `schema.prisma:780–799` | manual review UI only |
| `WalletHuntSnapshot.holders` (String[]) keyed by `tokenMint` | **Hand-curated "these wallets are related" ground truth** | `schema.prisma:690–703` | saved snapshots only |
| `CreditTransaction.reason` = `endpoint:/wallets/…/behavior-analysis` | **Demand signal**: which wallets people pay to inspect | `schema.prisma:752–766` | billing only |
| `SwapAnalysisInput.timestamp` (indexed `[walletAddress, timestamp]`) | **The time axis** for every trajectory | `schema.prisma:85–109` | per-request scans |
| `SolDailyPrice` | market-context **time-series**, already joined | `schema.prisma:899+` | PnL enrichment only |

The two label streams (`reviewStatus`, `WalletHuntSnapshot.holders`) are the crown jewels:
they are **ground truth for "is this coordination/similarity real," produced for free by your
own users.** No competitor can copy them. They are the reason Act 3 is a moat, not a feature.

---

## 2. Act 2 — Add the time axis (predictive, mostly free)

Each capability below requires **no new heavy ML** — only versioning SPEC-001's artifacts and
diffing them. This is the highest value-per-effort in the whole program.

### 2.1 Behavioral drift / regime-change detection — the sleeper win

- **Idea:** SPEC-001 stores one `WalletVector` per wallet. **Keep a history** (append a row
  per rebuild instead of overwriting). A wallet is then a sequence `v₀, v₁, … vₜ`. The signal
  is `‖vₜ − vₜ₋₁‖` (or drift over a window). A POSITION_TRADER whose vector lurches toward
  SNIPER is compromised, sold, botted, or switching strategy.
- **Why impossible today:** snapshot representation **overwrites the past** — there is no
  "before" to compare against.
- **Cost:** trivial. A history table + a windowed diff in the batch that already rebuilds
  vectors. **Zero new modeling.**
- **Product surface:** "this wallet changed character on 2026-06-30" alert; a per-wallet
  volatility score; filter cohorts by *stability*.
- **Confidence: High.** This is the cheapest genuinely-new intelligence in the program.

### 2.2 Cluster formation as a leading indicator (forensics → alpha)

- **Idea:** SPEC-001's `WalletWalletEdge`/`WalletClusterMembership` carry timestamps. Watch
  for a **new dense subgraph assembling around a *young* token** — coordination detected
  *while forming*, not in post-mortem. Densification of a subgraph over a short window on a
  low-age mint is the trigger.
- **Why it matters commercially:** "here's who rugged you" is forensics (low willingness-to-
  pay). "These 14 wallets are converging on this 3-hour-old token *right now*" is alpha /
  alerting (high willingness-to-pay). Same graph, plus a time axis and a densification watch.
- **Validation is free:** `WalletHuntSnapshot.holders` already contains analyst-confirmed
  rings *after the fact* — replay them to measure how early the formation detector would have
  fired. That is a ready-made backtest set you already own.
- **Cost:** Medium (a streaming/batch densification monitor over the edge table).
- **Confidence: High on value, Medium on tuning** (false-positive rate needs the backtest).

### 2.3 Outcome prediction by analogy (k-NN regression, not a trained model)

- **Idea:** every wallet is a vector *and* you have realized PnL. Prediction falls out **for
  free by analogy**: "the k wallets historically nearest to this one, when they entered
  tokens like this, went on to X% win rate / Y median PnL." No predictor is trained — it is
  k-NN regression over outcomes in the space SPEC-001 already built.
- **Why impossible today:** no persistent shared space to define "nearest" in, and outcomes
  aren't attached to positions in that space.
- **Product surface:** copy-trade / fade decision support; "smart-money-likeness" score for a
  fresh wallet; ranking holders of a token by predicted quality.
- **Cost:** Low–Medium (reuses the SPEC-001 ANN index + a PnL join).
- **Confidence: Medium-High.**

### 2.4 Trajectory representation (the one deferred ML piece, now motivated)

- Only *after* 2.1–2.3 prove demand, represent each wallet's ordered trade events as a
  sequence and embed *timing/order* (cadence, inter-trade intervals, action n-grams). This is
  the SPEC-001 "deferred" item — but now it has a **reason**: bot-cadence fingerprinting and
  same-actor-across-wallets detection that aggregates erase. Still its own spec, still gated.
- **Confidence: Medium.** High ceiling; only justified once the cheap temporal wins land.

---

## 3. Act 3 — Close the loop: the learned, verified metric (the moat)

This is where embeddings finally earn their place — and only here.

### 3.1 The self-improving architecture

```
engineered WalletVector  ──►  clusters / kNN neighbors / candidate rings
        ▲                                   │
        │                                   ▼
   metric learning  ◄──  analyst feedback: reviewStatus + WalletHuntSnapshot.holders
   (which behavioral dims actually predict a CONFIRMED ring / real similarity)
```

- SPEC-001 uses an *unsupervised* distance (cosine over engineered dims). It has no idea which
  dimensions actually matter for a *confirmed* ring — it weights them all blindly.
- Your analysts are **already labeling truth**: `reviewStatus` marks holdings/actors as
  real/not; `WalletHuntSnapshot.holders` marks sets as genuinely related. Feed these as
  supervision to learn a **metric** (equivalently, a learned embedding) where confirmed-related
  wallets are provably close and confirmed-unrelated wallets are provably far.
- **Result:** similarity and coordination detection get *measurably* better every time an
  analyst uses the tool. The engineered vector is the cold-start; the learned metric is the
  compounding asset.

### 3.2 Why this is the powerful move, not a fashionable one

- It is the **only** place a learned representation beats engineered features *with evidence*:
  the loss function is your own analysts' verified verdicts, not a generic objective.
- It is **defensible**: a competitor can copy the 32 features and the graph in a week. They
  cannot copy your accumulated stream of confirmed rings and analyst verdicts. The moat is the
  *labels*, and the learned metric is what converts labels into product advantage.
- It **de-risks the earlier ML bets**: you only train an embedding once you have (a) a shared
  space that works unsupervised (SPEC-001), and (b) a labeled reason to believe a learned
  metric would be better (the label streams). No speculative deep learning.

### 3.3 Prerequisites (hard gates)

- Label volume: enough `reviewStatus` decisions + hunt snapshots to train/validate a metric
  (measure during Act 2; if analysts label sparsely, **build label capture into the UI first**
  — cheap, and it's the true bottleneck).
- Act 1 + at least 2.1–2.2 shipped and used, so the loop has something to improve.

---

## 4. Revised destination (one screen)

| Act | Move | Representation shift | New capability | Embeddings? | Effort |
|---|---|---|---|---|---|
| 1 (SPEC-001) | Stop discarding | point + edge | global similarity, clustering, coord-lookup | no | done/low |
| 2.1 | Version vectors | point → **trajectory** | drift / regime-change alerts | no | **trivial** |
| 2.2 | Timestamp edges + densification watch | set → **formation** | coordination as **leading** indicator | no | medium |
| 2.3 | Join outcomes to space | space + labels | outcome prediction by analogy | no | low-med |
| 2.4 | Sequence of events | aggregate → **sequence** | cadence / same-actor fingerprint | yes (seq) | high, gated |
| 3 | Feed analyst labels back | learned **metric** | self-improving, defensible intel | **yes, justified** | high, gated |

---

## 5. Direct answer to "is stop-discarding enough?"

**No.** Stop-discarding is Act 1 — it removes the constraint that made everything else
impossible. The powerful move is the two things that constraint was hiding:

1. **The time axis is nearly free and the biggest sleeper.** Versioning artifacts SPEC-001
   already produces turns a static encyclopedia into a *predictive, anomaly-aware* system —
   drift detection (2.1) especially costs almost nothing and no competitor is doing it well.
2. **The moat is the analyst-label loop (Act 3).** It is the *only* rigorous justification for
   a learned embedding in this project, and it is defensible precisely because it is built on
   proprietary labels (`reviewStatus`, `WalletHuntSnapshot.holders`) you already collect and
   currently throw away as signal.

So: **not "stop discarding, and that's it."** It's *stop discarding → add time → close the
loop.* Descriptive → predictive → self-improving. Each act only possible because the last one
shipped, and only the final act needs the embedding — earned, not assumed.

---

## 6. Adversarial note on this spec

- **"This is vision-ware / speculative."** Guarded: Acts 2.1–2.3 require **no new ML** and reuse
  SPEC-001 tables; they are concrete and cheap. Only 2.4 and Act 3 are ML, and both are hard-
  gated behind proven demand and measured label volume. Nothing here asks for speculative deep
  learning before its prerequisites exist.
- **"The label streams may be too sparse to train a metric."** Acknowledged and made a gate
  (§3.3). The mitigation — *instrument the analyst UI to capture verdicts as first-class
  labels* — is itself cheap and valuable regardless, and is the real bottleneck to name now.
- **"Leading-indicator coordination will false-positive."** True; that's why 2.2 ships with a
  backtest built from `WalletHuntSnapshot.holders` (confirmed rings) before any alert goes live.
- **"Trajectory/embedding could be premature."** Which is exactly why they are Act 2.4 / Act 3,
  behind everything cheap and unsupervised that must prove the space is real first.

---

## 7. Execution Gate Addendum (SPEC002_T00, 2026-07-07)

### 7.1 Verdict

SPEC-002 is directionally consistent with SPEC-001, but it is **not executable as build work
before SPEC-001 lands**. Its "mostly free" Act 2 language is only true after SPEC-001 has
created the representation substrate: persisted `WalletVector`, `WalletWalletEdge`, and
`WalletClusterMembership` artifacts. In the current repo those names are planned in
`documentation/specs/SPEC-001-wallet-representation-layer.md:125`,
`documentation/specs/SPEC-001-wallet-representation-layer.md:145`, and
`documentation/specs/SPEC-001-wallet-representation-layer.md:149`, but a schema grep of
`prisma/schema.prisma` finds no current model declarations for those three tables.

Root cause: SPEC-002 describes temporal diffs over future SPEC-001 artifacts, while the live
system still computes request-local token-space vectors and discards them. The current
similarity path builds capital/binary token vectors in
`src/core/analysis/similarity/analyzer.ts:36` and `src/core/analysis/similarity/analyzer.ts:38`,
optionally returns those request-local vectors from
`src/core/analysis/similarity/similarity-service.ts:277`, and hardcodes
`clusters: []` in `src/core/analysis/similarity/analyzer.ts:285`.

### 7.2 Verified Assets And Limits

The label/time assets named by SPEC-002 do exist:

| Asset | Current evidence | Execution implication |
|---|---|---|
| `SwapAnalysisInput` | `prisma/schema.prisma:85`, with `[walletAddress, timestamp]` at `prisma/schema.prisma:107` | Usable for read-only temporal inventory and later replay. |
| `WalletHuntSnapshot` | `prisma/schema.prisma:690`, `holders String[]` at `prisma/schema.prisma:696` | Positive-ring evidence exists, but as saved operational snapshots. |
| `CreditTransaction` | `prisma/schema.prisma:752`, `reason` at `prisma/schema.prisma:758` | Demand signal only; not a truth label. |
| `RadarHolding` | `prisma/schema.prisma:780`, `firstSeenAt`/`lastSeenAt`/`acquiredAt`/`reviewStatus` at `prisma/schema.prisma:784`-`prisma/schema.prisma:790` | Analyst review stream exists, but not a training ledger. |
| `SolDailyPrice` | `prisma/schema.prisma:899` | Market time-series exists for later joins. |

Current wallet-hunt and radar code treats labels as operational product data, not as a
training-ready ledger. `WalletHuntService` saves holders into `walletHuntSnapshot` at
`src/api/services/wallet-hunt.service.ts:150` and computes candidates from snapshot overlap
at `src/api/services/wallet-hunt.service.ts:232`; it does not persist positive/negative pair
labels. `RadarSnapshotService` creates holdings with `reviewStatus: 'unreviewed'` at
`src/api/services/radar-snapshot.service.ts:60`-`src/api/services/radar-snapshot.service.ts:69`
and auto-ignores dust at `src/api/services/radar-snapshot.service.ts:77`-`src/api/services/radar-snapshot.service.ts:84`.
`RadarController` mutates review status for feed management at
`src/api/controllers/radar.controller.ts:140`-`src/api/controllers/radar.controller.ts:148`;
there is no reviewer identity, label taxonomy, pair construction, or split strategy.

### 7.3 Budget Gates

No SPEC-002 build job may start until the relevant gate below is satisfied:

| Gate | Required proof | Blocks |
|---|---|---|
| SPEC-001 substrate | `WalletVector` exists for vector history; `WalletWalletEdge` and `WalletClusterMembership` exist for formation/cluster work. | SPEC002_T01, SPEC002_T02 build work. |
| Row-count ledger | Gate-0 row counts from SPEC-001: wallets, `SwapAnalysisInput`, distinct mints, non-obvious mints, projected vector/edge rows, and batch window. | Any persisted temporal or graph projection. |
| Vector-table existence | Phase-1 vector write path is real and current-version vectors cover the accepted wallet population. | Drift scoring/history. |
| Graph-table existence | Phase-2 graph/edge tables are real and pruned by non-obvious-token logic; edge count is much less than wallets squared. | Formation monitor and cluster time diffs. |
| Label volume | `RadarHolding.reviewStatus` and `WalletHuntSnapshot` counts are measured, with sparsity and timestamp coverage reported. | Metric-learning work. |
| Negative-pair construction | A written rule avoids trivial negatives, leakage, and misuse of `ignored`/demand signals. | Any learned metric or embedding dispatch. |
| Backtest false-positive rate | Formation replay reports lead time, precision controls, false-positive sampling, and max fanout before live alerts. | Densification monitor/live alerting. |

### 7.4 Dispatch Gate Table

| Job | Gate | Verdict | Reason |
|---|---|---|---|
| SPEC002_T01 - vector history and drift pilot | BLOCKED | Do not build now. | Requires SPEC-001 Phase 1 `WalletVector`; current schema has no vector table and current similarity vectors are request-local token-space data. |
| SPEC002_T02 - formation replay and densification design | BLOCKED for build; read-only design only after graph direction is concrete. | Do not build now. | Requires SPEC-001 Phase 2 graph tables or a completed graph-table direction; replay must stay mint-first/pruned and cannot introduce a second serving model. |
| SPEC002_T03 - label ledger and learned-metric readiness | GO for read-only inventory/report only. | May run now; no ML. | Current label assets exist, but are operational fields. The next safe task is measuring label volume and defining pair/split rules, not training. |

Service-boundary check: this addendum adds no endpoint, queue consumer, IPC receiver, or
external-input handler. Later jobs that propose handlers must answer concurrency, memory at
scale, request-size, timeout, malformed-input, and backing-resource failure questions in
their own specs before implementation.
