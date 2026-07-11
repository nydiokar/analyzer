# AGENT 8 — SURFACE-1: surface the wallet-representation layer into the dashboard

Lane: DESIGN + PRODUCT INTEGRATION (not substrate). Everything this job needs already
exists in the database and the API. The job is to decide **where and how** the new
capability changes the product surfaces users actually use — and then build it.

## 0. Why this exists (read this first)

SPEC-001 and SPEC-002 built a real new capability class: persisted behavioral vectors,
a wallet↔token and wallet↔wallet edge graph, materialized coordination clusters, and
millisecond-latency database-wide kNN over an HNSW index. It is validated on real data
(SPEC_T05: 64,378 vectors, 3M token edges, 117 clusters / 421 memberships).

**But the specs stopped at the substrate. No one designed how this shows up in the
product.** The similarity flow, holder profiles, and cluster views still present the OLD
model. We are empowered and haven't spent the power where people look. Closing that is
this job. This is a gap in the roadmap, filed on purpose — treat it as a first-class
design problem, not a mechanical wiring task.

## 1. Boot

Read in order:

1. `.ai/CONTEXT.md` — Active Work (SURFACE-1), and the SPEC001_T06 / T06-caveat rows.
2. `.ai/dispatch/DISPATCH_LOG.md` — SPEC001_T06 and SPEC_T05 entries (what the substrate is).
3. `.ai/dispatch/AGENT_7_SPEC001_VECTOR_SIMILARITY_REDESIGN.md` — the vector-first engine.
4. `documentation/specs/SPEC-001-wallet-representation-layer.md` — the "impossible today"
   queries this unlocks (global kNN Q3, cohort queries Q5, cluster-as-lookup Q4).
5. `documentation/specs/SPEC-002-temporal-intelligence-and-the-learned-metric.md` — the
   several-steps-ahead framing (representation → time axis → labels).
6. Endpoints you can already call: `src/api/controllers/intel.controller.ts`
   (`GET /intel/wallet/:addr/similar` — now enriched with strategyType/speedCategory/winRate,
   `?rerank=true` adds shared-token + blendedScore; `GET /intel/wallet/:addr/cluster`).
7. The existing consumer + proof already built: `dashboard/src/app/wallet-siblings/page.tsx`
   (a NARROW demo — one seed, instant kNN), and `scripts/spec001-similarity-delta-proof.ts`.
8. The surfaces that still show the OLD model:
   - `dashboard/src/app/similarity-lab/page.tsx` (heavyweight, queue-backed, ≥2 wallets).
   - Holder Profiles: `dashboard/src/components/holder-profiles/v2/`.
   - Any cluster/correlation display in the dashboard.

## 2. The problem, stated as a product question

Today an analyst investigating a token sees the holders **in that cohort**. The new
substrate can answer questions the old flows structurally cannot — cheaply, globally,
and on demand. The job is to find the highest-leverage places to put that, design the
surface, and build it so we FEEL the added value in a flow we already use.

## 3. Provocations — NOT a spec, do not anchor on these

The product owner named a few directions. **They are deliberately listed as proof that
the power exists, not as a task list.** You are expected to think past them, find better
surfaces, and justify your own. If your best design ignores all three of these, that is a
valid and welcome outcome — say why.

- Related wallets **across the whole database**, not just the cohort under investigation.
- **More confident** coordination clusters as a first-class lookup (not ephemeral
  per-request correlation).
- A dedicated **exploration surface** where analysts pivot wallet→wallet through the
  neighborhood instead of running one-shot jobs.

Do your own discovery. Ask: which existing screen is most used, and what would the new
representation let it say that it can't today? Where is the "wow" cheapest to deliver?
What does an analyst do 20 times a day that this makes 10x faster or newly possible?

## 4. Task

1. **Design pass (write it down).** Investigate the real surfaces, enumerate candidate
   integrations, and pick 1–2 with an explicit rationale (leverage, effort, whether it
   changes a daily flow vs. adds a side page). Produce a short design note in
   `.ai/context/` before building. This is where the creative work happens.
2. **Build the chosen surface(s).** Consume the EXISTING endpoints. Match dashboard
   conventions (AppShell, fetcher with JWT/API-key auth, SWR/useJobProgress where
   relevant, shared components like WalletBadge). Additive; do not regress existing flows.
3. **Prove the value in a flow we use.** The acceptance bar is "we open a screen we
   already use and the new capability is visibly, usefully there" — not a new demo route
   in isolation (we already have `/wallet-siblings` for that).

## 5. Hard guards

- **Substrate is done — do not rebuild it.** No new migrations, materializers, or scoring
  schemes unless a specific, justified gap blocks the surface. If you hit a missing read,
  prefer a thin bounded read helper in `database-service.ts` over new pipelines.
- **Raw vectors never reach the browser.** The 32-dim vector stays server-side; surfaces
  consume search RESULTS (addresses, distances, labels, cluster membership), never vectors.
  (Obfuscation of client-exposed identifiers is a separate future concern — note it, don't
  solve it here.)
- **Bounded everything.** Every kNN / candidate / cluster read is capped (k, memberLimit,
  edgeLimit already are). No all-pairs or full-table scans in a request path.
- **Additive to the API contract.** If you need a new field/endpoint, keep the existing
  ones byte-identical and run `pnpm run intel:audit:strict` (must show no SDK/contract drift).
- **Don't re-prioritize the roadmap.** This job runs after SPEC001_T01 / SPEC002_T01 close.
  Confirm those are done before building; if not, do the design note and stop.

## 6. Acceptance

- A written design note with candidate surfaces, the 1–2 chosen, and the rationale
  (including any provocations you rejected and why).
- The chosen surface built, consuming existing endpoints, matching dashboard conventions,
  additive, `tsc` + `next lint` clean, intel audit clean if the API surface changed.
- Demonstrable in a flow an analyst already uses. Bare address+number dumps are a fail —
  neighbors/clusters carry the human context (behavior, win rate, shared tokens, confidence).
- `.ai/CONTEXT.md` and `DISPATCH_LOG.md` updated with what landed.

## 7. Service boundary checklist (for any new read/endpoint)

- Concurrency: reads are cheap but repeatable — cap k/limits; keep any heavy path queue-backed.
- Memory at scale: never materialize a full pair space or full cluster graph in a request.
- Request size: cap seed batches and k.
- Timeout: retrieval is one indexed query; bounded re-rank has a fixed ≤k ceiling.
- Malformed input: validate wallet addresses; structured 404 when a wallet has no vector
  (not all wallets have a behavior profile — 64,378 of 76,681).
- Backing resources: on DB/index failure, structured error; never fall back to an O(n²) scan.
