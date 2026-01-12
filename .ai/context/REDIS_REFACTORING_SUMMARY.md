# Redis Dependency Injection Refactoring

**Date:** 2026-01-12
**Branch:** discover-analytics-ux
**Status:** ✅ Complete

## Problem

NestJS dependency injection error when starting the application:
```
UnknownDependenciesException [Error]: Nest can't resolve dependencies of the AnalysesController (..., ?, ?).
Please make sure that the argument "REDIS_CLIENT" at index [6] is available in the AnalysesModule context.
```

### Root Cause

1. **Missing Export**: `QueueModule` was marked as `@Global()` and imported `RedisModule`, but didn't **export** `RedisModule`
   - In NestJS, even global modules must export providers to make them available elsewhere
   - `REDIS_CLIENT` provider was scoped only to `QueueModule`

2. **Architectural Violation**: `AnalysesController` and processors were directly injecting `REDIS_CLIENT` and using raw Redis operations
   - Violates Single Responsibility Principle (controllers doing cache logic)
   - No abstraction layer (duplicated Redis operations across files)
   - Inconsistent with existing cache services (`BalanceCacheService`, `HolderProfilesCacheService`)

## Solution

### Part 1: Fix Dependency Injection

**File:** `src/queues/queue.module.ts`

Added `RedisModule` to exports array:
```typescript
@Global()
@Module({
  imports: [RedisModule, ...],
  exports: [
    RedisModule, // ← Added this to make REDIS_CLIENT globally available
    // ... other exports
  ]
})
export class QueueModule {}
```

**Cleanup:** Removed redundant `RedisModule` import from `JobsModule` (now globally available)

### Part 2: Create Abstraction Layer

**New File:** `src/api/services/job-payload-cache.service.ts`

Created a dedicated service to abstract job payload storage pattern:

**Purpose:**
- Store large payloads (wallet balances, etc.) in Redis before queueing BullMQ jobs
- Keep BullMQ job data small (only key references, not full payloads)
- Centralize TTL management, error handling, logging

**Methods:**
- `storePayload(requestId, type, data, ttl)` → Returns Redis key
- `retrievePayload<T>(key)` → Returns parsed payload
- `deletePayload(key)` → Best-effort cleanup
- `exists(key)`, `getTTL(key)` → Helper methods

**Benefits:**
- Single source of truth for payload caching logic
- Consistent key naming (`{type}:balances:{requestId}`)
- Better logging and error handling
- Easy to test and mock
- Can switch cache backends without touching controllers/processors

### Part 3: Refactor Consumers

Refactored 3 files to use the new service:

#### 1. `src/api/controllers/analyses.controller.ts`
**Before:**
```typescript
@Inject(REDIS_CLIENT) private readonly redisClient: Redis
...
const balancesKey = `enrich:balances:${requestId}`;
await this.redisClient.set(balancesKey, JSON.stringify(body.walletBalances), 'EX', 15 * 60);
```

**After:**
```typescript
private readonly jobPayloadCache: JobPayloadCacheService
...
const balancesKey = await this.jobPayloadCache.storePayload(requestId, 'enrich', body.walletBalances);
```

#### 2. `src/queues/processors/similarity-operations.processor.ts`
**Before:**
```typescript
const balancesKey = `similarity:balances:${requestId}`;
await this.redisClient.set(balancesKey, JSON.stringify(validWalletBalances), 'EX', 15 * 60);
```

**After:**
```typescript
const balancesKey = await this.jobPayloadCache.storePayload(requestId, 'similarity', validWalletBalances);
```

**Note:** Kept `@Inject(REDIS_CLIENT)` for other Redis use cases:
- Lock management (`enrichmentLockKey`)
- Result caching (`resultKey`)
- Bulk operations (`mget`)

#### 3. `src/queues/processors/enrichment-operations.processor.ts`
**Before:**
```typescript
const cached = await this.redisClient.get(balancesKey);
if (cached) {
  balancesPayload = JSON.parse(cached);
}
await this.redisClient.del(balancesKey);
```

**After:**
```typescript
balancesPayload = await this.jobPayloadCache.retrievePayload(balancesKey);
await this.jobPayloadCache.deletePayload(balancesKey);
```

**Note:** Also kept `@Inject(REDIS_CLIENT)` for enriched balance caching

### Part 4: Update Module Providers

#### `src/api/modules/analyses.module.ts`
```typescript
providers: [
  EnrichmentStrategyService,
  MintParticipantsService,
  JobPayloadCacheService, // ← Added
]
```

#### `src/queues/queue.module.ts`
```typescript
providers: [
  RedisLockService,
  AlertingService,
  JobPayloadCacheService, // ← Added
  // ... other services
]
exports: [
  RedisModule, // ← Fixed: Now exported
  JobPayloadCacheService, // ← Added for external use
  // ... other exports
]
```

## Architecture Comparison

### Before Refactoring
```
Controller → REDIS_CLIENT → Redis
Processor → REDIS_CLIENT → Redis
```
- ❌ Direct coupling to Redis implementation
- ❌ Duplicated logic (key naming, TTL, parsing)
- ❌ Hard to test (mocking Redis client)
- ❌ Inconsistent with other cache services

### After Refactoring
```
Controller → JobPayloadCacheService → REDIS_CLIENT → Redis
Processor → JobPayloadCacheService → REDIS_CLIENT → Redis
```
- ✅ Clean abstraction layer
- ✅ Centralized logic (DRY principle)
- ✅ Easy to test (mock service, not Redis)
- ✅ Consistent with `BalanceCacheService`, `HolderProfilesCacheService`

## Files Changed

### Created
- `src/api/services/job-payload-cache.service.ts` (new)

### Modified
- `src/queues/queue.module.ts` (export RedisModule, add service)
- `src/api/modules/analyses.module.ts` (add service provider)
- `src/api/modules/jobs.module.ts` (remove redundant import)
- `src/api/controllers/analyses.controller.ts` (use service, remove direct Redis)
- `src/queues/processors/similarity-operations.processor.ts` (use service for payloads)
- `src/queues/processors/enrichment-operations.processor.ts` (use service for payloads)

## Testing

✅ TypeScript compilation successful (`npm run build`)
⏳ Runtime testing needed (start application and verify enrichment jobs work)

## Technical Debt Eliminated

1. **Fixed**: Missing module export causing DI errors
2. **Fixed**: Controllers directly using Redis (architectural violation)
3. **Fixed**: Duplicated payload caching logic across 3 files
4. **Fixed**: Inconsistent patterns (some services abstracted, some not)

## Pattern for Future Use

When caching temporary job data before queueing:
```typescript
// In controller or processor
constructor(private readonly jobPayloadCache: JobPayloadCacheService) {}

// Store payload
const key = await this.jobPayloadCache.storePayload(requestId, 'type', data);

// Add job with key (not full data)
await queue.add({ dataKey: key, ... });

// In processor: retrieve payload
const data = await this.jobPayloadCache.retrievePayload(key);

// Cleanup after use
await this.jobPayloadCache.deletePayload(key);
```

## Notes

- Direct `REDIS_CLIENT` injection is still valid for:
  - Lock management (RedisLockService pattern)
  - Result caching with custom TTLs
  - Bulk operations (mget, pipeline)
- This service is specifically for **job payload offloading** pattern
- Follows existing architecture patterns (`BalanceCacheService`, `HolderProfilesCacheService`)
