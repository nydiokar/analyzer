# Current State

**Project**: Sova Intel - Wallet Analysis System (Scaling Plan Phase 6)
**Goal**: Expose reliable Solana wallet analytics (sync, similarity, reporting) across API, queues, CLI, and dashboard.
**Status**: In Progress
**Last Updated:** 2025-11-18 22:30 UTC
**Updated By:** 

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

**References**: See `docs/archived_plans/architecture-holder-risk-analysis.md` for detailed implementation examples.

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
- [x] Holder profile snapshot cache (2025-11-30) – Persist the full holder profile JSON per wallet via `HolderProfileSnapshot`, stream cached holders instantly, and only re-run analysis when snapshots are stale (`prisma/schema.prisma`, `src/core/services/database-service.ts`, `src/queues/processors/analysis-operations.processor.ts`)
---

## Active

Next is working on creating a separate layout for the new home/landing page and create a proper flow - user onboarding. Landing page without the sidebar - simple, stylish and modern! it should only contain socials, some basic info and letting you login/sign up + button to go to tool hub - maybe the sidebar needs icon for the dashboard itself. Need to completely remove the current "/" and but use it's login/sign up in the home due to it looks better.    

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


PAY ATTENTION! 

Need to find out a way to fulfill all token history for a wallet, when we have identified such in the X amount of txs we have fetch. Gake is having no holder data for the past 1000 tx, due to old tokens. 

Find a way to detect when tokens have changed the owner and sold off from a different wallet. 
