# AGENT 10 — Start implementing the representation layer into the frontend (prioritized)

Lane: BUILD (frontend + one bounded backend read). This is the **execution** job that turns the
validated substrate + the SURFACE-1 design + the build catalog into shipped product surfaces. The
design thinking is done; this is "build it, in this order, without stepping on the substrate's
known pitfalls."

## 0. Relationship to prior jobs (do not re-do these)

- **SURFACE-1 (`AGENT_8_...`)** = the *design* pass. Its design note is chosen and final
  (Surface A = Holder Profiles inline; Surface B = single-seed Similarity Lab as pivot). **Do not
  re-design.** Build what it chose.
- **The build catalog** (`REPRESENTATION_BUILD_CATALOG_2026-07-12.md`) section E = the priority
  order. This job executes that order.
- **Substrate reality** (catalog "⚠️ VERIFIED SUBSTRATE REALITY" block + AGENT_9 doc if landed) =
  the pitfalls you MUST handle. Read them before writing a line of UI.

## 1. Boot (read in order)

1. `.ai/CONTEXT.md` → SURFACE-1 row + Architecture Decisions coverage note.
2. `.ai/context/SURFACE_1_REPRESENTATION_DASHBOARD_DESIGN_2026-07-12.md` (the chosen surfaces + §5 gaps).
3. `.ai/context/REPRESENTATION_BUILD_CATALOG_2026-07-12.md` → reality block + section E priorities.
4. `.ai/context/COLLECTIONS_VECTOR_VALIDATION_2026-07-12.md` → interpretation guardrails (labels).
5. Existing code to reuse, NOT rebuild:
   - Endpoints: `src/api/controllers/intel.controller.ts` (`/similar?rerank=true`, `/cluster`),
     `getWalletVectorHistory` + kNN helpers in `database-service.ts`.
   - Old-model surfaces to upgrade: `dashboard/src/components/holder-profiles/v2/SimilaritySidebar.tsx`,
     `ClusterIndicator.tsx`; `dashboard/src/app/similarity-lab/page.tsx`.
   - Proven demo to harvest from: `dashboard/src/app/wallet-siblings/page.tsx`,
     `scripts/spec001-similarity-delta-proof.ts`.

## 2. Build order (execute top-down; each step ships independently)

### STEP 1 — the batched read helper (backend, unblocks everything)
Before any UI: add ONE bounded batched read in `database-service.ts` that takes the visible
holder page (≤~100 addresses) and returns, per address, in a single `WHERE addr IN (...)` query
per signal: kNN-sibling summary, cluster membership, and drift flag. Mirror the existing
`getWalletBehaviorEnrichment` batched-join pattern. **This is the N+1 guard** (design note §5):
3 calls × 100 rows = 300 calls is the failure mode to prevent. Decide drift surface here: fold
drift into this batched read rather than a new endpoint unless a clean additive endpoint is
cheaper. If any API field is added, `pnpm run intel:audit:strict` must stay clean.

### STEP 2 — Surface A: Holder Profiles inline (this also delivers Catalog A2)
Per holder row, three chips off the STEP-1 read: **DB-wide siblings** (count + top strategy),
**cluster badge** (size + role — **but see pitfall: ~99% of rows have NO cluster; empty is the
normal state, render nothing/neutral, not an error**), **drift flag** (magnitude + date, only if
history exists). Replace the old cohort-scoped `SimilaritySidebar` / client-side
`analyzeSimilarityGraph`. Aggregate the same read into a per-token **cohort-quality badge**
(Catalog A2): % coordinated / % bot-like / median neighbor win-rate — components visible on hover,
not a black box. **Labels: "behavioral fingerprint" / "coordinated," NEVER "same person."**

### STEP 3 — Surface B: single-seed Similarity Lab as the pivot destination
Upgrade `similarity-lab/page.tsx` to accept a single seed (deep-linked from a Surface A chip) and
answer instantly via the vector-first engine (reuse `/wallet-siblings`'s proven path, 11–46ms).
Keep the existing ≥2-wallet queue flow intact + additive. Surface the `?rerank` toggle
(behavioral vs coordination view = one click). Each neighbor is itself clickable to re-seed
(iterative pivot without a new page — the rejected standalone explorer's intent, folded in).

### STEP 4 (optional, if time) — Catalog A1 token early-crowd panel
Only after A/B land. One bounded read over `WalletTokenEdge` (buyers in a firstTs window) →
behavior + cluster + winRate → a token-page panel. Thin-data empty state under ~10 buyers.

## 3. Pitfalls you MUST handle (from verified substrate reality)

- **404 / no-representation:** 64,378 of 76,681 wallets have a vector; the rest 404 on
  `/similar` + `/cluster` **by design** (zero-swap wallets). Every chip renders an explicit
  "no representation yet" state, never an error. Do NOT treat this as a coverage bug.
- **Cluster absence is normal:** 0.65% of wallets are in any cluster. The cluster badge is empty
  for ~99% of rows — design so an empty badge looks intentional, not broken.
- **No `WalletCluster` parent table:** cluster metadata must come from `WalletClusterMembership`
  aggregation; there is no parent row to join.
- **Drift is not live:** history populates only on re-analysis. A drift flag is best-effort
  ("last known character change"), not a real-time signal, until a rebuild cadence exists — do
  not imply liveness.
- **Raw vectors never reach the browser.** UI consumes results (addresses, distances, labels,
  cluster membership) only.

## 4. Conventions + guards

- Match dashboard conventions: AppShell, JWT/API-key fetcher, SWR / `useJobProgress` where
  relevant, shared `WalletBadge`. Additive; do not regress the existing ≥2-wallet flow.
- Bounded everything: caps on k, member/edge limits, holder-page batch size.
- `tsc --noEmit` (backend + dashboard) + `next lint` clean; `intel:audit:strict` clean if any API
  field changed.
- Validate against :5434 using the known-connected collections as a live smoke test: open a token
  the Solomon/FLORK wallets hold and confirm the sibling/cluster chips light up correctly, and
  that a STELLAR-type wallet shows *no* false cluster.

## 4b. DURABLE PRINCIPLE — engine swap, not parallel copy (read before any surfacing work)

*Added 2026-07-12 after a build that first violated it, then corrected. This is the standing
rule for surfacing the representation layer into ANY existing product surface.*

- **The UI reflects the REAL API/engine state.** If a screen ends up showing two answers to the
  same question, that is not a UI bug — it is the visible symptom of a redundant engine/path that
  must be reconciled or killed at the SOURCE (service + API), not papered over in the component.
- **Swap the engine underneath a functionality; do NOT spawn a second parallel functionality.**
  Before adding UI, trace the existing chain end-to-end (page → endpoint → processor → service →
  math). Find the ONE link that is the outdated computation and exchange only that link. Do not
  touch the surrounding pipeline (sync / PnL / behavior / token-mcap enrichment / balances) — that
  orchestration produces "goodies" other parts depend on; severing it breaks sequencing.
- **Reconcile scope explicitly.** Cohort-scoped ("who here, in THIS token, is coordinated") and
  DB-wide ("does this wallet belong to a known ring ANYWHERE") are DIFFERENT questions and both are
  wanted. Keep both, label each by scope. Never let a new DB-wide signal silently shadow or
  duplicate an existing cohort signal.
- **Preserve numeric honesty.** Do not return a new engine's number in an old field that means
  something else (e.g. behavioral-vector proximity ≠ capital-weighted token overlap). Swap the
  judgment (clusters/connections) via an ADAPTER into the shape the UI already consumes; keep the
  old evidence detail (token-overlap bars) intact.
- **Concrete instance (done):** the holder-profiles `SimilaritySidebar` cluster/connection truth
  was recomputed client-side per render (`analyzeSimilarityGraph`) from a cohort-scoped queue job
  that re-fetched raw transactions. The swap: a persisted-engine read `getCohortCoordination()`
  (materialized `WalletClusterMembership` rings + `WalletWalletEdge` edges) → adapter
  `buildPersistedGraphAnalysis()` → same `SimilarityGraphAnalysis` shape → same sidebar/table,
  unchanged interactions. The queue pipeline is untouched; only the coordination judgment moved to
  the materialized engine (higher confidence, DB-wide corroboration, no per-request tx refetch).

## 5. Acceptance

- STEP 1 batched read landed (no N+1), STEP 2 + STEP 3 built on existing endpoints, additive,
  all four pitfalls handled, labels honest ("fingerprint"/"coordinated").
- Demonstrable in Holder Profiles (a daily flow) — chips carry human context, no bare
  address+number dumps.
- Smoke-verified on :5434 against the known-connected collections.
- `.ai/CONTEXT.md` + `DISPATCH_LOG.md` updated with what landed.
