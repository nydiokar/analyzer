# Sova Intel - Project Context

**Branch:** `discover-analytics-ux` • **Last Updated:** 2026-01-30 • **Status:** 🟢 Active Development

---

## 📋 Active Work

| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
| 🔄 | Tracked wallets backend-frontend wiring completion | 🔸 | Complete integration: import flow, WebSocket job tracking, cache invalidation, compare with other job flows |
| 🔄 | Similarity Lab Frame 3: Pair Insights UX improvements | 🔸 | Next priority: improve wallet pairs display, shared tokens structure, and color schema |
| 🔄 | Similarity Lab Frame 3: Pair Insights UX improvements | 🔸 | Next priority: improve wallet pairs display, shared tokens structure, and color schema |
| 🔄 | WHEN password is reset we must send confirmation email!


**Recently Completed:**
- ✅ **P0: Historical Mode Bug - Flash/Working Scopes Fixed** (Jan 29) - Removed timeRange from dashboard scopes to fix persistence
- ✅ DexScreener rate limiting fix with in-flight token tracking (Jan 30)
- ✅ Favorites import system with attack-resistant design (Jan 29)
- ✅ P0: Database deadlock fix with prevention + retry (Jan 26)
- ✅ Similarity Lab Frame 1: Wallet Input Area (Jan 23-25)
- ✅ Similarity Lab Frame 2: Global Analysis Metrics (Jan 25)
- ✅ Error logging cleanup audit (Jan 22)
- ✅ Holder Profiles bucket alignment verification (Jan 25)
- ✅ Job subscription handling refactor (Jan 25)
- ✅ TimeRangeSelector hydration fix (Jan 25)
- ✅ Bulk favorites import + auto-analysis queueing (Jan 27)
| ✅ | Summary card skeleton regression 



<details>
<summary><b>Legend</b></summary>

**Status:** 🔄 In Progress • ⏸️ Blocked • 📝 Ready • ✅ Testing
**Scope:** 🔹 Small (<50 lines, <1hr) • 🔸 Medium (2-5 files, <4hrs) • 🔶 Large (5+ files, multi-day)

</details>

---

## 🎯 Current Focus & Priorities


### P1: Helius API Optimization (Mandatory, Not Urgent)
**Goal:** Reduce redundant RPC calls from 29k account fetches to ~10-50 per check (95%+ reduction)

<details>
<summary><b>Implementation Recommendation</b></summary>

**Phase 1: Quick Win — ✅ Implemented (Jan 30, 2026)**
1. Enable `changedSinceSlot` in V2 API calls
   - Store last checkpoint slot in Redis per wallet
   - Only fetch changed accounts on subsequent calls
   - Falls back to full fetch if slot too old
2. Transaction-triggered cache invalidation
   - HeliusSyncService already processes transactions
   - When new transaction arrives, invalidate affected token accounts
   - Next balance request fetches only invalidated accounts

**Phase 2: Long-term Solution**
3. Helius Webhooks for account changes
   - Subscribe to account change webhooks (not just transaction webhooks)
   - Real-time balance updates, no polling needed
4. WebSocket subscriptions for active wallets
   - Open WebSocket connections for actively monitored wallets
   - Close connections when no longer needed
   - Instant updates for tracked wallets

</details>

---

## 🎨 Similarity Lab UX Overhaul - Frame-by-Frame Design Refinement

Working through Similarity Lab in detailed "frames" - treating each major section as a cohesive visual and functional unit. Each frame contains clusters of related components that must be understood holistically, not just as individual files.

### Frame Structure (Current Work)

**Frame 1: Wallet Input Area** ✅ Complete
- Textarea for wallet/token addresses
- Token holder picker (top holders table)
- Modern loading animation with pulsing borders & shimmer effect
- 10-15% side margins, 2-column layout (desktop), stacked (mobile)
- **Status:** ✅ All refinements complete

**Frame 2: Global Analysis Metrics** ✅ Complete
- Wallets analyzed count with tooltip
- Top pairs similarity score with status badges
- Tokens analyzed (actively traded)
- Current holdings value with median
- Largest holding percentage
- Top 5 most similar pairs with wallet badges
- Score distribution chart (capital/behavioral/cumulative)
- **Status:** ✅ Fully implemented with proper tooltips and visual hierarchy

**Frame 3: Pair Insights** 🔄 Next Priority
- Wallet pairs list with improved color schema
- Better alignment with score distribution
- Deep dive functionality (currently only shows shared tokens)
- Color contradictions to be resolved
- **Issues:**
  - Wallet pairs not clearly indicating high shared token count vs high ratio
  - Shared tokens display lacks structure (tokens "hanging in air")
  - Token prices appearing stale/not using already-fetched metadata
  - Need better visual hierarchy and context for shared tokens

### Working Protocol for Frames

**When discussing a frame, AI must:**
1. Visualize the complete component cluster
2. Understand spatial relationships and layout
3. Think about the frame as a cohesive unit, not individual files
4. Create ASCII/text visualization before implementing
5. Confirm understanding if anything is unclear

**Implementation approach:**
- Transform existing code (don't multiply/create redundant)
- Align explicitly with the vision
- Check holistically - not components, but clusters
- Maintain visual consistency across frames

### Task List Reference

The following tasks are created to track frame-by-frame work:
- **Task #6:** METHODOLOGY - Frame-by-frame explanation (reference doc)
- **Task #2:** Frame 1 - Complete refinements (table styling, margins, text size)
- **Task #1:** Frame 2 - Design and implement Global Analysis Metrics
- **Task #4:** Frame 3 - Redesign Pair Insights with better colors
- **Task #5:** Frame 4 - Optimize Token Analysis layout
- **Task #3:** Frame 5 - Review Contextual Holdings

Use `TaskList` to see current status, `TaskGet #N` to see details, `TaskUpdate` to mark progress.

---

## 📅 Recent Activity

### January 30, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 30.1 | 🔧 | DexScreener 429 rate limiting fix - in-flight token tracking | 🔹 | `token-info.service.ts`, `string-sanitizer.ts`, `database-service.ts`, `helius-api-client.ts`, `queue.config.ts`, `constants.ts` |
| 30.2 | 🔧 | Similarity balances + token metadata stability pass | 🔸 | `dashboard/src/app/similarity-lab/page.tsx`, `dashboard/src/hooks/useTokenMetadata.ts`, `src/api/services/balance-cache.service.ts`, `src/core/services/wallet-balance-service.ts`, `src/core/services/helius-api-client.ts`, `src/config/constants.ts`, `src/queues/processors/enrichment-operations.processor.ts`, `dashboard/src/components/similarity-lab/results/MostCommonTokens.tsx` |

**Summary:**

**30.1:** Fixed cascading DexScreener 429 rate limit errors during bulk wallet analysis (138 concurrent jobs). **Root Cause:** Multiple enrichment jobs fetching same tokens simultaneously - with 95% token overlap across wallets (SOL, USDC, popular memes), system was making 138x redundant API calls. **Solution: In-Flight Token Tracking** - Redis-based deduplication system that marks tokens currently being fetched (`token:in-flight:{address}` with 30s TTL). When Job 2 starts while Job 1 is fetching SOL/USDC, Job 2's `getTokenEnrichmentPlan()` sees in-flight markers and skips those tokens. Markers automatically cleared after enrichment completes (with try/finally safety). **Additional Fixes:** (1) UTF-8 sanitization utility (`string-sanitizer.ts`) to strip null bytes from Solana transaction data before DB insert - prevents `invalid byte sequence for encoding "UTF8": 0x00` errors; (2) Batched metadata updates with deadlock handling in `updateMetadataSourceToHybrid()` to reduce lock contention; (3) Reduced Helius RPS from 40→40 (kept), internal concurrency 10→8, enrichment queue concurrency recommendations (user handling config). **Expected Impact:** 90%+ reduction in duplicate token fetches, zero 429 errors, 20-30 min for 138-wallet imports (down from 10-15 min with retries/failures). **Implementation Details:** Check-then-set pattern with 2-5ms race window (acceptable - goal is 95% reduction not 100%). TTL failsafe prevents stuck markers if cleanup fails. Non-blocking design - no polling or waiting. Bug fixed in `enrichTokensBackground()` missing cleanup call.

**30.2:** Fixed TokenBadge metadata auto-refresh (forced post-enrichment refresh). Switched similarity lab persistence to job-pointer only (no giant localStorage payloads), deduped enrichment subscriptions, and trimmed enriched balances to meaningful tokens only. MostCommonTokens now builds metadata only for rendered mints (logs removed). Enabled V2 `changedSinceSlot` incremental balance updates centrally via BalanceCacheService with slot tracking + merge logic, added whale-aware cache TTLs in `constants.ts`, and centralized `MIN_UI_BALANCE` filtering.

### January 29, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 29.1 | 🟦 | Favorites import system - attack-resistant design | 🔸 | `user-favorites.controller.ts`, `user-favorites.service.ts`, `database-service.ts`, `constants.ts`, `batch-analyze-favorites.dto.ts` |
| 29.2 | 🔧 | P0 Fix: Dashboard scopes (flash/working) persistence bug | 🔹 | `analysis-operations.processor.ts` |

**Summary:**

**29.1:** Implemented production-ready favorites import system with enterprise-grade protection. **Import Flow:** 50+250 batching (first 50 HIGH priority immediate, next 250 LOW priority staggered over 1 hour with 14.4sec delays). **Cooldown Protection:** User-level import cooldown (1 hour between bulk imports) via `User.lastBulkImportAt`. **Freshness Checking:** Wallet-level freshness (existing `AnalysisRun` table + processor logic) - prevents duplicate analysis when multiple users track same wallet. **New Endpoints:** `POST /batch-analyze` (up to 20 wallets, working/deep scope) and `POST /collections/:name/refresh` (flash analysis for collection, max 100 wallets). **Key Decision:** Did NOT add per-user analysis timestamps (would cause duplicate work problem) - instead rely on existing wallet-level freshness checks in processor. **DTO Cleanup:** Removed confusing unused params from import DTO (analyze, analysisScope, forceRefresh, etc). All jobs queue with `forceRefresh: false` to let processor decide based on wallet-level staleness. System correctly handles 100 users tracking same wallet - first queues analysis, subsequent requests skipped by processor.

**29.2:** Fixed critical bug where flash/working scopes completed analysis but didn't persist data, causing frontend to show "unanalyzed" state. **Root Cause:** `timeRange` was set for non-deep scopes (7d/30d) to optimize data fetching, but this incorrectly triggered "historical view" mode in PnL service → skipped persistence to protect FIFO lots from corruption. **The Insight:** Dashboard scopes are **progressive all-time snapshots** (differing only in depth: 250/2000/3000 signatures), NOT time windows. Setting `timeRange` conflated two concepts: (1) data fetching optimization and (2) historical query detection. **The Fix:** Removed `timeRange` from dashboard scope initialization (set to `undefined` for all scopes). Flash/working now fetch transactions based purely on `targetSignatureCount`, process ALL fetched data chronologically, and persist complete FIFO lot state. User-triggered time ranges (via API `?startDate=...`) remain view-only via `isViewOnly: true` flag. See `.ai/context/HISTORICAL_VIEW_INVESTIGATION.md` for full analysis and test plan.

### January 27, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 27.1 | ?? | Similarity Lab: Holder picker tracking flow + UI refactor | ?? | `similarity-lab/page.tsx`, `TokenHolderPicker.tsx`, `BulkTrackModal.tsx`, `WalletBadge.tsx`, tracking hooks |
| 27.2 | ?? | Favorites: Allow tracking wallets without prior analysis (stub wallet upsert) | ?? | `database-service.ts` |
| 27.3 | 🛠 | P0 Fix: Invalid address auto-trigger spam | 🔹 | `dashboard/src/lib/solana-utils.ts`, `WalletProfileLayout.tsx`, `WalletSearch.tsx` |
| 27.4 | 🟦 | Bulk favorites import + auto-analysis queueing | 🔸 | `user-favorites.controller.ts`, `user-favorites.service.ts`, `database-service.ts`, `trackers/page.tsx` |

**Summary:**

**27.1:** Redesigned holder picker tracking UX with a confirmable bulk-track modal, compact copy/track controls, and LP/system exclusion. Extracted tracking logic into reusable hooks and a shared modal, added a similarity-lab flow hook, and refined holder table spacing + minimal wallet badge copy actions.

**27.2:** Removed the ?wallet must exist? constraint for favorites by upserting a stub wallet record on add. Users can now track wallets immediately without forcing analysis; analysis still behaves as initial sync when run later.

**27.3:** Fixed invalid address auto-trigger spam by enforcing base58 decode validation (32-byte public key), preventing auto-trigger when address is invalid, and adding an auto-trigger cooldown even on request failure to stop retry storms.

**27.4:** Added bulk favorites import endpoint with schema normalization (trackedWalletAddress/name/emoji/alertsOn), batch upsert for favorites, and auto-queue dashboard analysis after import. Trackers UI now supports JSON/CSV import, optional import collection, and auto-queues deep analysis for the first 5 wallets (targetSignatureCount set to 10k but capped by DASHBOARD_MAX_SIGNATURES until raised).

<details>
<summary><b>Icon Legend</b></summary>

**Type:**
✅ Completed • 🔧 Fix/Refactor • 📊 Metrics/Monitoring • 📝 Documentation • ⚖️ Decision • 🔴 Bug • 🔵 Feature

</details>


## ⚠️ Known Issues

| Severity | Issue | Impact | Location | Status |
|:--------:|:------|:-------|:---------|:------:|
| 🟢 | Database Deadlock in Token Metadata Upserts | ~~Intermittent enrichment failures~~ | `database-service.ts:upsertManyTokenInfo` | ✅ Fixed (Jan 26) |

<details>
<summary><b>Details: Database Deadlock (RESOLVED)</b></summary>

**Error:** `PostgresError { code: "40P01", message: "deadlock detected" }`

**Root Cause:** Multiple parallel DexScreener batch processes attempting to upsert overlapping token sets in different orders, causing circular lock dependencies.

**Example Scenario:**
```
Process A: Upserts [TokenA, TokenB, TokenC]
Process B: Upserts [TokenC, TokenB, TokenA] (same tokens, different order)
→ Process A locks TokenA, Process B locks TokenC
→ Both wait for TokenB → DEADLOCK
```

**Solution Implemented (Jan 26, 2026):**

1. **Prevention (~95% reduction):**
   - Sort all token data alphabetically by address before transaction
   - Ensures consistent lock acquisition order across all concurrent processes
   - Industry-standard deadlock prevention technique

2. **Recovery (remaining ~5%):**
   - Exponential backoff retry (100ms base, 200ms, 400ms)
   - Random jitter (0-50ms) to prevent retry collision
   - Max 3 attempts before failing
   - Deadlock-specific error detection (40P01, P2034)

**Why This Approach:**
- ✅ Maintains parallel processing performance
- ✅ Preserves transaction atomicity
- ✅ Follows PostgreSQL best practices
- ❌ Alternative (global lock): Kills parallelism
- ❌ Alternative (no transactions): Loses data consistency

**Monitoring:** Watch for log messages "Deadlock detected in upsertManyTokenInfo" to verify fix effectiveness.

</details>

---

## 🏗️ Architecture Decisions

### Lock Scope Independence
*Decided: 2026-01-13*

Each analysis type uses isolated lock keys:

```
Dashboard:       lock:wallet:dashboard-analysis:{address}
PnL:             lock:wallet:pnl:{address}
Behavior:        lock:wallet:behavior:{address}
Sync:            lock:wallet:sync:{address}
Similarity:      lock:similarity:{requestId}
Holder Profiles: NO LOCK (relies on service idempotency)
```

**Rationale:** Services are idempotent. Database caching allows safe concurrent execution. Metrics track if contention becomes problematic.



---

## 📚 Quick Reference

### Key Code Locations

| Area | Path | Notes |
|:-----|:-----|:------|
| **Dashboard Components** | `dashboard/src/components/` | Primary work area |
| Discover Page | `dashboard/src/app/discover/` | ✅ Complete |
| Tracked Wallets | `dashboard/src/app/trackers/` | ✅ Complete |
| Holder Profiles v2 | `dashboard/src/components/holder-profiles/v2/` | 🔄 Final review |
| Similarity Lab | `dashboard/src/app/similarity-lab/` | 📝 Bug fixes pending |
| Analysis API | `src/api/controllers/analyses.controller.ts` | Backend endpoints |
| Queue System | `src/queues/processors/` | Job processing |
| Core Analysis | `src/core/analysis/` | Math & logic |

### Documentation Files

| File | Purpose |
|:-----|:--------|
| `CONTEXT.md` | Timeline, active tasks, decisions (this file) |
| `GUIDE.md` | Implementation roadmap, build instructions |
| `RULES.md` | AI agent execution contract |
| `HANDOFF.md` | Session start/end protocol |

---

## 💡 Usage Guide

### When to Update

✅ After completing tasks → Add to Recent Activity
✅ Starting new work → Add to Active Work
✅ Architectural decisions → Add to Architecture Decisions
✅ Discovering bugs → Add to Known Issues
✅ End of session → Update Current Focus, timestamp, and CHANGELOG.md for user-facing changes

### Entry Format

Recent Activity entries use: `DD.N` numbering (e.g., `13.1`, `13.2` for Jan 13)

```
| ID | Icon | Clear title | Scope | Key components/files |
```

- **ID:** Day.Sequence (13.1, 13.2, ...)
- **Icon:** Type indicator (✅ 🔧 📊 📝 ⚖️ 🔴 🔵)
- **Title:** What was accomplished
- **Scope:** 🔹 Small, 🔸 Medium, 🔶 Large
- **Components:** Shortened paths to key files

---

**Last Updated:** 2026-01-27 • **Branch:** `discover-analytics-ux`


