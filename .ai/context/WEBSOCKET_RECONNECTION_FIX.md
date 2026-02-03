# WebSocket & Redis Reconnection Fix

**Date:** 2026-02-03
**Status:** ✅ Fixed
**Severity:** 🔴 Critical (Production Resilience)

---

## Problem Statement

When Redis or Docker went down and came back up automatically, the application failed to reconnect to WebSocket and Redis, requiring manual restart of the backend. This would cause production outages if Redis restarted during maintenance or encountered transient failures.

### Root Causes Identified

1. **Backend Redis Subscriber - No Retry Mechanism**
   - Location: `src/api/shared/job-progress.gateway.ts:118`
   - Issue: Redis subscriptions set up with fixed 5-second delay during initialization
   - Impact: If Redis unavailable at startup or goes down after startup, subscriptions fail permanently
   - Behavior: Single attempt with warning log, no automatic retry

2. **Frontend Socket.io - Limited Reconnection Attempts**
   - Location: `dashboard/src/hooks/useJobProgress.ts:194`
   - Issue: `reconnectionAttempts: 5` - stops after 5 failed attempts
   - Impact: After 5 connection failures, frontend permanently disconnects
   - Behavior: User must refresh page to restore connection

3. **No Redis Connection State Recovery**
   - Issue: Backend Redis config has good initial retry strategies, but WebSocket gateway's subscriber doesn't recover from connection loss after initialization
   - Impact: If Redis goes down after successful initial connection, subscriptions don't automatically re-establish

4. **Backend Optimistic Timing Assumption**
   - Issue: 5-second delay assumes Redis will be ready, no fallback if it takes longer
   - Impact: Silent failure with warning log, no user-visible indication of degraded state

---

## Solution Implemented

### Backend Fixes (job-progress.gateway.ts)

#### 1. Added Connection State Tracking
```typescript
private isSubscribed = false;
private subscriptionRetryCount = 0;
private subscriptionRetryTimer?: NodeJS.Timeout;
```

#### 2. Redis Connection Event Monitoring
Added event listeners for:
- `connect` - Log successful connection
- `ready` - Trigger re-subscription if not subscribed
- `close` - Mark as not subscribed
- `reconnecting` - Log reconnection attempts

Key behavior: When Redis reconnects (`ready` event), automatically re-establish subscriptions if lost.

#### 3. Exponential Backoff Retry Logic
```typescript
private attemptRedisSubscription() {
  if (this.redisSubscriber.status !== 'ready') {
    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * Math.pow(2, this.subscriptionRetryCount), 30000);
    this.subscriptionRetryCount++;

    setTimeout(() => this.attemptRedisSubscription(), delay);
    return;
  }

  this.setupRedisSubscriptions();
}
```

**Retry Schedule:**
- Attempt 1: 1 second
- Attempt 2: 2 seconds
- Attempt 3: 4 seconds
- Attempt 4: 8 seconds
- Attempt 5+: 30 seconds (capped)
- Never stops trying

#### 4. Duplicate Subscription Prevention
```typescript
if (this.isSubscribed) {
  this.logger.warn('Already subscribed to Redis, skipping duplicate subscription');
  return;
}
```

#### 5. Cleanup on Shutdown
```typescript
async onModuleDestroy() {
  if (this.subscriptionRetryTimer) {
    clearTimeout(this.subscriptionRetryTimer);
  }
  // ... rest of cleanup
}
```

### Frontend Fixes (useJobProgress.ts)

#### 1. Infinite Reconnection Attempts
```typescript
reconnectionAttempts: Infinity, // Never give up reconnecting
reconnectionDelay: 1000, // Start with 1 second
reconnectionDelayMax: 10000, // Max 10 seconds between attempts
```

#### 2. Enhanced Connection Status Logging
Added handlers for:
- `reconnect_attempt` - Log each reconnection attempt number
- `reconnect` - Log successful reconnection after N attempts
- `reconnect_failed` - Log if all attempts exhausted (won't happen with Infinity)
- Enhanced `disconnect` - Log reason and reconnection strategy

**Console output examples:**
```
✅ WebSocket connected successfully
🔌 WebSocket disconnected: transport close
🔄 Connection lost. Attempting to reconnect...
🔄 Reconnection attempt #1...
🔄 Reconnection attempt #2...
✅ Successfully reconnected after 2 attempt(s)
```

### Redis Provider Fixes (redis.provider.ts)

#### Enhanced Connection Options
```typescript
enableOfflineQueue: true, // Queue commands while disconnected
enableReadyCheck: false, // Don't block on ready check
connectTimeout: 10000, // 10 second connection timeout
keepAlive: 30000, // Keep connection alive with 30 second pings
```

**Impact:**
- Commands queued during disconnection are executed when reconnected
- Faster connection establishment (no ready check blocking)
- Better connection health monitoring

---

## Testing Strategy

### Manual Testing Checklist

1. **Normal Operation**
   - [ ] Start backend with Redis running
   - [ ] Verify WebSocket connects: `📡 Subscribed to Redis pattern: job-events:*`
   - [ ] Verify frontend connects: `✅ WebSocket connected successfully`
   - [ ] Test job progress updates work

2. **Redis Down at Startup**
   - [ ] Stop Redis: `docker-compose stop redis`
   - [ ] Start backend
   - [ ] Verify retry logs appear with exponential backoff
   - [ ] Start Redis: `docker-compose start redis`
   - [ ] Verify automatic subscription: `🔄 Re-establishing Redis subscriptions after reconnect...`
   - [ ] Verify success: `📡 Subscribed to Redis pattern: job-events:*`
   - [ ] Test job progress updates work

3. **Redis Goes Down During Operation**
   - [ ] Start backend and frontend with Redis running
   - [ ] Verify both connected
   - [ ] Stop Redis: `docker-compose stop redis`
   - [ ] Verify frontend shows disconnection logs
   - [ ] Verify backend logs connection errors (throttled)
   - [ ] Start Redis: `docker-compose start redis`
   - [ ] Verify automatic reconnection on both sides
   - [ ] Test job progress updates work

4. **Docker Container Restart**
   - [ ] Full system running
   - [ ] Restart Redis container: `docker-compose restart redis`
   - [ ] Verify automatic recovery without backend restart
   - [ ] Test job progress updates work

5. **Long Disconnection**
   - [ ] Stop Redis for 5+ minutes
   - [ ] Verify retry logs continue (every 30 seconds after exponential backoff caps)
   - [ ] Verify frontend keeps trying (console logs)
   - [ ] Start Redis
   - [ ] Verify automatic recovery
   - [ ] Test job progress updates work

### Expected Behavior

**Before Fix:**
- ❌ Backend: One-time attempt, then silent failure
- ❌ Frontend: 5 reconnection attempts, then permanent disconnect
- ❌ Required: Manual backend restart + frontend page refresh

**After Fix:**
- ✅ Backend: Continuous retry with exponential backoff, automatic recovery
- ✅ Frontend: Infinite reconnection attempts, automatic recovery
- ✅ Required: Nothing - fully automatic recovery

---

## Files Modified

### Backend
1. `src/api/shared/job-progress.gateway.ts`
   - Added state tracking (isSubscribed, retryCount, retryTimer)
   - Added Redis connection event handlers
   - Implemented attemptRedisSubscription() with exponential backoff
   - Enhanced setupRedisSubscriptions() with retry logic
   - Added cleanup in onModuleDestroy()

2. `src/queues/config/redis.provider.ts`
   - Added enableOfflineQueue: true
   - Added keepAlive: 30000
   - Added connectTimeout: 10000
   - Added enableReadyCheck: false

### Frontend
1. `dashboard/src/hooks/useJobProgress.ts`
   - Changed reconnectionAttempts: 5 → Infinity
   - Added reconnectionDelayMax: 10000
   - Added handleReconnectAttempt handler
   - Added handleReconnect handler
   - Added handleReconnectFailed handler
   - Enhanced handleDisconnect logging
   - Registered new event handlers in effect

---

## Production Impact

### Resilience Improvements
- **Redis maintenance windows**: App survives Redis restarts without manual intervention
- **Transient network issues**: Automatic recovery from brief disconnections
- **Docker orchestration**: Survives container restarts and updates
- **Scaling operations**: Handles Redis failover scenarios

### Monitoring Indicators
- **Health**: Look for `📡 Subscribed to Redis pattern:` in logs
- **Issues**: Look for continuous retry logs (indicates Redis down)
- **Recovery**: Look for `🔄 Re-establishing Redis subscriptions after reconnect...`

### User Experience
- **Before**: Silent failure, broken real-time updates, requires refresh
- **After**: Automatic reconnection, transparent recovery, no user action needed

---

## Related Issues

- Original issue: Redis/Docker restart breaks WebSocket (permanent failure)
- Context.md entry: See "Recent Activity" for 2026-02-03
- Related: `.ai/context/JOB_THROTTLING_AUDIT.md` - Job system reliability

---

## Future Considerations

### Potential Enhancements
1. **Circuit Breaker Pattern**: Back off more aggressively if Redis consistently unavailable (20+ failures)
2. **Health Endpoint**: Expose WebSocket subscription status in `/health` endpoint
3. **Metrics**: Track reconnection frequency and duration for monitoring
4. **User Notification**: Show connection status indicator in UI (green/yellow/red dot)
5. **Fallback Mode**: Implement HTTP polling fallback for job status when WebSocket persistently down

### Not Implemented (Intentional)
- **Max retry cap**: Intentionally unlimited - prefer degraded service to complete failure
- **Alerting**: Should be added at monitoring layer, not application layer
- **Rate limiting retries**: 30-second cap is sufficient, more aggressive would delay recovery

---

**Last Updated:** 2026-02-03
**Tested:** Pending user verification
**Monitoring:** Watch for retry logs in production, should be rare after deployment
