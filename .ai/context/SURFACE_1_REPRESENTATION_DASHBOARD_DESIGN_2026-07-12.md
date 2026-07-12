# SURFACE-1 — Design Note: surfacing the representation layer into the dashboard

**Date:** 2026-07-12
**Author:** SURFACE-1 design pass (design-only; build gated on SPEC001_T01 close)
**Brief:** `.ai/dispatch/AGENT_8_SURFACE_REPRESENTATION_DASHBOARD.md`
**Status:** DESIGN NOTE — no build this pass (SPEC001_T01 still `in_progress`; guard §5).
**Substrate proven:** SPEC_T05 real data — 64,378 vectors, 3.06M token edges, 2,776 WW
edges, 117 clusters / 421 memberships; HNSW kNN 1.5–46ms. SPEC002_T01 vector history +
drift closed 2026-07-12 (100% coverage, population-invariant drift).

---

## 1. The gap, found in the real code (not assumed)

The holder-profiles v2 surface **already has** a similarity + cluster UI —
`SimilaritySidebar.tsx` + `ClusterIndicator.tsx` — but it is built entirely on the **old
model**:

- It consumes `CombinedSimilarityResult.pairwiseSimilarities` — the **queue-backed,
  cohort-scoped, ≥2-wallet** similarity job (`SimilaritySidebar.tsx:47`).
- Clusters are computed **client-side and ephemerally** every render via
  `analyzeSimilarityGraph(pairs)` (`SimilaritySidebar.tsx:90`, `utils/similarity-clusters`).
  This is exactly the "ephemeral per-request correlation" the brief says to replace.
- Every pair is scoped to **the holders currently on screen**. It structurally cannot say
  "this holder is coordinated with 11 wallets that are NOT in this token" — the single
  highest-value question the new substrate answers.

So the surface to change is not missing — it is present and **actively showing the weaker
model in the exact place analysts look**. That is the cheapest, highest-leverage "wow":
same screen, strictly better answer, no new page to learn.

## 2. The two connected surfaces (per product-owner direction)

Treat Holder Profiles and the Similarity Lab as **one linked flow**, not two pages:

1. **Holder Profiles table (the daily flow)** — inline, per-holder, DB-wide signal that the
   cohort-scoped job cannot produce.
2. **Similarity Lab (the deep dive)** — the surface a holder-row signal **pivots into**,
   upgraded from the heavyweight queue job to the instant vector-first engine.

The connective tissue: a click on a holder's "siblings" or "cluster" chip deep-links into
the Lab **pre-seeded with that wallet**, instant kNN, no queue. One flow: notice in the
table → explore in the Lab.

### 2.1 Surface A — Holder Profiles inline (primary, daily flow)

For each holder row, add three signals sourced from the **stored** substrate (all bounded,
all ms-latency, none cohort-scoped):

| Signal | Source | What it says that today's UI cannot |
|---|---|---|
| **DB-wide siblings** | `GET /intel/wallet/:addr/similar?rerank=true` | "Top-k behaviorally-nearest wallets across all 64k — with strategyType / winRate / shared-token count." Not limited to this token's holders. |
| **Confident cluster badge** | `GET /intel/wallet/:addr/cluster` | Stored coordination-cluster membership (clusterId, size, role, top edges) — a first-class lookup, not a client-side graph recomputed per render. |
| **Behavioral drift flag** | `getWalletVectorHistory(addr)` (SPEC002_T01 helper) | "This wallet changed character on <date>" — a temporal signal that does not exist anywhere in the product today. |

Presentation (respecting the "no raw address+number dump" acceptance bar): each is a small
chip in the row / expanded row, carrying human context — sibling count + top strategy,
cluster size + confidence %, drift magnitude + date. Raw vectors never cross to the browser
(guard §5): the UI consumes **results only**.

### 2.2 Surface B — Similarity Lab, upgraded (the deep dive it pivots into)

`dashboard/src/app/similarity-lab/page.tsx` is the most visibly "old model" screen: it
requires ≥2 wallets and runs a queue-backed job. Upgrade path:

- Accept a **single seed** (deep-linked from a holder row) and answer instantly via the
  vector-first engine (`findRankedSimilarWallets`, already proven 11–46ms), same as
  `/wallet-siblings` but *in the Lab the analyst already uses* — not an isolated demo route.
- Keep the existing ≥2-wallet queue flow intact and additive (guard: don't regress).
- Surface `?rerank` (shared-token boost) as a toggle, so behavioral vs. coordination views
  are one click apart — the SPEC001_T06 delta, made visible.

## 3. Provocations — accepted / rejected (brief §3 requires this)

- **"Related wallets across the whole DB"** → **ACCEPTED**, it is the spine of Surface A.
  This is the one capability the cohort-scoped job structurally lacks.
- **"Confident clusters as a first-class lookup"** → **ACCEPTED** as the cluster badge,
  replacing the client-side ephemeral `analyzeSimilarityGraph`.
- **"Dedicated wallet→wallet exploration surface"** → **REJECTED as a standalone page.**
  Reason: the brief's own acceptance bar is "a flow we ALREADY use," and `/wallet-siblings`
  already exists as the isolated demo. A brand-new graph-pivot page is the highest build
  cost and lowest daily-flow leverage of the three. Instead its *intent* (pivot
  wallet→wallet) is folded into Surface B: a holder-row click re-seeds the Lab, and each Lab
  neighbor is itself clickable to re-seed again — iterative pivoting **without** a new page.

## 4. Why this ordering (leverage vs. effort)

- **Surface A is the cheapest wow**: the endpoints exist, emit human context already, and
  the target screen is the one analysts hit dozens of times a day. The only new server work
  is a possible thin batched read (see §5), not a pipeline.
- **Surface B reuses `/wallet-siblings`'s proven engine** in a screen with real traffic,
  and provides the pivot destination for A's chips — so the two ship as one coherent story.
- **Rejected exploration page** would be net-new UI with no existing-flow anchor → fails the
  acceptance bar for the most effort.

## 5. Anticipated build gaps (flag now, do not solve this pass)

- **N+1 risk on the holder table.** Per-row `/similar` + `/cluster` + drift = 3 calls × N
  holders. A cohort table has up to ~100 rows → 300 calls. **Required before build:** a
  **batched** read (one `WHERE addr IN (...)` query per signal, bounded to the visible page),
  mirroring the existing `getWalletBehaviorEnrichment` batched-join pattern (SPEC001_T06-caveat).
  Prefer a thin bounded helper in `database-service.ts` over per-row fan-out (guard §5, §7).
- **404 semantics.** 64,378 of 76,681 wallets have a vector; the rest 404 on `/similar` and
  `/cluster`. The row UI must render an explicit "no representation yet" empty state, not an
  error (brief §7 malformed/So structured-404).
- **Drift read surface is server-only today.** `getWalletVectorHistory` has no controller.
  Surface A needs either a bounded intel endpoint (additive; must pass
  `pnpm run intel:audit:strict`) or to fold drift into the batched enrichment read. Decide at
  build time; keep existing contract byte-identical.
- **Cluster confidence label mapping.** Old UI derived cohesion client-side; the stored
  cluster carries `score`/edge data. Map stored edge scores → the existing
  `getClusterStrengthLabel` buckets so the visual language stays consistent.

## 6. Acceptance for the eventual build (restated from brief §6)

- Chosen surfaces (A primary, B connected) built on **existing endpoints** + one bounded
  batched read helper if §5 requires it; additive; `tsc` + `next lint` clean;
  `intel:audit:strict` clean if any API field is added.
- Demonstrable in Holder Profiles (a flow analysts already use), signals carry human context
  (strategy, win rate, shared tokens, cluster confidence, drift date) — no bare dumps.
- `.ai/CONTEXT.md` + `DISPATCH_LOG.md` updated.

## 7. Gate status

- **SPEC002_T01:** closed 2026-07-12 ✅
- **SPEC001_T01:** `in_progress` — remaining work is Gate-0/Gate-2 counts + public docs +
  agent skill (DISPATCH_LOG:13), i.e. **paperwork, not the endpoints this job consumes**.
  Per guard §5 the build waits on its formal close; this design note is the allowed step and
  is complete. **Next session: build Surface A behind the batched read from §5.**
