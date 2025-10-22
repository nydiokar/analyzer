# Work Guide

Working playbook for the Sova Intel codebase. Treat the scaling plan and the Nest/BullMQ code as the source of truth.

---

## Primary Goal

Finish Scaling Plan Phase 6 by turning the existing similarity engine into an AI-interpreted report that the dashboard can serve immediately, without breaking the queue-driven flows already in production.

---

## Canonical References

- `docs/1. scaling_plan.md` - current roadmap, completion status, acceptance criteria
- `docs/behavioral_reconstruction_task.md` - prompt to feed the similarity interpreter
- `src/api/controllers/analyses.controller.ts` & `src/api/services/similarity.service.ts` - queue endpoints and service entry points
- `src/core/analysis/similarity/` - similarity analyzer, vector builders, metrics
- `src/queues/` - BullMQ queues, processors, DLQ, websocket bridge
- `prisma/schema.prisma` - persisted wallet, analysis, and activity schema (SQLite backend)
- `dashboard/` - Next.js dashboard consuming the API and websocket streams

Always double-check these files before relying on scattered documentation.

---

## Immediate Focus

0. **Dashboard Auto-Load Analysis**
   - [ ] Automatically trigger the wallet analysis flow when a wallet page loads (`dashboard/src/app/(wallets)/[wallet]/page.tsx`).
   - [ ] Default to a recent snapshot (7 days / ≈200-300 swaps) so charts populate instantly.
   - [ ] Kick off a background fetch for deeper history via `POST /api/v1/analyses/wallets/:walletAddress/trigger-analysis` or a dedicated endpoint in `src/api/controllers/analyses.controller.ts`.
   - [ ] Update UI copy/states to reflect “recent window loaded / continuing historical sync”, document behaviour in `docs/1. scaling_plan.md`.

1. **Synchronous Similarity Execution**
   - [ ] Add a short-circuit path in `AnalysesService` or a sibling service that runs `SimilarityService` without queue hand-off.
   - [ ] Limit wallet batch size, reuse `DatabaseService` calls, and respect config in `src/core/analysis/similarity/similarity-service.ts`.

2. **LLM Interpreter**
   - [ ] Introduce `LLMService` (proposed path: `src/core/services/llm.service.ts`) that can call the configured provider using the prompt from `docs/behavioral_reconstruction_task.md`.
   - [ ] Handle timeouts, sanitize output (Markdown + structured summary), and make provider + model configurable via `.env`.

3. **API & Dashboard Integration**
   - [ ] Ship `POST /api/v1/analyses/similarity` returning both the raw metrics and the interpreted summary.
   - [ ] Update dashboard pages under `dashboard/src/app/(wallets)` to call the new endpoint, display AI output, and fall back to queued job status if the interpreter fails.
   - [ ] Add tests (service or e2e) to protect the synchronous flow and document the API in Swagger.

Keep queue-based `/analyses/similarity/queue` alive until the synchronous path proves stable.

---

## Supporting Workstreams (Next Up)

- **Activity Logging with User Context**  
  Ensure controllers/services record `logActivity` entries consistently (`src/api/controllers/*.ts`, `src/api/services/*`, `src/core/services/database-service.ts`), as laid out in the scaling plan section 4.4.

- **Wallet Comparison / Discovery UX**  
  Extend the similarity engine outputs into a comparison view (plan: "Pilot Wallet Comparison"). Check `src/scripts/walletSimilarity.ts` and existing dashboard similarity components for reusable pieces.

- **Analysis Math Audit**  
  Re-derive and validate P/L, KPI, and dashboard aggregates against trusted references (`src/core/analysis/**`, `analysis_reports/`, `docs/usage/wallet-behavior-kpis.md`) so product decisions rest on accurate numbers.

- **Enrichment & Demo Gating**  
  Tighten Redis-backed enrichment flows and demo wallet access. Inspect `src/queues/processors/enrichment-operations.processor.ts`, `src/api/services/token-info.service.ts`, and the dashboard API-key wiring.

---

## Key Modules (Read the Code)

- Nest bootstrap and Swagger: `src/main.ts`
- Queue wiring: `src/queues/queue.module.ts`, `src/queues/services/job-events-bridge.service.ts`
- Job submission/status API: `src/api/controllers/jobs.controller.ts`, `src/api/services/jobs.service.ts`
- Wallet ingestion + mapping: `src/core/services/helius-api-client.v2.ts`, `src/core/services/helius-transaction-mapper.ts`
- Persistence: `prisma/schema.prisma`, `src/core/services/database-service.ts`
- Scripts: `src/scripts/helius-analyzer.ts`, `src/scripts/topTokenHolders.ts`, `src/scripts/walletSimilarity.ts`

---

## Build and Run

```bash
# Install dependencies (Node 22.x required)
npm install

# Generate Prisma client and apply migrations
npx prisma generate
npx prisma migrate dev --name init

# Start API locally (http://localhost:3001/api/v1 and /api-docs)
npm run dev

# Run queue workers if testing background jobs
node dist/queues/workers/similarity.worker.js   # after build

# Execute CLI flows
npm run analyze -- --address <WALLET>
npm run similarity -- --wallets <A,B,C>
```

Environment essentials: copy `.env.example`, set `HELIUS_API_KEY`, Redis credentials, optional `FRONTEND_URL`, and any LLM provider keys once the interpreter lands.

---

## Testing and Verification

- `npm run verify` - TypeScript compilation check (no emit)
- `npm run test:unit` - Helius client, mapper, similarity analyzer tests
- `npm run test:integration` - queue and backend integration smoke
- Manual:
  - Trigger wallet analysis via API (`POST /api/v1/analyses/wallets/:address/trigger-analysis`)
  - Monitor job progress via websocket or `GET /api/v1/jobs/:id`
  - Exercise CLI scripts and ensure Prisma DB reflects updates

Log all test results and failures in `.ai/CONTEXT.md` before handing off.

---

## Operational Notes

- Queue priorities and retries: `src/queues/config/queue.config.ts`
- Redis locking and DLQ handlers: `src/queues/services/redis-lock.service.ts`, `src/queues/services/dead-letter-queue.service.ts`
- Known issue: Helius mapper fails on DCA Keeper signature `K3VY...APjierM8`; fix pending in `src/core/services/helius-transaction-mapper.ts`
- Dashboard consumes websocket events from `/job-progress`; keep bridge running when testing UI.

---

## When Stuck

1. Re-read `docs/1. scaling_plan.md` for current priorities.
2. Inspect the relevant code path (controller -> service -> core) to confirm real behavior.
3. Reproduce via CLI or API before guessing.
4. Document findings or blockers in `.ai/CONTEXT.md` and ping the maintainer if still blocked.
