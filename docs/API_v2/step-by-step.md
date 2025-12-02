## API v2 Step-by-Step Execution Guide

This document turns the potential plan into a precise, incremental execution guide. Each step includes clear actions, suggested file locations, and a definition of done. Follow the phases in order; deploy after each phase if desired. Keep changes minimal and focus on serve-only reads first.

Note: File paths use the current code structure (NestJS + BullMQ + Prisma). Adjust if your structure differs.

---

## Phase A — Serve-only reads and basic caching

Goal: All GET endpoints read precomputed data; no analysis runs on the request path. Add basic caching for hot reads.

### A1. Refactor PnL Overview to read persisted data only
- Actions:
  - Update `src/api/services/pnl-overview.service.ts` so it fetches the latest persisted analysis summary (and optional period slice) from the database via `DatabaseService` rather than calling `pnlAnalysisService.analyzeWalletPnl`.
  - If period data is not persisted yet, return 404 with a user-friendly message indicating that period data is not yet generated.
- DoD:
  - `GET /wallets/:walletAddress/pnl-overview` does not call analysis services.
  - Returns persisted all-time data; period data only if persisted.

### A2. Refactor Behavior Analysis to read persisted metrics only
- Actions:
  - Update `src/api/controllers/wallets.controller.ts` method `getBehaviorAnalysis` to read persisted `BehaviorMetrics` (via `DatabaseService.getWalletBehaviorProfile` or a new DAO) instead of calling `BehaviorService.getWalletBehavior`.
  - If period data is requested and not precomputed, return 404 with a message indicating data is not yet generated.
- DoD:
  - `GET /wallets/:walletAddress/behavior-analysis` performs zero analysis work; serves only persisted results.

### A3. Add ETag and Cache-Control to wallet summary endpoint
- Actions:
  - In `src/api/controllers/wallets.controller.ts#getWalletSummary`, compute `ETag` (e.g., hash of response body or version from persisted summary) and set `Cache-Control: max-age=60`.
  - Respect `If-None-Match` to return `304 Not Modified` when appropriate.
- DoD:
  - Summary responses include `ETag` and `Cache-Control`.
  - Conditional requests yield `304` when unchanged.

### A4. Add Redis-backed summary cache (60s TTL) with invalidation
- Actions:
  - Introduce a small Redis helper (if not present) to `get/set/del` JSON blobs with TTL: 60s.
  - Cache the full summary JSON under key `wallet_summary:{addr}` upon read-miss and return cached on subsequent hits.
  - Invalidation will be wired in Phase B.
- Files:
  - `src/api/services/cache.service.ts` (lightweight wrapper over existing Redis connection)
  - Integrate in `WalletsController#getWalletSummary`.
- DoD:
  - Repeated summary reads for the same wallet hit Redis for 60s.

---

## Phase B — Snapshot read service and cache invalidation

Goal: Centralize summary read logic and invalidate caches after background jobs complete.

### B1. Introduce SnapshotReadService (Redis → Postgres)
- Actions:
  - Create `src/api/services/snapshot-read.service.ts` that encapsulates summary read:
    - Try Redis `wallet_summary:{addr}` → return if present.
    - Fallback to compose from Postgres persisted results (existing summary composition logic).
    - Add `freshness_lag_sec` and optional `history_span_days` if derivable.
    - Manage ETag generation consistently.
  - Refactor `WalletsController#getWalletSummary` to use this service.
- DoD:
  - `WalletsController` delegates to `SnapshotReadService` only.

### B2. Wire JobProgress completion to invalidate summary cache
- Actions:
  - In `src/queues/processors/analysis-operations.processor.ts`, after successful dashboard analysis, publish an internal event or call a cache invalidation function to `del wallet_summary:{addr}`.
  - Alternatively, use `JobProgressGateway` to trigger a service that invalidates the cache.
- DoD:
  - When a dashboard analysis job completes, the next summary read is a cache miss (fresh data).

---

## Phase C — Ingest and fast-path deltas (foundational streaming)

Goal: Add webhook ingestion and a cheap delta-apply worker to reduce time-to-freshness without recompute.

### C1. Add /ingest/webhook/helius endpoint with verification
- Actions:
  - Create `src/api/controllers/ingest.controller.ts` with `POST /ingest/webhook/helius`.
  - Verify Helius signature/secret from env (`HELIUS_WEBHOOK_SECRET`).
  - Parse payload, extract wallet(s), signatures; enqueue `ingest-apply` jobs per wallet with necessary context.
- DoD:
  - Webhook returns `202` on valid input; rejects invalid signatures.

### C2. Implement ingest-apply worker: dedupe and delta-apply to snapshot
- Actions:
  - Add a new queue `ingest-apply` to `src/queues/queue.module.ts` and config.
  - Create `src/queues/processors/ingest-apply.processor.ts`:
    - Dedupe per signature (Redis `SETNX` or Postgres `HeliusTransactionCache`).
    - Normalize event(s) and apply deltas to the Redis summary snapshot (`wallet_summary:{addr}`) or a dedicated `wallet_snapshot:{addr}` structure.
    - Optionally append minimal fact rows to Postgres initially; ClickHouse can be added later.
  - Publish a light `wallet-updated` event over WebSocket to prompt UI revalidation.
- DoD:
  - New events cause quick summary deltas without recompute.

---

## Phase D — Governance: quotas and limits

Goal: Protect expensive endpoints and add per-user quotas with audit logging.

### D1. Add per-user quotas on /analyses/* and log denials
- Actions:
  - Implement a guard/interceptor for `/analyses/*` that checks per-user quotas (e.g., N requests per minute/hour/day) using Redis counters.
  - On denial, return 429 and write to `ActivityLog` via `DatabaseService.logActivity`.
  - Make limits configurable via env (e.g., `ANALYSES_QUOTA_PER_MIN`, `ANALYSES_QUOTA_PER_DAY`).
- DoD:
  - Quotas enforced; denials logged with reason and limits.

---

## Phase E — Documentation and contracts

Goal: Ensure API docs match behavior and provide client guidance for non-blocking UX.

### E1. Update Swagger and API docs
- Actions:
  - Update Swagger decorators for serve-only read endpoints and new ingest endpoint.
  - Update `src/api/API_DOCUMENTATION.md` to:
    - Emphasize: reads are precomputed only; use `/analyses/*` to refresh.
    - Document `ETag`/`Cache-Control` behavior.
    - Add troubleshooting for `WARMING_UP`/missing period data states.
- DoD:
  - Docs accurately reflect new behavior; examples show 202 patterns and job monitoring.

---

## Phase F — Optional: ClickHouse adoption (performance at scale)

Goal: Add CH for event facts and rollups when read/write scale requires it.

### F1. Stand up ClickHouse and schemas
- Actions:
  - Provision ClickHouse and create tables: `events`, `wallet_agg_daily`, `wallet_snapshot_store`.
  - Add CH client/config module.
- DoD:
  - CH reachable from the app; migrations applied.

### F2. Dual write from ingest-apply
- Actions:
  - On `ingest-apply`, insert normalized events into CH `events` and update `wallet_agg_daily`.
  - Keep Redis snapshot delta-apply as now.
- DoD:
  - New events appear in CH; aggregates updated for later reads.

### F3. SnapshotReadService CH fallback
- Actions:
  - In `SnapshotReadService`, add optional CH aggregation fallback when Redis miss and Postgres summary is insufficient.
  - Cache synthesized snapshot back to Redis.
- DoD:
  - Summary reads can be served from CH-derived aggregates if needed.

---

## Testing & Validation (ongoing per phase)

- Unit tests:
  - Mock `DatabaseService` to ensure read endpoints do not call analysis services.
  - Test ETag/304 logic and cache TTL behavior.
- Integration tests:
  - Submit `/analyses/wallets/dashboard-analysis` and verify cache invalidation.
  - Send webhook payload to `/ingest/webhook/helius` and verify delta updates and dedupe.
- Load testing (later):
  - Measure TTFB for summary with/without cache.

---

## Rollout plan

1) Deploy Phase A alone to eliminate compute-on-read and add caching.
2) Enable Phase B to unify snapshot reads and automatic invalidation.
3) Add Phase C when ready for near-real-time deltas.
4) Layer D (quotas) to protect resources.
5) Adopt F (ClickHouse) only when necessary for scale. - WAIT FOR NOW!

Feature flags (recommended):
- `SERVE_ONLY_READS=true`
- `SUMMARY_CACHE_TTL_SEC=60`
- `ENABLE_WEBHOOK_INGEST=false`
- `USE_CLICKHOUSE=false`

---

## Operational notes

- Ensure Redis is healthy; cache failures should degrade to Postgres reads, not errors.
- Keep per-wallet locking for long operations; you already have Redis locks in queue processors.
- Prefer background recompute; UI should use `/analyses/wallets/status` to decide when to show “Refresh”.

---

## Quick reference checklist

- Serve-only reads: PnL, Behavior (no analysis on GET)
- Summary headers: ETag + Cache-Control
- Redis summary cache with TTL and invalidation on job completion
- Webhook ingest + ingest-apply worker (dedupe, delta-apply)
- Quotas on analyses endpoints
- Swagger and docs updated
- Optional: ClickHouse (events, rollups), SnapshotReadService CH fallback


