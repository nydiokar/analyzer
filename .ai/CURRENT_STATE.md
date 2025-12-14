## What we're tackling
- Memory growth after jobs: long-lived accumulators in `HeliusSyncService` and missing teardown for Redis/queue resources.
- Costly cache invalidation reading all Redis keys into memory.
- Lack of a regression harness to prove per-job memory stays bounded.
- New: Memory growth from large similarity/enrichment payloads being persisted in BullMQ and inflated WebSocket subscription maps; multiple ad-hoc Redis clients per service and lack of visibility into oversized job payloads.

## What was wrong
- `HeliusSyncService` kept per-wallet stats/counters in service-level Maps without guaranteed cleanup (standard fetch had no deletion; errors skipped cleanup). Maps grew across jobs/failures.
- Redis-backed services (`BalanceCacheService`, `HolderProfilesCacheService`, `TokenInfoService`) created clients without closing them, risking leaked connections on restarts/workers.
- Holder cache invalidation used `KEYS` + JSON parse of every token cache, causing large transient memory use.
- Queue/Event services didn't close BullMQ queues/listeners on shutdown.
- Similarity jobs returned full results, enrichment jobs returned large payloads; BullMQ kept recent jobs, inflating Redis and worker heap on completion reads.
- WebSocket job-progress gateway never removed completed/failed job IDs from per-client subscriptions, allowing unbounded growth.
- Services (`BalanceCacheService`, `TokenInfoService`, `HolderProfilesCacheService`, `DexscreenerService`, `QueueHealthService`) each created their own Redis client; shutdown handled inconsistently.
- Redis provider had eager connect; concern about startup failure when Redis is slow.

## What I did
- Refactored `HeliusSyncService` to use per-run accumulators passed through fetch/process, with `finally` cleanup that saves stats and clears Maps; made helpers `protected` for testing.
- Added `onModuleDestroy` to close Redis clients in balance/holder/token cache services.
- Added shutdown cleanup for JobEventsBridge (closes queues) and DeadLetterQueueService (clears interval, closes listeners/queue).
- Swapped holder cache invalidation to SCAN batches to avoid loading all keys at once.
- Added a repeat-job leak regression test harness (`src/core/services/helius-sync-service.leak.test.ts`) asserting accumulators are empty after success/failure.
- Offloaded similarity results to Redis with a 15m TTL; similarity workers return only a `resultKey` + metadata and warn if results exceed 5MB. Jobs API now resolves similarity results from Redis transparently, falling back to inline data on failure.
- Added payload-size warnings for similarity job enqueue; tightened Bull retention for similarity/enrichment jobs to a small count/age window to avoid Redis bloat.
- Pruned completed/failed job IDs from WebSocket subscriptions after broadcasting to cap map growth.
- Centralized Redis via `REDIS_CLIENT` across cache/token/dexscreener/queue-health services; modules import `RedisModule`. Provider keeps `lazyConnect` with bounded retries to tolerate slow Redis startups.

## What's next
- Install deps and rerun the leak test (`node --test -r ts-node/register -r tsconfig-paths/register src/core/services/helius-sync-service.leak.test.ts`); wire into CI once passing.
- Run a quick similarity flow and confirm `/jobs/:id/result` returns data via the stored result key.
- Consider adding metrics/gauges for job payload size, similarity result key hits/misses, and subscription map size.
- Optional: add a similarity leak/repeat test (loop N runs, assert RSS and key sizes stay bounded) alongside the existing Helius sync leak test.
- Deploy and monitor RSS after repeated wallet syncs/analysis jobs to confirm stability.

---

# PostgreSQL Checkpoint I/O Blockage Investigation (Dec 14, 2025)

## Incident Summary
**Date:** December 13-14, 2025, 00:02-00:18 EET (22:02-22:18 UTC)
**Symptom:** Frontend froze when user attempted to process holder profile job. Backend became completely unresponsive for 19 minutes with zero logs.
**Root Cause:** PostgreSQL checkpoint taking 269 seconds (4.5 minutes) to write 86MB to disk, blocking all database I/O during critical user request window.

## Timeline of Events

### 21:59:53 UTC (23:59:53 EET) - Heavy Database Load Begins
- Backend processing **5 concurrent wallet analyses** simultaneously
- Processing **10,000+ total transactions** across wallets:
  - `2QygD8bDsfK1XCAnFxFtpPddzbJbamhXvKqcLQ8cELzE`: 1,878 transactions → 323 tokens
  - `38g4DgV4xH3tt9rqQSyH3YtG9LDEN67Jp94UN7tBQ6iH`: 964 transactions → 227 tokens
  - `FxN3VZ4BosL5urG2yoeQ156JSdmavm9K5fdLxjkPmaMR`: 2,679 transactions → 332 tokens
  - `7NAd2EpYGGeFofpyvgehSXhH5vg6Ry6VRMW2Y6jiqCu1`: 2,699 transactions → 337 tokens
  - `4nvNc7dDEqKKLM4Sr9Kgk3t1of6f8G66kT64VoC95LYh`: 2,332 transactions → 298 tokens
- **Massive batch database writes**: 200-337 AnalysisResult records per wallet
- Last logged activity: Behavior analysis completions at 21:59:53.928Z

### 00:01:28 EET (22:01:28 UTC) - PostgreSQL Checkpoint Starts
**PostgreSQL log:**
```
2025-12-14 00:01:28.352 EET [1000431] LOG:  checkpoint starting: time
```

**Checkpoint triggered by:**
- `checkpoint_timeout=300s` (5 minutes) - automatic checkpoint timer
- Needs to write **11,062 dirty buffers** (86MB) to disk
- 67.5% of shared_buffers dirty

**What checkpoint does:**
- Flushes all modified pages from PostgreSQL's `shared_buffers` to disk
- Ensures data durability in case of crash
- **Blocks or severely slows ALL write operations** during the flush

### 00:01:28 - 00:05:58 - The 269-Second I/O Freeze
**Duration:** 4 minutes 29 seconds (269.710 seconds)
**Data written:** 86MB (11,062 × 8KB buffers)
**Effective write speed:** **320 KB/s** (0.32 MB/s)

**PostgreSQL completion log:**
```
2025-12-14 00:05:58.108 EET [1000431] LOG:  checkpoint complete:
  wrote 11062 buffers (67.5%);
  write=269.710 s, sync=0.002 s, total=269.756 s;
  sync files=74
```

**What happened during this window:**
- User's holder profile request hits the backend (exact time unknown, but between 00:02-00:04)
- All database queries queue up waiting for I/O
- Backend event loop continues but all DB operations hang
- No logs emitted because operations are blocked in PostgreSQL
- Prisma connections wait indefinitely (no statement timeout configured yet)
- Frontend receives no response and appears frozen

### 00:05:58 - Checkpoint Completes
- Database I/O returns to normal
- Queued operations can proceed

### 00:18:42 UTC (00:18:42 EET) - Backend Logging Resumes
- First logs appear: HeliusSyncService processing wallets
- **Gap of 18 minutes, 49 seconds** from last log at 21:59:53
- Unclear why additional 12-minute delay after checkpoint completed (possibly internal timeouts/recovery)

## Why Was the Checkpoint So Slow?

### Normal vs. Observed Performance
- **Expected SSD performance:** 200-500 MB/s sequential writes
- **Expected HDD performance:** 50-100 MB/s sequential writes
- **Observed performance:** **0.32 MB/s** (320 KB/s)

**Performance degradation:** ~600-1500x slower than expected for SSD!

### Possible Causes for Extremely Slow Writes

1. **Random I/O Pattern (Most Likely)**
   - Checkpoint writes are **scattered random writes** across database files
   - SSDs handle sequential writes well but random writes much worse
   - Cheap SSDs (especially QLC NAND) can drop to <1 MB/s on random writes when cache fills
   - Write amplification: Single 8KB page write might trigger internal SSD page rewrites

2. **SSD Cache Saturation**
   - Most consumer SSDs have small write cache (few hundred MB to few GB)
   - During heavy batch writes leading up to checkpoint, cache likely filled
   - Once cache full, SSD must write directly to NAND (much slower)
   - QLC NAND: ~10-80 MB/s sustained writes when cache exhausted

3. **Competing I/O During Checkpoint**
   - Check system during checkpoint showed low I/O when idle
   - But at 00:01 checkpoint start, backend was doing heavy writes
   - Possible contention between:
     - PostgreSQL checkpoint writes
     - Application log writes
     - PM2 log writes
     - Other system services

4. **Filesystem Fragmentation**
   - PostgreSQL database files may be fragmented on disk
   - Causes more seeking/random I/O patterns
   - Database size: 1,142 MB across many tables

5. **Hardware Limitations**
   - Raspberry Pi or similar SBC with lower-end storage controller
   - Shared PCIe lanes between storage and other devices
   - Thermal throttling (SSD overheating reduces performance)

## Evidence from Logs

### Application Logs (combined-2025-12-13.log.gz)
```
2025-12-13T21:59:53.928Z INFO [BehaviorService] Completed behavior analysis...
[19-minute gap - ZERO logs]
2025-12-13T22:18:42.968Z INFO [HeliusSyncService] [Sync] Wallet entry ensured...
```

### PostgreSQL Logs
```
2025-12-14 00:01:28.352 EET [1000431] LOG:  checkpoint starting: time
2025-12-14 00:05:58.108 EET [1000431] LOG:  checkpoint complete: wrote 11062 buffers (67.5%);
  0 WAL file(s) added, 1 removed, 10 recycled;
  write=269.710 s, sync=0.002 s, total=269.756 s;
  sync files=74, longest=0.001 s, average=0.001 s;
  distance=171411 kB, estimate=189033 kB
```

**Key metrics:**
- `write=269.710s` - Time spent writing data to OS cache
- `sync=0.002s` - Time for fsync (negligible - data already on disk)
- `sync files=74` - Number of files touched (scattered writes across tables)

### Error Logs (error-2025-12-13.log)
```
2025-12-13T21:59:48.454Z ERROR [DatabaseService] Prisma Error saving new cached transactions
  to HeliusTransactionCache {"code":"P2002","meta":{"modelName":"HeliusTransactionCache","target":["signature"]}}
```

**Note:** P2002 errors are **red herring** - these are duplicate key violations from concurrent inserts, properly handled by application. Not related to freeze.

### PM2 Logs
- Same 19-minute gap in both error and output logs
- Process didn't crash (no restart logged)
- Uptime continued uninterrupted

### System Logs
- No OOM kills detected
- No kernel panics
- PostgreSQL process remained running

### Database Connection State (During Investigation)
```sql
SELECT state, count(*), max(now() - state_change) as oldest_idle
FROM pg_stat_activity WHERE datname = 'analyzer' GROUP BY state;

 state  | count |   oldest_idle
--------+-------+------------------
 active |     1 | -00:00:00.000002
 idle   |    11 | 00:25:04.983654
```

**Finding:** 11 idle connections sitting for 25+ minutes indicates Prisma connection pool not being cleaned up properly (separate issue, not cause of freeze).

## Mitigations Applied

### PostgreSQL Configuration Changes
**File:** `/etc/postgresql/15/main/postgresql.conf`

#### Before (Defaults):
```conf
shared_buffers = 128MB              # Small buffer
checkpoint_timeout = 5min           # Frequent checkpoints
max_wal_size = 1GB                  # Limited WAL
#wal_buffers = -1                   # Auto (small)
#bgwriter_delay = 200ms             # Commented out
#bgwriter_lru_maxpages = 100        # Commented out
#log_checkpoints = off              # No monitoring
```

#### After (Optimized):
```conf
shared_buffers = 512MB              # 4x larger - fewer writes needed
checkpoint_timeout = 15min          # 3x less frequent checkpoints
max_wal_size = 2GB                  # Allow more WAL growth before checkpoint
wal_buffers = 16MB                  # Larger WAL buffer (was auto ~4MB)
bgwriter_delay = 200ms              # Background writer spreads writes over time
bgwriter_lru_maxpages = 100         # Max buffers written per background writer round
log_checkpoints = on                # Monitor checkpoint performance
```

**Rationale:**
- **Reduce checkpoint frequency:** From every 5min to every 15min = 66% fewer checkpoints
- **Larger buffers:** More data stays in memory longer, reduces write pressure
- **Background writer:** Spreads writes across time instead of all at once during checkpoint
- **Better visibility:** `log_checkpoints=on` lets us track checkpoint duration in future

### Application Changes

#### 1. Statement Timeout Added
**File:** `src/core/services/database-service.ts`

```typescript
export const prisma = new PrismaClient({
  log: ['error', 'warn'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
        ? `${process.env.DATABASE_URL}&statement_timeout=120000`  // 2 minutes
        : undefined,
    },
  },
});
```

**What it does:**
- Any **individual SQL query** taking longer than 2 minutes gets cancelled
- Prevents queries from hanging forever during checkpoint or deadlock
- Does **NOT** apply to entire job duration, only individual queries

**Why 2 minutes (not 30 seconds):**
- Heavy operations like batch upserting 300+ AnalysisResults can take 40-50+ seconds
- Holder profile jobs can have individual queries during checkpoint that need to wait
- Job-level timeouts already exist separately in queue configuration

#### 2. Heartbeat Logging Added
**File:** `src/main.ts`

```typescript
// Heartbeat logging to detect event loop blocking / system freezes
setInterval(() => {
  Logger.log('[Heartbeat] Backend responsive', 'HealthCheck');
}, 30000); // Every 30 seconds
```

**What it does:**
- Logs every 30 seconds to prove backend is alive
- If heartbeat stops, we know event loop is blocked or process crashed
- Helps distinguish between:
  - **No heartbeat:** Event loop blocked (CPU bound operation, deadlock)
  - **Heartbeat present but no job logs:** Database I/O blocked (checkpoint)

## How to Diagnose Next Time

### If Frontend Freezes Again

1. **Check application heartbeat:**
   ```bash
   tail -f ~/.pm2/logs/sova-backend-api-out.log | grep Heartbeat
   ```
   - **Heartbeat stops:** Event loop blocked (investigate CPU/memory)
   - **Heartbeat continues:** Database I/O issue (proceed to step 2)

2. **Check PostgreSQL checkpoint status:**
   ```bash
   sudo tail -f /var/log/postgresql/postgresql-15-main.log
   ```
   Look for:
   ```
   LOG:  checkpoint starting: time
   LOG:  checkpoint complete: wrote X buffers; write=Y.YYY s
   ```
   - If `write=` time > 60 seconds → Slow checkpoint (I/O bottleneck)
   - If `write=` time < 10 seconds → Checkpoint is fine, look elsewhere

3. **Check active database queries:**
   ```bash
   sudo -u postgres psql -d analyzer -c "
     SELECT pid, usename, state,
            now() - query_start as duration,
            LEFT(query, 100) as query
     FROM pg_stat_activity
     WHERE datname = 'analyzer' AND state != 'idle'
     ORDER BY query_start;
   "
   ```
   - Long-running queries (duration > 2min) should have been killed by statement_timeout
   - If queries still running after 2min, statement_timeout not working

4. **Check disk I/O in real-time:**
   ```bash
   iostat -x 2 10
   ```
   During checkpoint, look for:
   - `%util` near 100% = Disk saturated
   - `w_await` > 100ms = Slow writes
   - `wkB/s` < 1000 (1MB/s) = Very slow write throughput

5. **Check database connection state:**
   ```bash
   sudo -u postgres psql -d analyzer -c "
     SELECT state, count(*)
     FROM pg_stat_activity
     WHERE datname = 'analyzer'
     GROUP BY state;
   "
   ```
   - Many connections in `active` waiting = Possible deadlock or checkpoint block
   - Many `idle` connections = Connection pool leak (separate issue)

### Verification Commands

**After PostgreSQL config changes, verify settings are active:**
```bash
sudo -u postgres psql -d analyzer -c "
  SHOW checkpoint_timeout;
  SHOW max_wal_size;
  SHOW shared_buffers;
  SHOW wal_buffers;
  SHOW log_checkpoints;
"
```

**Monitor checkpoint performance over time:**
```bash
sudo grep "checkpoint complete" /var/log/postgresql/postgresql-15-main.log | tail -20
```

Look for `write=` times:
- ✅ **< 30 seconds:** Good
- ⚠️ **30-60 seconds:** Acceptable
- ❌ **> 60 seconds:** Problem - investigate I/O

**Check SSD health/performance:**
```bash
# Check SMART stats
sudo smartctl -a /dev/sda | grep -E "SMART|Health|Wear|Temperature"

# Test write performance (CAREFUL - uses disk space)
sudo dd if=/dev/zero of=/tmp/testfile bs=1M count=1000 oflag=direct
# Should see > 50 MB/s on decent SSD
```

## How to Falsify or Prove This Hypothesis

### To PROVE checkpoint was the cause:

1. **Monitor checkpoint logs during next freeze:**
   ```bash
   # Run this in separate terminal while testing
   sudo tail -f /var/log/postgresql/postgresql-15-main.log | grep checkpoint
   ```
   - If freeze coincides with "checkpoint starting" → PROVEN

2. **Trigger manual checkpoint and observe behavior:**
   ```bash
   # During low load:
   sudo -u postgres psql -d analyzer -c "CHECKPOINT;"
   # Check if application logs stop during checkpoint
   ```

3. **Correlate checkpoint times with application log gaps:**
   ```bash
   # Extract checkpoint times from PostgreSQL log
   sudo grep "checkpoint complete" /var/log/postgresql/postgresql-15-main.log | \
     grep "write=[0-9][0-9][0-9]\." | \  # Only checkpoints > 100s
     awk '{print $1, $2, $3}'

   # Compare with application log gaps
   zcat logs/combined-*.log.gz | grep "INFO" | \
     awk '{print $1}' | \
     uniq -c | \
     awk '$1 < 10 {print}'  # Find time periods with < 10 logs (gaps)
   ```

### To FALSIFY (prove it's NOT checkpoint):

1. **If freeze happens with heartbeat still working:**
   - Proves event loop not blocked
   - But could still be DB I/O issue

2. **If freeze happens but PostgreSQL logs show fast checkpoint:**
   ```
   checkpoint complete: write=5.234 s
   ```
   - If checkpoint only takes 5 seconds but freeze lasts minutes → NOT checkpoint
   - Look for:
     - Long-running queries
     - Database deadlocks
     - External API timeouts
     - Redis issues

3. **If freeze happens outside checkpoint window:**
   - Check `log_checkpoints` entries
   - If last checkpoint was 10+ minutes before freeze → NOT checkpoint
   - Investigate other causes:
     - Helius API rate limiting/timeouts
     - Redis connection exhaustion
     - Memory pressure causing swap
     - BullMQ queue blocking

4. **If checkpoint is fast after optimizations but freezes continue:**
   - Proves optimizations worked for checkpoints
   - But freeze has different root cause
   - Next suspects:
     - Heavy holder profile jobs exhausting connections
     - Similarity job processing blocking event loop
     - External API cascading failures

## Configuration Reference

### Current PostgreSQL Settings (Post-Fix)
- Database: `analyzer` (1,142 MB)
- PostgreSQL Version: 15
- Max connections: 100 (default)
- Shared buffers: 512 MB
- Effective cache size: 4 GB
- Checkpoint timeout: 15 min
- Max WAL size: 2 GB

### Current Prisma Settings
- Connection limit: 30 (in DATABASE_URL)
- Pool timeout: 20 seconds
- Connect timeout: 10 seconds
- Statement timeout: 120 seconds (2 minutes)

### System Resources
- RAM: 8 GB total, ~6 GB available
- Storage: 293 GB total, 245 GB free (12% used)
- Disk: `/dev/sda` (SSD, unknown model/specs)

## Related Issues to Investigate

1. **Prisma connection pool not cleaning up idle connections** (11 idle connections after 25 minutes)
2. **P2002 duplicate key errors** on HeliusTransactionCache (benign but log noise)
3. **Missing SOL price data** causing warnings in PnL calculations
4. **SSD model/specifications** - unknown if consumer-grade QLC or enterprise SLC/MLC

## References
- PostgreSQL Checkpoint Documentation: https://www.postgresql.org/docs/15/wal-configuration.html
- PostgreSQL Checkpoint Tuning: https://www.postgresql.org/docs/15/runtime-config-wal.html
- Prisma Connection Pooling: https://www.prisma.io/docs/guides/performance-and-optimization/connection-management
