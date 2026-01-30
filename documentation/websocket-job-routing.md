# WebSocket Job Routing (User Rooms + Job Mapping)

## Overview
Job events are delivered to the frontend via Socket.IO rooms keyed by userId. Each job must be associated with a userId at enqueue time; the mapping is stored in Redis and picked up by the JobEventsBridge, which injects userId into every emitted event. The WebSocket gateway is room-only and drops events without userId.

## Flow
1. Enqueue job with userId → queue writes `job:user:{jobId}` (TTL 24h).
2. BullMQ emits lifecycle events → JobEventsBridge listens.
3. Bridge resolves userId (from job data or Redis mapping) and emits Redis pub/sub events with userId.
4. Gateway receives pub/sub events and broadcasts to room `user-{userId}`.
5. Frontend listens on the user room (no per-job subscription needed).

## Mapping Responsibilities
- **Queues writing mappings:**
  - `AnalysisOperationsQueue`: dashboard analysis + holder profiles (writes mapping when enqueuing).
  - `SimilarityOperationsQueue`: similarity analysis flow.
  - `EnrichmentOperationsQueue`: enrichment jobs (dashboard/similarity/parallel).
- **Not yet mapped:** wallet-operations (sync/fetch-balance) and any other queues not listed above. If a job should reach the UI, add the same mapping write there.

## Bridge Behavior
- Resolves userId from job data; if missing, falls back to Redis `job:user:{jobId}`.
- Emits progress/queue-to-start/completed/failed with userId.
- Cleans mapping on completed/failed.
- Logs a warning if userId cannot be resolved (event dropped by gateway).

## Gateway Behavior
- Room-only broadcasting: sends to `user-{userId}`; drops events without userId.
- Legacy per-job subscription has been removed; frontend subscribe/unsubscribe calls are no-ops server-side.

## Frontend Note
- `useJobProgress` still emits subscribe/unsubscribe today (harmless); can be simplified to room-only later.

## Adding a New User-Scoped Job
1. Include `userId` in job data at enqueue time.
2. After `queue.add(...)`, write `SET job:user:{jobId} {userId} EX 86400`.
3. That’s it—bridge + gateway will deliver to the user room. No processor changes required.
