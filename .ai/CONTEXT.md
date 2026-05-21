# Sova Intel — Project Context

**Branch:** `feature/evm-ingestion` (pending merge) | **Last Updated:** 2026-05-22 | **Status:** EVM ingestion + analysis pipeline complete; chain-agnostic refactor identified as next priority.

---

## Active Work

| ID | Task | Priority |
|:--:|:-----|:--------:|
| EVM-1 | **[EVM-CHAIN-AGNOSTIC] Refactor analysis pipeline to be genuinely chain-agnostic** — `NativeBalanceFetcher` interface, field renames, remove `skipBalanceFetch` flag. READ `.ai/context/EVM_PORT/EVM_CHAIN_AGNOSTIC_REFACTOR.md` before starting. | 🔴 NOW |
| MCP-8 | **[sova-intel-mcp] Post-publish end-to-end smoke test** — install published MCP in Claude Desktop or Claude Code, run `wallet_hud` live | 🟡 |
| MCP-13 | **[sova-intel-mcp] x402 runtime verification** — packaging is fixed; still need real standalone `x402` startup/payment verification | 🟡 |
| MCP-15 | **[sova-intel-mcp] Acceptance-bar verification pass** — local code/package fixes are done; still need live invalid-input, expired-result-key, upstream-error, limited-mode, apikey, and x402 verification against the API | 🟡 |
| GTM-3 | **Open Twitter bot for public use** — rate-limit and open; announce on @Sova_intel | ⚪ |
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

### May 22, 2026 — EVM Integration: Analysis Pipeline Wired + Chain-Aware API/Frontend ✅

**Branch:** `feature/evm-ingestion` — merge-ready  
**⚠️ ARCHITECTURAL DEBT IDENTIFIED — read `.ai/context/EVM_PORT/EVM_CHAIN_AGNOSTIC_REFACTOR.md` before continuing EVM work.**

The current implementation works end-to-end but uses `skipBalanceFetch: true` as a bypass instead of a proper chain-agnostic abstraction. `PnlAnalysisService` still injects `HeliusApiClient` directly. EVM unrealized PnL is always 0 as a result.

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| EVM-A | ✅ FEAT | **[EVM-ANALYSIS-WIRE]** `EvmSyncService.syncWalletData()` Step 7 — after saving `SwapAnalysisInput` records, runs full analysis pipeline: PnL → behavior → HUD invalidation. Services are optional in constructor so standalone scripts still work. `analysisRan: boolean` added to `EvmSyncResult`. | 🟡 M | `src/core/services/evm-sync-service.ts`, `src/api/integrations/evm.module.ts` |
| EVM-B | ✅ FEAT | **[EVM-CHAIN-API]** `WalletSummaryResponse` + `wallets.controller.ts` — `chain` and `nativeToken` fields added, populated from `wallet.chain` DB column. Both `unanalyzed` and `ok` responses include chain context. | 🟢 S | `src/api/shared/dto/wallet-summary-response.dto.ts`, `src/api/controllers/wallets.controller.ts` |
| EVM-C | ✅ FEAT | **[EVM-ADDRESS-VALIDATORS]** `isValidEvmAddress`, `isValidWalletAddress`, `detectChain`, `WalletChain` added to backend pipe and dashboard utils. All controllers + search flows now accept `0x` addresses. | 🟢 S | `src/api/shared/solana-address.pipe.ts`, `dashboard/src/lib/solana-utils.ts` |
| EVM-D | ✅ FEAT | **[EVM-FRONTEND-CHAIN-AWARE]** `WalletProfileLayout` derives chain from API response (not address guess) — correct for Arbitrum/Base which share `0x` format. Shows chain badge, suppresses Solana analysis triggers for EVM wallets, shows "not yet synced" empty state. `AccountSummaryCard` accepts `nativeToken` prop, replaces hardcoded `SOL` labels. | 🟡 M | `dashboard/src/components/layout/WalletProfileLayout.tsx`, `dashboard/src/components/dashboard/AccountSummaryCard.tsx`, `dashboard/src/components/shared/WalletSearch.tsx`, `dashboard/src/components/layout/QuickAddForm.tsx` |
| EVM-E | ✅ FIX | **[EVM-CONTROLLER-GUARDS]** `intel.controller` returns `404/not_synced` for unsynced EVM wallets (instead of queuing Solana analysis). `analyses.controller` returns `{ skipped: true, skipReason: 'evm-wallet' }` instead of 400. | 🟢 S | `src/api/controllers/intel.controller.ts`, `src/api/controllers/analyses.controller.ts` |

**Key architectural debt (not fixed — tracked as EVM-1):**
- `PnlAnalysisService` injects `HeliusApiClient` directly — should inject `NativeBalanceFetcher` interface
- `skipBalanceFetch: true` is a workaround flag, not an abstraction
- Field names `totalSolSpent`, `realizedPnlSol`, `associatedSolValue`, `currentSolBalance` lie about their content for EVM
- `src/types/helius-api.ts` file name implies Solana — should be `analysis-types.ts`
- EVM unrealized PnL is always 0 (no balance fetch)
- No EVM token metadata enrichment (USD values null for EVM tokens)

---

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




