# Daily Aggregates Implementation Spec
**Date:** 2026-04-05  
**Status:** READY FOR EXECUTION PLANNING  
**Author:** Architecture audit + spec (Claude, session 2026-04-05)

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
- `PnlAnalysisService` already accepts `timeRange` and correctly scopes to it. Calling it with a one-day window works today — it's just not persisted.
- PostgreSQL is sufficient. Data volume and query patterns do not require ClickHouse. This is not a performance problem; it is a missing persistence layer.
- Fields like `totalFees`, `realizedPnlSol`, `tradeCount`, `volumeSol` are additive — they can be stored per day and summed for any window with correct arithmetic.

### What fails or does not hold

- **`unrealizedPnl` cannot be stored for past days.** It requires current token prices and current open positions. A past-day `unrealizedPnl` would be meaningless or incorrect. Exclude from `WalletDailyPnl`.
- **`currentSolBalance` cannot be reconstructed for past days.** Live fetch only. Exclude.
- **Behavior metrics are not additive and not storable as daily rows.** Windowed behavior analysis requires re-running `BehaviorAnalyzer` over the full window's raw swaps. No daily behavior table.
- **`profitableTokensCount` (lifetime) is a distinct-token count.** Summing a daily version across N days overcounts tokens touched on multiple days. For windowed distinct counts, query `SwapAnalysisInput` directly.
- **`medianPnlPerToken`, `trimmedMeanPnlPerToken`** (AdvancedTradeStats) require a sorted distribution — not derivable from daily row aggregates.
- **Realized PnL attribution spans day boundaries.** A buy on day 1 + sell on day 8 produces realized PnL attributed to day 8 (the sell date). This is correct and consistent with how `PnlAnalysisService` currently scopes timeRange queries, but it must be explicitly communicated to users.

---

## 3. Recommended Target Design

### Core principle

**Separate two concerns that are currently collapsed:**

1. **Lifetime summaries** (`WalletPnlSummary`, `WalletBehaviorProfile`, `AnalysisResult`) — unchanged. These remain the outputs of full-history analysis runs.
2. **Daily PnL aggregates** — one new table, written by a separate nightly job, never by the sync/analysis flow.

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

  // Realized PnL — attributed to sell date
  realizedPnlSol           Float    // Net realized PnL for pairs closed on this day
  profitablePairsCount     Int      // Closed pairs with positive PnL
  totalPairsClosedCount    Int      // All closed pairs on this day

  // Token coverage
  uniqueMintsTradedCount   Int      // Distinct mints touched today (NOT additive for multi-day distinct counts)
  newMintsEnteredCount     Int      // First-ever buy of this mint for this wallet

  // USD metrics (nullable — only if enrichment data present)
  volumeUsd                Float?
  realizedPnlUsd           Float?

  // Data quality flag
  hasIncompleteEnrichment  Boolean  // True if any swap in this day lacked usdValue / mcapBucket
  hasIncompleteHistory     Boolean  // True if wallet has hasIncompleteHistory on AnalysisResult (cost basis unknown)

  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@unique([walletAddress, date])
  @@index([walletAddress])
  @@index([date])
}
```

### 3.2 What Is NOT in This Table (Explicit Exclusions)

| Excluded field | Reason |
|---|---|
| `unrealizedPnl` | Point-in-time mark-to-market; meaningless for past days |
| `currentSolBalance` | Live fetch only; no historical reconstruction |
| `winRate` | Derive at query time: `SUM(profitablePairsCount) / SUM(totalPairsClosedCount)` |
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
- `totalPairsClosedCount`, `profitablePairsCount`
- `realizedPnlSol` (with sell-date attribution semantic — see §10)
- `volumeUsd`, `realizedPnlUsd` (where not null)

### Derivable from daily aggregates at query time

| Metric | Formula |
|---|---|
| `winRate` for N-day window | `SUM(profitablePairsCount) / SUM(totalPairsClosedCount)` |
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

- `realizedPnlSol` — buy-sell pairs straddling day/window boundaries: attribute PnL to **sell date**. Consistent with existing `PnlAnalysisService` behavior. Must be documented.
- `profitableTokensCount` vs `profitablePairsCount` — the lifetime field counts distinct profitable tokens. For daily/windowed use, count profitable **pairs closed** on that day instead. Semantically different — do not conflate.

---

## 5. Flow Changes

### Before (current)

```
Trigger → sync() → SwapAnalysisInput rows
→ analyzeWalletPnl() → AnalysisResult + WalletPnlSummary
→ analyzeWalletBehavior() → WalletBehaviorProfile
```

### After (proposed — minimal change)

```
Trigger → sync() → SwapAnalysisInput rows
→ analyzeWalletPnl() → AnalysisResult + WalletPnlSummary  [UNCHANGED]
→ analyzeWalletBehavior() → WalletBehaviorProfile          [UNCHANGED]
```

```
[Separate nightly job — NOT in sync/analysis flow]
DailyAggregationJob (cron: midnight UTC)
→ Fetch wallets active in past 30 days
→ For each wallet: DailyAggregationService.recomputeRecentDays(walletAddress)
   → For each affected date: upsert WalletDailyPnl row
```

### Why daily aggregation is NOT part of sync flow

1. Sync is on the hot path (user-triggered, Redis-locked). Adding aggregation increases failure surface and latency.
2. Daily aggregates need only 24-hour granularity. Nightly recalculation is sufficient.
3. A separate job can re-run on failure without retriggering analysis.

### Sync vs async decision

**Async, nightly batch job.** Not inline with sync.

**One exception:** After first-ever full sync of a new wallet, the nightly job would leave it with no daily data until it runs (up to 23 hours). A backfill-on-first-analysis trigger is a reasonable optimization but should be deferred to avoid complexity.

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
| `src/core/services/daily-aggregation.service.ts` | Core logic: compute `WalletDailyPnl` rows from `SwapAnalysisInput` |
| `src/queues/jobs/daily-aggregation.job.ts` | `@Cron` nightly job that drives the service |
| `src/api/dto/wallet-daily-pnl.dto.ts` | Query + response DTOs for new endpoint |

### Files to modify

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `WalletDailyPnl` model |
| `src/api/controllers/wallets.controller.ts` | Add `GET /wallets/:addr/pnl-daily` endpoint |
| `src/core/modules/` (relevant NestJS module) | Register `DailyAggregationService` and job |
| `dashboard/src/` | Add daily PnL chart component |

### Files explicitly NOT touched

| File | Reason |
|---|---|
| `pnl-analysis-service.ts` | Lifetime analysis flow unchanged |
| `behavior-service.ts` | Behavior stays lifetime-only; no daily variant |
| `helius-sync-service.ts` | Sync flow unchanged |
| `analysis-operations.processor.ts` | No new BullMQ job types needed initially |

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
  data: [
    {
      date: "2026-03-01",
      tradeCount: number,
      buyCount: number,
      sellCount: number,
      volumeSol: number,
      feesSol: number,
      realizedPnlSol: number,
      profitablePairsCount: number,
      totalPairsClosedCount: number,
      winRate: number,           // derived: profitablePairs / totalPairs
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
  "profitablePairsCount"     INTEGER NOT NULL,
  "totalPairsClosedCount"    INTEGER NOT NULL,
  "uniqueMintsTradedCount"   INTEGER NOT NULL,
  "newMintsEnteredCount"     INTEGER NOT NULL,
  "volumeUsd"                DOUBLE PRECISION,
  "realizedPnlUsd"           DOUBLE PRECISION,
  "hasIncompleteEnrichment"  BOOLEAN NOT NULL DEFAULT false,
  "hasIncompleteHistory"     BOOLEAN NOT NULL DEFAULT false,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletDailyPnl_walletAddress_date_key" UNIQUE ("walletAddress", "date")
);
CREATE INDEX "WalletDailyPnl_walletAddress_idx" ON "WalletDailyPnl"("walletAddress");
CREATE INDEX "WalletDailyPnl_date_idx" ON "WalletDailyPnl"("date");
```

### Backfill approach

**Problem:** `realizedPnlSol` and `profitablePairsCount` require buy-sell pair matching — this logic lives in TypeScript (`PnlAnalysisService`), not in SQL. A pure SQL GROUP BY can cover counts and volumes but not PnL.

**Recommended approach:** Run `DailyAggregationService` (once implemented) as a one-time backfill script over all wallets. The service calls `analyzeWalletPnl(wallet, { startTs, endTs }, { isViewOnly: true })` scoped to each calendar day, extracts the realized PnL, and upserts the row. This reuses existing logic and avoids reimplementing pair matching.

**Cost estimate:** ~1–5 seconds per wallet (depending on history depth). For ~1000 wallets → 15–90 minutes. Acceptable for a one-time overnight run.

**Simple volume/count fields** can alternatively be pre-seeded via SQL GROUP BY before PnL is filled in, but this adds complexity for marginal gain. Recommend single-pass TypeScript backfill for correctness.

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

Non-zero deltas reveal wallets where daily and lifetime pairing logic diverged. Investigate top outliers. Perfect alignment is not expected for `hasIncompleteHistory` wallets (cost basis unknown) — this is acceptable.

### Rollout order (staged, each step independently deployable)

| Stage | What | Risk |
|---|---|---|
| 1 | Schema migration (no writes) | Zero — additive |
| 2 | `DailyAggregationService` with unit tests | Low — isolated |
| 3 | Nightly cron job, writes for new data only | Low — no existing code touched |
| 4 | Backfill script for historical data | Medium — CPU-intensive, safe to rerun |
| 5 | `GET /wallets/:addr/pnl-daily` read endpoint | Low — read-only |
| 6 | Dashboard daily PnL chart component | Low — UI only |
| 7 (optional/later) | Serve `pnl-overview` period queries from daily table | Medium — changes existing behavior |

Stage 7 is the only step that modifies an existing code path. Defer until daily rows are validated.

---

## 10. Risks and Contradictions

### Design risks

**R1 — Realized PnL sell-date attribution semantic**  
A buy on March 1 + sell on March 8 produces realized PnL in the March 8 daily row. A 7-day window containing March 8 but not March 1 includes this PnL. This is correct by the sell-date convention and consistent with how `PnlAnalysisService` already scopes time-range queries — but it is non-obvious to users. Must be documented in the API response (e.g. `attributionMethod: "sell_date"`) and explained in the dashboard.

**R2 — `uniqueMintsTradedCount` is not a cross-day distinct count**  
`SUM(uniqueMintsTradedCount)` over N days overcounts tokens traded on multiple days. Any dashboard metric claiming "distinct tokens traded in last 30 days" must query `SwapAnalysisInput` directly (`COUNT(DISTINCT mint) WHERE timestamp >= ...`). The daily row field is for single-day display only.

**R3 — Incomplete history wallets**  
Wallets with `AnalysisResult.hasIncompleteHistory = true` have unknown cost basis for some tokens. Their `realizedPnlSol` in daily rows (and lifetime) is an undercount. The `hasIncompleteHistory` flag on `WalletDailyPnl` propagates this signal — consumers must surface it visually rather than suppressing it.

### Implementation risks

**R4 — Daily pairing logic must match lifetime pairing logic**  
If `DailyAggregationService` uses a slightly different buy-sell pairing algorithm than `PnlAnalysisService`, daily rows will not sum to the lifetime figure. **Fix:** Do not reimplement pair matching. Call `analyzeWalletPnl(wallet, dayTimeRange, { isViewOnly: true })` and extract the PnL from its output. Extract the shared utility if needed for testing, but do not fork the logic.

**R5 — Nightly job failure leaves stale rows**  
If the cron fails mid-run, some wallets will have data for yesterday and some won't. Add per-wallet `updatedAt` to `WalletDailyPnl` and a monitoring query to surface wallets not refreshed within 26 hours.

**R6 — Backfill performance for large wallets**  
Wallets with thousands of swaps across months will be slow per TypeScript backfill. Consider processing in date-range chunks (e.g. 30-day batches) to reduce memory pressure per invocation. The underlying `PnlAnalysisService` already accepts `timeRange`, so this is straightforward.

### Semantic risks

**R7 — User interprets daily chart as "complete trading picture"**  
A wallet holding a position for 60 days shows zero realized PnL on 59 chart bars, then a large spike on sell day. This is correct but looks broken. The dashboard must explain this is realized-only and sell-date-attributed.

**R8 — Behavior metric pressure**  
As the daily chart ships, there will be product pressure to add per-day `flipperScore` or `speedCategory`. These are not additive and cannot be correctly produced from daily row aggregates. Running `BehaviorAnalyzer` per calendar day is theoretically possible but semantically wrong for single-day windows (most metrics need multi-day patterns to be meaningful). Resist this scope creep. If windowed behavior is needed, use the ad-hoc `GET /wallets/:addr/behavior-analysis?startDate=...&endDate=...` path with a multi-day window.

---

## 11. Final Recommendation

### Go / no-go

**Go.** Daily aggregates are feasible. The data is already correctly timestamped. The minimum viable implementation is small and does not touch any existing code path. PostgreSQL is sufficient for this data volume. ClickHouse is not justified.

### Minimum viable implementation (exact scope)

1. Add `WalletDailyPnl` table — Prisma migration.
2. Implement `DailyAggregationService.computeDailyPnl(walletAddress, date: string)`:
   - Fetch `SwapAnalysisInput` rows for wallet + UTC day.
   - Count `tradeCount`, `buyCount`, `sellCount`, `uniqueMintsTradedCount`.
   - Sum `volumeSol` (`associatedSolValue`), `feesSol` (`feeAmount`).
   - Call `analyzeWalletPnl(wallet, { startTs, endTs }, { isViewOnly: true })` to get `realizedPnlSol`, `profitablePairsCount`, `totalPairsClosedCount`. **Do not reimplement pairing logic.**
   - Sum `volumeUsd` (from `SwapAnalysisInput.usdValue`) where not null; set `hasIncompleteEnrichment` if any row in the day has null `usdValue`.
   - Propagate `hasIncompleteHistory` from any `AnalysisResult` row for this wallet.
   - Upsert `WalletDailyPnl` row.
3. Add nightly `@Cron('0 0 * * *')` job that iterates wallets with `newestProcessedTimestamp` in last 30 days and calls the service for the last 2 days (yesterday + today, to catch late-arriving enrichment).
4. Add `GET /wallets/:addr/pnl-daily` endpoint with `startDate`/`endDate` query params.
5. Run one-time backfill script over all wallets.

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
| Prisma schema | `prisma/schema.prisma` |
| Market context / enrichment | `src/core/services/market-context-standalone.ts` |

## Appendix B: Key Constraints for Executing Agent

1. Do not reimplement buy-sell pairing logic. Reuse `PnlAnalysisService` with `isViewOnly: true`.
2. Do not add daily behavior tables or daily token-level tables.
3. Do not modify the sync flow or the analysis flow.
4. The `hasIncompleteHistory` flag must be propagated to `WalletDailyPnl` rows.
5. The `@@unique([walletAddress, date])` constraint is required — all writes must upsert.
6. `realizedPnlSol` attribution is sell-date-based — document this in code comments and API response.
7. Validate by cross-checking `SUM(WalletDailyPnl.realizedPnlSol)` vs `WalletPnlSummary.realizedPnl` after backfill.
8. ClickHouse is not on the table unless PostgreSQL proves structurally insufficient at production volume. It has not.
