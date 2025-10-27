# Current State

**Project**: Sova Intel - Wallet Analysis System (Scaling Plan Phase 6)  
**Goal**: Expose reliable Solana wallet analytics (sync, similarity, reporting) across API, queues, CLI, and dashboard.  
**Status**: In Progress  
**Last Updated**: 2025-10-27 00:08 UTC
**Updated By**: Codex

---

## Completed


- [x] BullMQ orchestration stack spanning wallet, analysis, similarity, and enrichment operations with locking, DLQ, and job event streaming (`src/queues/queue.module.ts`, `src/queues/queues/*.ts`, `src/queues/services/*`, `src/api/controllers/jobs.controller.ts`)
- [x] Wallet ingestion and swap analysis persisted via Prisma (Helius client, transaction mapper, P/L summaries) (`src/core/services/helius-api-client.v2.ts`, `src/core/services/helius-transaction-mapper.ts`, `prisma/schema.prisma`)
- [x] REST plus CLI entry points that trigger analyses and expose queue status (`src/api/controllers/analyses.controller.ts`, `src/scripts/helius-analyzer.ts`, `src/scripts/walletSimilarity.ts`)
- [x] Dashboard auto-trigger flow stabilized: token tab renders cached data instantly, flash scope runs once per wallet, and frontend subscribes to already-running jobs without blank states (`dashboard/src/components/layout/WalletProfileLayout.tsx`, `dashboard/src/components/dashboard/TokenPerformanceTab.tsx`)
- [x] Dashboard-analysis API now returns existing job metadata instead of failing on locks, exposing `status: 'queued' | 'running'` and `alreadyRunning` for clients (`src/api/controllers/analyses.controller.ts`, `src/api/shared/dto/dashboard-analysis.dto.ts`, `dashboard/src/types/api.ts`, `src/queues/services/redis-lock.service.ts`)
---

## Active

- **Dashboard QA & polish**
  - [ ] Re-run manual verification matrix (heavy wallet, low-activity wallet, demo, multi-tab, skipped follow-up) now that the auto-trigger pipeline is stable.
  - [ ] Tighten restricted-wallet guardrails before auto-triggering flash (respect server-side status sooner in the layout).
  - [ ] Refresh CTA copy/instrumentation once the above checks pass.

**Task-with-low-priority** *DEFER for now*: Phase 6 - AI Expert Similarity Interpreter (see `docs/1. scaling_plan.md`).
Deliverable: synchronous endpoint that transforms similarity output into an LLM-formatted dashboard report.

- [ ] Execute similarity flow directly via `AnalysesService` (`src/api/services/similarity.service.ts`) for targeted wallet sets
- [ ] Stand up `LLMService` (new module, e.g. `src/core/services/llm.service.ts`) using the prompt in `docs/behavioral_reconstruction_task.md`
- [ ] Return formatted summary from `POST /api/v1/analyses/similarity` that the dashboard can render (Markdown or structured blocks) and document usage in `dashboard/`
---

## Next

- Instrument API controllers and wrapper services with activity logging that includes user context (`src/api/controllers/*.ts`, `src/api/services/*`, `src/core/services/database-service.ts`)
- Pilot wallet comparison and discovery UX ("Find Similar Wallets") reusing the similarity engine (`src/api/services/similarity.service.ts`, `dashboard/src/app/(wallets)`)
- Audit analysis math (P/L, KPI rollups, dashboard metrics) for correctness and alignment with product needs (`src/core/analysis/**`, `docs/usage/wallet-behavior-kpis.md`, `analysis_reports/`)
- Tighten enrichment and demo gating (Redis configuration, `src/queues/processors/enrichment-operations.processor.ts`, dashboard API-key flow)

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

- CTA copy/instrumentation polish pending; finalize wording + analytics now that scoped pipeline is stable.
- Run manual verification matrix (heavy wallet, low-activity wallet, demo, multi-tab, skipped follow-up) before handoff.
