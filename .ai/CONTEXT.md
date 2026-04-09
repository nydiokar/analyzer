# Sova Intel — Project Context

**Branch:** `feature/daily-aggregates` | **Last Updated:** 2026-04-09 | **Status:** DA-1 through DA-9 complete. DA-10 (lifetime USDC fix) backlog. DA-12 (PnL curve panel + calendar) designed, not yet implemented. SYNC-1/SYNC-2 (redundant Helius fetches + job overlap) logged, not yet investigated.

---

## Active Work

### Daily Aggregates — `feature/daily-aggregates` (spec: `.ai/context/DAILY_AGGREGATES_SPEC_2026-04-05.md`)

Staged rollout per spec §9. Each stage is independently deployable. **Do not merge until stage 5 is complete.**

| Stage | ID | Task | Status |
|:-----:|:--:|:-----|:------:|
| 1 | DA-1 | Schema migration — `WalletDailyPnl` in `prisma/schema.prisma` | ✅ Done |
| 2 | DA-2 | `DailyAggregationService` (`src/core/services/daily-aggregation.service.ts`) — full-history FIFO pass, per-sell date attribution, upserts | ✅ Done |
| 3a | DA-3 | `DailyAggregationJob` (`src/queues/jobs/daily-aggregation.job.ts`) — nightly `@Cron('0 0 * * *')` repair job querying `lastComputedAt < NOW() - 26h`, calls `recomputeRecentDays(wallet, 3)` | ✅ Done |
| 3b | DA-4 | Async dispatch hook in `analysis-operations.processor.ts` — `dispatchDailyAggregation()` fires after `invalidateCache` in `processAnalyzePnl` and `processDashboardWalletAnalysis` only (not behavior — no swap writes) | ✅ Done |
| 3c | DA-5 | `DailyAggregationService` + `DailyAggregationJob` registered in `QueueModule`; service exported so `WalletsModule` resolves from global module (no duplicate instance) | ✅ Done |
| 4 | DA-6 | Backfill script — one-time run of `recomputeDays` over all wallets; run validation query from spec §9 (`SUM(realizedPnlSol)` vs `WalletPnlSummary.realizedPnl`). **Do after staging validation.** | ✅ Done |
| 5 | DA-7 | `GET /wallets/:addr/pnl-daily` — query/response DTOs, range guard (endDate ≥ startDate, max 366d), `attributionMethod: "sell_date"`, 404 with actionable message | ✅ Done |
| — | DA-VAL | **Staging validation gate** — trigger analysis on 3–5 wallets, hit `GET /pnl-daily`, run SQL cross-check: `SUM(WalletDailyPnl.realizedPnlSol)` vs `WalletPnlSummary.realizedPnl`. Investigate any large deltas on non-incomplete-history wallets before backfill. | ✅ Done |
| 6 | DA-8 | Dashboard period-scoped wallet profile page — period picker (1d/7d/30d/all) drives summary stats, PnL chart, and overview panels on the wallet profile page. Token performance stays all-time. HUD stays all-time (snapshot, not windowed). See DA-8 design notes below. | ✅ Done |
| 7 | DA-9 | Serve `pnl-overview` period queries from daily table — `getPeriodDataFromDailyRows` in `pnl-overview.service.ts`; no raw-swap recompute for period view | ✅ Done |
| — | DA-11 | **Windowed behavior on period picker** — when period is selected, call `GET /wallets/:addr/behavior-analysis?startDate=&endDate=` (already exists, ad-hoc recompute from raw swaps) and surface `medianHoldTime`, `speedCategory`, `buySellRatio` in the period panel. Suppress signals that are meaningless for short windows. Internal dashboard only — no public API changes. | ⬜ Backlog |
| 8 | DA-10 | **Lifetime PnL accuracy fix** — `WalletPnlSummary.realizedPnl` is computed using a single current SOL price for all USDC→SOL conversions across history. Should use per-swap `solPriceUsd` (already stored on `SwapAnalysisInput` from enrichment) instead, matching what `DailyAggregationService` does. Delta is small (~5 SOL on a 35-USDC-swap wallet) but systematically wrong for USDC-heavy wallets. Fix lives in `src/core/analysis/swap/analyzer.ts` — pass per-swap `solPriceUsd` into the USDC conversion instead of a single `estimatedSolPriceUsd`. | ⬜ Backlog |

---

### DA-12 — PnL Curve Panel + Calendar (wallet profile header redesign)

**Goal:** Move the daily PnL visualisation out of the Account Stats tab and into the wallet profile header, directly next to the summary card. Make the header PNL stat period-aware. Add a calendar modal for the canonical "PnL per day" calendar view.

---

#### Current header layout (Row 2 in `WalletProfileLayout.tsx` ~line 1288)
```
[AccountSummaryCard 180px fixed] [WalletHudOverlay expanded] [McapDistributionBar 220px fixed]
```
`AccountSummaryCard` shows: PNL (all-time, never changes with period picker) / Balance / Last Active

---

#### Target header layout
```
[AccountSummaryCard 180px fixed] [PnlCurvePanel flex-1] [WalletHudOverlay expanded] [McapDistributionBar 220px fixed]
```

---

#### Step 1 — Remove DailyPnlChart from AccountStatsPnlTab

File: `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx`
- Remove `import DailyPnlChart`
- Remove the `<div className="rounded-lg border bg-card px-3 py-2">` block containing `<DailyPnlChart>`
- Remove `gap-3 sm:gap-4` from the outer div (revert to `h-full flex flex-col`)

---

#### Step 2 — Create PnlCurvePanel component

File: `dashboard/src/components/charts/PnlCurvePanel.tsx` (new file)

**Props:** `walletAddress: string`

**Data:** SWR fetch `GET /wallets/${walletAddress}/pnl-daily?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- Construct key from `useTimeRangeStore` `startDate`/`endDate` — same pattern as existing `DailyPnlChart.tsx`
- Type: `WalletDailyPnlResponse` from `@/types/api`
- `fetcher` from `@/lib/fetcher`
- `revalidateOnFocus: false`, `revalidateOnReconnect: false`
- On loading: `<Skeleton className="h-full w-full rounded-lg" />`
- On 404 or no data: `return null`
- On other error: `return null`

**Layout (when data present):** `flex flex-row gap-3 h-full`

**Left — cumulative PnL area chart (`flex-1`, height ~120px):**
- Use `EChartComponent` from `@/components/charts/EChartComponent`
- Compute cumulative series: `rows.reduce((acc, r) => { const prev = acc[acc.length-1] ?? 0; acc.push(prev + r.realizedPnlSol); return acc; }, [] as number[])`
- X axis: dates formatted as `"D MMM"` (e.g. "1 Apr") — same `formatDate` helper as DailyPnlChart
- Y axis: hidden labels, show zero line only (`axisLine: { show: false }`, `splitLine: show only zero line`)
- Series: `type: 'line'`, `areaStyle: { opacity: 0.15 }`. Colour entire line+area green (`#22c55e`) if final cumulative value >= 0, red (`#ef4444`) if negative
- Mark max and min points: `markPoint: { data: [{ type: 'max' }, { type: 'min' }] }` with small symbol size (~6) and label showing `+X.XX` / `-X.XX SOL`
- Zero reference line: `markLine: { data: [{ yAxis: 0 }], lineStyle: { type: 'dashed', color: 'hsl(215 27.9% 16.9%)' }, label: { show: false } }`
- Tooltip: trigger axis, show date + that day's `realizedPnlSol` + running cumulative total
- `backgroundColor: 'transparent'`, minimal grid, no legend
- A `CalendarDays` icon button (lucide-react, `h-3.5 w-3.5`) absolutely positioned top-right of the chart div — `onClick` opens the calendar modal (`setCalendarOpen(true)`)

**Right — stats strip (`w-[130px] shrink-0 flex flex-col justify-center gap-2`):**
- Realized PnL: `data.summary.totalRealizedPnlSol` — bold, green/red coloured, format as `+X.XXX SOL`
- Trades: `data.summary.totalTradeCount`
- Win Rate: `data.summary.winRate` — format as `XX%` or `N/A`
- Labels in `text-[10px] text-muted-foreground uppercase tracking-wide`, values in `text-sm font-semibold`

**Calendar modal (shadcn `Dialog`):**
- State: `const [calendarOpen, setCalendarOpen] = useState(false)`
- State: `const [calendarMonth, setCalendarMonth] = useState<{ year: number; month: number }>(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; })`
- Build a map: `const dayMap = new Map(data.data.map(r => [r.date, r]))`
- Month grid: 7 columns (Mon–Sun). For each day cell in the current month:
  - If row exists: background colour intensity based on `realizedPnlSol` magnitude. Use opacity variants: `bg-green-500/10` → `bg-green-500/40` → `bg-green-500/70` for positive tiers (< 0.1 SOL / 0.1–1 SOL / > 1 SOL). Same tiers for red. Zero/no data: `bg-muted/20`
  - Show `realizedPnlSol` formatted as `+X.XX` / `-X.XX` in `text-[10px]` inside the cell
  - Hover tooltip (use shadcn Tooltip): date, Trades (tradeCount), Buys/Sells (buyCount/sellCount), Volume (volumeSol formatted to 2dp + " SOL"), Win Rate (profitableSellsCount/totalSellsCount formatted as %)
- Month navigation: `<` and `>` buttons, disable `<` if no data exists before current month, disable `>` if no data exists after
- Initialise `calendarMonth` to the most recent month that has data in `data.data`
- Dialog title: `"PnL Calendar"` with the month+year label

---

#### Step 3 — Wire PnlCurvePanel into WalletProfileLayout

File: `dashboard/src/components/layout/WalletProfileLayout.tsx`
- Add `import PnlCurvePanel from '@/components/charts/PnlCurvePanel'`
- In Row 2, insert between `AccountSummaryCard` and `WalletHudOverlay`:
  ```tsx
  <div className="flex-1 min-w-0 rounded-xl border bg-card px-3 py-2">
    <PnlCurvePanel walletAddress={walletAddress} />
  </div>
  ```

---

#### Step 4 — Period-aware PNL in AccountSummaryCard

**Problem:** `AccountSummaryCard` shows `data.latestPnl` which is always all-time realized PnL from `WalletSummaryData`. It never changes when the period picker changes.

**Fix:**
- `WalletProfileLayout` already SWR-fetches `pnl-daily` for `PnlCurvePanel` (via the component itself). To avoid a duplicate fetch, add a separate SWR call in `WalletProfileLayout` for the same key and extract `summary.totalRealizedPnlSol`. Since SWR deduplicates by key, there is no double network call.
- Key construction (identical to PnlCurvePanel so SWR deduplicates):
  ```ts
  const dailyPnlKey = useMemo(() => {
    if (!walletAddress || !startDate || !endDate) return null;
    const s = startDate.toISOString().slice(0, 10);
    const e = endDate.toISOString().slice(0, 10);
    return `/wallets/${walletAddress}/pnl-daily?startDate=${s}&endDate=${e}`;
  }, [walletAddress, startDate, endDate]);
  const { data: dailyPnlData } = useSWR<WalletDailyPnlResponse>(dailyPnlKey, fetcher, { revalidateOnFocus: false, revalidateOnReconnect: false });
  ```
- Add `WalletDailyPnlResponse` to the import from `@/types/api` in WalletProfileLayout
- Pass `periodPnlSol={dailyPnlData?.summary?.totalRealizedPnlSol ?? null}` to `AccountSummaryCard`

In `AccountSummaryCard.tsx`:
- Add optional prop `periodPnlSol?: number | null`
- In the PNL section, display `periodPnlSol ?? data.latestPnl` as the value
- If `periodPnlSol` is defined and not null, add a tiny `text-[9px] text-muted-foreground` label `"period"` below/beside the value so the user knows it's period-scoped not all-time

---

#### Key files touched
| File | Change |
|---|---|
| `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx` | Remove DailyPnlChart panel |
| `dashboard/src/components/charts/PnlCurvePanel.tsx` | New file — curve + stats + calendar modal |
| `dashboard/src/components/layout/WalletProfileLayout.tsx` | Insert PnlCurvePanel, add dailyPnlKey SWR, pass periodPnlSol |
| `dashboard/src/components/dashboard/AccountSummaryCard.tsx` | Accept + render periodPnlSol |

- check "C:\Users\Cicada38\Pictures\Screenshots\Screenshot 2026-04-09 005726.png" for full outlook refefence but don't copy 100% 

- check "C:\Users\Cicada38\Pictures\Screenshots\Screenshot 2026-04-09 005858.png" as reference for the calendar modal

- check "C:\Users\Cicada38\Pictures\Screenshots\Screenshot 2026-04-09 011040.png" for reference for some stats to include around the curve

#### Files NOT touched
- Any backend file
- `AccountStatsPnlTab.tsx` beyond removing the chart block
- HUD, McapDistributionBar, token performance

#### Validation
- `npx tsc --noEmit -p tsconfig.json` from `dashboard/` must pass with 0 errors
- No new backend endpoints needed — all data from existing `GET /pnl-daily`

---

**Key constraints (from spec Appendix B):**
- `DailyAggregationService` NEVER calls `analyzeWalletPnl` — FIFO runs directly in the service
- FIFO must run over full wallet history; day-scoped FIFO produces wrong realized PnL
- `lastComputedAt` set explicitly on every run; do NOT rely on `@updatedAt` for freshness monitoring
- All writes are upserts (`@@unique([walletAddress, date])`)
- `realizedPnlSol` is sell-date attributed — document in API response and code comments

---

### Other Active

| ID | Task | Priority |
|:--:|:-----|:--------:|
| SYNC-1 | **Redundant Helius fetches** — SmartFetch fetches 162/662 txns from Helius then saves 0 (all already in DB). `newestProcessedSignature` cursor should stop the fetch early but isn't. Trace `executeSmartFetch` phase 1 → `getAllTransactionsForAddress` → how `stopAtSignature` is used. | 🔴 |
See logs whereas this wallet was sync and analyzed earlier before so the question i swhy do we sync it with all available 691 sig fetched when we just can append and we keep the data available including the helius cache : 
0|sova-backend-api  |   Fetching details: Processed ~100% of signatures (162/162 sigs → 162 txns fetched)...
 [HeliusSyncService] [Sync] 🎉 SmartFetch completed for Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7: 0 transactions processed and saved to database.
 [PnlAnalysisService] [PnlAnalysis] Analysis completed for Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7: 782 transactions → 85 tokens, Net PNL: -0.8503 SOL
0|sova-backend-api  |   Fetching details: Processed ~100% of signatures (662/662 sigs → 662 txns fetched)...
0|sova-backend-api  |   Fetching details: Processed ~100% of signatures (488/488 sigs → 488 txns fetched)...
 [HeliusSyncService] [Sync] 🎉 SmartFetch completed for Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7: 0 transactions processed and saved to database.
 [PnlAnalysisService] [PnlAnalysis] Analysis completed for Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7: 782 transactions → 85 tokens, Net PNL: -0.8503 SOL
0|sova-backend-api  |   Fetching details: Processed ~100% of signatures (662/662 sigs → 662 txns fetched)...
0|sova-backend-api  |   Fetching details: Processed ~100% of signatures (662/662 sigs → 662 txns fetched)...
 [HeliusSyncService] [Sync] 🎉 SmartFetch completed for Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7: 0 transactions processed and saved to database.
 [PnlAnalysisService] [PnlAnalysis] Analysis completed for Gu7JugMP1FZHdFmKDveCHxsJXwXGe4P1pYeRz47nq1V7: 782 transactions → 85 tokens, Net PNL: -0.8503 SOL

| SYNC-2 | **Concurrent job overlap on same wallet** — `pnl` and `dashboard-analysis` lock keys are separate, so both job types can run simultaneously on the same wallet, each triggering independent full Helius fetches + analysis. Need a shared sync-level lock, or at minimum ensure only one job type can hold the sync at a time. Also: `pnl-overview` period picker change triggers `analyzeWalletPnl` (all-time) via the all-time path on every period switch — `isViewOnly: true` but still expensive. | 🔴 |
| DA-12 | **PnL Curve Panel + Calendar — wallet profile header redesign** — see DA-12 design spec below | 🟡 |
| MCP-8 | **[sova-intel-mcp] Post-publish end-to-end smoke test** — install published MCP in Claude Desktop or Claude Code, run `wallet_hud` live | 🔴 NOW |
| MCP-13 | **[sova-intel-mcp] x402 runtime verification** — packaging is fixed; still need real standalone `x402` startup/payment verification | 🔴 |
| MCP-15 | **[sova-intel-mcp] Acceptance-bar verification pass** — local code/package fixes are done; still need live invalid-input, expired-result-key, upstream-error, limited-mode, apikey, and x402 verification against the API | 🟡 |
| GTM-3 | **Open Twitter bot for public use** — rate-limit and open; announce on @Sova_intel | 🟡 |
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

### April 8, 2026 — Daily Aggregates: Schema + Service (DA-1, DA-2)

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------:|
| DA-1 | 🎯 FEAT | **[DAILY-AGG-SCHEMA]** `WalletDailyPnl` model added to `prisma/schema.prisma`. Fields: additive swap facts, FIFO-attributed realized PnL, USD nullable metrics, quality flags (`hasIncompleteEnrichment`, `hasIncompleteHistory`), `lastComputedAt` explicit freshness field. `@@unique([walletAddress, date])`. | 🟢 S | `prisma/schema.prisma` |
| DA-2 | 🎯 FEAT | **[DAILY-AGG-SERVICE]** `DailyAggregationService` implemented. Full-history FIFO pass with per-sell date attribution via `attributeSellsByDay`. Additive fields (volume, fees, counts) computed in a single scan. `recomputeDays(wallet, dates[])` + `recomputeRecentDays(wallet, nDays)`. Reviewed and corrected for coding conventions: `createLogger` (Winston), `core/` import aliases, `volumeUsd` null semantics tied to `hasIncompleteEnrichment`. Does NOT call `analyzeWalletPnl`. | 🟢 S | `src/core/services/daily-aggregation.service.ts` |

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




