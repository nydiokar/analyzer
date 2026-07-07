# SPEC-001 — Wallet Representation Layer

**Status:** Draft for review
**Author:** Representation & Embedding Audit follow-up
**Date:** 2026-07-06
**Supersedes:** none
**Grounded against:** live `analyzer` codebase (Postgres/Prisma), commit state of 2026-07-06

---

## 0. Reading Guide

This document turns the Representation & Embedding Audit into an executable, phased
specification. It is deliberately **conservative**: every phase is independently
shippable, gated by a prior validation, and reversible. Sections 1–4 are context and
design. Section 5 is the phased plan (the contract). Section 6 is the data model.
Section 7 is the API surface. Section 8 defines validation gates. Section 9 is the
**adversarial self-review** — read it before approving; it is where this spec argues
against itself and records what changed as a result.

A term used precisely throughout:

- **Behavioral feature vector** — a fixed-length, fixed-order, standardized numeric
  vector derived from `WalletBehaviorProfile` + `AdvancedTradeStats`. Dimensions are
  *interpretable behavioral statistics* (hold-time percentiles, buy/sell symmetry,
  win rate, mcap-bucket shares…). **This is NOT the token-space vector** used by the
  current similarity engine.
- **Token-space vector** — the existing sparse per-request vector over token mints
  (`createCapitalAllocationVectors` / `createBinaryTokenVectors`). Variable dimension,
  never persisted, never indexable across the DB. We do not change its math; we stop
  treating it as the only representation.

The distinction in the two bullets above is the single most important idea in this
spec. Confusing them is the primary way this project could be implemented wrong.

---

## 1. Objective & Scope

### 1.1 Ultimate objective the representations must serve

Sova Intel answers intelligence questions about Solana wallets. The questions that
justify calling the product "intel" (not "a PnL calculator") are:

- **Q1. Style:** How does this wallet trade? (already answered well)
- **Q2. Quality:** Is it profitable / a bot / a whale? (already answered well)
- **Q3. Neighborhood:** *Which other wallets behave like this one — across the entire
  database?* (**structurally impossible today**)
- **Q4. Coordination:** *What coordination cluster does this wallet belong to?*
  (computed per-request over a caller-supplied set; never a stored fact)
- **Q5. Cohort discovery:** *Give me all wallets matching profile P* (e.g. "fresh
  wallets that behave like known snipers"). (**impossible today**)

Q3–Q5 are the target of this spec. Q1–Q2 are preserved unchanged.

### 1.2 In scope

- Persisting a behavioral feature vector per wallet, indexed for nearest-neighbor.
- Materializing the wallet↔token bipartite graph and a derived wallet↔wallet edge set.
- Converting coordination clustering from per-request recompute to a stored,
  refreshable artifact.
- Upgrading wallet classification from a scalar label to an evidence-bearing record.

### 1.3 Out of scope (this spec)

- Sequence/trajectory models and graph embeddings (node2vec). See §5.5 (Deferred).
- Any change to FIFO PnL, mcap profiling, or holder-profile snapshot logic.
- Any change to the *math* of the existing pairwise similarity/correlation engines.
  We change their **inputs and persistence**, not their formulas.
- Real-time/streaming recomputation.

---

## 2. Current State (verified ground truth)

Verified against code on 2026-07-06. File:line citations are current, not from memory.

| Concern | Current representation | Evidence |
|---|---|---|
| Behavior | 1 row/wallet, ~40 numeric cols + ~10 JSON blobs, keyed by address only | `schema.prisma:231–296` `WalletBehaviorProfile` |
| Similarity | Ephemeral. Raw tx re-loaded per request; sparse token-space vectors rebuilt; discarded | `similarity-service.ts:78`, `analyzer.ts:34–57` |
| Clusters (similarity path) | **Never produced** — hardcoded `clusters: []` | `analyzer.ts:285` |
| Coordination | Ephemeral O(n²) pairwise + DFS connected-components over caller's set | `correlation/analyzer.ts:82–170, 178–266` |
| Public similarity API | Requires `walletAddresses[] (≥2)` as input — no global query | `api/services/similarity.service.ts:36–44` |
| Wallet↔token graph | Implicit only, as `SwapAnalysisInput` rows; re-pivoted each request | `schema.prisma:85–109` |
| Classification | Scalar `classification` + `classificationConfidence` float | `schema.prisma:20–23` |
| Store | PostgreSQL (pgvector available) | `schema.prisma:5–8` |
| Vector/graph/embedding infra | **None. Greenfield.** | grep: no `pgvector`/`hnsw`/`embedding` refs |

**Key enabling fact:** `SwapAnalysisInput` already has `(walletAddress, mint, timestamp,
direction, associatedSolValue, mcapBucket)` and is indexed on `[walletAddress, timestamp]`
and `[mint]`. The graph and any future sequence are derivable from data we already store.

---

## 3. Design Principles

1. **Stop discarding representations we already compute.** The behavioral features
   exist; we persist and standardize them. This is the cheapest high-leverage move.
2. **Deterministic before learned.** Engineered features and explicit edges ship first.
   Embeddings (behavioral autoencoder, node2vec) are optional later stages, each behind
   its own validation gate.
3. **One store.** Materialized tables + pgvector in the existing Postgres. No second
   datastore (no Neo4j) unless a later gate proves relational-graph traversal
   insufficient.
4. **Every phase independently shippable and reversible.** New tables and columns only;
   no destructive migration of existing data.
5. **Prune for signal.** The wallet↔wallet edge set reuses the existing "non-obvious
   token" logic (`correlation/analyzer.ts:52–61`) as the pruning key to prevent
   combinatorial edge explosion.
6. **Cost honesty.** Every phase states storage, compute, and refresh cost. If a phase
   cannot state its cost against real row counts, it does not ship until §8 Gate-0
   provides those counts.

---

## 4. Representation Decisions (the "what" and "why")

### 4.1 Behavioral feature vector (Q3, Q5)

- **Representation:** fixed-order `Float[]`, **exactly 32 dims in v1** (see §6.3;
  `vector(64)` is declared to leave zero-padded headroom for v2 without a type migration),
  standardized
  (z-score or robust-scaled using persisted population statistics), stored in a
  `pgvector` column on a new `WalletVector` row (1:1 with wallet).
- **Source dims (all already computed):** `buySellSymmetry`, `flipperScore`,
  `medianHoldTime`, `percentTradesUnder1Hour/4Hours`, `reentryRate`,
  `avgTradesPerSession`, `sessionCount`, win rate (from `AdvancedTradeStats`),
  `mcapDistribution` bucket shares, `velocityScore`, `tokensWithBothBuyAndSell` ratio,
  etc. Fully enumerated in §6.3.
- **Why not the token-space vector:** it is variable-dimension (one dim per mint the
  caller's wallets touched) and sparse; it cannot be indexed across the whole DB or
  clustered globally. The behavioral vector is fixed-dimension and dense → ANN-indexable.
- **Embeddings?** No, not initially. Engineered features are interpretable and
  low-dimensional. A learned behavioral autoencoder is a **deferred** option (§5.5),
  justified only if Gate-1 clustering quality is inadequate.
- **Enables:** Q3 (kNN over `pgvector`), global style clustering (batch k-means/HDBSCAN),
  anomaly detection (distance to nearest centroid), Q5 cohort queries.

### 4.2 Wallet↔token bipartite graph + derived wallet↔wallet edges (Q4)

- **Representation A — bipartite edges:** `WalletTokenEdge(walletAddress, mint,
  direction, weight, firstTs, lastMs, tradeCount)`. `weight` = capital share for buys.
  Materialized incrementally from `SwapAnalysisInput`.
- **Representation B — wallet↔wallet edges:** `WalletWalletEdge(a, b, sharedNonObvious,
  syncEventCount, score, refreshedAt)`. Batch-materialized. **Pruned** to pairs sharing
  ≥ N non-obvious tokens (reuse existing threshold config), so we never enumerate the
  full O(n²) pair space — only pairs that co-hold a rare token are ever scored.
- **Cluster membership:** `WalletClusterMembership(walletAddress, clusterId, role,
  refreshedAt)` — connected-components (existing DFS logic, run as a **batch**) over
  `WalletWalletEdge`, stored so Q4 is a **primary-key lookup**, not a recompute.
- **Embeddings?** No. Explicit edges + stored components deliver Q4 fully. node2vec is
  deferred (§5.5); it would add a *similarity-by-co-trading* signal orthogonal to
  behavior, but only if demand for it is proven.
- **Enables:** Q4 as lookup; whole-DB coordination detection as a batch job; instant
  shared-holder wallet hunts; proactive ring alerting later.

### 4.3 Evidential classification (supports Q2 explainability)

- **Representation:** add `classProbabilities Json` (distribution over classes) and
  `topFeatures Json` (the behavioral dims that drove the label) to the classification
  record. Keep existing scalar label for backward compatibility.
- **Embeddings?** No.
- **Enables:** "wallets near the bot boundary," tunable thresholds, explainable labels.
  Naturally fed by the §4.1 feature vector as classifier input.

---

## 5. Phased Plan (the contract)

Each phase lists: goal, deliverables, migration, acceptance, rollback. **A phase may not
begin until the prior phase's gate (§8) passes.**

### 5.0 Phase 0 — Validation harness (GATE, no production change)

- **Goal:** Prove behavioral clusters are real/separable and size the system before any
  persistence work. De-risks everything downstream.
- **Deliverables:** offline script that (a) exports current `WalletBehaviorProfile`+
  `AdvancedTradeStats` into a numeric matrix, (b) runs k-means + HDBSCAN + UMAP, (c)
  reports silhouette/DBCV scores, cluster count, and **production row counts**
  (`Wallet`, `SwapAnalysisInput`, distinct mints).
- **Acceptance (Gate-0):** report produced; row counts recorded in this spec's §8;
  clustering shows non-trivial separability (silhouette ≥ 0.15 OR HDBSCAN finds
  meaningful clusters covering ≥ 40% of wallets). If it fails, **stop** — the whole
  feature-vector thesis is wrong and we save ourselves Phases 1–4.
- **Rollback:** n/a (no prod change).

### 5.1 Phase 1 — Persist & index the behavioral feature vector (Q3, Q5)

- **Goal:** Ship "find wallets similar to X across the DB" and cohort queries.
- **Deliverables:**
  - Migration: pgvector extension + `WalletVector` table (§6.1).
  - `FeatureVectorBuilder` service: deterministic, versioned mapping from profile →
    `Float[]`; writes `WalletVector` **in the same transaction** as profile write.
  - Backfill job to vectorize existing profiles.
  - `PopulationStats` singleton row holding standardization params (mean/scale per dim),
    versioned with the feature schema.
  - New endpoints (§7): `GET /intel/wallet/:addr/similar`, `POST /intel/cohort/query`.
- **Migration:** additive only (new table, new extension). No existing column touched.
- **Acceptance (Gate-1):** kNN returns sane neighbors on a labeled probe set
  (e.g. known snipers' nearest neighbors are disproportionately snipers, precision@10
  materially above random baseline); backfill covers ≥ 99% of profiled wallets; vector
  write is transactional with profile write (verified by test).
- **Rollback:** drop `WalletVector` + endpoints; profiles unaffected.

### 5.2 Phase 2 — Materialize the wallet↔token graph + wallet↔wallet edges (Q4)

- **Goal:** Coordination cluster membership becomes a stored lookup, not a recompute.
- **Deliverables:**
  - Migration: `WalletTokenEdge`, `WalletWalletEdge`, `WalletClusterMembership` (§6.2).
  - Incremental `WalletTokenEdge` updater hooked into the existing analysis write path.
  - Batch `edge-materializer` job: from `WalletTokenEdge`, find co-holders of
    non-obvious tokens (pruned), score pairs using the **existing** correlation formula,
    write `WalletWalletEdge`.
  - Batch `cluster-materializer` job: run existing DFS connected-components over
    `WalletWalletEdge`, write `WalletClusterMembership`.
  - Refactor the public correlation path so cluster membership is served from the store,
    with per-request refinement only when the caller supplies a custom set.
  - New endpoint (§7): `GET /intel/wallet/:addr/cluster`.
- **Migration:** additive only.
- **Acceptance (Gate-2):** materialized clusters reproduce the per-request DFS result on
  a fixed test set (parity test); edge-materializer completes within the batch window
  sized by Gate-0 row counts; popular-token pruning keeps `WalletWalletEdge` within the
  storage budget stated in §8.
- **Rollback:** drop the three tables + endpoint; per-request path still works unchanged.

### 5.3 Phase 3 — Evidential classification

- **Goal:** Explainable, boundary-aware classification fed by the Phase-1 vector.
- **Deliverables:** migration adding `classProbabilities`/`topFeatures`; classifier
  update consuming `WalletVector`; endpoint surfaces the distribution.
- **Migration:** additive columns, nullable.
- **Acceptance (Gate-3):** probabilities calibrated (reliability plot sane); existing
  scalar label unchanged for wallets above confidence threshold (no regression).
- **Rollback:** columns nullable; ignore them.

### 5.4 Phase 4 — Reserved

Intentionally empty. No phase 4 is committed. Any further work requires a new gate and a
new spec revision. This prevents scope creep by construction.

### 5.5 Deferred (explicitly NOT in this plan)

- **Behavioral autoencoder embedding** — only if Gate-1 shows engineered features cluster
  poorly. Adds opacity + training/serving cost.
- **Graph embeddings (node2vec)** over `WalletTokenEdge` — a co-trading similarity signal
  orthogonal to behavior. Deferred until Q4-as-lookup proves demand for deeper structure.
- **Sequence/trajectory representation + sequence models** — highest ceiling (temporal
  coordination, style-drift, cadence fingerprinting) but highest cost and unproven demand.
  Requires its own spec. The audit ranked this HLO-3; this spec **removes it from the
  committed roadmap** and records it here as a research bet.

---

## 6. Data Model (Prisma additions — all additive)

> Exact column types finalized during Phase 1 migration authoring; shapes below are the
> contract. `vector(N)` requires the `pgvector` extension (Phase 1 migration).

### 6.1 `WalletVector` (Phase 1)

```prisma
model WalletVector {
  walletAddress   String   @id
  schemaVersion   Int                       // feature schema version (fixed ordering)
  vector          Unsupported("vector(64)") // pgvector; standardized behavioral dims
  builtAt         DateTime @updatedAt
  wallet          Wallet   @relation(fields: [walletAddress], references: [address], onDelete: Cascade)

  @@index([schemaVersion])
  // HNSW/IVFFlat index created via raw SQL in migration (cosine ops)
}

model PopulationStats {
  id             Int      @id @default(1)   // singleton
  schemaVersion  Int
  means          Json                        // per-dim mean
  scales         Json                        // per-dim scale
  walletCount    Int
  computedAt     DateTime @updatedAt
}
```

### 6.2 Graph tables (Phase 2)

```prisma
model WalletTokenEdge {
  walletAddress String
  mint          String
  // One edge per (wallet, mint); buy and sell activity aggregated into columns
  // (no `direction` scalar — a wallet both buys and sells a mint, which would
  //  break the composite PK).
  buyWeight     Float    // capital share for buys (0..1)
  buyCount      Int
  sellCount     Int
  tradeCount    Int      // buyCount + sellCount
  firstTs       Int
  lastTs        Int
  refreshedAt   DateTime @updatedAt

  @@id([walletAddress, mint])
  @@index([mint])          // co-holder lookup
  @@index([walletAddress])
}

model WalletWalletEdge {
  a               String
  b               String   // convention: a < b lexicographically
  sharedNonObvious Int
  syncEventCount  Int
  score           Float
  refreshedAt     DateTime @updatedAt

  @@id([a, b])
  @@index([a])
  @@index([b])
  @@index([score])
}

model WalletClusterMembership {
  walletAddress String   @id
  clusterId     String
  role          String?  // e.g. "core" | "peripheral"
  clusterSize   Int
  refreshedAt   DateTime @updatedAt

  @@index([clusterId])
}
```

### 6.3 Feature schema v1 (frozen ordering — the contract for §4.1)

**v1 = exactly 32 dimensions.** Fixed index order below is the frozen contract. Missing
source values are imputed to population median (a companion bitmask MAY be added in v2 if
Gate-1 shows imputation harms neighbor quality). All dims standardized via `PopulationStats`.
Physical column is `vector(64)`; dims 32–63 are **zero-padded reserved headroom** for v2 so
adding features never requires a column-type migration.

```
 0 buySellSymmetry            11 avgTradesPerSession(log1p)  22 avgSessionDurationMinutes(log1p)
 1 flipperScore               12 log1p(uniqueTokensTraded)   23 percentOfValueInCurrentHoldings
 2 log1p(medianHoldTime)      13 completePairsRatio          24 mcapShare_ultraMicro
 3 log1p(avgFlipDurationHrs)  14 avgTradesPerToken(log1p)    25 mcapShare_large+
 4 winRate                    15 mcapShare_nano              26 dominantEntryMcapBucketShare
 5 buySellRatio(clipped)      16 mcapShare_micro             27 log1p(avgEntryMcap+1)
 6 sequenceConsistency        17 mcapShare_small             28 tokensWithOnlyBuys / uniqueTokens
 7 percentTradesUnder1Hour    18 mcapShare_mid               29 activeTradingDays(log1p)
 8 percentTradesUnder4Hours   19 velocityScore               30 medianActiveHoldingHours(log1p)
 9 reentryRate                20 tokensBothBuySell/uniqueTok 31 percentTradesUnder1Hour_x_flipper (interaction)
10 sessionCount(log1p)        21 percentUnpairedTokens
--- dims 32..63: reserved, zero-padded (v2) ---
```

Every dim maps 1:1 to an existing `WalletBehaviorProfile`/`AdvancedTradeStats` field except
dim 31 (a cheap engineered interaction term). No source field requires new computation.
Rationale for transforms: heavy-tailed counts use `log1p`; ratios are clipped to sane ranges;
mcap distribution enters as pre-computed bucket shares. This is engineering, not learning —
fully reproducible and auditable.

---

## 7. API Surface (additions)

All additive; existing endpoints unchanged.

- `GET /intel/wallet/:addr/similar?k=20&filter=...`
  → nearest behavioral neighbors via pgvector kNN. **New capability (Q3).**
  Requires `WalletVector` for `:addr` (404/`202 building` if absent).
- `POST /intel/cohort/query`
  → body: behavioral constraints and/or a seed wallet + radius → matching wallets.
  **New capability (Q5).**
- `GET /intel/wallet/:addr/cluster`
  → stored coordination cluster membership + members + score. **New capability (Q4).**
- (Phase 3) classification responses gain `classProbabilities`, `topFeatures`.

Pricing note: Q3/Q4 lookups are now O(index lookup), not O(n²) recompute → the
100-credit pairwise price no longer applies to these queries. Set credit cost to reflect
the new marginal cost (near-zero) — this is a product decision flagged, not made here.

---

## 8. Validation Gates & Cost Ledger

**Gate-0 outputs (fill in during Phase 0 — BLOCKS everything):**

- `Wallet` row count: `______`
- `SwapAnalysisInput` row count: `______`
- distinct mints: `______`
- non-obvious mint count (post-pruning): `______`
- clustering separability (silhouette/DBCV): `______`
- **Storage projections** (must be filled before Phase 2 approval):
  - `WalletVector`: rows × 64 × 4 bytes ≈ `______`
  - `WalletTokenEdge`: ≈ (avg tokens/wallet × wallets) rows ≈ `______`
  - `WalletWalletEdge` (pruned): ≈ `______` (must be ≪ wallets², or pruning is wrong)
- **Batch window** for edge+cluster materialization: `______` (must fit ops schedule)

Gates 1–3 defined per-phase in §5. **No phase ships on vibes; each has a measured
acceptance test.**

---

## 9. Adversarial Self-Review

This section attacks the spec above. Where an attack lands, the spec was changed and the
change is noted. Where an attack is survivable, the residual risk is recorded.

### 9.1 Attacks that forced changes

- **"Feature vector = token-space vector" confusion (LANDED → fixed).**
  Early framing risked implying we index the existing sparse token vectors. Those are
  variable-dimension and un-indexable across the DB. *Change:* §0 and §4.1 now hard-separate
  **behavioral feature vector** (fixed, dense, indexable) from **token-space vector**
  (sparse, per-request, unchanged). This was the audit's most exploitable ambiguity.

- **Sequence embeddings smuggled into the roadmap (LANDED → removed).**
  The audit put HLO-3 at Phase 4. High cost, unproven demand, model-serving burden — a
  classic complexity trap. *Change:* removed from the committed plan; §5.4 is reserved-empty;
  sequence work relegated to §5.5 Deferred requiring its own spec.

- **Storage/compute unbounded (LANDED → gated).**
  Materializing edges without a row-count budget risks `WalletWalletEdge` blowing up to
  O(wallets²). *Change:* Gate-0 (§8) now BLOCKS all persistence until real counts + storage
  projections exist; §6.2 mandates non-obvious-token pruning as the id-space limiter;
  Phase 2 acceptance requires `WalletWalletEdge ≪ wallets²`.

- **"Cosine is fine, don't touch it" over-read (LANDED → corrected).**
  The audit said the metric is fine and implied no change needed. True for the *pairwise*
  path, but it obscured that ANN/clustering need a **standardized fixed-dim** vector the
  system doesn't have. *Change:* §6.3 specifies the frozen feature schema, transforms, and
  `PopulationStats` standardization — the actual work the audit under-scoped.

- **Staleness of derived artifacts (LANDED → pinned).**
  A vector or cluster that drifts from its source silently corrupts Q3/Q4. *Change:* §5.1
  mandates vector write in the **same transaction** as profile write; graph/cluster tables
  carry `refreshedAt` and are explicitly batch-refreshed (not claimed real-time).

### 9.2 Attacks the spec survives (residual risks recorded)

- **"What if there aren't enough wallets for global similarity to matter?"**
  Survivable: Gate-0 measures exactly this. If counts are tiny, Phase 1 still ships cheaply
  as an experiment and Phase 2 is deferred. The gate converts the unknown into a decision.

- **"Connected-components clustering is crude (chains merge unrelated wallets)."**
  Acknowledged, out of scope: this spec preserves the **existing** DFS logic to guarantee
  parity (Gate-2). Improving cluster quality (e.g. community detection, edge-weight
  thresholds) is a follow-up once membership is a stored artifact we can iterate on cheaply.
  Recorded as open question OQ-2.

- **"pgvector `Unsupported` type in Prisma is awkward."**
  Survivable: index is created via raw SQL in the migration; reads use `$queryRaw` for kNN.
  This is standard pgvector-with-Prisma practice; complexity is contained to two query sites.

- **"Batch refresh means stale coordination during fast attacks."**
  Accepted trade-off: wallet *character* changes slowly; coordination rings persist across
  the batch window. Real-time was explicitly rejected (cost ≫ value). If a fast-attack
  product need emerges, that is a new spec, not a patch here.

- **"Feature schema will need to change; re-vectorizing is churn."**
  Bounded: `schemaVersion` on `WalletVector` + `PopulationStats` allows blue/green
  re-vectorization; queries filter by current version. Cost is a backfill job, already
  built for Phase 1.

### 9.3 Attacks that would kill the spec (kept visible)

- **If Gate-0 fails** (no separable behavioral structure), Phases 1–4 are unjustified and
  must not proceed. The spec is designed to fail cheap here rather than expensively later.
- **If production wallet count is trivially small** (< a few thousand), global similarity is
  a solution without a problem; ship Phase 1 as an experiment only, do not build Phase 2.

### 9.3b Final-pass defects found in the delivered draft (LANDED → fixed)

Two defects survived §9.1 and were caught in a final read-through of the written spec:

- **Feature vector dimensionality was internally inconsistent** — prose said "32–64,"
  the column said `vector(64)`, the enumeration listed ~24 with a hand-wave. A frozen
  contract cannot be vague about its own length. *Fixed:* v1 is now **exactly 32 fully
  enumerated dims** (§6.3); `vector(64)` is explicitly reserved headroom; §4.1 updated to
  match.
- **`WalletTokenEdge` PK/`direction` contradiction** — `@@id([walletAddress, mint])` with a
  scalar `direction` column is impossible (a wallet both buys and sells the same mint).
  *Fixed:* replaced `direction` with `buyWeight`/`buyCount`/`sellCount` aggregated per
  (wallet, mint) (§6.2).

### 9.4 Post-review changes summary

Relative to the original audit, this spec: (1) hard-separated the two vector notions;
(2) removed sequence embeddings from the committed plan; (3) elevated Gate-0 to a blocking
prerequisite with a filled-in cost ledger; (4) specified the frozen feature schema and
standardization the audit under-scoped; (5) pinned vector/cluster freshness semantics.
Net effect: **less committed complexity, more certainty, same headline capabilities.**

---

## 10. Open Questions

- **OQ-1 (blocks Phase 2 sizing):** production row counts — resolved by Gate-0.
- **OQ-2:** is connected-components cluster quality good enough for a customer-facing
  "coordination ring" claim, or is community detection needed? Iterate post-Phase-2.
- **OQ-3:** is Q3 ("similar wallets") a demanded product surface or a hypothesis? Phase 1
  is cheap enough to ship as an experiment either way.
- **OQ-4:** credit pricing for O(1) lookups that replace 100-credit O(n²) analyses — product
  decision.

---

## 11. Roadmap Summary (one screen)

| Phase | Ships | Gate to enter | ML? | Migration | Reversible |
|---|---|---|---|---|---|
| 0 | Validation harness + cost ledger | — | offline only | none | n/a |
| 1 | `WalletVector` + kNN + cohort API (Q3, Q5) | Gate-0 pass | no | additive | yes |
| 2 | Graph + wallet-wallet edges + cluster lookup (Q4) | Gate-1 pass | no | additive | yes |
| 3 | Evidential classification | Gate-2 pass | uses P1 vector | additive | yes |
| (def) | autoencoder / node2vec / sequences | new spec | yes | — | — |

**Bottom line:** the highest-leverage move is not "add embeddings" — it is to **stop
discarding representations the system already computes**, persist the behavioral feature
vector, and materialize the wallet graph. Those two changes unlock database-wide similarity,
clustering, and coordination-as-lookup that are structurally impossible today, with learned
representations held as well-gated future bets rather than the headline.
