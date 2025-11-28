# Current State

**Project**: Sova Intel - Wallet Analysis System (Scaling Plan Phase 6)
**Goal**: Expose reliable Solana wallet analytics (sync, similarity, reporting) across API, queues, CLI, and dashboard.
**Status**: In Progress
**Last Updated:** 2025-11-18 22:30 UTC
**Updated By:** Codex

---

## Architecture Principles

**⚠️ CRITICAL: Follow the existing async job-based pattern. DO NOT create "god services".**

### System Architecture Pattern:
```
1. Controller (HTTP) → Enqueues job, returns job ID
2. BullMQ Queue → Stores job
3. Processor (Worker) → Executes job asynchronously
4. API layer
4. Core Services → Business logic (BehaviorAnalyzer, TokenHoldersService, etc.)
5. Database → Data access (Prisma)
```

### DO:
- ✅ Controllers enqueue jobs (`await this.queue.add('job-type', data)`)
- ✅ Return job ID to frontend immediately
- ✅ Extend existing processors (`AnalysisOperationsProcessor`, `EnrichmentOperationsProcessor`)
- ✅ Reuse existing core services (`BehaviorAnalyzer`, `TokenHoldersService`, etc.)
- ✅ Frontend polls job status until complete

### DO NOT:
- ❌ Create synchronous API endpoints that do heavy processing
- ❌ Create centralized "god services" that orchestrate everything
- ❌ Process jobs directly in controllers
- ❌ Create new services when existing core services can be reused

### Example:
```typescript
// ❌ WRONG: God service doing everything
class HolderProfileService {
  async getTokenHolderProfiles() { /* synchronous heavy processing */ }
}

// ✅ CORRECT: Job-based async pattern
// Controller
POST /analyses/holder-profiles → enqueue job → return { jobId }

// Processor
AnalysisOperationsProcessor.processAnalyzeHolderProfiles()
  → TokenHoldersService.getTopHolders()
  → BehaviorAnalyzer.calculateHistoricalPattern()
  → Store results in DB

// Frontend
Poll GET /jobs/:jobId until status = 'completed'
```

**References**: See `.ai/context/holder-risk/architecture-holder-risk-analysis.md` for detailed implementation examples.

---

## Completed

- [x] Holder Profiles dashboard rebuilt using the unified Token Pulse / Wallet Classifier spec (Token outcome strips, cognitive primitives, multi-wallet compare up to six addresses with group insights) (dashboard/src/app/tools/holder-profiles/page.tsx, dashboard/src/components/holder-profiles/v2/**/*)

- [x] BullMQ orchestration stack spanning wallet, analysis, similarity, and enrichment operations with locking, DLQ, and job event streaming (`src/queues/queue.module.ts`, `src/queues/queues/*.ts`, `src/queues/services/*`, `src/api/controllers/jobs.controller.ts`)
- [x] Wallet ingestion and swap analysis persisted via Prisma (Helius client, transaction mapper, P/L summaries) (`src/core/services/helius-api-client.ts`, `src/core/services/helius-transaction-mapper.ts`, `prisma/schema.prisma`)
- [x] REST plus CLI entry points that trigger analyses and expose queue status (`src/api/controllers/analyses.controller.ts`, `src/scripts/helius-analyzer.ts`, `src/scripts/walletSimilarity.ts`)
- [x] Dashboard tabs now load via dynamic imports with the token performance tab set as default, cutting initial bundle size while keeping default UX on token metrics (`dashboard/src/components/layout/WalletProfileLayout.tsx`)
- [x] Dashboard-analysis API now returns existing job metadata instead of failing on locks, exposing `status: 'queued' | 'running'` and `alreadyRunning` for clients (`src/api/controllers/analyses.controller.ts`, `src/api/shared/dto/dashboard-analysis.dto.ts`, `dashboard/src/types/api.ts`, `src/queues/services/redis-lock.service.ts`)
- [x] Token performance responses now include server-computed spam risk metadata consumed by the dashboard (risk filtering happens without client-side heuristics) (`src/api/services/token-performance.service.ts`, `src/api/shared/dto/token-performance-data.dto.ts`, `dashboard/src/types/api.ts`, `dashboard/src/components/dashboard/TokenPerformanceTab.tsx`)
- [x] Virtualized token performance table with stabilized skeleton heights and min-height container to reduce DOM cost and CLS (`dashboard/src/components/dashboard/TokenPerformanceTab.tsx`, `dashboard/package.json`)
 - [x] Staged dashboard auto-refresh for wallet profile: initial load over `min(7 days, 1000 signatures)`, then 30‑day window, then deep backfill to max‑tx cap; thresholds are config‑driven and backend orchestrates jobs with websocket progress streaming (`dashboard/src/components/layout/WalletProfileLayout.tsx`, `dashboard/src/components/dashboard/BehavioralPatternsTab.tsx`, `src/api/controllers/analyses.controller.ts`)
 - [x] Dashboard QA & polish pass: verification matrix (heavy/low‑activity/demo), restricted‑wallet guardrails tightened, CTA copy and instrumentation refreshed.
---

## Active

None - Ready for next feature.

## Recently Completed (Last 3-4 Days)

- **Exit Timing Token Drilldown** ✅ (2025-11-20) - See "Completed" section below for full details
- **Dashboard Components Documentation** ✅ (2025-11-20) - Comprehensive `dashboard/docs/components-overview.md` update

---

## Completed (Archived)

- **Holder Risk Analysis & Predictive Holding Time** *(See `.ai/context/holder-risk/architecture-holder-risk-analysis.md` for full details)*
  - **Status**: ✅ **ALL PHASES COMPLETE** (2025-11-17) - Ready for Staging Deployment
  - [x] Document holding time methodology in `docs/3.metrics_compact_map.md`
  - [x] Create architecture plan in `.ai/context/architecture-holder-risk-analysis.md`
  - [x] Critical review completed - plan finalized and ready to start
  - [x] **Phase 1 (Core Calculation)**: ✅ **COMPLETE** (2025-11-08)
    - [x] Add `calculatePeakPosition()` and `detectPositionExit()` (exit threshold: 20% remaining)
    - [x] Add `buildTokenLifecycles()` to track position states (ACTIVE/EXITED)
    - [x] Add `calculateHistoricalPattern()` with weighted average from completed positions only
    - [x] Implement weighted average entry time calculation (matches weighted sell logic)
    - [x] Add `historicalPattern` field to `BehavioralMetrics` (optional, non-breaking)
    - [x] Mark `weightedAverageHoldingDurationHours` and `averageFlipDurationHours` as `@deprecated`
    - [x] Write comprehensive unit tests (`test-holder-risk-analysis.ts` with 7 test scenarios)
    - [x] **Validate accuracy on 19 real wallets with 4,007+ exited positions** ✅
    - [x] **Critical bug fix**: Exit detection logic corrected (was misclassifying exits as dust)
    - [x] **Smart sampling strategy**: Handle high-volume wallets (500k+ txs) via 2000-signature sampling
    - [ ] Implement Redis caching for historical patterns (24h TTL) - DEFERRED to Phase 2
    - **Key Findings from Validation (2025-11-08)**:
      - **Bug discovered**: DUST threshold (≤5%) was checked before EXIT threshold (≤20%), causing all exits to be misclassified as dust
      - **Root cause**: Position at 0% would hit dust check first, never reaching exit logic despite `exitInfo.exited` being true
      - **Fix**: Removed DUST concept entirely, simplified to binary ACTIVE/EXITED classification based on 20% threshold
      - **DUST redefinition needed**: Should be value-based (e.g., <$0.001 SOL) not supply-based, deferred to future work
      - **Validation results**: 6 ULTRA_FLIPPER wallets (avg 35min hold), 13 FLIPPER wallets (avg 5.5h hold), 100% success rate
      - **Smart sampling validated**: 2000 signatures yields 50-357 exited positions per wallet, sufficient for reliable patterns
      - **Performance**: 12.8s avg sync time, <0.05s analysis time per wallet
      - **Files**: `src/core/analysis/behavior/analyzer.ts` (fixed), `test-holder-risk-sampled.ts` (validation), `holder-risk-test-report.md` (results)
  - [x] **Re-entry lifecycle bug FIXED** (2025-11-10): ✅ **RESOLVED**
    - **Issue**: `buildTokenLifecycles()` was creating ONE lifecycle per token mint, not handling re-entries
    - **Fix**: Lines 583-626 in `analyzer.ts` now split trades into separate cycles whenever balance hits 0
    - **Result**: Accurate hold time calculations for wallets that exit and re-enter positions
  - [x] **Phase 2 (Prediction Layer)**: ✅ **FUNCTIONALLY COMPLETE** (2025-11-12)
    - [x] Add `predictTokenExit()` method (`analyzer.ts:312-397`)
    - [x] Add current position analysis (weighted entry time, percent sold, status)
    - [x] Calculate `estimatedTimeUntilExit = max(0, historical - weightedCurrentAge)`
    - [x] Add risk level classification (CRITICAL <5min, HIGH <30min, MEDIUM <2h, LOW ≥2h) - optimized for memecoin flippers
    - [x] Add `WalletTokenPrediction` TypeScript interface (`src/types/behavior.ts:67-92`)
    - [x] Display predictions with confidence scores via scripts
    - [x] **Validation via scripts**: `generate-prediction-report.ts` and `generate-holder-analysis.ts` demonstrate working predictions
  - [ ] **Phase 2B (Validation Infrastructure)**: 4-5 days **← DEFERRED** (See `.ai/context/holder-risk/PHASE2-VALIDATION-PLAN.md` for details)
    - **Goal**: Track prediction accuracy over time to validate and improve the model
    - [ ] **Database Layer** (2 days):
      - [ ] Add `WalletTokenPrediction` Prisma model with validation fields
      - [ ] Add `PredictionAccuracyMetrics` model for aggregated stats
      - [ ] Run migrations
    - [ ] **Service Layer** (2 days):
      - [ ] Create `PredictionService` (store, retrieve, validate predictions)
      - [ ] Implement validation logic (check if positions actually exited)
      - [ ] Implement accuracy calculation (by behavior type, risk level)
    - [ ] **Background Worker** (1 day):
      - [ ] Create BullMQ validation processor (daily validation job)
      - [ ] Setup cron schedules (daily validation, weekly reports)
      - [ ] Implement manual validation trigger
    - [ ] **API & Dashboard** (1 day):
      - [ ] Create `/api/v1/predictions` endpoints (CRUD)
      - [ ] Create `/api/v1/predictions/accuracy/latest` endpoint
      - [ ] Build accuracy dashboard component
      - [ ] Add prediction history view
    - [ ] **Testing** (1 day):
      - [ ] Historical backtest on 19 test wallets
      - [ ] Validate accuracy thresholds
      - [ ] End-to-end test: predict → validate → metrics
    - **Success Metrics**: After 30 days, achieve ≥70% overall accuracy, ≥80% for ULTRA_FLIPPER
  - [x] **Phase 3 (Token Holder Profiles Dashboard)**: ✅ **COMPLETE** (2025-11-13) (See `.ai/context/holder-risk/architecture-holder-risk-analysis.md` for implementation details)
    - **Goal**: Show holding behavior profiles for top holders of any token (build foundation first, add prediction/validation later)
    - **Architecture**: ASYNC JOB-BASED (Controller → Queue → Processor → Core Services)
    - **Key Advantage**: Reuses existing `TokenHoldersService` + `BehaviorAnalyzer` (no new core services needed!)
    - **User Flow**: Enter token → Backend enqueues job → Frontend polls status → Display profiles when complete
    - [x] **Day 1: Queue & Processor** (6h):
      - [x] Add job types to `src/queues/jobs/types.ts` (AnalyzeHolderProfilesJobData, HolderProfile, HolderProfilesResult)
      - [x] Extend `AnalysisOperationsProcessor` with new handler: `processAnalyzeHolderProfiles()`
      - [x] Implement batch DB query (fetch all wallet swap records in one query - avoid N+1)
      - [x] Implement parallel analysis with Promise.all()
      - [x] Calculate holding metrics per holder:
        - [x] Median hold time (hours/days)
        - [x] Average hold time (weighted)
        - [x] **NEW: Flip ratio** (% of completed positions held <5min) ⭐
        - [x] Behavior classification (ULTRA_FLIPPER/FLIPPER/SWING/HOLDER)
        - [x] Data quality tiers (HIGH/MEDIUM/LOW/INSUFFICIENT)
      - [x] Unit tests for daily flip ratio and data quality tiers
    - [x] **Day 2: API Endpoint** (4h):
      - [x] Add endpoint to `AnalysesController`: `POST /analyses/holder-profiles`
      - [x] Enqueue job, return job ID (not synchronous processing!)
      - [x] Test with curl on 3 real tokens
    - [x] **Day 3: Dashboard Page** (6h):
      - [x] New page: `/tools/holder-profiles`
      - [x] Token input form (submits job)
      - [x] Poll job status until complete
      - [x] `HolderProfilesTable` component (wallet, supply %, median, avg, flip ratio, type, confidence)
      - [x] Show loading state with progress
      - [x] Styling and polish
    - [x] **Day 4: Caching & Bug Fixes** (4h):
      - [x] End-to-end testing with 5 real tokens
      - [x] Verify batch query optimization (check DB logs for N+1)
      - [x] Verify parallel processing
      - [x] Performance: <15s for 10 holders
      - [x] **CRITICAL FIXES** (2025-11-13) - See `.ai/context/phase1-fixes-completed.md` and `.ai/context/phase1-additional-improvements.md`
        - [x] **FIX #1**: Supply percentage calculation (was using sum of top N, now fetches actual token supply via RPC)
        - [x] **FIX #2**: Cache race condition (atomic Lua script prevents stale data)
        - [x] **FIX #3**: Timeout enforcement (5 checkpoints prevent hanging jobs)
        - [x] **FIX #4**: Job deduplication (ID validation prevents duplicate processing)
        - [x] **IMPROVEMENT #1**: Use DatabaseService.getSwapAnalysisInputsBatch() instead of direct Prisma access
        - [x] **IMPROVEMENT #2**: Cache token supply permanently in TokenInfoService (immutable data, 100x faster)
      - [x] **Redis caching** with 2-minute TTL and atomic invalidation
      - [x] Documentation complete
    - **What We Show Per Holder**:
      - Wallet address + % of supply + rank
      - Median hold time + Average hold time
      - **Flip ratio** (% of completed positions held <5min - flipping activity indicator)
      - Behavior type (ULTRA_FLIPPER/FLIPPER/SWING/HOLDER)
      - Exit pattern (GRADUAL/ALL_AT_ONCE)
      - Data quality tier (HIGH/MEDIUM/LOW/INSUFFICIENT with tooltips)
    - **Performance Optimizations**:
      - Top 10 holders only (not 20-50)
      - Batch DB fetch: `{ walletAddress: { in: [...] } }`
      - Parallel analysis: `Promise.all(wallets.map(...))`
      - Show incremental results as they arrive
    - **Caching Strategy** (2025-11-12):
      - ✅ Redis cache for holder profiles (2 min TTL max)
      - ✅ Automatic invalidation on wallet sync or behavior analysis
      - ✅ Cache key: `holder-profiles:{tokenMint}:{topN}`
      - ✅ Prevents stale data after new transactions
      - Implementation: `HolderProfilesCacheService` + invalidation in processors
  - [x] **Metrics Refactor & Classification Redesign**: ✅ **COMPLETE** (2025-11-17) (See `.ai/context/holder-risk/MIGRATION-COMPLETE.md` for full details)
    - **Goal**: Replace deprecated holding time metrics with accurate historical pattern calculations
    - [x] **Constants Consolidation**: ✅ **COMPLETE** (2025-11-18)
      - **Single Source of Truth**: All behavior classification thresholds consolidated into `src/core/analysis/behavior/constants.ts`
      - **Two Classification Systems** (both actively used):
        1. **Trading Speed Categories** (6 types) - Used by `TradingInterpretation.speedCategory`
           - Data Source: **COMPLETED/EXITED positions only** (uses 20% remaining threshold)
           - Purpose: General wallet behavior analysis ("How fast do they trade when they exit?")
           - Categories: ULTRA_FLIPPER (<3min), FLIPPER (3-10min), FAST_TRADER (10-60min), DAY_TRADER (1-24h), SWING_TRADER (1-7d), POSITION_TRADER (7+d)
           - Helper: `classifyTradingSpeed(medianHoldTimeHours)` where `medianHoldTimeHours` = `historicalPattern.medianCompletedHoldTimeHours`
           - Shown In: BehavioralPatternsTab summary section
        2. **Holder Behavior Types** (8 types) - Used by `WalletHistoricalPattern.behaviorType`
           - Data Source: COMPLETED positions only (exited trades)
           - Purpose: Holder risk analysis and exit prediction
           - Categories: SNIPER (<1min), SCALPER (1-5min), MOMENTUM (5-30min), INTRADAY (30min-4h), DAY_TRADER (4-24h), SWING (1-7d), POSITION (7-30d), HOLDER (30+d)
           - Helper: `classifyHolderBehavior(medianCompletedHoldTimeHours)`
           - Shown In: BehavioralPatternsTab historical pattern section, HolderProfilesTable
      - **Why Two Systems?**: Different granularity (6 vs 8 categories) + same data source (both use completed positions) + slightly different purposes (general speed vs holder risk prediction)
      - **Migration Impact**: Zero breaking changes (thresholds identical, just moved to constants)
      - **Critical Bug Fixes** (2025-11-18):
        - ✅ Fixed invalid hold time filtering (`> 0` → `>= 0.0001h`) - was filtering out sub-second holds incorrectly
        - ✅ Added `holdTimeDistribution` to `WalletHistoricalPattern` (8 time ranges: instant, ultraFast, fast, momentum, intraday, day, swing, position)
        - ✅ Fixed flip ratio calculation (was always 0.0% due to missing `tokenLifecycles`) - now uses `holdTimeDistribution`
        - ✅ Aggregated filtering logs (reduced spam from 100s of lines to single summary)
    - [x] **New Constants File**: `src/core/analysis/behavior/constants.ts`
      - Trading speed thresholds + helper function
      - Holder behavior thresholds + helper function
      - Bot detection constants (3-minute threshold)
      - All classification logic centralized
    - [x] **Refactored `analyzer.ts`**:
      - Line 265: Replaced 23 hardcoded lines with `classifyHolderBehavior()`
      - Line 1360: Replaced 15 hardcoded lines with `classifyTradingSpeed()`
      - Single source of truth: Changing thresholds requires updating only `constants.ts`
    - [x] **Updated Bot Detection** (`bot-detector.ts:105-116`):
      - Uses median hold time (was average)
      - 3-minute threshold (was 6 minutes)
    - [x] **New TypeScript Interfaces** (`types/behavior.ts:94-112`):
      - `TradingInterpretation`: speedCategory, typicalHoldTimeHours, economicHoldTimeHours, economicRisk, behavioralPattern
      - `HistoricalPattern`: behaviorType, exitPattern, medianCompletedHoldTimeHours, etc.
      - Separates "what they usually do" (median) from "where the money goes" (weighted average)
    - [x] **Dual Holding Time Methodology** - Two complementary systems:
      1. **Exited Positions Metrics** (Historical Pattern - for prediction):
         - `historicalPattern.medianCompletedHoldTimeHours` - Median from exited positions only
         - `historicalPattern.historicalAverageHoldTimeHours` - Weighted average from exited positions only
         - Used for: Exit prediction, behavior classification, holder risk analysis
      2. **Current Holdings Metrics** (Active positions - for portfolio analysis):
         - `medianCurrentHoldingDurationHours` - Median of currently held positions
         - `averageCurrentHoldingDurationHours` - Average of currently held positions
         - Used for: Current portfolio state, unrealized hold times
      3. **Smart Fallback Metrics** (Holder Profiles API):
         - `medianHoldTimeHours` - Smart fallback (typical → realized → current)
         - `avgHoldTimeHours` - Smart fallback (typical → realized → current)
         - `typicalHoldTimeHours` + `typicalHoldTimeSource` - Intelligent combination with source tracking
    - [x] **Truly Deprecated Metrics** (NOT used in holder-profiles):
      - `averageFlipDurationHours` - Legacy mixed metric (unreliable for prediction)
      - `weightedAverageHoldingDurationHours` - Legacy mixed metric (conceptually flawed)
      - `medianHoldTime` (in BehaviorAnalysisResponseDto only, NOT in HolderProfile)
    - **Backward Compatibility**: All old metrics still computed and included in API responses (zero breaking changes)
  - [x] **Phase 4 (Frontend Migration)**: ✅ **COMPLETE** (2025-11-17)
    - **Goal**: Update dashboard to use new metrics (avoid user confusion between holder risk tab and wallet profile)
    - [x] **Updated `types/api.ts`**:
      - Added `TradingInterpretation` interface (lines 92-107)
      - Added `HistoricalPattern` interface (lines 109-118)
      - Marked deprecated fields with comments (lines 130-135)
    - [x] **Updated `BehavioralPatternsTab.tsx`**:
      - Summary section now shows new metrics: Speed Category, Economic Risk, Behavioral Pattern (lines 355-373)
      - Holding durations replaced: "Typical Hold Time (Median)" and "Economic Hold Time (Weighted)" (lines 414-428)
      - Added Historical Pattern section: Completed Cycles, Behavior Type, Exit Pattern, Data Quality (lines 449-476)
      - Removed deprecated `weightedAverageHoldingDurationHours` from Current Holdings
      - All new displays use `??` fallback to old metrics (zero breaking changes)
    - [x] **Verified Consistency**: Holder risk tab (`HolderProfilesTable.tsx`) already using correct new metrics
    - **Result**: Both tabs now show consistent, accurate metrics with rich interpretation

- **Exit Timing Token Drilldown** ✅ **COMPLETE** (2025-11-20)
  - [x] **Backend - Simple Token List Endpoint**:
    - [x] `GET /api/v1/wallets/:walletAddress/exit-timing-tokens/:timeBucket`
    - [x] Returns: `{ walletAddress, timeBucket, tokens: string[], count: number }`
    - [x] Added `getExitTimingTokenMints()` to BehaviorService (reads from cached `holdTimeTokenMap` in database)
    - [x] Controller endpoint in WalletsController (src/api/controllers/wallets.controller.ts:917-988)
    - [x] TESTED: ultraFast (1 token), fast (1 token), day (40 tokens) ✅
  - [x] **Frontend - Token List Panel**:
    - [x] Created `ExitTimingDrilldownPanel` - floating non-blocking panel
    - [x] Simple grid of TokenBadge components (automatic batching + enrichment)
    - [x] Click handlers on `ExitTimingBreakdown` cohort bars
    - [x] Toggle behavior: click to open, click same bucket to close
    - [x] Non-blocking UX: backdrop doesn't interfere, page stays interactive
    - [x] Loading/error/empty states with EmptyState component
    - [x] Mobile responsive grid layout (md:grid-cols-2)
    - [x] Pagination: Load more button (50 tokens at a time)
  - [x] **Architecture Improvements**:
    - [x] Database caching: `holdTimeTokenMap` stored in `WalletBehaviorProfile` (instant ~5ms reads, no re-analysis)
    - [x] Smart TokenBadge: Auto-batching (100 tokens = 2 API calls, not 200), two-phase data flow
    - [x] Centralized enrichment: TokenBadge handles all metadata fetching (no scattered logic)
    - [x] Updated `dashboard/docs/components-overview.md` with comprehensive component documentation
  - **Status**: Backend complete, frontend functional. Polish phase deferred to next iteration.
  - [x] **CRITICAL BUG FIX (2025-11-17)**: ⚠️ **historicalPattern calculation was NEVER WIRED UP**
    - **Discovery**: The entire new metrics system was built but `calculateHistoricalPattern()` was never called in the analysis flow
    - **Impact**: All API responses had `historicalPattern: undefined`, `tradingInterpretation` used fallback to deprecated metrics
    - **Files Fixed** (10 total):
      - [x] `analyzer.ts:53` - Added `walletAddress` parameter to `analyze()` signature
      - [x] `analyzer.ts:133-144` - Wired up `calculateHistoricalPattern()` call with logging
      - [x] `behavior-service.ts:47` - Pass walletAddress to analyzer
      - [x] `bot-detector.ts:108-123` - Removed blind fallback, explicit handling
      - [x] `BehavioralPatternsTab.tsx:416,422` - Removed fallbacks (exposes real state)
      - [x] 5 test/script files updated with wallet address parameter
    - [x] **Created `validate-behavior-metrics.ts`**: Comprehensive validation script (13 automated tests)
    - [x] **Validated**: Test wallet shows Median: 0.251h vs Weighted: 2.405h (858% different - NO FALLBACK!)
    - [x] **Builds**: Both backend and frontend compile successfully
    - [x] **PM2**: Restarted with v0.17.0
    - **Status**: ✅ ALL 5 CRITICAL TESTS PASS - Ready for user testing
    - **Docs**: See `.ai/context/holder-risk/FINAL-STATUS.md` for complete details

- **IPFS Metadata Fetching Security Hardening** ✅ **COMPLETE** (2025-11-06) *(See `.ai/context/security-ipfs-metadata-vulnerability.md` for full details)*
  - [x] Security vulnerability identified and documented
  - [x] **Phase 1 (Critical Protections)**: IMPLEMENTED
    - [x] Add size limits (5MB max) with streaming checks in `fetchMetadataFromUri()`
    - [x] Implement URI validation: reject IP addresses, private networks, localhost (`validateUri()`)
    - [x] Add prototype pollution protection: strip `__proto__`, `constructor`, `prototype` keys (`sanitizeMetadata()`)
    - [x] Update retry logic to skip security rejections (no retries for validation failures)
  - [x] **Phase 2 (Enhanced Security)**: IMPLEMENTED
    - [x] Add JSON depth limits (max 20 levels) to prevent stack overflow
    - [x] Add array/value limits (max 1000 elements, 10k char strings)
    - [x] Add Content-Type verification (log warnings for unexpected types)
    - [x] Implement safe URI logging (`sanitizeUriForLogging()`)
  - [x] **Testing & Validation**: COMPLETE
    - [x] Test with large files (>5MB) → rejects correctly
    - [x] Test with IP addresses → rejects correctly (including observed 95.179.167.134)
    - [x] Test with prototype pollution payloads → sanitizes correctly
    - [x] Test with deeply nested JSON → rejects correctly
    - [x] Test valid IPFS/Arweave URIs → works correctly
    - [x] Monitor logs for suspicious activity → logging implemented with safe URI sanitization
  - **Files Modified**: `src/core/services/onchain-metadata.service.ts`
  - **Test Suite**: `src/scripts/test-metadata-security.ts` (14 test cases, all passing)
  - **Impact**: Backward compatible, resilient design (returns null on security errors)

- **Helius Phase 1 migration (signatures mode) — behind a flag** ✅ **COMPLETE BUT NOT RECOMMENDED** (2025-11-06)
  - [x] Add `getTransactionsForAddress` signatures wrapper in `HeliusApiClient` (`src/core/services/helius-api-client.ts`)
  - [x] Feature‑flag routing in `getAllTransactionsForAddress` with fallback to legacy on hard failures
  - [x] Map newer/older traversal to server‑side `filters.blockTime` and signature bounds; keep `sortOrder` semantics
  - [x] Preserve Phase 2 Enhanced `/v0/transactions` enrichment path unchanged
  - [x] Add minimal telemetry: page count, time‑to‑first‑results, and Helius credit usage per wallet
  - [x] Test and validate: V2 costs 100 credits/page vs 0 for legacy, saves only ~274ms for 2000 txs (35% Phase 1 improvement)
  - **Status**: Implemented but DISABLED by default - not cost-effective for our use case
  - **Recommendation**: Keep disabled unless Helius deprecates `getSignaturesForAddress` RPC method
  - **Branch**: `feature/helius-phase1-migration`
  - **Docs**: Updated in `docs/helius_v2_API/helius-getTransactionsForAddress-migration.md` with cost-benefit analysis

- **Merge and rollout**
  - [ ] Merge staged auto‑refresh branch into `main`; enable via config flags
  - [ ] Monitor UX and performance post‑release; tune thresholds via config only (no code changes)

**Task-with-low-priority** *DEFER for now*: Phase 6 - AI Expert Similarity Interpreter (see `docs/1. scaling_plan.md`).
Deliverable: synchronous endpoint that transforms similarity output into an LLM-formatted dashboard report.

- [ ] Execute similarity flow directly via `AnalysesService` (`src/api/services/similarity.service.ts`) for targeted wallet sets
- [ ] Stand up `LLMService` (new module, e.g. `src/core/services/llm.service.ts`) using the prompt in `docs/behavioral_reconstruction_task.md`
- [ ] Return formatted summary from `POST /api/v1/analyses/similarity` that the dashboard can render (Markdown or structured blocks) and document usage in `dashboard/`
---

## Next

- **Exit Timing Enhancements (Wallet Baseball Card)** - Win Rate & ROI per Cohort
  - **Status**: 🔄 **IN PROGRESS** - Phase 1 (WR/ROI calculations)
  - **Goal**: Show aggregate win rate, PnL, and ROI for each exit timing bucket
  - **Priority**: HIGH - Adds critical trading performance insights
  - **Estimated Duration**: 2-3 days remaining

  - [ ] **Phase 1 (Backend - Enriched Hold Time Distribution)**: 2-3 days
    - **Goal**: Calculate aggregate win rate, PnL, and ROI for each exit timing bucket
    - [ ] **Data Architecture** (0.5 day):
      - [x] Create `EnrichedHoldTimeBucket` interface: `{ count, winRate, totalPnlSol, avgPnlSol, roiPercent, totalCapitalSol }`
      - [x] Extend `WalletHistoricalPattern.holdTimeDistribution` to use enriched buckets
      - [x] Update `HolderProfile` type to include enriched distribution
    - [ ] **Calculation Logic** (1.5 days):
      - [x] Modify `calculateHistoricalPattern()` in `BehaviorAnalyzer` to track aggregate PnL per bucket
      - [x] For each completed lifecycle: calculate PnL, classify into time bucket, accumulate metrics
      - [x] Calculate per-bucket: win rate (% profitable), total PnL, average PnL, ROI
      - [x] Handle edge cases: zero trades, all losses, missing data
    - [ ] **Integration & Testing** (1 day):
      - [x] Update `processAnalyzeHolderProfiles` to include enriched distribution
      - [x] Update cache layer to handle slightly larger payload (~2KB increase)
      - [x] Add unit tests for aggregate PnL calculation and win rate logic

  - [x] **Phase 2 (Frontend - Display WR & ROI per Cohort)**: 1 day
    - [x] Update `ExitTimingBreakdown` component to show cohort-level metrics
    - [x] Format display: `<1m 366 (5% WR, -40% ROI)` with color coding
    - [x] Green for positive ROI, red for negative, gray for neutral
    - [x] Add tooltips explaining WR and ROI (per cohort, not per token)

  - [x] **Phase 3 (Polish - Token List Panel UX)**: 0.5 day
    - [x] Review and polish ExitTimingDrilldownPanel appearance
    - [x] Improve token grid layout and spacing
    - [x] Optimize loading skeleton states
    - [x] Fine-tune mobile responsiveness




---

## Environment

- **Runtime**: Node.js 22.x (`package.json` engines)
- **Framework**: NestJS 11 REST and websockets (`src/main.ts`, `src/api/**`)
- **Queues**: BullMQ with Redis (`src/queues/**`, `.env` -> `REDIS_HOST`, `REDIS_PORT`)
- **Database**: SQLite via Prisma (`prisma/schema.prisma`, `DATABASE_URL=file:./prisma/dev.db`)
- **External APIs**: Helius RPC and webhooks, DexScreener (`src/api/services/dexscreener.service.ts`)
- **Frontends and CLI**: Dashboard under `dashboard/`, websocket bridge at `/job-progress`, scripts in `src/scripts/`

---

## Findings / Follow-ups

- Merge staged auto‑refresh now; thresholds are config‑driven so Phase 1 migration requires no dashboard changes.
- After Phase 1 migration, use server‑side filters to honor the same UX: show after `min(7 days, 1000 signatures)`; continue 30‑day then deep backfill to the cap.
- Add minimal telemetry to guide threshold tuning and monitor credit usage; adjust via config only.
- Dashboard lint/build in this workspace: install `dashboard` deps first (`npm install --prefix dashboard`) before running lint/CI tasks.
- Tests: `npm run verify` ✅; `npm run lint` (dashboard) ❌ `next: not found` because dashboard dependencies are missing.


PAY ATTENTION! 

Need to find out a way to fulfill all token history for a wallet, when we have identified such in the X amount of txs we have fetch. Gake is having no holder data for the past 1000 tx, due to old tokens. 

Find a way to detect when tokens have changed the owner and sold off from a different wallet. 

