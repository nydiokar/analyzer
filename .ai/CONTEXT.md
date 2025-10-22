# Current State

**Project**: Sova Intel - Wallet Analysis System (Scaling Plan Phase 6)  
**Goal**: Expose reliable Solana wallet analytics (sync, similarity, reporting) across API, queues, CLI, and dashboard.  
**Status**: In Progress  
**Last Updated**: 2025-10-22 11:17 UTC  
**Updated By**: Codex

---

## Completed

- [x] BullMQ orchestration stack spanning wallet, analysis, similarity, and enrichment operations with locking, DLQ, and job event streaming (`src/queues/queue.module.ts`, `src/queues/queues/*.ts`, `src/queues/services/*`, `src/api/controllers/jobs.controller.ts`)
- [x] Wallet ingestion and swap analysis persisted via Prisma (Helius client, transaction mapper, P/L summaries) (`src/core/services/helius-api-client.v2.ts`, `src/core/services/helius-transaction-mapper.ts`, `prisma/schema.prisma`)
- [x] REST plus CLI entry points that trigger analyses and expose queue status (`src/api/controllers/analyses.controller.ts`, `src/scripts/helius-analyzer.ts`, `src/scripts/walletSimilarity.ts`)

---

## Active

**High Priority UX**: Auto-load dashboard wallet analysis (non-similarity) so users see data instantly on first visit.  
- [ ] When `dashboard/src/app/(wallets)/[wallet]/page.tsx` mounts, trigger an analysis job automatically (no “Analyze” button press).  
- [ ] Default payload: last 7 days (≈200–300 swaps) to give immediate charts; relay through `POST /api/v1/analyses/wallets/:walletAddress/trigger-analysis` or a new lightweight endpoint if needed (`src/api/controllers/analyses.controller.ts`, `src/api/services/pnl-analysis.service.ts`).  
- [ ] Kick off a background fetch for deeper history (configurable `X` transactions/30 days) once the initial window is ready; keep rate limits (`src/queues/queues/wallet-operations.queue.ts`, Helius API) in mind.  
- [ ] Update UI states to show “Loaded recent window / Fetching more…” instead of idle button, and document flow in `docs/1. scaling_plan.md` + `.ai/GUIDE.md` once implemented.

**Task-with-low-priority** *DEFER for now*: Phase 6 - AI Expert Similarity Interpreter (see `docs/1. scaling_plan.md`, Immediate focus).  
Deliverable: synchronous endpoint that transforms similarity output into an LLM-formatted dashboard report.

- [ ] Execute similarity flow directly via `AnalysesService` (`src/api/services/similarity.service.ts`) for targeted wallet sets
- [ ] Stand up `LLMService` (new module, for example `src/core/services/llm.service.ts`) using the prompt in `docs/behavioral_reconstruction_task.md`
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

## Blockers

- Mapper failure on DCA Keeper interaction (double spend) - reproduce with signature `K3VYZgVA9snNCb17o6vVcEvR3gdHGVaa2PxNGbGqJXQsvrDRynZjMZ17tasAiyrGUzBNnVJdY1S35vnAPjierM8`; fix expected in `src/core/services/helius-transaction-mapper.ts`
- Similarity interpreter pending: dashboard must keep queue-backed fallback until the synchronous flow ships

---

## Notes

- Queue priorities and SLAs live in `src/queues/config/queue.config.ts`; job events feed websockets through `src/queues/services/job-events-bridge.service.ts`
- CLI commands (`npm run analyze`, `npm run similarity`, `npm run top-holders`) reuse the same services - run after migrations and ensure Redis is reachable
- Use DTOs from `src/api/shared/dto/` and throttling annotations already present in controllers to stay aligned with Swagger contracts

---

## Quick Reference

**Scaling Plan**: `docs/1. scaling_plan.md`  
**Similarity internals**: `src/core/analysis/similarity/`  
**Prompts**: `docs/behavioral_reconstruction_task.md`  
**API surface**: Swagger `/api-docs` (mirrors `AnalysesController`, `JobsController`, etc.)
