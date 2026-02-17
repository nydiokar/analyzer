# Similarity Job Flow — Efficiency Improvements (Next Sprint)

**Created:** 2026-02-16
**Status:** Planned
**Priority:** P2 — Performance optimization (not blocking, but wasteful)

---

## Context

The similarity job stores its large result payload in Redis (`similarity:result:{requestId}`, 15min TTL) and returns only a pointer (`{ resultKey }`) as BullMQ job returnvalue. The frontend must then "hydrate" this pointer by making an HTTP round-trip to fetch the actual data.

This works, but introduces unnecessary latency and round-trips.

---

## Issue 1: Double Redis Read on Hydration

**Current flow (after Feb 16 fixes):**
1. Frontend receives WebSocket `job-completed` with `result.data.resultKey`
2. Frontend calls `GET /jobs/{jobId}/result` (HTTP round-trip)
3. Backend `getJobResult()` reads `job.returnvalue` from BullMQ Redis (Redis read #1)
4. Extracts `resultKey` from returnvalue
5. Reads similarity data from Redis using `resultKey` (Redis read #2)
6. Returns to frontend

**Proposed fix — dedicated lightweight endpoint:**

```
GET /jobs/{jobId}/similarity-result?key=similarity:result:{requestId}
```

- Frontend already HAS the resultKey from the WebSocket event
- New endpoint does a single Redis `GET` using the provided key
- Skips the BullMQ job lookup entirely (Redis read #1 eliminated)
- Validates the key format server-side to prevent arbitrary Redis access

**Impact:** Eliminates 1 Redis read + BullMQ job deserialization per similarity completion.

---

## Issue 2: Holder Profiles Blasts Full Payload Through WebSocket

**Current:** The holder profiles processor returns the full `HolderProfilesResult` (10+ wallet profiles, ~50-200KB) as BullMQ `returnvalue`. This entire payload:
- Gets stored in BullMQ Redis
- Gets parsed by the bridge service
- Gets published to Redis pub/sub as JSON
- Gets broadcast via WebSocket to the frontend

**Proposed fix — mirror the similarity pointer pattern:**

1. Processor stores result in Redis with a short TTL key (e.g., `holder-profiles:result:{jobId}`)
2. Returns only `{ resultKey, success, metadata }` as BullMQ returnvalue (~200 bytes)
3. Frontend detects the pointer and hydrates via HTTP (same pattern as similarity)

**Impact:** ~99% reduction in WebSocket payload size for holder profiles. Prevents potential WebSocket frame fragmentation on slower connections.

**Consideration:** The existing progressive streaming (via `job.updateProgress()` with partial profiles) would continue to work unchanged — only the final completion event gets the pointer treatment.

---

## Issue 3: 15-Minute TTL Expiration Risk

**Current:** Similarity results stored with `resultTtlSeconds = 15 * 60`. If the user doesn't view results within 15 minutes:
- Hydration fails silently
- Frontend shows "completed without usable payload"
- No recovery path

**Proposed fix:**
- Increase TTL to 1 hour (similarity jobs are expensive, users may come back)
- Add fallback: if Redis key expired, try `job.returnvalue` (BullMQ keeps it longer)
- Frontend: show "Results expired, re-run analysis" instead of cryptic warning

---

## Issue 4: HTTP Fallback Has No Retry Polling

**Current:** When `subscribeToJob` runs and WebSocket is disconnected:
1. Single HTTP poll to `GET /jobs/{jobId}`
2. If job is still active: warns and gives up — **no further polling**
3. User sees no updates until page refresh

**This was the primary trigger for the "without usable payload" bug** — the HTTP fallback ran before WebSocket reconnected, picked up a completed job, and had no hydration logic.

**Fixed in Feb 16:** Added hydration to `handleJobCompletedFromHttp`.

**Further improvement (optional):**
- Add a simple retry poll (3 attempts, 2s interval) when job is active and WebSocket is down
- Or: don't HTTP-fallback at all — just wait for WebSocket reconnection (it's configured with `reconnectionAttempts: Infinity`)

---

## Summary of Feb 16 Fixes (Already Applied)

| Fix | File | Issue |
|:----|:-----|:------|
| Parse BullMQ `returnvalue` string → object | `job-events-bridge.service.ts` | WebSocket was broadcasting JSON string instead of object |
| Add hydration to HTTP fallback path | `useJobProgress.ts` (`handleJobCompletedFromHttp`) | HTTP fallback didn't resolve similarity Redis pointers |
| Convert `completedJobs` from state → ref | `useJobProgress.ts` | **Socket recreation on every job completion** — `completedJobs` in useEffect deps caused full socket teardown/rebuild, triggering the WebSocket disconnect that forced the HTTP fallback |

The root cause chain: `completedJobs` state change → useEffect re-run → socket.disconnect() → new socket created → brief disconnection window → similarity subscribeToJob hits disconnected socket → HTTP fallback → no hydration → "without usable payload".

---

## Issue 5: Duplicate "[Primary Filtered]" Logging (Not Actually Duplicate Work)

**Observation:** Backend logs show the full "[Primary Filtered] Wallet X: N actively traded tokens" listing **twice** for every similarity job.

**Cause:** `SimilarityApiService.runAnalysis()` calls `calculateWalletSimilarityFromTransactions` twice — once for `binary`, once for `capital` (lines 85-96 in `similarity.service.ts`). Each call runs the "[Primary Filtered]" section which filters tokens and logs per-wallet stats.

**What IS memoized (runs once):**
- `analyzeSharedTokensInternal` — shared token identification
- `calculateWalletPairCounts` — pair counts matrix
- `getAnalysisResults` DB query — the expensive batch query for all wallets

**What runs twice (vectorType-dependent):**
- `getAllRelevantMints(transactionData, vectorType)` — different mints per type
- Token filtering: binary uses 453 tokens, capital uses 429 (different universes)
- Per-wallet "[Primary Filtered]" logging — same data but logs twice
- Vector creation: `createBinaryTokenVectors` vs `createCapitalAllocationVectors`

**Verdict:** The duplicate logs are misleading but the work is NOT fully duplicated — the DB query and shared-token analysis are memoized. The filtering and vector creation genuinely differ per type. However, the per-wallet filtering logs (lines 154-158, 178-186) print identical "actively traded tokens (paid fees)" counts both times because that's wallet-level, not vectorType-dependent.

**Proposed fix:**
- Move the per-wallet active-token logging into the memoized section (run once)
- Only log the vectorType-specific filtering (`"Filtered from X to Y tokens for binary/capital"`) in the per-type section
- Reduces log noise by ~50% for 9-wallet jobs (18 redundant lines eliminated)
