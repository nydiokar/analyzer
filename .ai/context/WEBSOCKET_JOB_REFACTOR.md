# WebSocket Job Propagation Refactor Plan

**Created**: 2025-12-17
**Status**: Planning
**Priority**: High (fixes race conditions, duplicate subscriptions, resource waste)

---

## Executive Summary

Current WebSocket architecture requires clients to subscribe to individual job IDs, causing race conditions on page load/refresh, duplicate subscriptions, and resource waste. This document outlines a refactor to user-scoped rooms for efficient, reliable job propagation.

**Goal**: Move from per-job subscriptions to user-scoped rooms with minimal changes to existing code.

---

## Current Architecture

### What We Have

**Backend** (`src/api/shared/job-progress.gateway.ts`):
- ✅ WebSocket gateway with Socket.IO
- ✅ Redis pub/sub for job events (`job-events:progress`, `job-events:completed`, `job-events:failed`, `job-events:queue-to-start`)
- ✅ Per-client subscription tracking: `Map<clientId, Set<jobId>>`
- ✅ Client subscribes via `subscribe-to-job` message with `jobId`
- ✅ Events broadcasted only to clients subscribed to that specific `jobId`

**Frontend** (`dashboard/src/hooks/useJobProgress.ts`):
- ✅ WebSocket client connects on mount
- ✅ Subscribes to individual jobs via `socket.emit('subscribe-to-job', { jobId })`
- ✅ HTTP polling fallback when WebSocket not connected (line 221)

**Job Creation** (`src/api/controllers/analyses.controller.ts`):
- ✅ User context available: `@Req() req: Request & { user?: User }`
- ❌ **Jobs do NOT store userId** - this is the key missing piece

### Current Flow

```
1. User triggers analysis → POST /analyses/wallets/dashboard-analysis
2. Backend creates BullMQ job → Returns jobId
3. Frontend navigates to /wallets/{address}?jobId={jobId}
4. useJobProgress mounts → Connects WebSocket
5. Frontend emits: socket.emit('subscribe-to-job', { jobId })
6. Backend adds jobId to client's subscription set
7. Job processor publishes to Redis: job-events:progress
8. Gateway receives Redis event → Broadcasts to subscribed clients
```

### Problems

1. **Race Condition**: Page loads before WebSocket connects → Falls back to HTTP polling → Admin-only error
2. **Duplicate Subscriptions**: Refresh = new client ID = re-subscribe to same jobs
3. **Resource Waste**: Each tab/refresh = new WebSocket connection
4. **No Persistence**: Lost subscriptions on disconnect/reconnect
5. **Manual Subscription**: Frontend must know jobId ahead of time
6. **Scaling Issues**: N clients × M jobs = N*M subscriptions to track

---

## Ideal State

### Architecture

**User-Scoped Rooms**:
- Each user gets a Socket.IO room: `user-{userId}`
- Backend emits job events to user's room (all tabs receive automatically)
- No per-job subscription needed - room membership handles it
- Reconnect = rejoin same room (automatic with Socket.IO rooms)

### Flow

```
1. User triggers analysis → POST /analyses/wallets/dashboard-analysis (user context in req)
2. Backend creates job WITH userId in job.data
3. Frontend connects WebSocket → Auto-joins user room
4. Job processor publishes to Redis WITH userId
5. Gateway emits to: server.to(`user-${userId}`).emit('job-completed', data)
6. All user's tabs receive event automatically
```

### Benefits

- ✅ No race conditions (room joined immediately on connect)
- ✅ No duplicate subscriptions (room-based, not job-based)
- ✅ Works across tabs/refreshes
- ✅ Scales better (N users vs N*M subscriptions)
- ✅ Simpler frontend (no manual subscribe/unsubscribe)
- ✅ Foundation for job history (query jobs by userId)

---

## What Needs to Happen

### Phase 1: Add userId to Jobs (Backend)

**Files to Modify**:
1. `src/queues/jobs/types.ts` - Add `userId?: string` to job data types
2. `src/api/controllers/analyses.controller.ts` - Extract `userId` from `req.user?.id` and add to job data
3. `src/api/controllers/jobs.controller.ts` - Same for any job submission endpoints

**Changes**:
```typescript
// In analyses.controller.ts (line 410)
const jobData: DashboardWalletAnalysisJobData = {
  walletAddress: dto.walletAddress,
  userId: req.user?.id, // ✅ ADD THIS
  requestId,
  analysisScope: scope,
  // ... rest of data
};
```

**Validation**: Ensure all job types that need userId get it added to their TypeScript interfaces.

---

### Phase 2: Modify Gateway to Use User Rooms (Backend)

**Files to Modify**:
1. `src/api/shared/job-progress.gateway.ts`

**Changes**:

#### 2.1: Add Room Join on Connection
```typescript
// Line 115 - handleConnection
handleConnection(client: Socket, @ConnectedSocket() socket: Socket) {
  const clientId = client.id;

  // Extract userId from socket handshake (passed from frontend)
  const userId = socket.handshake.auth?.userId;

  if (userId) {
    const userRoom = `user-${userId}`;
    socket.join(userRoom);
    this.logger.log(`Client ${clientId} joined room: ${userRoom}`);
  }

  // Keep existing subscription tracking for backward compatibility during migration
  this.clientSubscriptions.set(clientId, {
    jobIds: new Set(),
    userId // Store for reference
  });

  client.emit('connected', {
    message: 'Connected to job progress updates',
    clientId,
    userId,
    room: userId ? `user-${userId}` : null,
    timestamp: Date.now()
  });
}
```

#### 2.2: Update Broadcast Logic
```typescript
// Line 202 - broadcastToSubscribers
private broadcastToSubscribers(event: string, data: any, jobId?: string, queue?: string) {
  // NEW: Room-based broadcast (if job has userId)
  if (data.userId) {
    const userRoom = `user-${data.userId}`;
    this.server.to(userRoom).emit(event, data);
    this.logger.debug(`Broadcasted ${event} to room ${userRoom} for job ${jobId}`);
    return; // Early exit - room handles all tabs automatically
  }

  // FALLBACK: Legacy per-job subscription (backward compatibility)
  for (const [clientId, subscription] of this.clientSubscriptions) {
    if (jobId && subscription.jobIds.has(jobId)) {
      this.server.to(clientId).emit(event, data);
    }
  }
}
```

#### 2.3: Keep Legacy Subscribe Method (Backward Compatibility)
```typescript
// Lines 212-222 - Keep existing subscribe-to-job handler unchanged
// This allows gradual migration - old code continues to work
@SubscribeMessage('subscribe-to-job')
handleSubscribeToJob(@MessageBody() data: { jobId: string }, @ConnectedSocket() client: Socket) {
  // Existing logic - no changes needed for backward compatibility
}
```

---

### Phase 3: Update Job Publishers to Include userId (Backend)

**Files to Modify**:
1. All job processors that call `publishProgressEvent`, `publishCompletedEvent`, `publishFailedEvent`

**Example** (from any processor):
```typescript
// When publishing events, include userId from job.data
await this.jobProgressGateway.publishCompletedEvent(
  job.id,
  'analysis-operations',
  result,
  processingTime,
  totalTime,
  job.data.userId // ✅ ADD THIS PARAMETER
);
```

**Gateway Methods to Update**:
```typescript
// Line 241 - publishCompletedEvent signature
async publishCompletedEvent(
  jobId: string,
  queue: string,
  result: any,
  processingTime: number,
  totalTime?: number,
  userId?: string // ✅ ADD THIS
) {
  const event: JobCompletedEvent = {
    jobId,
    queue,
    result,
    processingTime,
    totalTime,
    userId, // ✅ ADD THIS
    timestamp: Date.now()
  };
  await this.redisPublisher.publish('job-events:completed', JSON.stringify(event));
}

// Repeat for publishProgressEvent, publishFailedEvent, publishQueueToStartEvent
```

---

### Phase 4: Update Frontend to Pass userId (Frontend)

**Files to Modify**:
1. `dashboard/src/hooks/useJobProgress.ts`

**Changes**:

#### 4.1: Pass userId in Socket Auth
```typescript
// Line ~70 - Socket initialization
useEffect(() => {
  if (!socketUrl) return;

  const newSocket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    auth: {
      userId: user?.id // ✅ ADD THIS (from useAuth hook)
    }
  });

  // ... rest of initialization
}, [socketUrl, user?.id]); // ✅ Add user?.id to deps
```

#### 4.2: Remove Manual Subscription (Optional - for simplicity)
```typescript
// Line 206 - subscribeToJob function
const subscribeToJob = useCallback(async (jobId: string) => {
  // SIMPLIFIED: No need to emit 'subscribe-to-job' anymore
  // Room membership handles everything automatically

  // Still check WebSocket connection for health
  if (!socket?.connected) {
    console.warn(`⚠️ WebSocket not connected for job ${jobId}. Attempting to reconnect...`);
    socket?.connect(); // Try to reconnect
  }

  // Remove HTTP fallback entirely (or keep for legacy jobs without userId)
  // Since room-based subscription happens automatically on connect
}, [socket]);
```

**Alternative (Keep Backward Compatibility)**:
```typescript
// Keep existing subscribe-to-job logic for gradual migration
// New jobs use rooms, old jobs use per-job subscription
const subscribeToJob = useCallback(async (jobId: string) => {
  if (socket?.connected) {
    // Still emit subscribe for backward compatibility
    socket.emit('subscribe-to-job', { jobId });
  } else {
    // Fallback unchanged
  }
}, [socket]);
```

---

## Implementation Strategy

### Recommended Approach: Gradual Migration

**Why Gradual?**
- Minimize risk (old code keeps working)
- Test each phase independently
- Rollback is easy

**Steps**:

1. **Phase 1 (Backend)**: Add `userId` to all job data structures
   - ✅ Safe: Additive change, no breaking changes
   - ✅ Test: Verify jobs contain userId in Redis/BullMQ dashboard

2. **Phase 2 (Backend)**: Add room join logic to gateway
   - ✅ Safe: Falls back to legacy subscription if no userId
   - ✅ Test: Verify clients join rooms, events broadcast to rooms

3. **Phase 3 (Backend)**: Update job publishers to include userId
   - ✅ Safe: userId is optional, existing publishers work
   - ✅ Test: Verify Redis events contain userId

4. **Phase 4 (Frontend)**: Pass userId in socket auth
   - ✅ Safe: Backend handles both old and new clients
   - ✅ Test: Verify room join, automatic job updates

5. **Cleanup (Later)**: Remove legacy per-job subscription after confirming room-based works
   - Remove `subscribe-to-job` / `unsubscribe-from-job` handlers
   - Remove `clientSubscriptions` Map
   - Simplify frontend subscribeToJob function

---

## Testing Plan

### Phase 1 Testing (userId in Jobs)
- Create job via API
- Check BullMQ dashboard → Verify `job.data.userId` exists
- Check Redis → `HGETALL bull:analysis-operations:{jobId}` → Verify userId in data

### Phase 2 Testing (Room Join)
- Connect WebSocket with userId in auth
- Check server logs → "Client {id} joined room: user-{userId}"
- Trigger job → Check if event broadcasts to room

### Phase 3 Testing (Publisher Updates)
- Trigger job → Check Redis messages contain userId
- Verify Redis pub/sub: `SUBSCRIBE job-events:completed` → Check message has `userId`

### Phase 4 Testing (Frontend)
- Open 2 tabs
- Trigger job in tab 1
- Verify tab 2 receives updates automatically (same user room)
- Refresh tab 1 → Verify reconnects and still receives updates
- Test with WebSocket disconnected → Verify HTTP fallback works (or remove it)

### Integration Testing
- Trigger job via "Import & Analyze" button
- Refresh page immediately after
- Verify: Job updates appear without "Admin access required" error
- Verify: Both tabs receive updates

---

## Estimated Effort

**Phase 1 (userId in Jobs)**: 1-2 hours
- Update TypeScript interfaces
- Add userId extraction in controllers
- Test job creation

**Phase 2 (Gateway Rooms)**: 2-3 hours
- Add room join logic
- Update broadcast function
- Test room behavior

**Phase 3 (Publisher Updates)**: 2-3 hours
- Find all publishers (grep for `publishProgressEvent` etc.)
- Update signatures and calls
- Test Redis messages

**Phase 4 (Frontend)**: 1-2 hours
- Update useJobProgress hook
- Test room-based subscription
- Verify backward compatibility

**Testing & Validation**: 2-3 hours
- End-to-end testing
- Multi-tab testing
- Refresh/reconnect testing

**Total**: 8-13 hours (1-2 days)

---

## Risks & Mitigations

**Risk 1**: Breaking existing job subscriptions
- **Mitigation**: Keep backward compatibility (fallback to per-job subscription if no userId)

**Risk 2**: WebSocket rooms not scaling
- **Mitigation**: Socket.IO rooms are built for this (Redis adapter available for multi-server scaling)

**Risk 3**: Users seeing other users' jobs
- **Mitigation**: Strict userId validation, each room is isolated by userId

**Risk 4**: Old jobs without userId
- **Mitigation**: Graceful degradation - gateway checks for userId, falls back to per-job subscription

---

## Future Enhancements

Once room-based subscription is working:

1. **Job History Page**: Query BullMQ jobs by userId (no need for separate DB table)
2. **Job Persistence**: Store completed job IDs in Redis with TTL for "recent jobs" list
3. **Multi-Server Scaling**: Add Redis adapter for Socket.IO to share rooms across servers
4. **Job Filtering**: Frontend can filter which jobs to display (all received via room)
5. **Notifications**: Easy to add toast notifications for all job events (room = single listener)

---

## Success Criteria

✅ No "Admin access required" errors
✅ Job updates work on page refresh
✅ Job updates work across multiple tabs
✅ No duplicate subscriptions
✅ WebSocket connects reliably on page load
✅ HTTP fallback no longer needed (or works correctly)
✅ Existing functionality preserved during migration

---

## Decision: Execute on Current Branch?

**Recommendation**: **Create separate branch** for this refactor.

**Why?**
- `pretty` branch is for design system work
- This is architectural/infrastructure work
- Easier to test and rollback independently
- Can merge after design work is done

**Suggested Branch**: `refactor/websocket-user-rooms` or `feat/job-propagation-refactor`

**After Refactor**: Merge into `main` (or `pretty` if needed for design features)

---

## Next Steps

1. Review this plan with team
2. Decide: Same branch or new branch?
3. If new branch: Create from current `pretty` branch state
4. Start Phase 1: Add userId to jobs
5. Test incrementally after each phase
6. Document any deviations from this plan
