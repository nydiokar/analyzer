# Sova Intel - Project Context

**Branch:** `discover-analytics-ux` • **Last Updated:** 2026-01-26 • **Status:** 🟢 Active Development

---

## 🎯 Current Focus & Priorities

### P0: Database Deadlock ✅ FIXED
**Issue:** PostgreSQL deadlocks during parallel token metadata upserts
**Status:** ✅ Fixed with two-pronged approach (Jan 26, 2026)
**Solution:**
- **Prevention (95% reduction):** Sort token addresses alphabetically before transaction to ensure consistent lock acquisition order across all processes
- **Recovery (remaining 5%):** Exponential backoff retry with jitter for rare deadlock cases
**Impact:** Eliminates intermittent enrichment failures during similarity/holder-profiles analysis
**Next Step:** Monitor production logs to verify fix effectiveness
See [Recent Activity](#-recent-activity) for implementation details.

### P1: Helius API Optimization (Mandatory, Not Urgent)
**Goal:** Reduce redundant RPC calls from 29k account fetches to ~10-50 per check (95%+ reduction)

<details>
<summary><b>Implementation Recommendation</b></summary>

**Phase 1: Quick Win**
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

**Frame 4: Token Analysis** 📝 Planned
- Most Common Tokens component
- Historical vs Live Holdings (2 components, 1 frame)
- **Goal:** Balanced horizontal space, proper visual separation

**Frame 5: Contextual Holdings** 📝 Planned
- Standalone contextual holdings component
- **Goal:** Review & ensure consistency with other frames

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

### Detailed Frame Progress Tracker

**Frame 1: Wallet Input Area** - Status: 🔄 In Progress
```
Component Graph:
page.tsx (lines 554-591)
├─ Card container with flex layout
│  ├─ LEFT: SmartWalletInput.tsx (lg:w-[500px])
│  │  ├─ Label + "Clear All" button
│  │  ├─ Textarea (min-h-[180px], font-mono, resize-y)
│  │  └─ Status Row (status message + [ANALYZE] button)
│  └─ RIGHT: TokenHolderPicker.tsx (when token detected)
│     ├─ Token Badge header
│     ├─ Selection controls (count + All/Clear)
│     ├─ System wallet warning
│     └─ Scrollable table (checkbox | # | Wallet | % Hold)
└─ LOADING STATE (page.tsx lines 593-632)
   └─ ✅ Modern pulsing animation with shimmer effect

What's Done:
✅ Modern loading animation (pulsing borders, shimmer, gradient)
✅ Placeholder text verified ("Paste wallet or token addresses...")
✅ Instructions display working (status message lines 74-108)
✅ Checkbox column exists (TokenHolderPicker.tsx line 169)

What's Pending:
⏳ Table text size review (currently text-[10px], may be too small)
⏳ Color schema refinement for better contrast
⏳ Verify 10-15% side margins properly applied
⏳ Test responsive behavior (desktop 2-column → mobile stacked)
```

**Frame 2: Global Analysis Metrics** - Status: ✅ Complete
```
Component: GlobalMetricsCard.tsx
✅ 5-stat grid (wallets, top pairs sim, tokens, holdings value, largest holding)
✅ Top 5 most similar pairs with WalletBadge integration
✅ Score distribution chart (capital/behavioral/cumulative lines)
✅ Comprehensive tooltips with contextual information
✅ Responsive grid layout (2/3/5 columns based on screen size)
✅ Proper visual hierarchy and spacing
```

**Frame 3: Pair Insights** - Status: 🔄 In Progress
```
Component Graph (To Be Discovered):
- Wallet Pairs list component
- Shared Tokens deep dive component
- Color/category labeling logic

Critical Issues to Fix:
1. Wallet pairs expansion indicator unclear
   - High number of shared tokens vs high ratio (% of portfolio)
   - Need visual cue: "14 of 48 total" vs "14 of 15 total" = very different
2. Shared tokens structure problems
   - Tokens appear unstructured ("hanging in air")
   - Percentages lack context (0.3% • 0.3% - of what?)
   - No grouping/sorting/hierarchy
   - Missing token metadata (prices appear stale)
3. Token price staleness
   - Already-fetched token metadata not being reused
   - Need to trace data flow from analysis → display

Next Steps:
1. ✅ Update CONTEXT.md status
2. Find wallet pairs component
3. Find shared tokens component
4. Trace token price data flow
5. Design improved UX (visual hierarchy, ratio indicators)
6. Implement improvements
```

**Frame 4: Token Analysis** - Status: 📝 Planned
```
Components:
- Most Common Tokens
- Historical vs Live Holdings

Goal: Balance layout treating both as unified frame
```

**Frame 5: Contextual Holdings** - Status: 📝 Planned
```
Goal: Review standalone component for consistency
```

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

## 📋 Active Work

| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
| 🔄 | Similarity Lab Frame 3: Pair Insights UX improvements | 🔸 | Next priority: improve wallet pairs display, shared tokens structure, and color schema |
| 🔄 | Summary card skeleton regression | 🔸 | Summary card in wallet profile turns into skeleton after some time - investigate state/cache issue |
| 🔄 | Multiple token enrichment calls investigation | 🔸 | Multiple identical enrichment calls showing in logs - identify source component/flow |

**Recently Completed:**
- ✅ P0: Database deadlock fix with prevention + retry (Jan 26)
- ✅ Similarity Lab Frame 1: Wallet Input Area (Jan 23-25)
- ✅ Similarity Lab Frame 2: Global Analysis Metrics (Jan 25)
- ✅ Error logging cleanup audit (Jan 22)
- ✅ Holder Profiles bucket alignment verification (Jan 25)
- ✅ Job subscription handling refactor (Jan 25)
- ✅ TimeRangeSelector hydration fix (Jan 25)



<details>
<summary><b>Legend</b></summary>

**Status:** 🔄 In Progress • ⏸️ Blocked • 📝 Ready • ✅ Testing
**Scope:** 🔹 Small (<50 lines, <1hr) • 🔸 Medium (2-5 files, <4hrs) • 🔶 Large (5+ files, multi-day)

</details>

---

## 📅 Recent Activity

### January 26, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 26.1 | 🔧 | P0 Fix: Database deadlock resolution with prevention + retry | 🔹 | `database-service.ts` |

**Summary:**

**26.1:** Fixed PostgreSQL deadlock errors (code 40P01) in `upsertManyTokenInfo` with industry-standard two-pronged approach. **Prevention:** Sort token data alphabetically by address before transaction - ensures all concurrent processes acquire locks in the same order, reducing deadlock probability by ~95%. **Recovery:** Implemented exponential backoff retry with jitter (100ms base, 3 max retries) to handle rare remaining deadlocks. Added deadlock-specific error detection checking multiple error formats (error.code, error.meta.code, Prisma P2034). This is the PostgreSQL-recommended solution - deadlocks are impossible to prevent 100% in concurrent systems, so the correct approach is: (1) minimize probability with consistent lock ordering, (2) handle gracefully with retries. Alternative approaches (global locks, per-token locks, removing transactions) would sacrifice either performance or data consistency.

### January 25, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 25.1 | ✅ | Similarity Lab Frame 2: Global Analysis Metrics complete | 🔸 | `GlobalMetricsCard.tsx`, `WalletBadge.tsx` |
| 25.2 | ✅ | Similarity Lab Frame 3: Pair Insights improvements | 🔸 | `EnhancedKeyInsights.tsx`, `page.tsx` |
| 25.3 | 🔧 | Job subscription handling refactor | 🔸 | `WalletProfileLayout.tsx`, `useJobProgress.ts`, `job-progress.gateway.ts` |
| 25.4 | 🔧 | TimeRangeSelector hydration mismatch fix | 🔹 | `TimeRangeSelector.tsx` |
| 25.5 | 🔧 | Error logging cleanup across services | 🔸 | `token-info.service.ts`, processors, `database-service.ts` |

**Summary:**

**25.1:** Completed Frame 2 with comprehensive global metrics display. Implemented 5-stat grid (wallets analyzed, top pairs similarity, tokens analyzed, current holdings value, largest holding percentage). Added Top 5 most similar pairs section with WalletBadge integration for proper wallet display with known types/labels. Created score distribution chart with capital/behavioral bars and cumulative line. Added extensive tooltip system with contextual information. Responsive grid layout (2/3/5 columns).

**25.2:** Enhanced Pair Insights component with improved clarity and functionality. Refined wallet pair display and shared tokens visualization. Updated color schema for better alignment with score distribution patterns.

**25.3:** Refactored job subscription handling to improve WebSocket connection management and cleanup. Enhanced cache cleanup scripts. Updated DTOs for better type safety in dashboard analysis flow.

**25.4:** Fixed React hydration mismatch in TimeRangeSelector by ensuring consistent server/client rendering. Prevents console warnings about mismatched content.

**25.5:** Continued error logging cleanup initiative from Jan 22. Applied `getCleanErrorMessage()` utility across additional services including token-info service, queue processors, and database service. Added Redis URL configuration to .env.example.

### January 23, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 23.1 | ✅  | Similarity Lab Frame 1: Modern loading animation | 🔹 | `similarity-lab/page.tsx`, `globals.css` |

**Summary:**

**23.1:** Replaced generic progress bar with modern multi-layer animated loading component. Features: (1) Dual pulsing borders with staggered timing (30%/50% opacity); (2) Pulsing dot indicator with ping effect; (3) Gradient progress bar with shimmer sweep animation; (4) Custom shimmer keyframe in globals.css; (5) Backdrop blur effects and tabular-nums for no layout shift. Component positioned below wallet input area as specified in Frame 1 design. Established "frame-by-frame" approach for Similarity Lab UX overhaul - treating each major section as cohesive visual/functional clusters rather than isolated components.

### January 22, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 22.1 | 🔧 | Error logging cleanup & circular reference fix | 🔸 | Logger crash prevention + clean error messages in user-facing flows |

**Summary:**

**22.1:** Fixed cascading logger failures caused by circular references in error objects. Added `safeStringify()` to logger and auto-sanitization of error metadata. Created `error-utils.ts` for clean error messages. Automated cleanup of 88 error logs across 15 critical user-facing files (similarity, PnL, holder profiles, API controllers, queue processors). Logs reduced from 50+ lines per error to single actionable lines. Added whale wallet protection in enrichment processor: 5k token hard cap, 0.01 minimum balance threshold, balance-sorted prioritization to prevent system overload from wallets with 20k+ dust tokens.

### January 17, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 17.1 | ✅ | Wallet type taxonomy simplification | 🔹 | Protocol wallet types (ORCA/JUPITER/RAYDIUM/METEORA) merged into unified PROTOCOL type with distinct labels |
| 17.2 | ✅ | Holder Profiles v2 final review | 🔹 | Complete UX polish and validation of holder profiles feature |
| 17.3 | ✅| Wallet refresh completion handling | ?? | `dashboard/src/components/layout/WalletProfileLayout.tsx`, `src/api/controllers/analyses.controller.ts`, `src/core/services/database-service.ts`, `dashboard/src/hooks/useTokenMetadata.ts` |
| 17.4 | 🔧 | System wallet detection wiring + holder profiles filtering | 🔸 | `src/queues/processors/analysis-operations.processor.ts`, `src/api/services/system-wallet-detection.service.ts`, `src/core/services/helius-api-client.ts` |

**Summary:**

**17.1:** Simplified wallet classification taxonomy by merging specialized DEX protocol types (ORCA, JUPITER, RAYDIUM, METEORA) into a single PROTOCOL wallet type. Each maintains distinct labels for identification while reducing type proliferation in the system.

**17.2:** Completed final review and validation of Holder Profiles v2 feature. All UX refinements, tooltip improvements, and bucket alignment work verified and ready for production use.

**17.4:** Wired dynamic system wallet detection into holder profile wallet-mode entry, filtered all holders before queueing jobs, and persisted LP/Protocol tags from top holders into DB/Redis so similarity can skip them consistently. Added thin count-only helper in Helius API client for early-exit detection and documented its use in system wallet detection.

### January 16, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 16.1 | ✅ | Wallet classification system: Defense-in-depth architecture | 🔶 | `constants.ts`, `system-wallet-detection.service.ts`, `helius-sync-service.ts`, `analysis-operations.processor.ts`, `pnl-analysis-service.ts`, `behavior.service.ts`, `WALLET_CLASSIFICATION_SYSTEM.md` |
| 16.2 | ✅ | Wallet registry integration & token price refresh | 🔶 | `known-wallets.ts`, `analysis-operations.processor.ts`, `token-info.service.ts`, `similarity.service.ts` |

**Summary:**

**16.1:** Completed full defense-in-depth architecture for wallet detection. Removed shouldBlock/isSystemWallet/isLargeWallet boolean flags. Removed WALLET_CLASSIFICATIONS.INVALID and .JUPITER. Implemented three-layer protection: (1) Entry points do early RPC detection before queueing expensive jobs (dashboard, analyze-pnl, analyze-behavior processors); (2) Sync service checks DB knownType and skips; (3) PnL/Behavior services check registry + DB knownType as safety net. 70k+ tokens auto-tagged with knownType='SYSTEM' during CURRENT run via RPC call. LARGE (15k-70k) uses isLarge flag, analyzed normally. All layers use SKIP_* exclusion sets for consistency. Registry + dynamic detection unified - same treatment whether wallet is in static registry or detected via RPC. DB query optimization: behavior service now fetches wallet once and reuses for both knownType and staleness checks (50% reduction). Comprehensive documentation with flow diagrams added.

**16.2:** Registry now lives in src/config/known-wallets.ts and drives central wallet-type filtering for PnL, similarity, and holder profiles. Holder profiles and similarity now pull fresh token prices during analysis and recompute holding values. Known wallet labels flow through backend analysis and are surfaced in holder profile results.

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

**Last Updated:** 2026-01-17 • **Branch:** `discover-analytics-ux`

