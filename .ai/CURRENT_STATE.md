## Latest Updates (Frontend - Design System)
- Added design tokens (shadow tiers + radius overrides) in `dashboard/tailwind.config.ts`.
- Introduced `Metric` and `StatCard` components under `dashboard/src/components/ui/`.
- Added `/test-components` page (`dashboard/src/app/test-components/page.tsx`) to showcase variants and responsive/dark-mode behavior.
- Migrated `dashboard/src/components/dashboard/AccountSummaryCard.tsx` off Tremor to shadcn + custom Metric/StatCard with p-6 spacing and shadow system; kept existing error/unanalyzed flows.
- Migrated `dashboard/src/components/dashboard/TokenPerformanceTab.tsx` wrapper to shadcn Card (rounded-xl, shadow-base/hover) and replaced Tremor text/flex uses with standard layout classes; table logic unchanged.

## Latest Updates (Backend - Memory Leak Fixes)
- Memory growth after jobs: long-lived accumulators in `HeliusSyncService` and missing teardown for Redis/queue resources.
- Costly cache invalidation reading all Redis keys into memory.
- Memory growth from large similarity/enrichment payloads being persisted in BullMQ and inflated WebSocket subscription maps; multiple ad-hoc Redis clients per service and lack of visibility into oversized job payloads.

### What was fixed
- `HeliusSyncService` kept per-wallet stats/counters in service-level Maps without guaranteed cleanup (standard fetch had no deletion; errors skipped cleanup). Maps grew across jobs/failures.
- Redis-backed services (`BalanceCacheService`, `HolderProfilesCacheService`, `TokenInfoService`) created clients without closing them, risking leaked connections on restarts/workers.
- Holder cache invalidation used `KEYS` + JSON parse of every token cache, causing large transient memory use.
- Queue/Event services didn't close BullMQ queues/listeners on shutdown.
- Similarity jobs returned full results, enrichment jobs returned large payloads; BullMQ kept recent jobs, inflating Redis and worker heap on completion reads.
- WebSocket job-progress gateway never removed completed/failed job IDs from per-client subscriptions, allowing unbounded growth.
- Services (`BalanceCacheService`, `TokenInfoService`, `HolderProfilesCacheService`, `DexscreenerService`, `QueueHealthService`) each created their own Redis client; shutdown handled inconsistently.
- Redis provider had eager connect; concern about startup failure when Redis is slow.

### Implementation details
- Refactored `HeliusSyncService` to use per-run accumulators passed through fetch/process, with `finally` cleanup that saves stats and clears Maps; made helpers `protected` for testing.
- Added `onModuleDestroy` to close Redis clients in balance/holder/token cache services.
- Added shutdown cleanup for JobEventsBridge (closes queues) and DeadLetterQueueService (clears interval, closes listeners/queue).
- Swapped holder cache invalidation to SCAN batches to avoid loading all keys at once.
- Added a repeat-job leak regression test harness (`src/core/services/helius-sync-service.leak.test.ts`) asserting accumulators are empty after success/failure.
- Offloaded similarity results to Redis with a 15m TTL; similarity workers return only a `resultKey` + metadata and warn if results exceed 5MB. Jobs API now resolves similarity results from Redis transparently, falling back to inline data on failure.
- Added payload-size warnings for similarity job enqueue; tightened Bull retention for similarity/enrichment jobs to a small count/age window to avoid Redis bloat.
- Pruned completed/failed job IDs from WebSocket subscriptions after broadcasting to cap map growth.
- Centralized Redis via `REDIS_CLIENT` across cache/token/dexscreener/queue-health services; modules import `RedisModule`. Provider keeps `lazyConnect` with bounded retries to tolerate slow Redis startups.

## Testing
- Frontend: `npm run lint --prefix dashboard` (pre-existing warnings only; no new issues from added files).
- Backend: Install deps and rerun the leak test (`node --test -r ts-node/register -r tsconfig-paths/register src/core/services/helius-sync-service.leak.test.ts`); wire into CI once passing.
- Run a quick similarity flow and confirm `/jobs/:id/result` returns data via the stored result key.
- Consider adding metrics/gauges for job payload size, similarity result key hits/misses, and subscription map size.
- Optional: add a similarity leak/repeat test (loop N runs, assert RSS and key sizes stay bounded) alongside the existing Helius sync leak test.
- Deploy and monitor RSS after repeated wallet syncs/analysis jobs to confirm stability.
