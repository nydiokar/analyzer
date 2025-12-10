## What we’re tackling
- Memory growth after jobs: long-lived accumulators in `HeliusSyncService` and missing teardown for Redis/queue resources.
- Costly cache invalidation reading all Redis keys into memory.
- Lack of a regression harness to prove per-job memory stays bounded.

## What was wrong
- `HeliusSyncService` kept per-wallet stats/counters in service-level Maps without guaranteed cleanup (standard fetch had no deletion; errors skipped cleanup). Maps grew across jobs/failures.
- Redis-backed services (`BalanceCacheService`, `HolderProfilesCacheService`, `TokenInfoService`) created clients without closing them, risking leaked connections on restarts/workers.
- Holder cache invalidation used `KEYS` + JSON parse of every token cache, causing large transient memory use.
- Queue/Event services didn’t close BullMQ queues/listeners on shutdown.

## What I did
- Refactored `HeliusSyncService` to use per-run accumulators passed through fetch/process, with `finally` cleanup that saves stats and clears Maps; made helpers `protected` for testing.
- Added `onModuleDestroy` to close Redis clients in balance/holder/token cache services.
- Added shutdown cleanup for JobEventsBridge (closes queues) and DeadLetterQueueService (clears interval, closes listeners/queue).
- Swapped holder cache invalidation to SCAN batches to avoid loading all keys at once.
- Added a repeat-job leak regression test harness (`src/core/services/helius-sync-service.leak.test.ts`) asserting accumulators are empty after success/failure.

## What’s next
- Install deps and rerun the new leak test (`node --test -r ts-node/register -r tsconfig-paths/register src/core/services/helius-sync-service.leak.test.ts`); wire into CI once passing.
- Optional: add runtime gauges/logs for accumulator sizes and Redis connection counts to catch future leaks in prod.
- Deploy and monitor RSS after repeated wallet syncs/analysis jobs to confirm stability.
