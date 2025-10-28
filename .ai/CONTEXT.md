# Current State

**Project**: Sova Intel - Wallet Analysis System (Scaling Plan Phase 6)  
**Goal**: Expose reliable Solana wallet analytics (sync, similarity, reporting) across API, queues, CLI, and dashboard.  
**Status**: In Progress  
**Last Updated**: 2025-10-28 00:00 UTC  
**Updated By**: Codex

---

## Completed


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

- **Helius Phase 1 migration (signatures mode) — behind a flag**
  - [ ] Add `getTransactionsForAddress` signatures wrapper in `HeliusApiClient` (`src/core/services/helius-api-client.ts`)
  - [ ] Feature‑flag routing in `getAllTransactionsForAddress` with fallback to legacy on hard failures
  - [ ] Map newer/older traversal to server‑side `filters.blockTime` and signature bounds; keep `sortOrder` semantics
  - [ ] Preserve Phase 2 Enhanced `/v0/transactions` enrichment path unchanged
  - [ ] Add minimal telemetry: page count, time‑to‑first‑results, and Helius credit usage per wallet

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

- Flip default to Helius Phase 1 once parity and credit usage are validated; keep legacy path as fallback
- Try revised staged thresholds via config after Phase 1 (e.g., `initialWindowDays` 3–10, `initialMaxSignatures` around 1000–2000) based on telemetry
- Instrument API controllers and wrapper services with activity logging that includes user context (`src/api/controllers/*.ts`, `src/api/services/*`, `src/core/services/database-service.ts`)
- Pilot wallet comparison and discovery UX ("Find Similar Wallets") reusing the similarity engine (`src/api/services/similarity.service.ts`, `dashboard/src/app/(wallets)`)
- Audit analysis math (P/L, KPI rollups, dashboard metrics) for correctness and alignment with product needs (`src/core/analysis/**`, `docs/usage/wallet-behavior-kpis.md`, `analysis_reports/`)
- Tighten enrichment and demo gating (Redis configuration, `src/queues/processors/enrichment-operations.processor.ts`, dashboard API-key flow)
- Add cost budget and alerts for Helius credits; emit per‑wallet credit usage to logs/metrics
- Add automated parity checks comparing legacy Phase 1 vs new Phase 1 on sampled wallets
 - Add automated Lighthouse smoke-test gate for dashboard (see `dashboard/docs/front-end-performance.md`)

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
