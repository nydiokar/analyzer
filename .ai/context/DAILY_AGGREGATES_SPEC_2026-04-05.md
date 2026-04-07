# Daily Aggregates Implementation Spec
**Date:** 2026-04-07  
**Status:** REVISED 2026-04-07 — corrections applied post code audit  
**Author:** Architecture audit + spec (Claude, session 2026-04-05); corrections (Claude, session 2026-04-07)

> This document is the canonical handoff artifact for the next agent tasked with planning and executing daily aggregate support. Every claim below was verified against the actual codebase. Uncertainty is called out explicitly. Do not act on assumptions — re-read the referenced files before writing code.

---

## 0. How to Read This Document

Sections 1–2 are **facts from code inspection**. Sections 3–11 are **design decisions and recommendations**. The executing agent should validate sections 1–2 by re-reading the referenced files before trusting them — code may have changed since this audit.

---

## 1. Current Architecture — Facts From Code

### 1.1 Sync and Analysis Flow

**Entry point:** `HeliusSyncService.syncWalletData(walletAddress, options)` in `src/core/services/helius-sync-service.ts` (lines 83–180).

**Trigger mechanism:** On-demand only. Triggered by:
- Dashboard user action → `POST /analyses/dashboard-wallet-analysis` → BullMQ queue job
- Direct API call
- No nightly reanalysis cron exists

**Step-by-step sync flow:**
```
[Trigger: Dashboard / Queue / API]
      ↓
HeliusSyncService.syncWalletData()
  → Pre-flight: skip SYSTEM/INVALID wallets, check knownType
  → smartFetch or standardFetch (two-phase or single-pass Helius API call)
  → mapHeliusTransactionsToIntermediateRecords() → SwapAnalysisInput[]
  → SwapAnalysisInput.create() per record [dedup: (signature, mint, direction, amount)]
  → Update wallet.firstProcessedTimestamp / newestProcessedTimestamp / newestProcessedSignature
      ↓
PnlAnalysisService.analyzeWalletPnl(walletAddress, timeRange?, options?)
  → SwapAnalyzer per mint → AnalysisResult.upsert() [unique: walletAddress + tokenAddress]
  → Aggregate across tokens → WalletPnlSummary.upsert() [unique: walletAddress]
  → AdvancedTradeStats.upsert() [nested 1:1 with WalletPnlSummary]
      ↓
BehaviorService.analyzeWalletBehavior(walletAddress, timeRange?, pnlMap?)
  → BehaviorAnalyzer.analyze() over SwapAnalysisInput records
  → WalletBehaviorProfile.upsert() [ONLY if timeRange is NOT provided — explicit guard line 123]
```

**Idempotency controls:**
- `SwapAnalysisInput` unique constraint: `(signature, mint, direction, amount)` — prevents duplicate rows on retry
- 10-minute freshness gate: wallet analyzed < 10min ago → skip re-analysis (`pnl-analysis-service.ts:198`)
- Redis distributed lock: prevents concurrent analysis for the same wallet (`analysis-operations.processor.ts:140–157`)
- Each summary model is **upserted** (never delete+recreate), so a partial failure leaves the prior version intact

**Critical observation:** The three summary models are **not written in a shared transaction.** PnL upsert and behavior upsert can succeed/fail independently, leaving the wallet in a partially updated state. This is an existing risk, not introduced by daily aggregates.

---

### 1.2 SwapAnalysisInput — Schema

**File:** `prisma/schema.prisma` lines 83–107  
**Table:** `SwapAnalysisInput`

| Field | Type | Notes |
|---|---|---|
| `id` | Int (autoincrement) | PK |
| `walletAddress` | String | Wallet being analyzed |
| `signature` | String | Solana tx signature |
| `timestamp` | Int | **Unix seconds — from Helius block time. This is the partition key for daily aggregates.** |
| `mint` | String | Token being traded |
| `amount` | Float | UI token amount |
| `direction` | String | `"in"` (buy) or `"out"` (sell) |
| `associatedSolValue` | Float | SOL value from parsed instruction |
| `associatedUsdcValue` | Float? | USDC value (optional) |
| `interactionType` | String | Swap program type (e.g. `"raydium_swap"`) |
| `feeAmount` | Float? | Gas/protocol fee |
| `feePercentage` | Float? | Fee as percentage |
| `solPriceUsd` | Float? | SOL/USD at time of tx (enrichment) |
| `usdValue` | Float? | Total USD value (enrichment: solValue × solPrice) |
| `tokenPriceUsd` | Float? | Per-token USD price (enrichment) |
| `marketCapUsd` | Float? | Token market cap at time (enrichment) |
| `mcapBucket` | String? | `"nano"` \| `"ultra-micro"` \| `"micro"` \| `"small"` \| `"mid"` \| `"large"` \| `"mega"` |
| `enrichedAt` | DateTime? | When enrichment completed; null = not enriched yet |

**Unique constraint:** `(signature, mint, direction, amount)`  
**Timestamp reliability:** High. Block time from Helius, 1-second precision. Safe for `floor(timestamp / 86400)` day bucketing.  
**Date extraction:** `new Date(timestamp * 1000).toISOString().slice(0, 10)` → `"YYYY-MM-DD"` UTC

---

### 1.3 AnalysisResult — Schema and Usage

**File:** `prisma/schema.prisma` lines 109–157  
**Unique constraint:** `(walletAddress, tokenAddress)` — one lifetime row per wallet+token

**Key fields:**

| Field | Classification | Notes |
|---|---|---|
| `totalAmountIn`, `totalAmountOut` | Raw fact | Aggregated swap amounts |
| `totalSolSpent`, `totalSolReceived` | Raw fact | SOL flows |
| `transferCountIn`, `transferCountOut` | Raw fact | Swap counts |
| `firstTransferTimestamp`, `lastTransferTimestamp` | Raw fact | Unix seconds |
| `netSolProfitLoss`, `realizedPnlSol` | Derived | Computed from pairing logic |
| `unrealizedPnlSol`, `totalPnlSol` | Derived | Requires current price |
| `avgEntryMcap`, `typicalEntryMcapUsd` | Derived | Volume-weighted from enriched swaps |
| `hasIncompleteHistory` | Flag | True if buys exist before first sync — affects PnL accuracy |
| `currentUiBalance`, `balanceFetchedAt` | Live state | From balance fetch at analysis time |

**Write location:** `PnlAnalysisService.analyzeWalletPnl()` — fully recomputed and upserted each analysis run  
**Read locations:**
- `GET /wallets/:addr/token-performance` (`wallets.controller.ts:286–349`)
- `GET /wallets/:addr/pnl-overview` (`pnl-overview.service.ts:130–176`)
- `BehaviorService` — reads per-mint PnL for mcap enrichment (`behavior-service.ts:206–231`)

**No date dimension on AnalysisResult.** It is per wallet+token across all time. Adding per-day token granularity would require a separate `wallet+mint+day` table — out of scope for first implementation.

---

### 1.4 WalletPnlSummary — Schema and Usage

**File:** `prisma/schema.prisma` lines 180–211  
**Unique constraint:** `walletAddress` (one row per wallet)

**Key fields and classification:**

| Field | Classification | Notes |
|---|---|---|
| `totalVolume` | Additive | Σ(SOL spent + received) |
| `totalFees` | Additive | Σ(fees per token) |
| `realizedPnl` | Additive | Σ(per-token realized PnL) |
| `totalExecutedSwapsCount` | Additive | Σ(buy + sell swaps) |
| `profitableTokensCount` | Additive count | Distinct tokens with +PnL — NOT additive across days |
| `unrealizedPnl` | Point-in-time | Requires current prices — cannot reconstruct for past days |
| `netPnl` | Derived | realizedPnl + unrealizedPnl |
| `averageSwapSize` | Derived | totalVolume / count |
| `realizedPnlToTotalVolumeRatio` | Derived | Division of two additive fields |
| `currentSolBalance` | Live state | From balance fetch — no historical reconstruction possible |
| `overallFirstTimestamp`, `overallLastTimestamp` | Metadata | Unix seconds; lifetime span |

**AdvancedTradeStats (1:1 relation):**

| Field | Classification | Notes |
|---|---|---|
| `tokenWinRatePercent` | Derived | profitableTokens / totalTokens × 100 |
| `medianPnlPerToken` | Derived | Requires sorted distribution — not additive |
| `trimmedMeanPnlPerToken` | Derived | 10%-trimmed mean — not additive |
| `weightedEfficiencyScore` | Derived | PnL weighted by capital — not additive |

**Write location:** `PnlAnalysisService.analyzeWalletPnl()` — fully recomputed on each run; no delta updates  
**Read locations:** `GET /wallets/:addr/summary`, `GET /wallets/:addr/pnl-overview`

---

### 1.5 WalletBehaviorProfile — Schema and Usage

**File:** `prisma/schema.prisma` lines 229–294  
**Unique constraint:** `walletAddress`

**Key fields and windowability:**

| Field | Windowable? | Reason |
|---|---|---|
| `buySellRatio`, `totalTradeCount` | Yes — simple recount | Additive counts |
| `flipperScore` | No | Composite metric; sequence-dependent |
| `medianHoldTime` | No | Requires sorted per-token hold-time distribution |
| `sequenceConsistency` | No | Requires full buy→sell sequence |
| `sessionCount`, `avgTradesPerSession` | No | Session detection requires contiguous time |
| `activeTradingPeriods`, `averageSessionStartHour` | No | Temporal pattern over full history |
| `tradingStyle`, `speedCategory`, `strategyType` | No | Classification based on absolute metric thresholds |
| `mcapDistribution`, `mcapBucketPnl` | No | Requires per-swap enrichment, not pre-aggregatable |

**Write location:** `BehaviorService.analyzeWalletBehavior()` — **only if `timeRange` is NOT provided** (explicit guard `behavior-service.ts:123`). This is intentional: behavior profiles are never persisted for windowed runs.  
**Read locations:** `GET /wallets/:addr/behavior-analysis`, `GET /wallets/:addr/summary` (classification tag)

**Key conclusion:** Behavior metrics are mostly non-additive and non-windowable at the daily row level. A windowed behavior analysis must re-run `BehaviorAnalyzer` over the full window's raw swaps. Do not create a `WalletBehaviorProfileDaily` table.

---

### 1.6 Database Schema — Time Fields Summary

| Table | Timestamp Field | Type | Purpose |
|---|---|---|---|
| `SwapAnalysisInput` | `timestamp` | Int (Unix seconds) | Block time — **partition key for daily buckets** |
| `AnalysisResult` | `firstTransferTimestamp`, `lastTransferTimestamp` | Int (Unix seconds) | Trade span per token |
| `WalletPnlSummary` | `overallFirstTimestamp`, `overallLastTimestamp` | Int (Unix seconds) | Lifetime span |
| `WalletBehaviorProfile` | `firstTransactionTimestamp`, `lastTransactionTimestamp` | Int (Unix seconds) | Lifetime span |
| `Wallet` | `firstProcessedTimestamp`, `newestProcessedTimestamp` | Int (Unix seconds) | Sync progress |
| `SolDailyPrice` | `date` | String (`"YYYY-MM-DD"`) | SOL/USD daily price cache |
| `TokenLot` | `purchaseTimestamp` | Int (Unix seconds) | FIFO lot basis |
| `AnalysisRun` | `runTimestamp` | DateTime | Job audit log |

**No existing time-partitioned or daily-snapshot tables** for any summary model.

---

### 1.7 API Routes — Existing

All in `src/api/controllers/wallets.controller.ts`.

| Endpoint | Time Params | Current Behavior |
|---|---|---|
| `GET /wallets/:addr/summary` | `startDate?`, `endDate?` (ISO 8601) | Passes to service but behavior unclear — may not be fully wired through |
| `GET /wallets/:addr/pnl-overview` | `startDate?`, `endDate?` | Fully wired: converts to `{startTs, endTs}`, triggers `analyzeWalletPnl(..., timeRange, isViewOnly: true)` — **ad-hoc recompute from raw swaps, never persisted** |
| `GET /wallets/:addr/behavior-analysis` | `startDate?`, `endDate?` | Accepted, passed to service, result NOT saved to DB |
| `GET /wallets/:addr/token-performance` | None | Lifetime only, paginated |

**Key observation for `/pnl-overview` with time range:** Every call with `startDate/endDate` re-runs `analyzeWalletPnl` from scratch over raw swaps for that window. This holds a Redis lock and is computationally expensive. The daily aggregate table is the fix for this.

---

### 1.8 Jobs and Scheduling

**Framework:** BullMQ (Redis-backed). Job types: `analyze-pnl`, `analyze-behavior`, `dashboard-wallet-analysis`.

**Scheduled jobs (currently):**
- Alert evaluator: `@Cron('*/30 * * * * *')` — evaluates token price alerts only. No analysis scheduling.
- Payment reconciliation: repeating BullMQ job — unrelated.

**`@Cron` pattern reference:** The `@Cron` decorator from `@nestjs/schedule` is already established in this codebase. See `src/queues/jobs/alert-evaluator.job.ts` and `src/api/services/wallet-hunt.service.ts` for existing usages. The daily aggregation job follows the same pattern.

**No nightly reanalysis cron.** Analysis runs only on explicit request.

---

### 1.9 Recomputation and Failure Risks (Existing)

1. **PnL + behavior not in shared transaction.** If behavior upsert fails after PnL succeeds, wallet is partially updated. Existing risk — not worsened by daily aggregates.
2. **Concurrent analysis:** Redis lock prevents this. Safe.
3. **Stale balance data:** If balance fetch fails, `unrealizedPnl` is wrong. Live fetch only — no historical reconstruction possible.
4. **SwapAnalysisInput dedup on retry:** Unique constraint handles this, but `createMany` must use `skipDuplicates: true` (verify this is the case in current code before relying on it).
5. **`hasIncompleteHistory` on AnalysisResult:** Some wallets have buys before first sync. Cost basis is unknown; realized PnL is an undercount. Daily rows for these wallets will inherit this inaccuracy.

---

## 2. Feasibility Assessment

### What holds

- `SwapAnalysisInput.timestamp` is reliable for UTC calendar-day bucketing. No special handling needed.
- Dedup constraint on `SwapAnalysisInput` makes daily recompute idempotent — retrying a day's computation always produces the same result.
- Fields like `totalFees`, `realizedPnlSol`, `tradeCount`, `volumeSol` are additive — they can be stored per day and summed for any window with correct arithmetic.
- PostgreSQL is sufficient. Data volume and query patterns do not require ClickHouse. This is not a performance problem; it is a missing persistence layer.

### What fails or does not hold

- **`unrealizedPnl` cannot be stored for past days.** It requires current token prices and current open positions. A past-day `unrealizedPnl` would be meaningless or incorrect. Exclude from `WalletDailyPnl`.
- **`currentSolBalance` cannot be reconstructed for past days.** Live fetch only. Exclude.
- **Behavior metrics are not additive and not storable as daily rows.** Windowed behavior analysis requires re-running `BehaviorAnalyzer` over the full window's raw swaps. No daily behavior table.
- **`profitableTokensCount` (lifetime) is a distinct-token count.** Summing a daily version across N days overcounts tokens touched on multiple days. For windowed distinct counts, query `SwapAnalysisInput` directly.
- **`medianPnlPerToken`, `trimmedMeanPnlPerToken`** (AdvancedTradeStats) require a sorted distribution — not derivable from daily row aggregates.
- **Realized PnL attribution spans day boundaries.** A buy on day 1 + sell on day 8 produces realized PnL attributed to day 8 (the sell date). This is correct and consistent with how `PnlAnalysisService` currently scopes timeRange queries, but it must be explicitly communicated to users.
- **FIFO lot matching requires full chronological history.** Scoping `buildFifoLotsForToken` to a single calendar day's swaps produces wrong results for sells that close positions opened on earlier days. `realizedPnlSol` for daily rows must be derived from a full-history FIFO pass with per-sell date attribution — not from day-scoped calls to `analyzeWalletPnl`. See §3 and §5 for the correct approach.

---

## 3. Recommended Target Design

### Core principle

**Separate two concerns that are currently collapsed:**

1. **Lifetime summaries** (`WalletPnlSummary`, `WalletBehaviorProfile`, `AnalysisResult`) — unchanged. These remain the outputs of full-history analysis runs.
2. **Daily PnL aggregates** — one new table, written by a separate job, never by the sync/analysis flow.

**Do not create:** `WalletBehaviorProfileDaily`, per-token daily rows (`wallet+mint+day`).

---

### 3.1 Proposed New Table: `WalletDailyPnl`

```prisma
model WalletDailyPnl {
  id                       Int      @id @default(autoincrement())
  walletAddress            String
  date                     String   // "YYYY-MM-DD" UTC calendar day

  // Additive swap facts — safe to SUM across any window
  tradeCount               Int      // buy + sell swaps on this day
  buyCount                 Int
  sellCount                Int
  volumeSol                Float    // Σ(associatedSolValue) for all swaps
  feesSol                  Float    // Σ(feeAmount) for all swaps

  // Realized PnL — attributed to sell date via full-history FIFO pass
  realizedPnlSol           Float    // Net realized PnL for sell events on this day
  profitableSellsCount     Int      // Sell events where FIFO-attributed PnL was positive
  totalSellsCount          Int      // All sell events on this day (same as sellCount)

  // Token coverage
  uniqueMintsTradedCount   Int      // Distinct mints touched today (NOT additive for multi-day distinct counts)
  newMintsEnteredCount     Int      // First-ever buy of this mint for this wallet

  // USD metrics (nullable — only if enrichment data present)
  volumeUsd                Float?
  realizedPnlUsd           Float?

  // Data quality flags
  hasIncompleteEnrichment  Boolean  // True if any swap in this day lacked usdValue / mcapBucket
  hasIncompleteHistory     Boolean  // True if wallet has hasIncompleteHistory on AnalysisResult (cost basis unknown)

  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
  lastComputedAt           DateTime // Set explicitly on every successful aggregation run — used for freshness monitoring

  @@unique([walletAddress, date])
  @@index([walletAddress])
  @@index([date])
}
```

**Note on `profitableSellsCount` / `totalSellsCount`:** These are sell-event counts, not token counts. A single token traded multiple times contributes one entry per sell event. `winRate` derived from these fields is a sell-event win rate, not a token win rate. See §3.2 for the derivation formula.

**Note on `lastComputedAt`:** Set explicitly on every successful aggregation run, distinct from `updatedAt` (which advances on any write). Enables the monitoring query `WHERE "lastComputedAt" < NOW() - INTERVAL '26 hours'` to surface wallets whose daily rows have gone stale. `@updatedAt` alone is insufficient — it advances on every write but does not advance when a row is intentionally skipped or when the nightly job finds nothing changed.

### 3.2 What Is NOT in This Table (Explicit Exclusions)

| Excluded field | Reason |
|---|---|
| `unrealizedPnl` | Point-in-time mark-to-market; meaningless for past days |
| `currentSolBalance` | Live fetch only; no historical reconstruction |
| `winRate` | Derive at query time: `SUM(profitableSellsCount) / SUM(totalSellsCount)` |
| Any behavior metrics | Non-additive; require full sequence re-analysis |
| Per-token PnL | Requires `wallet+mint+day` — future scope |
| `medianPnlPerToken`, `trimmedMeanPnl` | Require sorted distribution across window |

### 3.3 Relationship to Other Models

| Model | Relationship |
|---|---|
| `SwapAnalysisInput` | **Source of truth.** `WalletDailyPnl` is derived from it. All recomputes go back to this table. |
| `AnalysisResult` | **Independent.** Lifetime per-token summary. Not a source for and not derived from `WalletDailyPnl`. |
| `WalletPnlSummary` | **Independent.** Lifetime wallet aggregate. Can be cross-validated: `SUM(WalletDailyPnl.realizedPnlSol)` should approximate `WalletPnlSummary.realizedPnl` (within tolerance of incomplete-history wallets). |
| `WalletBehaviorProfile` | **No relationship.** Behavior remains full-history or ad-hoc windowed only. |

---

## 4. Metrics Classification

### Safe additive daily metrics (SUM across any window gives correct result)

- `tradeCount`, `buyCount`, `sellCount`
- `volumeSol`, `feesSol`
- `totalSellsCount`, `profitableSellsCount`
- `realizedPnlSol` (with sell-date attribution semantic — see §10)
- `volumeUsd`, `realizedPnlUsd` (where not null)

### Derivable from daily aggregates at query time

| Metric | Formula |
|---|---|
| `winRate` for N-day window | `SUM(profitableSellsCount) / SUM(totalSellsCount)` (sell-event win rate) |
| Average trade size | `SUM(volumeSol) / SUM(tradeCount)` |
| Total realized PnL for period | `SUM(realizedPnlSol) WHERE date BETWEEN X AND Y` |
| Daily PnL chart | One row per day; `realizedPnlSol` plotted directly |
| Period-over-period comparison | Two range sums, compared |

### Metrics that still require raw fact recomputation (cannot be served from daily rows)

- `unrealizedPnl` — needs current token prices + open positions
- `netPnl` — depends on unrealizedPnl
- Distinct `uniqueMintsTraded` for multi-day window — `SUM(uniqueMintsTradedCount)` overcounts; must `SELECT COUNT(DISTINCT mint) FROM SwapAnalysisInput`
- `medianHoldTime`, `flipperScore`, `sequenceConsistency` — require sorted per-token sequence
- `activeTradingPeriods`, session metrics — require session detection across contiguous time
- `mcapDistribution`, `mcapBucketPnl` — require per-swap enrichment data

### Metrics that need lifetime-only treatment

- `currentSolBalance`, `solBalanceFetchedAt`
- `overallFirstTimestamp`, `overallLastTimestamp`
- `totalSignaturesProcessed`
- `medianPnlPerToken`, `trimmedMeanPnlPerToken`, `weightedEfficiencyScore`

### Metrics requiring special handling for time windows

- `realizedPnlSol` — buy-sell pairs straddling day/window boundaries: attribute PnL to **sell date**. Consistent with sell-date attribution semantic. Must be documented.
- `profitableSellsCount` vs lifetime `profitableTokensCount` — the lifetime field counts distinct profitable tokens. For daily/windowed use, `profitableSellsCount` counts profitable sell events on that day. Semantically different — do not conflate. A token traded on multiple days contributes one sell event per sell transaction, not one per token.

---

## 5. Flow Changes

### Before (current)

```
Trigger → sync() → SwapAnalysisInput rows
→ analyzeWalletPnl() → AnalysisResult + WalletPnlSummary
→ analyzeWalletBehavior() → WalletBehaviorProfile
```

### After (proposed)

```
Trigger → sync() → SwapAnalysisInput rows
→ analyzeWalletPnl() → AnalysisResult + WalletPnlSummary  [UNCHANGED]
→ analyzeWalletBehavior() → WalletBehaviorProfile          [UNCHANGED]
→ [after analysis completes] dispatch async BullMQ job:
    DailyAggregationJob for this wallet (today + yesterday) [NON-BLOCKING — user response not delayed]
```

```
[Primary trigger — after each analysis, non-blocking]
analysis-operations.processor.ts (around line 232, after walletHudService.invalidateCache)
→ dispatch BullMQ job: DailyAggregationJob({ walletAddress, dates: [today, yesterday] })
→ DailyAggregationService.recomputeDays(walletAddress, dates)
   → runs full-history FIFO pass, attributes sell events to their calendar day
   → upserts WalletDailyPnl rows for affected dates
   → sets lastComputedAt on each row
```

```
[Secondary trigger — nightly repair, @Cron('0 0 * * *')]
DailyAggregationJob (cron: midnight UTC)
→ Fetch wallets where lastComputedAt < NOW() - 26 hours (not refreshed by primary trigger)
→ For each: DailyAggregationService.recomputeRecentDays(walletAddress, last 2–3 days)
   → covers late-arriving enrichment and wallets not recently analyzed
```

### Why two tiers

The primary async dispatch (after analysis) keeps daily rows fresh immediately after a wallet is analyzed, without waiting up to 23 hours for the nightly cron. It is non-blocking — the BullMQ job is dispatched after the user response is already sent, mirroring the existing `walletHudService.invalidateCache` pattern at line 232 of `analysis-operations.processor.ts`. The nightly repair cron is a safety net for wallets that were not recently analyzed and for late-arriving enrichment on the last 2–3 days.

### Why daily aggregation does NOT call `analyzeWalletPnl` — CRITICAL

`DailyAggregationService` does **not** call `analyzeWalletPnl` at all, not even with `isViewOnly: true`. The reason is architectural:

`buildFifoLotsForToken` (in `src/core/analysis/swap/fifo-lot-tracker.ts`) requires the full chronological buy history to correctly cost sells. If you scope `getSwapAnalysisInputs` to a single calendar day, sells that close positions opened on earlier days will have no matching lots. This triggers `hasIncompleteHistory = true` and produces wrong or zero `realizedPnlSol` for the majority of real trades. This would silently corrupt the primary metric the feature exists to show.

**Correct approach:** Run FIFO over the full wallet history, then attribute each sell event to its calendar day:

1. Fetch all `SwapAnalysisInput` rows for the wallet (no time filter), ordered by `timestamp ASC` — same as a normal `analyzeWalletPnl` call.
2. Group rows by `mint`. For each mint, run `buildFifoLotsForToken` (imported from `src/core/analysis/swap/fifo-lot-tracker.ts`) over the full chronological history.
3. During FIFO execution, for each sell event (`direction='out'`), record: `{ date: UTC calendar day of sell timestamp, realizedPnlSol: proceeds minus costBasis for this sell, isProfitable: boolean }`.
4. Group these per-sell records by date → produces `realizedPnlSol`, `profitableSellsCount`, `totalSellsCount` per day.
5. JOIN with a simple `SwapAnalysisInput GROUP BY date` aggregation for the additive fields (`tradeCount`, `buyCount`, `sellCount`, `volumeSol`, `feesSol`, `uniqueMintsTradedCount`, `newMintsEnteredCount`).

`buildFifoLotsForToken` is already exported from `src/core/analysis/swap/fifo-lot-tracker.ts` and can be called directly. The backfill uses the same `DailyAggregationService` — no separate logic.

### Why daily aggregation does NOT modify the sync or analysis flow

Do not modify `helius-sync-service.ts` or the analysis flow (`pnl-analysis-service.ts`, `behavior-service.ts`). The async daily aggregation dispatch belongs in `analysis-operations.processor.ts`, after analysis completes, mirroring the existing HUD cache invalidation pattern at line 232.

### Failure handling and idempotency

- `@@unique([walletAddress, date])` → upsert semantics → safe to rerun
- Process wallets in bounded batches; log per-wallet failures without aborting the run
- A failed row leaves the prior version intact; correct value is written on retry
- No dependency between rows across days — each day is independently recomputable

---

## 6. Touch Points

### New files to create

| File | Purpose |
|---|---|
| `prisma/migrations/XXXX_add_wallet_daily_pnl.sql` | Schema migration |
| `src/core/services/daily-aggregation.service.ts` | Core logic: full-history FIFO pass with per-sell date attribution; upserts `WalletDailyPnl` rows |
| `src/queues/jobs/daily-aggregation.job.ts` | `@Cron` nightly repair job + BullMQ job handler for per-wallet dispatch |
| `src/api/dto/wallet-daily-pnl.dto.ts` | Query + response DTOs for new endpoint |

### Files to modify

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `WalletDailyPnl` model |
| `src/api/controllers/wallets.controller.ts` | Add `GET /wallets/:addr/pnl-daily` endpoint |
| `src/queues/processors/analysis-operations.processor.ts` | After analysis completes (around line 232, after `walletHudService.invalidateCache`), dispatch async BullMQ job for daily aggregation of this wallet |
| `src/core/modules/` (relevant NestJS module) | Register `DailyAggregationService` and job |
| `dashboard/src/` | Add daily PnL chart component |

### Files explicitly NOT touched

| File | Reason |
|---|---|
| `pnl-analysis-service.ts` | Lifetime analysis flow unchanged |
| `behavior-service.ts` | Behavior stays lifetime-only; no daily variant |
| `helius-sync-service.ts` | Sync flow unchanged — do not modify |

---

## 7. API Impact

### New endpoint

```
GET /wallets/:walletAddress/pnl-daily
Query params:
  startDate: string (ISO date, required)
  endDate:   string (ISO date, required)
  groupBy?:  "day" | "week" | "month" (default: "day")

Response shape:
{
  attributionMethod: "sell_date",   // PnL is attributed to the sell event's calendar day
  data: [
    {
      date: "2026-03-01",
      tradeCount: number,
      buyCount: number,
      sellCount: number,
      volumeSol: number,
      feesSol: number,
      realizedPnlSol: number,
      profitableSellsCount: number,
      totalSellsCount: number,
      winRate: number,               // derived: profitableSellsCount / totalSellsCount (sell-event win rate)
      uniqueMintsTradedCount: number,
      volumeUsd: number | null,
      realizedPnlUsd: number | null,
      hasIncompleteEnrichment: boolean,
      hasIncompleteHistory: boolean
    }
  ],
  summary: {
    totalRealizedPnlSol: number,
    totalTradeCount: number,
    totalVolumeSol: number,
    winRate: number,
    periodStart: string,
    periodEnd: string
  }
}
```

### Existing endpoint changes

**`GET /wallets/:addr/pnl-overview` with `startDate/endDate`:** Currently triggers an ad-hoc `analyzeWalletPnl` re-run from raw swaps (expensive, holds Redis lock). This can eventually be served from `WalletDailyPnl` rows for the period instead. **This is an optimization — do not implement in phase 1. Keep the existing ad-hoc path.** Migrate in a later stage after daily rows are validated.

**No other existing endpoints require changes for the minimum viable implementation.**

### Backward compatibility

Zero breaking changes. All existing endpoints and response shapes are unchanged. `WalletDailyPnl` is purely additive.

---

## 8. Dashboard Impact

### Views that can use daily data immediately (new build)

- Daily PnL chart: `GET /wallets/:addr/pnl-daily` → bar/line chart
- Period comparison panel (7d vs 30d vs all-time): summary block from new endpoint
- Trailing-N-day KPIs in wallet summary card (optional, new component)

### Views that cannot use daily data

| View | Why | What to do |
|---|---|---|
| Behavior classification card | No daily behavior equivalent | Keep reading `WalletBehaviorProfile` (lifetime only) |
| Token performance table | No `wallet+mint+day` data | Keep reading `AnalysisResult` (lifetime only) |
| SOL balance display | No historical balance | Keep live-fetch path |

### Comparison support

`WalletDailyPnl` makes period-over-period comparison trivial — two date range sums. Straightforward to implement in the dashboard once the endpoint exists.

---

## 9. Backfill and Migration Plan

### Schema migration (SQL)

```sql
CREATE TABLE "WalletDailyPnl" (
  "id"                       SERIAL PRIMARY KEY,
  "walletAddress"            TEXT NOT NULL,
  "date"                     TEXT NOT NULL,
  "tradeCount"               INTEGER NOT NULL,
  "buyCount"                 INTEGER NOT NULL,
  "sellCount"                INTEGER NOT NULL,
  "volumeSol"                DOUBLE PRECISION NOT NULL,
  "feesSol"                  DOUBLE PRECISION NOT NULL,
  "realizedPnlSol"           DOUBLE PRECISION NOT NULL,
  "profitableSellsCount"     INTEGER NOT NULL,
  "totalSellsCount"          INTEGER NOT NULL,
  "uniqueMintsTradedCount"   INTEGER NOT NULL,
  "newMintsEnteredCount"     INTEGER NOT NULL,
  "volumeUsd"                DOUBLE PRECISION,
  "realizedPnlUsd"           DOUBLE PRECISION,
  "hasIncompleteEnrichment"  BOOLEAN NOT NULL DEFAULT false,
  "hasIncompleteHistory"     BOOLEAN NOT NULL DEFAULT false,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastComputedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletDailyPnl_walletAddress_date_key" UNIQUE ("walletAddress", "date")
);
CREATE INDEX "WalletDailyPnl_walletAddress_idx" ON "WalletDailyPnl"("walletAddress");
CREATE INDEX "WalletDailyPnl_date_idx" ON "WalletDailyPnl"("date");
```

### Backfill approach

**Problem:** `realizedPnlSol` and `profitableSellsCount` require FIFO lot matching over the full wallet history — this logic lives in TypeScript (`buildFifoLotsForToken`), not in SQL. A pure SQL GROUP BY can cover counts and volumes but not PnL.

**Correct approach:** Run `DailyAggregationService` (once implemented) as a one-time backfill script over all wallets. The service performs the full-history FIFO pass described in §5, attributing each sell event to its calendar day. The same service instance used for ongoing aggregation handles the backfill — no separate logic. This ensures backfill and ongoing daily rows are produced by identical code.

**Do not** call `analyzeWalletPnl(wallet, dayTimeRange, { isViewOnly: true })` scoped to individual calendar days. This produces wrong `realizedPnlSol` for any sell that closes a position opened on a prior day. See §5 for the full explanation.

**Cost estimate:** ~1–5 seconds per wallet (depending on history depth). For ~1000 wallets → 15–90 minutes. Acceptable for a one-time overnight run.

### Validation query (run after backfill)

```sql
SELECT
  w."walletAddress",
  w."realizedPnl"                AS lifetime_pnl,
  SUM(d."realizedPnlSol")        AS summed_daily_pnl,
  ABS(w."realizedPnl" - SUM(d."realizedPnlSol")) AS delta
FROM "WalletPnlSummary" w
JOIN "WalletDailyPnl" d ON d."walletAddress" = w."walletAddress"
GROUP BY w."walletAddress", w."realizedPnl"
ORDER BY delta DESC
LIMIT 50;
```

Non-zero deltas reveal wallets where daily and lifetime pairing logic diverged. Investigate top outliers. Perfect alignment is not expected for `hasIncompleteHistory` wallets (cost basis unknown). Because both the daily rows and the lifetime summary use `buildFifoLotsForToken` over full history, residual deltas should be small and explainable by enrichment gaps.

### Rollout order (staged, each step independently deployable)

| Stage | What | Risk |
|---|---|---|
| 1 | Schema migration (no writes) | Zero — additive |
| 2 | `DailyAggregationService` with unit tests | Low — isolated |
| 3 | Nightly cron repair job + async dispatch hook in `analysis-operations.processor.ts` | Low — dispatch is non-blocking; no existing behavior changed |
| 4 | Backfill script for historical data | Medium — CPU-intensive, safe to rerun |
| 5 | `GET /wallets/:addr/pnl-daily` read endpoint | Low — read-only |
| 6 | Dashboard daily PnL chart component | Low — UI only |
| 7 (optional/later) | Serve `pnl-overview` period queries from daily table | Medium — changes existing behavior |

Stage 7 is the only step that modifies an existing code path. Defer until daily rows are validated.

---

## 10. Risks and Contradictions

### Design risks

**R1 — Realized PnL sell-date attribution semantic**  
A buy on March 1 + sell on March 8 produces realized PnL in the March 8 daily row. A 7-day window containing March 8 but not March 1 includes this PnL. This is correct by the sell-date convention and consistent with how `PnlAnalysisService` already scopes time-range queries — but it is non-obvious to users. Must be documented in the API response (`attributionMethod: "sell_date"` in the response envelope) and explained in the dashboard.

**R2 — `uniqueMintsTradedCount` is not a cross-day distinct count**  
`SUM(uniqueMintsTradedCount)` over N days overcounts tokens traded on multiple days. Any dashboard metric claiming "distinct tokens traded in last 30 days" must query `SwapAnalysisInput` directly (`COUNT(DISTINCT mint) WHERE timestamp >= ...`). The daily row field is for single-day display only.

**R3 — Incomplete history wallets**  
Wallets with `AnalysisResult.hasIncompleteHistory = true` have unknown cost basis for some tokens. Their `realizedPnlSol` in daily rows (and lifetime) is an undercount. The `hasIncompleteHistory` flag on `WalletDailyPnl` propagates this signal — consumers must surface it visually rather than suppressing it.

### Implementation risks

**R4 — FIFO must run over full history, not day-scoped**  
FIFO lot matching (`buildFifoLotsForToken`) requires the full chronological buy history to correctly cost sells. Scoping the input to a single calendar day causes sells that close positions opened on prior days to produce `hasIncompleteHistory = true` and wrong or zero `realizedPnlSol` for the majority of real trades. The correct approach is the full-history FIFO pass with per-sell date attribution described in §5. `DailyAggregationService` calls `buildFifoLotsForToken` directly — it does not call `analyzeWalletPnl` at all. The backfill uses the same service.

**R5 — Nightly job failure leaves stale rows; `lastComputedAt` enables monitoring**  
If the cron fails mid-run, some wallets will have data for yesterday and some won't. The `lastComputedAt` field on `WalletDailyPnl` is set explicitly on every successful aggregation run. Monitoring query: `WHERE "lastComputedAt" < NOW() - INTERVAL '26 hours'`. Note that `@updatedAt` alone is insufficient — it advances on every write but does not advance when a row is intentionally skipped or when the nightly job runs and finds nothing changed.

**R6 — Backfill performance for large wallets**  
Wallets with thousands of swaps across months require a full `SwapAnalysisInput` scan per wallet. The full-history FIFO pass processes all rows in one pass, which is memory-bounded but not date-chunk-able without breaking FIFO correctness. A single wallet's full history is the minimum unit of work. Process wallets sequentially rather than in parallel during backfill to manage memory pressure.

### Semantic risks

**R7 — User interprets daily chart as "complete trading picture"**  
A wallet holding a position for 60 days shows zero realized PnL on 59 chart bars, then a large spike on sell day. This is correct but looks broken. The dashboard must explain this is realized-only and sell-date-attributed.

**R8 — Behavior metric pressure**  
As the daily chart ships, there will be product pressure to add per-day `flipperScore` or `speedCategory`. These are not additive and cannot be correctly produced from daily row aggregates. Running `BehaviorAnalyzer` per calendar day is theoretically possible but semantically wrong for single-day windows (most metrics need multi-day patterns to be meaningful). Resist this scope creep. If windowed behavior is needed, use the ad-hoc `GET /wallets/:addr/behavior-analysis?startDate=...&endDate=...` path with a multi-day window.

---

## 11. Final Recommendation

### Go / no-go

**Go.** Daily aggregates are feasible. The data is already correctly timestamped. The minimum viable implementation is small and does not touch any existing code path in a breaking way. PostgreSQL is sufficient for this data volume. ClickHouse is not justified.

### Minimum viable implementation (exact scope)

1. Add `WalletDailyPnl` table — Prisma migration. Include `lastComputedAt DateTime` field.
2. Implement `DailyAggregationService.recomputeDays(walletAddress, dates: string[])`:
   - Fetch **all** `SwapAnalysisInput` rows for the wallet (no time filter), ordered by `timestamp ASC`.
   - Group by `mint`. For each mint, call `buildFifoLotsForToken` (imported from `src/core/analysis/swap/fifo-lot-tracker.ts`) over the full history.
   - During FIFO execution, for each sell event (`direction='out'`), record `{ date: UTC calendar day of sell timestamp, realizedPnlSol: proceeds minus costBasis for this sell, isProfitable: boolean }`.
   - Group per-sell records by date → `realizedPnlSol`, `profitableSellsCount`, `totalSellsCount` per day.
   - JOIN with `SwapAnalysisInput GROUP BY date` for `tradeCount`, `buyCount`, `sellCount`, `volumeSol`, `feesSol`, `uniqueMintsTradedCount`, `newMintsEnteredCount`.
   - Sum `volumeUsd` (from `SwapAnalysisInput.usdValue`) where not null; set `hasIncompleteEnrichment` if any row in the day has null `usdValue`.
   - Propagate `hasIncompleteHistory` from any `AnalysisResult` row for this wallet.
   - Upsert `WalletDailyPnl` rows for the requested dates; set `lastComputedAt = now()` on each.
   - **Do not call `analyzeWalletPnl` anywhere in this service.**
3. In `analysis-operations.processor.ts`, after the existing `walletHudService.invalidateCache(walletAddress)` call (around line 232), dispatch an async BullMQ job: `DailyAggregationJob({ walletAddress, dates: [today, yesterday] })`. Non-blocking — user response is not delayed.
4. Add nightly `@Cron('0 0 * * *')` repair job (following the pattern in `src/queues/jobs/alert-evaluator.job.ts`) that queries wallets where `lastComputedAt < NOW() - 26 hours` and calls the service for the last 2–3 days (to catch late-arriving enrichment).
5. Add `GET /wallets/:addr/pnl-daily` endpoint with `startDate`/`endDate` query params. Include `attributionMethod: "sell_date"` in the response envelope.
6. Run one-time backfill script over all wallets using the same `DailyAggregationService`.

### What is out of scope for first implementation

- `WalletBehaviorProfileDaily` — do not create
- `wallet+mint+day` per-token daily rows — do not create
- Changing `pnl-overview` to serve from daily table — defer to stage 7
- `groupBy: week|month` in the API — can add later trivially
- Dashboard chart — build after endpoint is live and validated

---

## Appendix A: Key File Locations

| Component | File |
|---|---|
| Sync service | `src/core/services/helius-sync-service.ts` |
| PnL analysis | `src/core/services/pnl-analysis-service.ts` |
| Behavior service | `src/core/analysis/behavior/behavior-service.ts` |
| Behavior analyzer | `src/core/analysis/behavior/analyzer.ts` |
| Wallet controller | `src/api/controllers/wallets.controller.ts` |
| PnL overview service | `src/core/services/pnl-overview.service.ts` |
| Job processor | `src/queues/processors/analysis-operations.processor.ts` |
| FIFO lot tracker | `src/core/analysis/swap/fifo-lot-tracker.ts` |
| Alert evaluator job (Cron pattern reference) | `src/queues/jobs/alert-evaluator.job.ts` |
| Prisma schema | `prisma/schema.prisma` |
| Market context / enrichment | `src/core/services/market-context-standalone.ts` |

## Appendix B: Key Constraints for Executing Agent

1. Do not call `analyzeWalletPnl` from `DailyAggregationService`. Call `buildFifoLotsForToken` directly from `src/core/analysis/swap/fifo-lot-tracker.ts` over the full wallet history.
2. Do not scope `SwapAnalysisInput` queries to a single calendar day when computing `realizedPnlSol`. FIFO requires the full chronological history. Attribute sell events to their calendar day after the full-history FIFO pass.
3. Do not add daily behavior tables or daily token-level tables.
4. Do not modify `helius-sync-service.ts` or the analysis flow. The async daily aggregation dispatch belongs in `analysis-operations.processor.ts`, after analysis completes, mirroring the existing HUD cache invalidation pattern at line 232.
5. The `hasIncompleteHistory` flag must be propagated to `WalletDailyPnl` rows.
6. The `@@unique([walletAddress, date])` constraint is required — all writes must upsert.
7. `realizedPnlSol` attribution is sell-date-based — document this in code comments and API response (`attributionMethod: "sell_date"`).
8. Set `lastComputedAt` explicitly on every successful aggregation run. Do not rely on `@updatedAt` for freshness monitoring.
9. Validate by cross-checking `SUM(WalletDailyPnl.realizedPnlSol)` vs `WalletPnlSummary.realizedPnl` after backfill. Residual deltas should be small and limited to `hasIncompleteHistory` wallets.
10. ClickHouse is not on the table unless PostgreSQL proves structurally insufficient at production volume. It has not.
