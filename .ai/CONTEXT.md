# Sova Intel — Project Context

**Branch:** `main` | **Last Updated:** 2026-07-12 | **Status:** `@sova-intel/mcp@0.1.0` published; token detail sidebar feature planned and ready for implementation.

---

## Active Work

| ID | Task | Priority |
|:--:|:-----|:--------:|
| SPEC001_T01 | ✅ **DONE (substrate) 2026-07-12** — representation substrate closed + validated on real data. All of: additive migration, feature-vector builder, vector/edge/cluster materializers, bounded Intel read endpoints, SDK methods, label-capture fixes — landed and proven on :5434. **Gate-0 counts filled** (`scripts/spec001-gate0-ledger.ts`): 76,681 wallets / 14.9M swaps / 527,902 mints / 64,378 vectors / 3.06M token edges (projection = actual); 2,776 WW edges; labels 6 unreviewed / 564 ignored / **0 confirmed-positive**. **Note:** 64,378 vectors = **100% of tradeable wallets** (= behavior-profile count); the 12,303 without a vector have **zero swaps** and are un-vectorizable by definition — NOT a coverage gap (see Architecture Decisions → "Representation-layer coverage is NOT a gap"). Only outstanding item = external public docs + agent SKILL.md → **de-coupled to GUIDE-1** (not a blocker for internal work). See DISPATCH_LOG SPEC001_T01. | ✅ |
| SPEC001_T06 | ✅ **DONE 2026-07-11** — vector-first similarity landed + validated on real data. HNSW index-defeat bug fixed (455ms→1.5ms, identical neighbors), boosting blended re-rank, `?rerank=true` additive endpoint, WW materializer rewritten (3m34s vs old 8min-killed), cluster pipeline intact. See DISPATCH_LOG SPEC001_T06. | ✅ |
| SPEC002_T01 | ✅ **DONE 2026-07-12** — vector history + behavioral-drift pilot closed on real data (:5434). `WalletVectorHistory` backfilled **64,378/64,378 = 100%** coverage of current `WalletVector` (acceptance ≥99%); rerun idempotent (0 dup rows/keys); drift deterministic (tests pass); live append+drift path verified e2e (changed vector → `driftFromPrevious≈2.0`). Read surface = minimal bounded O(1)-by-wallet DB helper `getWalletVectorHistory` (no API endpoint — SURFACE-1 owns product surfacing). History now self-populates via the existing `upsertWalletBehaviorProfile` write-path. See DISPATCH_LOG SPEC002_T01. | ✅ |
| SPEC001_T06-caveat | ✅ **DONE 2026-07-12** — field-tested on real-data copy (:5434). (a) **Payload enriched**: `/similar` now returns `strategyType`/`speedCategory`/`winRate` per neighbor in BOTH default and rerank modes via one batched join (`getWalletBehaviorEnrichment`) — no more bare address+distance; DTO fields optional/nullable, intel audit clean (no contract drift). (b/c) **Dedicated dashboard consumer**: new `/wallet-siblings` route (single-seed instant HNSW lookup + rerank toggle), distinct from the heavyweight queue-backed Similarity Lab. (d) **Delta proven**: `scripts/spec001-similarity-delta-proof.ts` shows rerank keeps the behavioral pool and PROMOTES coordination siblings (e.g. seed → top-2 neighbors with shared=24/23 tokens surfaced above cosine-only order); retrieval 11–46ms. Controller-level payload verified end-to-end (8/8 assertions) on real data. **Deferred**: public docs-site coverage for `/similar` + `/cluster` (SKILL.md + sova-intel docs) — pre-existing gap flagged by intel audit, not a regression; tracked under GUIDE-1. | ✅ |
| MCP-8 | **[sova-intel-mcp] Post-publish end-to-end smoke test** — install published MCP in Claude Desktop or Claude Code, run `wallet_hud` live | 🟡 |
| MCP-13 | **[sova-intel-mcp] x402 runtime verification** — packaging is fixed; still need real standalone `x402` startup/payment verification | 🔴 |
| MCP-15 | **[sova-intel-mcp] Acceptance-bar verification pass** — local code/package fixes are done; still need live invalid-input, expired-result-key, upstream-error, limited-mode, apikey, and x402 verification against the API | 🟡 |
| GTM-3 | **Open Twitter bot for public use** — rate-limit and open; announce on @Sova_intel | 🟡 |
| SURFACE-1 | ✅ **DONE 2026-07-12** — representation layer surfaced into the dashboard (AGENT_10 build). **Surface A (Holder Profiles inline):** each holder row now carries DB-wide behavioral-sibling / coordination-cluster / drift chips (`RepresentationChips`), plus a per-token cohort-quality badge (`CohortQualityBadge`, catalog A2). **Surface B (Similarity Lab pivot):** `similarity-lab` renders a single-seed instant vector-first sibling panel (`SingleSeedSiblings`, reuses the `/wallet-siblings` HNSW path) — deep-linked via `?seed=` from a Surface A chip, rerank/coordination toggle, clickable re-seed; the ≥2-wallet queue flow is untouched (additive). **STEP 1 N+1 guard:** `getWalletRepresentationBatch()` in `database-service.ts` → new `@Public()` `POST /wallets/representation/batch` (`WalletRepresentationController`) — OFF the credit-gated `/intel` surface (mirrors `/wallets/hud/batch`), so **no `/intel` contract change** (`intel:audit:strict` exit 0). All 4 substrate pitfalls handled; labels honest ("behavioral fingerprint"/"coordinated", never "same person"). Verified: tsc (backend+dashboard) clean, `next lint` warnings-only, smoke on :5434 (`scripts/surface1-representation-batch-smoke.ts`) reproduces Solomon/FLORK clusters (4/4) + STELLAR correctly unlinked. **Engine swap (follow-up):** the `SimilaritySidebar` cluster/connection judgment no longer recomputes client-side (`analyzeSimilarityGraph`) from the tx-refetching cohort queue job — it now reads the persisted materialized engine via `getCohortCoordination()` → `POST /wallets/representation/cohort` → adapter `buildPersistedGraphAnalysis()` into the SAME `SimilarityGraphAnalysis` shape (passed as `graphAnalysisOverride`, legacy path kept as fallback). Pipeline (sync/PnL/behavior/mcap-enrichment) untouched; cohort token-overlap ribbon kept as evidence; cohort-vs-DB-wide scope reconciled + labeled. Durable engine-swap-not-parallel-copy principle recorded in the AGENT_10 brief §4b. See DISPATCH_LOG AGENT_10. Design note: `.ai/context/SURFACE_1_REPRESENTATION_DASHBOARD_DESIGN_2026-07-12.md`. | ✅ |
| REPR-QUAL | **[REPRESENTATION FIDELITY] The 32-dim vector was built by an under-reviewed agent pass — audit whether it faithfully maps behavior before building products on it.** Three priorities (details + first read-only findings: `.ai/context/REPRESENTATION_QUALITY_PRIORITIES_2026-07-12.md`). **Priorities (1) metrics↔vectors map + (2) dimension significance: ✅ DONE 2026-07-12** — full audit `.ai/context/METRICS_VECTOR_AUDIT_2026-07-12.md`, every claim SQL-reproducible on :5434. Headlines: **6 of 32 dims DEAD** (mcap key-drift bug `MCAP-VEC-BUG`, filed below — vector reads legacy `nano/micro/...` keys, DB stores `0-10k…1m+`, overlap 34/64,378=0.05%); vector strong on active-trading (FAST 0.90 purity) / weak on holding-distribution (PURE_HOLDER 0.25→72% land in LOW_ACTIVITY, DISTRIBUTOR 0.25→53% land in FAST_TRADER — proven via confusion matrix, mechanism = missing sell-skew + holding-magnitude dims); ~8 near-collinear fast-trade dims (dim8↔32 r=0.98); dim30 (`medianActiveHoldingHours`) is a legit open-position axis but the vector is MISSING the orthogonal closed-round-trip `medianCompletedHoldTimeHours` (r=0.11, different token universe) → ADD not replace; `flipperScore` blunt proxy confirmed (r=0.895 w/ %<1h). Per-dim keep/drop/replace/re-weight + excluded-metrics-that-deserve-a-dim + magnitude-axis open question all in doc. **Deepened into a behavioral-axis design map 2026-07-12** (`.ai/context/BEHAVIORAL_AXIS_MAP_2026-07-12.md`) — reframes the vector from "2 crude axes (speed×hold)" to ~10 independent behavioral axes carried by FEWER honest dims. Compaction ledger (every stored/computed metric → earns-a-dim or restates-existing, judged by behavioral meaning not coverage%). Key evidenced calls: **DROP** ~6 redundant speed/sequence dims (dim2/9/20/32 + one of dim7/14); **ADD** `medianCompletedHoldTimeHours` (Axis 3, orthogonal to dim30 r=0.11), `sellSkew`=sells/(buys+sells) (Axis 4 — separates DISTRIBUTOR 0.75 vs FAST_TRADER 0.47 where existing flow dims fail; `tokensWithOnlySells` is computed-but-NOT-stored), `averageSessionStartHour` as sin/cos (Axis 6 — orthogonal \|r\|<0.04, free), one bounded holding-conviction dim (Axis 5 — the PURE_HOLDER/LOW_ACTIVITY fix); **drop candidates** `*CurrentHoldingDuration*` (r=0.945–1.000 w/ dim30 = redundant); `confidenceScore`→weight not dim; derived labels (strategyType etc.) never fed back as dims. Explicit scope boundary: vector stays pure-behavior, money/magnitude answered from PnL tables (money = separate future embedding if wanted). **Priority (3) similarity correctness harness — STILL OPEN** (the ORIGINAL goal): known-connected collections pass (`COLLECTIONS_VECTOR_VALIDATION_2026-07-12.md`) but no systematic new-vs-old precision/recall/latency harness yet. NOT a build job — audits + harness. | 🟡 |
| MCAP-VEC-BUG | ✅ **DONE 2026-07-13 (fixed in AGENT_12 v2 rebuild).** `readMcapDistribution` now reads the real dollar-range keys and compacts them to one honest weighted-median positioning dim; the 6 dead dims are gone (harness confirms 0 dead dims on v2). See BEHAVIOR_VECTOR_V2_VALIDATION_2026-07-13. Original report kept below. — **[REPRESENTATION BUG — filed by REPR-QUAL audit]** `readMcapDistribution()` in `src/core/representations/wallet-feature-vector.ts` reads `mcapDistribution` JSON with legacy keys `nano / ultra-micro / ultraMicro / micro / small / mid / large / mega`, but `WalletBehaviorProfile.mcapDistribution` in the DB stores **dollar-range keys** (`0-10k, 10-20k, 20-30k, 30-50k, 50-100k, 100-200k, 200-500k, 500k-1m, 1m+`). Key overlap = **34 of 64,378 wallets (0.05%)** → vector dims **16,17,18,19,25,26 are ~99.95% zero / near-zero variance = DEAD**. The intended market-cap-positioning axis is structurally absent from the vector. **Fix options** (don't just delete): (a) map the 9 dollar-range keys into the intended bucket dims, or (b) read the already-populated `entryMcapDistributionByCount` (also byte-range keys), then re-run `scripts/spec001-backfill-wallet-vectors.ts` (population stats + all vectors change → also re-append vector history / re-materialize edges as appropriate). **Impact if unfixed:** nano-cap-degen vs large-cap-rotator are indistinguishable in the vector; any mcap-aware cohort/similarity surface is silently broken. Verified read-only on :5434; SQL in the audit doc §1B. | 🔴 |
| AGENT_11 | **[REPRESENTATION → CAPITAL] Add the money/capital axis as a SEPARATE embedding** (behavior vector stays pure by design). Brief: `.ai/dispatch/AGENT_11_CAPITAL_OUTCOME_EMBEDDING.md`. **Part A** (read-only): audit every stored/computed money metric — `WalletPnlSummary` (64,271), `AdvancedTradeStats` (63,228), `mcapBucketPnl` (~98% coverage, data ALREADY exists) — into capital axes, kill redundancy, add a per-wallet **data-quality flag** (untracked inter-wallet transfers corrupt PnL), bound every dim; GATE if too impure. **Part B** (if green): additive `WalletCapitalVector`+`CapitalPopulationStats`+HNSW, `capital-feature-vector.ts` mirroring the behavior builder, backfill + **live-write-path hook** (self-populates on import). No /intel contract, no UI. Cost: days — road already paved. Ready. | 🟡 |
| AGENT_12 | ✅ **DONE 2026-07-13** — behavior vector rebuilt to v2 (32→27 dims) on :5434. Adversarially reviewed the brief first (`.ai/context/AGENT_12_ADVERSARIAL_REVIEW_2026-07-13.md` — found 5 gaps: A null-semantics, B all-or-nothing version cutover, C false retention guard, D mandatory test/stats recompute, E missing harness) and executed via the corrected order. Built the acceptance harness (`scripts/spec-agent12-vector-quality-harness.ts`, version-parameterized, same script v1↔v2), froze v1 baseline, then rebuilt: FIX MCAP-VEC-BUG (6 dead dims→1 honest weighted-median), DROP 8 collinear dims (\|r\|≥0.9), ADD closed-hold-time + presence flag + sellSkew + session sin/cos + merged conviction, RE-WEIGHT (post-standardization `WALLET_VECTOR_AXIS_WEIGHTS`, hand-set/descriptive). **Proven better**: DISTRIBUTOR 0.26→0.55, PURE_HOLDER 0.24→0.29, strong types up, dead dims 6→0, max\|r\| 0.98→0.81, known-connected (Solomon/FLORK/STELLAR) preserved. Downstream re-materialized (stats→vectors 64378 v2/0 v1→history 64378→edges 2582→clusters 117); live write-path emits v2 automatically. tsc+tests+intel:audit:strict green. Doc: `BEHAVIOR_VECTOR_V2_VALIDATION_2026-07-13.md`. See DISPATCH_LOG AGENT_12. **Cutover note:** :5434 used the rebuild-window path (disposable); PROD needs the shadow-table (`WalletVector_v2`+rename) path — deferred (YAGNI) until a prod cutover is real. **SURFACE-1 now reads v2 live.** | ✅ |
| AGENT_13 | **[REPRESENTATION → TYPOLOGY] Behavior × Capital → honest typology + DB-wide research.** Brief: `.ai/dispatch/AGENT_13_BEHAVIOR_CAPITAL_TYPOLOGY.md`. **GATED on AGENT_11 + AGENT_12.** Partially realizes SPEC-002 §2.3 foresight (outcome-by-analogy). L1 = combined queries impossible before ("behave like X AND capital-legit / makes money", data-quality-gated). L2 = first DESCRIPTIVE typology from the honest ~10-axis space (clustering as lens; vs the crude 9 strategyType labels). L3 = "is this a good trader / what for" judgment sketch → ties to Act-3 label moat. Descriptive-only (no metric learning — label NO-GO stands). This is where the program becomes real DB-wide wallet research. **AGENT_12 landed 2026-07-13; now gated ONLY on AGENT_11 (capital embedding).** | 🔴 |
| GUIDE-1 | **Finish wallet intelligence guide** (`documentation/agent-wallet-intelligence-guide.md`) | ⚪ |
| X-1 | **Finish sova-x wallets/tokens opening work** | ⚪ |

---

## Pending (carry-over)

| Status | Task | Notes |
|:------:|:-----|:------|
| ⚪ | **[PAY-5d]** Blocked wallet E2E test — `isActive=false` returns 403 | Manual DB flip + script |
| ⚪ | **Production auth hardening** — cookie-mode readiness + CSP tightening | Set `CSRF_SECRET`; keep `AUTH_COOKIE_MODE=false` until full flow complete |
| ⚪ | **Implement feed feature** | Design and implement activity feed functionality |
| ⚪ | **Intel contract — SDK ownership decision** | Decide: handwritten SDK as main facade + generated as low-level baseline, or hybrid generated-core + handwritten-facade. Then: move SDK ownership into `sova-intel` cleanly, revisit docs automation from stable artifact path |
| ⚪ | **REMOVE AUTODOC from deps** | |
| ⚪ | **[sova-intel-mcp] Post-publish hardening** | Published, but still need real smoke verification plus live invalid-input, expired-result-key, limited-mode, apikey, and x402 verification against the API |

---

## Recent Activity

### July 7, 2026 - Wallet Representation Layer Started

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| WRL-1 | FEAT | **[SPEC-001 substrate]** Added additive pgvector/graph schema substrate, deterministic 32-dim wallet feature-vector builder, vector backfill and Gate-0 ledger scripts, wallet-token edge materializer, pruned wallet-wallet edge materializer, cluster materializer, DB kNN read helper, bounded Intel read endpoints, and SDK methods. Local pgvector Docker DB was started as `analyzer-postgres` on host port `5433`; all migrations and materializers verify there with synthetic data. | M | `prisma/schema.prisma`, `prisma/migrations/20260707000000_wallet_representation_layer/`, `src/core/representations/wallet-feature-vector.ts`, `src/core/services/database-service.ts`, `src/api/controllers/intel.controller.ts`, `packages/sdk/src/`, `scripts/spec001-*.ts` |
| WRL-2 | FIX | **[label-capture hygiene]** Added radar review provenance fields and stopped automated inactive wallet-hunt cleanup from hard-deleting hunt snapshots; cleanup now archives hunts so future metric-learning labels are not destroyed. | S | `src/api/controllers/radar.controller.ts`, `src/api/services/radar-snapshot.service.ts`, `src/api/services/wallet-hunt.service.ts` |

### May 31, 2026 - RPC-Full Sync Race Guard

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| SYNC-1 | 🐛 FIX | **[RPC-FULL-SYNC-RACE]** Added a wallet-scoped Redis sync lock around `HeliusSyncService.syncWalletData()` and changed stale `SwapAnalysisInput` row-id updates to `updateMany`. This protects the May 29 RPC-full clean-mapper replace-by-signature path from concurrent same-wallet syncs where one job deletes/replaces rows while another job is updating stale row ids. | 🟡 M | `src/core/services/helius-sync-service.ts`, `src/api/integrations/helius.module.ts`, `src/core/services/database-service.ts`, `src/api/services/market-context.service.ts`, `src/core/services/market-context-standalone.ts` |

**Why this exists:**
- Commit `b405c339` introduced RPC-full clean mapper persistence: `deleteMany(wallet + signatures)` then insert netted clean rows. The delete step is intentional because the clean mapper can emit different `(signature, mint, direction, amount)` rows than the legacy mapper, and plain upsert would strand legacy per-leg rows.
- The race observed on 2026-05-31: two holder-profile child jobs synced the same wallet concurrently. One job read `SwapAnalysisInput.id`s, another replaced those rows, then the first job failed with Prisma "No record was found for an update."
- The Redis lock is a guardrail, not the ideal long-term model. It serializes same-wallet syncs and degrades to old behavior if Redis locking is unavailable. `updateMany` makes stale row-id updates non-fatal in both sync-save and enrichment paths.

**When to revisit/remove:**
- Revisit after the RPC-full mapper has been stable in production and wallet sync ownership is redesigned.
- Remove only if replace-by-signature no longer uses a delete gap, for example a transactionally safe replace model, a DB-level advisory lock, or a serving model where duplicate same-wallet sync jobs are deduped before execution.
- Before removing, run a concurrency test with two same-wallet holder-profile/dashboard syncs and confirm no Prisma `P2025`/missing-row update errors, no stranded legacy rows, and correct `SwapAnalysisInput` counts per signature.

### April 22, 2026 — Token Detail Sidebar: Implemented ✅

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| TDS-1 | ✅ FEAT | **[TDS-1]** Added `getSwapAnalysisInputsForToken(walletAddress, mint)` to `database-service.ts` — direct prismaClient call, `WHERE walletAddress AND mint ORDER BY timestamp ASC`, same structural pattern as `getSwapAnalysisInputs`. | 🟢 S | `src/core/services/database-service.ts` |
| TDS-2 | ✅ FEAT | **[TDS-2]** Created `token-trade-history.dto.ts` with `TokenTradeItemDto` + `TokenTradeHistoryDto`. All nullable fields decorated with `nullable: true, required: false`. Pattern matches `token-performance-data.dto.ts`. | 🟢 S | `src/api/shared/dto/token-trade-history.dto.ts` |
| TDS-3 | ✅ FEAT | **[TDS-3]** Added `GET :walletAddress/token-trades/:tokenAddress` to `WalletsController`. Runs `getSwapAnalysisInputsForToken` + `getAnalysisResults` in parallel, maps to `TokenTradeHistoryDto`. Auth: userId check → ForbiddenException (lightweight, no activity logging — omitted intentionally to match simpler handlers like `getExitTimingTokens`). | 🟡 M | `src/api/controllers/wallets.controller.ts` |
| TDS-4 | ✅ FEAT | **[TDS-4]** Added `TokenTradeItemDto` + `TokenTradeHistoryDto` interfaces to `dashboard/src/types/api.ts`. | 🟢 S | `dashboard/src/types/api.ts` |
| TDS-5 | ✅ FEAT | **[TDS-5]** Created `TokenDetailSidebar.tsx`. Uses `DialogPrimitive.Content` directly (not `DialogContent` wrapper) for right-side drawer. SWR-fetches trade history only when open + tokenData present. Summary stats from `tokenData` prop. Trade history table with direction badge, MCAP, amount, SOL, relative time, Solscan link. Full null safety on all nullable fields. | 🟡 M | `dashboard/src/components/dashboard/TokenDetailSidebar.tsx` |
| TDS-6 | ✅ FEAT | **[TDS-6]** Wired `TokenDetailSidebar` into `TokenPerformanceTab.tsx`. Added `selectedToken` + `sidebarOpen` state. TableRow made clickable with `cursor-pointer`; `tokenAddress` cell gets `e.stopPropagation()` to prevent TokenBadge button conflict. Sidebar mounted outside `<Card>`. | 🟢 S | `dashboard/src/components/dashboard/TokenPerformanceTab.tsx` |

**Key deviations from plan:**
- Activity logging omitted on TDS-3 endpoint — consistent with `getExitTimingTokens` and `getWalletClassification` patterns in the same controller; lighter endpoints skip logging.
- SWR key uses array `[url]` + `([url]) => fetcher(url)` — matches `ReviewerLogTab.tsx` pattern in this codebase (not bare string key).

**Verification:** Both `npx tsc --noEmit` (backend + dashboard) pass with zero errors after all 6 tasks.

---

### April 22, 2026 — Token Detail Sidebar: Full Planning Pass

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| TDS-0 | 📌 PLAN | **[TOKEN-DETAIL-SIDEBAR]** Full-stack planning pass for click-to-detail token trade drawer on Token Performance table. Two investigation sweeps + hostile review corrected 8 wrong assumptions from initial pass. Final plan is dispatch-ready with zero open ambiguities. Spec: `.ai/context/TOKEN_DETAIL_SIDEBAR_PLAN_2026-04-22.md` | 🟡 M | `prisma/schema.prisma`, `src/core/services/database-service.ts`, `src/api/controllers/wallets.controller.ts`, `src/api/shared/dto/token-trade-history.dto.ts`, `dashboard/src/components/dashboard/TokenDetailSidebar.tsx`, `dashboard/src/components/dashboard/TokenPerformanceTab.tsx`, `dashboard/src/types/api.ts` |

**Key decisions & confirmed facts:**
- Data split: summary stats come from `TokenPerformanceDataDto` already in table memory (no re-fetch); only trade history + mcap aggregates require the new endpoint.
- New endpoint: `GET /api/v1/wallets/:walletAddress/token-trades/:tokenAddress` — runs two indexed queries (`SwapAnalysisInput` by `mint`, `AnalysisResult` by `tokenAddress`) and returns both in one response.
- **`SwapAnalysisInput` uses `mint` field, `AnalysisResult` uses `tokenAddress`** — same value, different column names. Conflating them returns zero rows silently.
- `avgEntryMcap`, `avgExitMcap`, and mcap percentile fields exist in DB but are NOT in the current `TokenPerformanceDataDto` — must come from new endpoint.
- No `Sheet` component in project. `DialogContent` wrapper cannot be repositioned via Tailwind overrides (center-position classes baked into `cn()` base). Use `DialogPrimitive.Content` directly from `@radix-ui/react-dialog` + `DialogPortal` + `DialogOverlay` from `dialog.tsx`.
- `marketCapUsd`, `tokenPriceUsd`, `solPriceUsd` on `SwapAnalysisInput` are nullable in practice — enrichment is async and may never complete for old txs. All UI cells must show "—" for null.
- `transferCountIn`/`Out` are NOT pure buy/sell counts — include airdrops and wallet transfers. Label as "Receives"/"Sends" or derive true buy/sell count from `direction` field in trade history rows.
- Holding duration for open positions (`currentUiBalance > 0`): use `Date.now()` as end, not `lastTransferTimestamp`.
- `DialogContent` auto-injects a close `<X>` button — using it directly would duplicate our custom header close. Compose from primitives to avoid this.
- `DatabaseService` already injected in `WalletsController` — no module changes needed.
- `ScrollArea` confirmed at `dashboard/src/components/ui/scroll-area.tsx`.

---

### April 4, 2026 — sova-intel-mcp Published

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| MCP-16 | 🚀 RELEASE | **[MCP-PUBLISH]** `@sova-intel/mcp@0.1.0` published. Local publish workflow was removed from this repo afterward; CI remains, and live post-publish verification is still pending. | 🟢 S | `packages/sova-intel-mcp/package.json`, `.github/workflows/continuous-integration.yml` |

---

### April 3, 2026 — sova-intel-mcp Scaffold

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| MCP-10a | 🔧 FIX | **[MCP-AUDIT-FIXES]** Closed the local scaffold gaps from the MCP audit: removed SDK-internal MCP coupling by adding public SDK resume methods, fixed `job_wait` queued-envelope input handling, wired real timeout-derived polling, removed baked pricing table fallback, added MCP README, and declared `x402` runtime deps. SDK tests pass; SDK + MCP builds pass. Live API/Claude/x402 verification still pending. | 🟡 M | `packages/sdk/src/client.ts`, `packages/sdk/src/client.test.ts`, `packages/sova-intel-mcp/src/core/polling.ts`, `src/tools/*.ts`, `src/server.ts`, `src/config.ts`, `package.json`, `README.md` |
| MCP-1 | 🎯 FEAT | **[MCP-SCAFFOLD]** Package scaffold — `package.json` (ESM, bin entry `sova-intel-mcp`, workspace SDK dep), `tsconfig.json` (NodeNext), `src/index.ts` (stdio entrypoint, limited-mode startup log). `pnpm build` clean. | 🟢 S | `packages/sova-intel-mcp/package.json`, `tsconfig.json`, `src/index.ts` |
| MCP-2 | 🎯 FEAT | **[MCP-AUTH]** Config + auth layer — env-var loading with fail-fast on bad explicit mode, `auto` resolves apikey → x402 → limited, x402 builder lazy-imports Solana deps only when needed. | 🟢 S | `src/config.ts`, `src/auth/resolve-auth-mode.ts`, `src/auth/x402-auth.ts`, `src/client/create-sova-client.ts` |
| MCP-3 | 🎯 FEAT | **[MCP-CORE]** Core layer — typed output envelope (`ToolResult`, `completedResult`, `queuedResult`, `errorResult`), stable error taxonomy + classifier, per-tool factual summaries, limited-mode availability guard. | 🟢 S | `src/core/result.ts`, `src/core/errors.ts`, `src/core/summary.ts`, `src/core/availability.ts` |
| MCP-4 | 🎯 FEAT | **[MCP-WALLET-TOOLS]** Wallet tools — `wallet_hud` (1cr), `wallet_profile` (5cr), `wallet_token_pnl` (3cr), `batch_wallet_hud` (5cr). Thin handlers; SDK handles GET timeout fallback internally. | 🟢 S | `src/tools/wallet-hud.ts`, `wallet-profile.ts`, `wallet-token-pnl.ts`, `batch-wallet-hud.ts` |
| MCP-5 | 🎯 FEAT | **[MCP-ASYNC-TOOLS]** Async tools — `token_holder_profiles` (20cr, `pollTokenHoldersAgent`), `wallet_similarity` (20cr, `pollWalletSimilarityAgent`), `deep_token_analysis` (35cr), `job_status` (free), `job_wait` (resume via `pollAndFetch`). All return queued envelope on `JobPollerError` — no throws. | 🟡 M | `src/tools/token-holder-profiles.ts`, `wallet-similarity.ts`, `deep-token-analysis.ts`, `job-status.ts`, `job-wait.ts` |
| MCP-6 | 🎯 FEAT | **[MCP-RESOURCES]** Resources — `sova://pricing` (live `GET /pricing`, static fallback), `sova://skill` (live GitHub raw), `sova://help/auth` (static, always available). | 🟢 S | `src/resources/pricing.ts`, `skill.ts`, `auth-help.ts` |
| MCP-7 | 🎯 FEAT | **[MCP-SERVER]** Server registration — 9 tools + 3 resources wired into `McpServer`, limited-mode guard per tool, `isError: true` structured returns. Zero TS errors. | 🟢 S | `src/server.ts` |

**Key decisions:**
- stdio transport; `npx sova-intel-mcp` install shape.
- Agent-optimised SDK methods only: `pollTokenHoldersAgent()`, `pollWalletSimilarityAgent()` — not verbose developer variants.
- Async tools queue first (capturing `agentResultKey`), poll second; on `JobPollerError` return queued envelope with `resumeTool: "job_wait"`.
- x402 lazy-imports Solana deps — apikey-only deployments don't pay the cost.

---

### April 3, 2026 — Intel Contract Pipeline Finished

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| 3.1 | 🎯 FEAT | **[INTEL-AUDIT-1]** Intel surface drift audit — controller endpoints vs SDK method coverage, accepted-response types, HUD fields, wallet behavior fields, docs surfaces. Strict mode catches real drift classes. | 🟡 M | `scripts/intel-surface-audit.ts`, `package.json`, `.github/workflows/intel-surface-audit.yml` |
| 3.2 | 🔧 REFACTOR | **[INTEL-SYNC-BRIDGE-REMOVED]** Removed temporary patch-sync script from active workflow. Contract path no longer depends on regex surface patching. | 🟢 S | `package.json`, `scripts/intel-sync-surfaces.ts` |
| 3.3 | 🔧 REFACTOR | **[INTEL-SDK-LAYERING]** SDK public accepted-response types now live explicitly in `packages/sdk/src/types.ts`; no longer re-exported from `generated-intel-contract.ts`. Strict audit checks parity. | 🟢 S | `packages/sdk/src/types.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`, `scripts/intel-surface-audit.ts` |
| 3.4 | 🎯 FEAT | **[INTEL-ARTIFACT-1]** Intel public DTO layer + OpenAPI exporter + SDK contract generator working end-to-end from `artifacts/intel-openapi.json`. `pnpm run build`, `intel:openapi`, `intel:sdk`, `intel:audit:strict` all pass. `pnpm run intel:verify` is the local end-to-end check. | 🟢 M | `src/api/shared/dto/intel-public.dto.ts`, `src/api/controllers/intel.controller.ts`, `scripts/export-intel-openapi.ts`, `scripts/generate-intel-sdk-contract.ts`, `packages/sdk/src/generated-intel-contract.ts`, `package.json` |
| 3.5 | 🔧 REFACTOR | **[INTEL-ARTIFACT-ISOLATION]** OpenAPI export boots a dedicated Intel-only Nest module with stub providers instead of full `AppModule`, removing Redis/queue coupling from artifact generation. | 🟢 S | `scripts/export-intel-openapi.ts`, `src/api/modules/intel-openapi.module.ts` |
| 3.6 | 🔧 EVAL | **[INTEL-GENERATED-SDK-EVAL]** One-off generator emits a fully artifact-driven SDK package to `C:/Users/solastic/prj/sova-intel/sdk-generated`. Compiles, but raw generated surface is materially worse than handwritten SDK ergonomics. Evaluation-only — not committed until ownership decision made. | 🟢 M | `scripts/export-generated-intel-sdk.ts`, `artifacts/generated-sdk-eval/` |
| 3.7 | 🔧 INFRA | **[INTEL-HOOK-AUTOMATION]** `pnpm run hooks:install` installs `.git/hooks/pre-commit` — reruns Intel contract pipeline only for staged Intel contract changes, auto-stages generated contract outputs, reminds author of SDK facade/docs follow-up. CI remains hard backstop on PRs to `main`. | 🟢 S | `scripts/install-git-hooks.ps1`, `scripts/git-hooks/pre-commit-intel.ps1`, `.github/workflows/intel-surface-audit.yml`, `package.json` |

---

### April 2, 2026 — Token Supply Optimization + WalletPreparationService

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| 2.1 | 🐛 FIX | `TokenHoldersService.getTopHolders` was calling `heliusClient.getTokenSupply` directly, bypassing Redis → DB → RPC cache in `TokenInfoService`. Now routes through `TokenInfoService.getTokenSupply`. | 🟢 S | `src/api/services/token-holders.service.ts` |
| 2.2 | 🔧 REFACTOR | `buildSupplyMap` concurrency raised 3→10, inter-chunk delay lowered 300ms→100ms. For 200 cold mints: ~20s artificial delay cut to ~2s. | 🟢 S | `src/api/services/market-context.service.ts` |
| 2.3 | 🎯 FEAT | `WalletPreparationService` — shared `sync → enrich` orchestration layer. All full-wallet analysis paths now call `prepareWallet(address, syncOptions?)`. Prevents null-mcap orchestration gap from recurring on new processor paths. | 🟢 S | `src/api/services/wallet-preparation.service.ts`, `src/api/modules/market-context.module.ts`, `src/queues/processors/analysis-operations.processor.ts`, `src/queues/processors/similarity-operations.processor.ts` |
| 2.4 | 🔧 REFACTOR | Removed now-unused `HeliusSyncService` and `MarketContextService` injections from `SimilarityOperationsProcessor` — superseded by `WalletPreparationService`. | 🟢 S | `src/queues/processors/similarity-operations.processor.ts` |

**Key decisions:**
- `wallet-operations` processor intentionally excluded from `WalletPreparationService` — queues enrichment async via `process-market-context`.
- Staleness check (`needsSync`) stays in each processor. The service only enforces ordering, not staleness logic.

---

### April 1, 2026 — Market Cap Behavior/Profile Rework + Holder Profile Entry Mcap Fix

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| 1.1 | 🎯 FEAT | Wallet market-cap behavior reworked to use robust persisted summaries: `typicalEntryMcapUsd`, `entryMcapP25Usd`, `entryMcapP75Usd`, `dominantEntryMcapBucket`, `dominantEntryMcapBucketShare`, plus token-level robust entry/exit mcap on `AnalysisResult`. | 🟡 M | `prisma/schema.prisma`, `prisma/migrations/20260401000000_market_cap_behavior_profile_rework/`, `behavior-service.ts`, `pnl-analysis-service.ts`, `market-context-standalone.ts` |
| 1.2 | 🔧 REFACTOR | HUD mcap layering corrected. HUD stays signal-only (`Typical Entry Mcap`); bracketed bucket removed. Full behavior/profile API carries richer mcap context. | 🟡 M | `wallet-hud.dto.ts`, `wallet-hud.service.ts`, `behavior.service.ts`, `intel.controller.ts`, `dashboard/src/components/shared/WalletHudOverlay.tsx`, `dashboard/src/lib/mcap.ts`, `packages/sdk/src/types.ts` |
| 1.3 | 🐛 FIX | Holder-profile token-mode `entryMcapUsd` corrected: now prefers open `TokenLot` position entry mcap weighted by `amountRemaining`, with `AnalysisResult.avgEntryMcap` fallback. Answers "where is this holder positioned in this token?" correctly. | 🟡 M | `analysis-operations.processor.ts`, `database-service.ts`, `dashboard/src/components/holder-profiles/v2/MinimalHoldersTable.tsx` |
| 1.4 | 🐛 FIX | Startup SOL daily price cache simplified. `QueueModule` no longer fire-and-forgets 730-day backfill on startup. Startup only calls `appendTodaySolPrice()`. | 🟢 S | `src/queues/queue.module.ts`, `src/api/services/market-context.service.ts`, `src/core/services/market-context-standalone.ts` |
| 1.5 | 📌 DECISION | Wallet HUD answers "what caps does this wallet usually trade?"; holder-profile token rows answer "around what mcap is this current position built?" — different questions, intentionally different mcap summaries. | 🟢 S | `.ai/context/MARKET_CAP_BEHAVIOR_PROFILE_REWORK_PLAN_2026-04-01.md` |

---

### March 31, 2026 — MCE-7: Market Context Downstream ✅ COMPLETE

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| 31.1 | 🎯 FEAT | **[MCE-7A]** `AnalysisResult`: `avgExitMcap` + `avgExitMcapBucket` — volume-weighted avg mcap at sell time, per token | 🟢 S | `prisma/schema.prisma`, `pnl-analysis-service.ts` |
| 31.2 | 🎯 FEAT | **[MCE-7B]** `TokenLot`: `entryPriceUsd`, `entryMcapUsd`, `entryMcapBucket`, `costBasisUsd` — per-lot USD cost basis and entry mcap, keyed by `signature:mint` | 🟢 S | `prisma/schema.prisma`, `pnl-analysis-service.ts` |
| 31.3 | 🎯 FEAT | **[MCE-7C]** `WalletPnlSummary`: `totalVolumeUsd`, `realizedPnlUsd`, `unrealizedPnlUsd`, `netPnlUsd` — true FIFO USD replay matching SOL algorithm exactly | 🟡 M | `prisma/schema.prisma`, `pnl-analysis-service.ts` |
| 31.4 | 🐛 FIX | **[MCE-7 review]** 6 bugs fixed before ship: signature collision on lot map, `realizedPnlUsd` including open positions, partial lot fraction on unrealized, 5→1 DB round-trips, excluded mints missing from USD path, lot enrichment firing on view-only calls | 🟡 M | `pnl-analysis-service.ts` |
| 31.5 | 🎯 FEAT | **[MCE-7D]** HUD DTO: `typicalEntryMcapUsd` + `dominantEntryMcapBucket` surfaced. Migration `20260331000000_mce7_downstream` covering 16 new columns across 4 tables. | 🟢 S | `wallet-hud.dto.ts`, `wallet-hud.service.ts`, `prisma/migrations/` |
| 31.6 | 🐛 FIX | **[MCE-7 orchestration]** Live wallet-analysis paths were consuming raw `SwapAnalysisInput` before market-context enrichment. Patched live orchestrators: dashboard wallet analysis, similarity deep sync, holder-profile wallet mode. | 🟡 M | `analysis-operations.processor.ts`, `similarity-operations.processor.ts`, `enrichment-operations.processor.ts`, `wallet-operations.processor.ts`, `scripts/queue-market-context-backfill.ts` |

**Key decisions:**
- `realizedPnlUsd` uses full FIFO replay in USD — not aggregate flow. Partial exits are correct.
- Single `allEnrichedRows` query per analysis feeds all three downstream computations (A, B, C).
- All new fields nullable, no existing API surface changed.
- Self-healing only works if caller enforces `sync -> enrich -> analyze`; orchestration gap patched for live flows 2026-03-31.

---

## Architecture Decisions

**ALWAYS run scripts with:** `npx ts-node -r tsconfig-paths/register`

**Real-data dev DB (disposable):** `analyzer-postgres-pg17` (:5434, DB `sova_analyzer`),
`DATABASE_URL="postgresql://postgres:postgres@localhost:5434/sova_analyzer?schema=public"`.
It is a restore of a **server dump**, NOT production — **safe to mutate, migrate, run
materializers against, or drop/recreate.** The operator re-extracts it on demand, so jobs
that need real data should use it directly; no throwaway clone required. (The older
`analyzer-postgres` on :5433 is a tiny synthetic set.)

### Representation-layer coverage is NOT a gap (read before "fixing" it)
*Verified on :5434, 2026-07-12 (SQL reproducible)*

The recurring `64,378 vectors / 76,681 wallets` figure is **not a 16% coverage hole** —
it is 100% coverage of every wallet that can *have* a behavior vector:

- `WalletVector` count **equals** `WalletBehaviorProfile` count **equals** 64,378 (one vector
  per behavior profile, by construction — `spec001-backfill-wallet-vectors.ts`).
- The 12,303 "uncovered" wallets have **exactly ZERO swaps** (verified: `zero_swaps = 12,303`,
  `swaps ≥ 1 = 0`). They are empty `Wallet` shells (counterparty/holder-lookup/sync-only rows),
  and a behavioral vector over zero trades is **undefined, not missing**.
- Therefore `/similar` and `/cluster` returning **structured 404 for these wallets is correct**,
  not a bug. A production migration will show the same shape: coverage = "fraction of wallet
  rows that have any trade," which is a property of the source data, not a defect to close.

**Do not open work to "improve vector coverage."** The only lever is upstream (whether a wallet
gets analyzed into a behavior profile at all), which is a separate, pre-existing pipeline concern.

### DB Growth Investigation Protocol
*Decided: 2026-02-26*

For future sessions investigating DB growth, run this sequence first (read-only):

1. Verify runtime + DB target:
   - `pm2 status`
   - `docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'`
   - Expect active container: `analyzer-postgres` and DB `sova_analyzer`.
2. Baseline size:
   - `docker exec analyzer-postgres psql -U postgres -d sova_analyzer -c "SELECT pg_size_pretty(pg_database_size('sova_analyzer')), pg_database_size('sova_analyzer');"`
3. Top table footprint: `pg_total_relation_size`, `pg_relation_size`, `pg_indexes_size`, toast from `pg_class`.
4. Day-level growth: group by day on `SwapAnalysisInput.timestamp`, `HeliusTransactionCache.fetchedAt`, `TokenLot.createdAt`, `AnalysisResult.updatedAt`.
5. Separate true growth vs bloat: `pg_stat_user_tables` (`n_live_tup`, `n_dead_tup`, autovacuum timestamps).
6. Index amplification: `pg_index` + `pg_relation_size(index)` on top tables.
7. Workload concentration: top wallets by row counts (14d) for `SwapAnalysisInput`, `TokenLot`, `AnalysisResult`.

DB ops runbook: `.ai/context/db_op/ONLINE_DB_CLEANUP_RUNBOOK_2026-03-05.md`

### Lock Scope Independence
*Decided: 2026-01-13*

```
Dashboard:       lock:wallet:dashboard-analysis:{address}
PnL:             lock:wallet:pnl:{address}
Behavior:        lock:wallet:behavior:{address}
Sync:            lock:wallet:sync:{address}
Similarity:      lock:similarity:{requestId}
Holder Profiles: NO LOCK (relies on service idempotency)
```

---

## Quick Reference

### Key Code Locations

| Area | Path | Notes |
|:-----|:-----|:------|
| **Dashboard Components** | `dashboard/src/components/` | Primary work area |
| Holder Profiles v2 | `dashboard/src/components/holder-profiles/v2/` | |
| Analysis API | `src/api/controllers/analyses.controller.ts` | Backend endpoints |
| Queue System | `src/queues/processors/` | Job processing |
| Core Analysis | `src/core/analysis/` | Math & logic |
| Holdings Radar controller | `src/api/controllers/radar.controller.ts` | 7 endpoints at `/analyst/radar/...` |
| Holdings Radar service | `src/api/services/radar-snapshot.service.ts` | Snapshot + dust filter |
| AnalystGuard | `src/api/shared/guards/analyst.guard.ts` | `isAnalyst \|\| isAdmin` |
| Telegram bot entry | `src/bot/intel/index.ts` | Standalone process via PM2 (`sova-tg-bot`) |
| Telegram bot spec | `.ai/context/telegram-bot/spec.md` | Architecture, file structure, API contract |
| Bot API key script | `scripts/manage-api-keys.ts` | `create <userId> -d "..." -s "full"` |
| X (Twitter) bot | `submodules/sova-x/` | |
| Public API docs | `submodules/sova-intel/` | Docusaurus site |
| Intel SDK | `packages/sdk/src/` | `SovaIntelClient` — canonical types + HTTP client |
| Bot env vars | `.env` | `INTEL_BOT_TOKEN`, `INTEL_API_KEY`, `INTEL_BOT_ALLOWED_USER_IDS`, `INTEL_BASE_URL` |

### Documentation Files

| File | Purpose |
|:-----|:--------|
| `CONTEXT.md` | Timeline, active tasks, decisions (this file) |
| `GUIDE.md` | Implementation roadmap, build instructions |
| `RULES.md` | AI agent execution contract |
| `HANDOFF.md` | Session start/end protocol |
| `.ai/context/SHAREABLE_ANALYSIS_PLAN.md` | OG images + SSR share page architecture |

---

## Usage Guide

**When to update:**
- After completing tasks → add to Recent Activity
- Starting new work → add to Active Work
- Architectural decisions → add to Architecture Decisions
- End of session → update Active Work, timestamp, CHANGELOG.md for user-facing changes

**Entry format:** `DD.N` numbering (e.g. `3.1`, `3.2` for April 3)

```
| ID | Icon | Clear title | Scope | Key components/files |
```

- **Scope:** S = Small (<50 lines, <1hr) | M = Medium (2-5 files, <4hrs) | L = Large (5+ files, multi-day)



