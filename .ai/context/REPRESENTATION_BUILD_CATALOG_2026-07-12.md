# Representation Layer — Exploratory Build Catalog

**Date:** 2026-07-12
**Purpose:** Ideas for what to build on the SPEC-001/002 substrate that go BEYOND the
SURFACE-1 dispatch's three provocations (DB-wide siblings / confident clusters / wallet
explorer) and beyond the thing already identified (holder-profiles inline + Similarity Lab).
This is a menu to think with, split by consumer: **human (dashboard)** vs **machine
(API/MCP/agent)**. Each entry states the new *question*, the *substrate join* that answers
it, effort, and honest risk. Nothing here is committed; several are one bounded read away.

**Substrate primitives available (real data, :5434):**
- 64,378 behavioral vectors + HNSW kNN (~1.5ms, DB-wide, any seed).
- 3,065,841 wallet↔token edges (buy/sell weight, tradeCount, firstTs/lastTs).
- 2,776 wallet↔wallet edges + 117 clusters / 421 memberships (stored coordination lookup).
- WalletVectorHistory + population-invariant drift (trajectory over time).
- Per-wallet realized/unrealized PnL + winRate, joinable to the vector space.
- 527,902 mints (501,868 "non-obvious"), timestamped swaps.

---

## ⚠️ VERIFIED SUBSTRATE REALITY — read before building any entry below

*Confirmed on :5434, 2026-07-12 (reproducible SQL). Every idea below must handle these four facts or it ships a bug/false-alarm.*

1. **Vector coverage is 100% of tradeable wallets — NOT a 16% gap.** 64,378 vectors =
   64,378 behavior profiles. The 12,303 wallets without a vector have **zero swaps** (empty
   shells). `/similar` + `/cluster` **404 by design** on them. → Every human surface (A1–A5)
   needs an explicit **"no representation yet"** empty state, not an error; every machine
   surface (B1–B5) needs a **structured 404**, never a fallback scan.

2. **Coordination clusters are genuinely rare — 421 of 64,378 wallets (0.65%) are in ANY
   cluster.** This is real, not under-materialization: most wallets are not coordinated.
   → A "cluster badge" is **empty for ~99% of holders** — that's the correct, expected default.
   Design the *absence* of a cluster as the normal state; a present badge is the exception
   that carries signal. Do not build UI that looks broken when a wallet has no cluster.

3. **There is NO `WalletCluster` parent table.** Cluster identity lives only as a `clusterId`
   string on `WalletClusterMembership` (it's the concatenation of member addresses). There is
   **no row to join for cluster-level metadata** (score, label, created-at). → Any "cluster
   density / cluster info" read must aggregate from memberships; do not assume a parent entity.

4. **Drift populates only on re-analysis, never on a schedule.** `WalletVectorHistory` appends
   a row only when `upsertWalletBehaviorProfile` runs (a wallet is re-analyzed). → A "drift
   watchlist / changed-character feed" (A4) is **inert** until a periodic rebuild cadence
   exists. That cadence is a prerequisite, not a detail — flag it as a dependency, don't
   assume drift is live.

**Same-person ≠ same-behavior (validation finding, 2026-07-12).** Tested against hand-labeled
known-connected wallet collections (`.ai/context/COLLECTIONS_VECTOR_VALIDATION_2026-07-12.md`):
the substrate perfectly recovers **operational sibling fleets** (one owner, same strategy, same
tokens — clustered 4/4 and 3/3, and ranked as each other's top DB-wide neighbors), but
**correctly does NOT link same-owner-different-role wallets** (STELLAR pair: cosine 0.58, 12
shared tokens → no cluster). Any surface that presents siblings/clusters as "same person" is
**overclaiming**; the honest claim is "same behavioral fingerprint / coordinated on-chain."

The meta-insight: the old product only ever asked **forward** questions ("tell me about THIS
wallet/token"). The substrate makes **inverse** and **relational** questions cheap:
"given a behavior, find the wallets", "given an outcome, find the antecedent", "given a
token, characterize its crowd", "given a wallet, where is it going". Those inversions are the
unspent power.

---

## A. HUMAN surfaces (dashboard / analyst)

### A1. "Who is accumulating this NEW token right now" — early-crowd fingerprint ⭐
- **New question:** For a young mint, don't just list holders — **characterize the crowd by
  behavior and pull their DB-wide reputation.** "37 buyers in the last 3h; 12 are in known
  coordination clusters; median historical win-rate 61%; 5 are SNIPERs with >70% win-rate."
- **Join:** WalletTokenEdge (buyers of mint, `firstTs` window) → WalletVector/behavior +
  WalletClusterMembership + winRate. All indexed, bounded to the buyer set.
- **Why it matters:** this is the single biggest willingness-to-pay flip in SPEC-002 §2.2 —
  "here's who rugged you" (forensics) → "here's the *quality* of who is buying this, live"
  (alpha). A token page that scores its own incoming crowd is a genuinely new product.
- **Effort:** Medium. One bounded read + a token-page panel. **Risk:** needs a freshness
  window and a "thin data" empty state; don't overclaim on <10 buyers.

### A2. Cohort quality score on ANY holder table — one number, huge context
- **New question:** Reduce "what kind of holders does this token have" to a single, defensible
  badge: % smart-money-adjacent, % bot-like, % in coordination clusters, drift-instability.
- **Join:** the visible holder set → batched behavior + cluster + drift (the same batched read
  SURFACE-1 §5 needs). Aggregate → one score + a 4-part breakdown on hover.
- **Why:** an analyst scans 20 tokens/day; a per-token cohort-quality badge is the 10x-triage
  the brief asks for. Complements A1 (A1 = live buyers, A2 = current holders).
- **Effort:** Low–Medium (rides SURFACE-1's batched helper). **Risk:** score design must be
  legible, not a black box — show the components.

### A3. Behavioral cohort search — "find me wallets LIKE this profile" (no seed wallet) ⭐
- **New question:** Today similarity needs a seed *address*. Invert it: let an analyst
  **describe a behavior** ("fast flipper, >65% win-rate, trades micro-caps, high reentry")
  and retrieve the matching cohort DB-wide. This is SPEC-001's Q5 cohort query, unbuilt.
- **Join:** build a synthetic query vector from slider/filter inputs (reuse
  `buildWalletSourceVector` dims + population stats) → HNSW kNN → cohort. No seed wallet.
- **Why:** turns the vector space into a **search engine over behavior**, not just a
  "similar-to-X" lookup. Powers watchlist-building, lead-gen, "show me all the snipers".
- **Effort:** Medium (needs a query-vector builder + a new bounded endpoint). **Risk:** UI
  for "describe a behavior" is the hard part; start with 3-4 high-signal dims, not all 32.

### A4. Drift watchlist / "changed character" feed
- **New question:** Surface the SPEC002_T01 signal as a *feed*: "these 14 watched wallets
  changed behavior this week" (POSITION_TRADER → SNIPER = compromised/sold/botted).
- **Join:** WalletVectorHistory ordered by recent `driftFromPrevious` over a threshold,
  filtered to a user's watchlist or a cluster.
- **Why:** the cheapest genuinely-new temporal intelligence (SPEC-002 §2.1), and nobody else
  ships it. A standing "behavioral alerts" surface.
- **Effort:** Low (history + drift already stored; needs a threshold read + a feed panel).
  **Risk:** drift only populates on *rebuilds*; needs a periodic rebuild cadence to be live
  (flag: today history self-populates only when a profile is re-analyzed).

### A5. "Constellation" mini-map on the wallet profile — pivot without a new page
- **New question:** On the existing wallet profile, a small always-present neighborhood map:
  top-k siblings + cluster co-members, each clickable to re-center. Folds the *rejected*
  standalone explorer's intent into a surface analysts already open.
- **Join:** `/similar?rerank=true` + `/cluster`, rendered as a compact node cluster.
- **Effort:** Medium (a bounded force layout, ≤k nodes). **Risk:** keep it a *map*, not a
  full graph tool; hard cap node count.

---

## B. MACHINE surfaces (intel API / MCP / agents) — the underserved half

The dispatch is dashboard-framed, but the substrate's cleanest fit is **machine consumers**:
agents want a bounded, factual, DB-wide primitive, not a UI. These are cheap because the
retrieval already exists — they're mostly new *endpoint shapes* over the same reads.

### B1. `wallet_reputation` — one call, agent-ready verdict ⭐
- **New question:** An agent asks "should I copy/fade this wallet?" and wants a *decision-
  support* payload, not raw stats: peer-relative percentile (win-rate vs. its k behavioral
  neighbors), cluster membership (coordinated?), drift-stability, "smart-money-likeness".
- **Join:** kNN neighbors → aggregate their outcomes → percentile the seed against its own
  cohort (this is **k-NN outcome-by-analogy**, SPEC-002 §2.3, no model trained).
- **Why:** the highest-value MCP tool we don't have. "Rank this token's holders by predicted
  quality" is a one-call answer agents will pay for. Extends the existing `wallet_hud`.
- **Effort:** Medium (kNN + PnL aggregation + percentile; new intel endpoint + SDK/MCP tool).
  **Risk:** must label confidence honestly (n-neighbors, data tier); never present analogy as
  prediction. Bounded, read-only, no ML.

### B2. `similar_wallets` as a first-class public/MCP tool (seed → DB-wide neighbors)
- **New question:** The internal `/similar` exists but the *agent-optimized* single-seed,
  instant, DB-wide sibling lookup isn't a headline MCP tool. Expose it: address in → ranked
  neighbors with strategy/winRate/shared-tokens out.
- **Why:** it's the cleanest demonstration of the whole substrate for the agent audience, and
  it's already built + audited internally. Mostly packaging + docs.
- **Effort:** Low. **Risk:** rate/credit shape; 404 for no-vector wallets.

### B3. `token_crowd` — characterize a mint's buyers/holders as a batch (A1's machine twin)
- **New question:** Agent passes a mint → gets the crowd fingerprint (behavior mix, cluster
  density, median reputation, bot share) as structured JSON.
- **Join:** same as A1, emitted as a bounded batch payload.
- **Why:** lets trading agents gate entries on *who else is in the token*. A differentiated,
  substrate-only endpoint.
- **Effort:** Medium. **Risk:** batch-size cap on holder set; freshness window.

### B4. `cohort_query` API — behavior-vector search for machines (A3's twin)
- **New question:** Describe-a-behavior → matching wallet set, as an API. The inverse index
  as a service.
- **Why:** enables downstream products (screeners, lead-gen, monitoring) to subscribe to a
  *behavioral segment* instead of a static list.
- **Effort:** Medium–High (query-vector contract is the design cost). **Risk:** define the
  query DSL narrowly first; guard against unbounded result sets.

### B5. Cluster-as-lookup endpoint for coordination ("is this a ring?") 
- **New question:** Agent/analyst passes a wallet or a set → stored cluster verdict + members
  + confidence, O(1), no per-request correlation. Already 90% there (`/cluster`).
- **Why:** turns coordination detection into a *lookup*, the SPEC-001 Q4 win, consumable by
  bots (e.g. the sova-x / TG surfaces) not just the dashboard.
- **Effort:** Low. **Risk:** clusters refresh on materializer cadence; state staleness clearly.

---

## C. Cross-cutting / higher-ceiling (flag, don't build yet)

- **C1. Reputation-weighted token scoring.** Aggregate B1 across a token's holders → a
  token-level "backed-by-smart-money" index. Composes A2 + B3. High value, needs A/B first.
- **C2. Formation *alerting*** (SPEC-002 §2.2, SPEC002_T02): densification watch over the WW
  edge table on young mints → "14 wallets converging on a 3h-old token NOW". Still gated on
  the false-positive backtest (WalletHuntSnapshot replay). Highest ceiling, highest risk;
  keep behind its gate.
- **C3. Trajectory embeddings / learned metric** (SPEC-002 §2.4/§3): stays hard-gated — 0
  confirmed-positive labels on real data (Gate-0: 6 unreviewed / 564 ignored). Do NOT pursue
  until label capture (SPEC002_T04) yields volume. Named here only to keep it visibly parked.

---

## D. Recommended sequencing (what actually makes a difference)

Ranked by (value × cheapness), honest about dependencies:

1. **A1 + A2 (token crowd + cohort quality)** — biggest product flip (forensics→alpha), rides
   the batched read SURFACE-1 already needs. Ship with SURFACE-1's Surface A.
2. **B1 `wallet_reputation` MCP/API tool** — highest-value machine primitive; k-NN analogy,
   no ML, extends an audience (agents) the dashboard ideas ignore.
3. **A3/B4 cohort search (behavior → wallets)** — converts the space into a search engine;
   the most *strategically* differentiating, medium effort.
4. **A4 drift watchlist** — cheapest temporal win; needs a rebuild cadence decision.
5. **A5 constellation map / B2 similar_wallets tool** — polish + packaging of built engines.
6. **C2 formation alerting** — only after its backtest gate; highest ceiling.

**The through-line:** stop shipping forward lookups; ship the **inversions** (behavior→wallets,
outcome→antecedent, token→crowd-quality) and serve them to **machines as much as humans**. The
substrate's real unspent power is that it makes those inversions O(ms), and no competitor with
only per-request analysis can answer them at all.

---

## E. PRIORITY EXTRACTION — what to actually start next (decision-ready)

*Distilled from section D + the verified-reality gate. This is the "where do I navigate to"
list for the next build session. Ordered by (value × cheapness × unblocked).*

**START HERE (top 3, all unblocked, all ride SURFACE-1's batched read):**

1. **SURFACE-1 Surface A + Catalog A2 — cohort-quality on the Holder Profiles table.**
   The single cheapest "wow" in a daily flow. Replaces the old cohort-scoped `SimilaritySidebar`
   / client-side `analyzeSimilarityGraph` with DB-wide siblings + confident-cluster badge + drift
   flag per holder row. **Gate:** must land the one **batched** `WHERE addr IN (...)` helper first
   (N+1 guard, §5 of the design note). **Reality checks:** pitfall 1 (empty state for no-vector
   rows), pitfall 2 (cluster badge empty for ~99% is normal). *This is already the chosen
   SURFACE-1 build — it just also delivers A2 for free.*

2. **Catalog A1 / B3 — "who is accumulating this NEW token" early-crowd fingerprint.**
   The biggest product *flip* (forensics → alpha). One bounded read over `WalletTokenEdge`
   (buyers in a firstTs window) → behavior + cluster + winRate. Ship the human panel (A1) and
   its machine twin (`token_crowd`, B3) from the same read. **Reality checks:** pitfall 1
   (thin-data empty state under ~10 buyers), pitfall 2 (cluster density will usually be ~0 —
   present it as "N of M buyers are coordinated," where 0 is the common, correct answer).

3. **Catalog B1 — `wallet_reputation` MCP/API tool (k-NN outcome-by-analogy).**
   Highest-value *machine* primitive, serves the agent audience the dashboard ideas ignore.
   kNN neighbors → aggregate their PnL → percentile the seed against its own cohort. No ML.
   **Reality checks:** pitfall 1 (404 on no-vector seed), and label confidence honestly
   (n-neighbors, data tier) — never present analogy as prediction.

**THEN (second wave, once the above prove the pattern):**

4. **Catalog A3 / B4 — behavior→wallets cohort search** (the vector space as a search engine;
   most strategically differentiating; medium effort — the query-vector builder is the real cost).

**PARKED (do not start — blocked on a named prerequisite):**

- **A4 drift watchlist** — blocked on a **rebuild-cadence decision** (pitfall 4). Cheap once
  that exists; inert until it does.
- **C2 formation alerting** — blocked on its false-positive backtest gate (SPEC002_T02).
- **C3 trajectory embeddings / learned metric** — hard-gated: 0 confirmed-positive labels.

**One-line for the next session:** *open SURFACE-1, build Surface A behind the batched read
(that also gives you A2), then reuse that read for A1/B3; B1 is the parallel machine track.*
