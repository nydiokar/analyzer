# Frontend Cache Management Guide

**Last Updated:** October 31, 2025
**Status:** CRITICAL - Required reading for all frontend development

---

## Table of Contents

1. [Overview](#overview)
2. [SWR Cache Architecture](#swr-cache-architecture)
3. [Critical Limitations & Solutions](#critical-limitations--solutions)
4. [Cache Configuration](#cache-configuration)
5. [Cache Invalidation Patterns](#cache-invalidation-patterns)
6. [Troubleshooting Guide](#troubleshooting-guide)
7. [Best Practices](#best-practices)
8. [Common Pitfalls](#common-pitfalls)

---

## Overview

This application uses **SWR (stale-while-revalidate)** for client-side data fetching and caching. Understanding its behavior and limitations is **critical** to avoid UX issues like stale data, missing images, and skeleton loaders that never resolve.

### Why This Document Exists

**We've suffered from cache issues multiple times**, spending hours debugging why:
- Data doesn't refresh after analysis completes
- Images don't appear after enrichment
- Scope changes show old cached data
- Manual refresh button needed when it shouldn't be

**This document prevents those issues from recurring.**

---

## SWR Cache Architecture

### How SWR Works

```typescript
const { data, error, mutate } = useSWR(key, fetcher, options)
```

**Key Concepts:**

1. **Cache Key**: A unique identifier for the cached data (usually the API URL)
2. **Fetcher**: Function that fetches data from the API
3. **Mutate**: Function that triggers cache revalidation/refetch
4. **Options**: Configuration for cache behavior

### Cache Flow

```
User Action → SWR Checks Cache → Cache Hit?
  ├─ YES → Return cached data (instant)
  │         └─ Revalidate in background (if enabled)
  └─ NO  → Show loading state
            └─ Fetch from API → Cache result
```

---

## Critical Limitations & Solutions

### ⚠️ Limitation #1: Global Mutate with Filter Functions Doesn't Work

**Problem:**
```typescript
// ❌ This DOES NOT trigger refetch (SWR limitation)
await globalMutate(
  (key) => typeof key === 'string' && key.startsWith('/wallets/'),
  undefined,
  { revalidate: true }
);
```

**Why:** SWR's filter-based invalidation marks cache as stale but **doesn't force revalidation** unless `revalidateIfStale: true` AND component remounts or key changes.

**Solution:** Use **Direct Mutate Pattern**
```typescript
// ✅ Component exposes its mutate function to parent
const MyComponent = ({ onMutateReady }) => {
  const { data, mutate } = useSWR(key, fetcher);

  useEffect(() => {
    if (onMutateReady) {
      onMutateReady(mutate); // Pass mutate to parent
    }
  }, [onMutateReady, mutate]);
};

// ✅ Parent stores and calls mutate directly
const mutateRef = useRef(null);
await mutateRef.current(); // Guaranteed refetch!
```

**Implementation:** See `TokenPerformanceTab.tsx:735-744` and `WalletProfileLayout.tsx:252-262`

---

### ⚠️ Limitation #2: keepPreviousData Shows Stale Images/Data

**Problem:**
```typescript
// ❌ Shows old images when switching scopes
useSWR(key, fetcher, {
  keepPreviousData: true  // Keeps old data while fetching new
});
```

**Why:** When cache key changes (e.g., scope 7d → 1m), SWR shows previous scope's data while fetching, causing users to see old images.

**Solution:**
```typescript
// ✅ Show loading state instead of stale data
useSWR(key, fetcher, {
  keepPreviousData: false  // Clear data while fetching
});
```

---

### ⚠️ Limitation #3: Long dedupingInterval Blocks Refetch

**Problem:**
```typescript
// ❌ Blocks refetch for 5 minutes after enrichment
useSWR(key, fetcher, {
  dedupingInterval: 300000  // 5 minutes
});
```

**Why:** SWR deduplicates requests within this window, preventing cache updates even when data changes.

**Solution:**
```typescript
// ✅ Short interval allows post-enrichment updates
useSWR(key, fetcher, {
  dedupingInterval: 3000  // 3 seconds
});
```

---

### ⚠️ Limitation #4: revalidateIfStale: false Prevents Updates

**Problem:**
```typescript
// ❌ Never updates even when cache is stale
useSWR(key, fetcher, {
  revalidateIfStale: false
});
```

**Why:** Blocks automatic revalidation when cache is marked stale.

**Solution:**
```typescript
// ✅ Allow revalidation when cache is stale
useSWR(key, fetcher, {
  revalidateIfStale: true
});
```

---

## Cache Configuration

### Global Config (`dashboard/src/lib/swr-config.ts`)

```typescript
export const defaultSWRConfig: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: false,        // Don't refetch on tab focus
  revalidateOnReconnect: false,    // Don't refetch on network reconnect
  revalidateOnMount: true,         // DO refetch on component mount
  dedupingInterval: 5000,          // 5 sec - allow fast updates
  keepPreviousData: false,         // Show loading, not stale data
  revalidateIfStale: true,         // Allow stale cache updates
  refreshInterval: 0,              // No auto-refresh
  focusThrottleInterval: 60000,    // 1 min between focus revalidations
};
```

### Component-Level Overrides

**TokenPerformanceTab** (`dashboard/src/components/dashboard/TokenPerformanceTab.tsx:487-516`):

```typescript
useSWR(key, fetcher, {
  revalidateOnFocus: false,
  keepPreviousData: false,      // CRITICAL: Don't show stale images
  dedupingInterval: 3000,       // 3 sec for fast enrichment updates
  revalidateOnReconnect: false,
  revalidateIfStale: true,      // Allow cache updates
  onSuccess: (data) => {
    console.log('[TokenPerformance] ✅ Data received:', {
      tokenCount: data?.data?.length || 0,
      hasImages: data?.data?.filter(t => t.onchainImageUrl || t.imageUrl).length || 0,
    });
  },
});
```

---

## Cache Invalidation Patterns

### Pattern #1: Direct Mutate (Recommended)

**Use Case:** When parent needs to refresh child component's data

**Implementation:**

```typescript
// Child component
const ChildComponent = ({ onMutateReady }) => {
  const { data, mutate } = useSWR(key, fetcher);

  useEffect(() => {
    if (onMutateReady) {
      onMutateReady(mutate);
    }
  }, [onMutateReady, mutate]);

  return <div>{data}</div>;
};

// Parent component
const ParentComponent = () => {
  const childMutateRef = useRef(null);

  const handleDataUpdate = async () => {
    if (childMutateRef.current) {
      await childMutateRef.current(); // Direct refetch
    }
  };

  return (
    <ChildComponent
      onMutateReady={(mutate) => { childMutateRef.current = mutate; }}
    />
  );
};
```

**Advantages:**
- ✅ Guaranteed to trigger refetch
- ✅ No SWR limitations
- ✅ Fast and predictable

---

### Pattern #2: Local Mutate (Simple)

**Use Case:** Component refreshing its own data

**Implementation:**

```typescript
const MyComponent = () => {
  const { data, mutate } = useSWR(key, fetcher);

  const handleRefresh = async () => {
    await mutate(); // Refetch current key
  };

  return <button onClick={handleRefresh}>Refresh</button>;
};
```

---

### Pattern #3: Global Mutate with Specific Key (Works)

**Use Case:** Invalidating a single known cache key

**Implementation:**

```typescript
import { useSWRConfig } from 'swr';

const MyComponent = () => {
  const { mutate: globalMutate } = useSWRConfig();

  const handleInvalidate = async () => {
    // ✅ Works - specific key provided
    await globalMutate('/api/wallet/summary');
  };
};
```

---

### Pattern #4: Global Mutate with Filter (DOESN'T WORK)

**Use Case:** ❌ **AVOID** - Does not trigger refetch

**Implementation:**

```typescript
// ❌ DOES NOT WORK - Filter-based invalidation
const { mutate: globalMutate } = useSWRConfig();

await globalMutate(
  (key) => typeof key === 'string' && key.startsWith('/api/wallet/'),
  undefined,
  { revalidate: true }
);
```

**Why It Fails:** Marks cache as stale but doesn't force revalidation unless:
- Component remounts, OR
- Cache key changes, OR
- `revalidateIfStale: true` AND some other trigger fires

**Solution:** Use Pattern #1 (Direct Mutate) instead.

---

## Troubleshooting Guide

### Issue #1: Data Doesn't Refresh After Analysis

**Symptoms:**
- Analysis completes (WebSocket event received)
- Console shows "Cache invalidation complete"
- But NO `[TokenPerformance] 🔄 Fetching data:` log
- Skeleton loaders persist

**Diagnosis:**
```bash
# Check console logs - do you see?
[WalletProfile] ✅ Cache invalidation complete for flash
# But NO fetch after?
```

**Root Cause:** Using global mutate with filter (Pattern #4)

**Fix:** Switch to Direct Mutate (Pattern #1)
- See `WalletProfileLayout.tsx:432-443`
- See `TokenPerformanceTab.tsx:735-744`

---

### Issue #2: Images Don't Appear After Enrichment

**Symptoms:**
- Enrichment completes
- Database has `onchainImageUrl`
- Frontend shows no images or old images

**Diagnosis:**

1. **Check image priority:**
```typescript
// ❌ Wrong - only uses DexScreener CDN (403 errors)
<TokenBadge metadata={{ imageUrl: item.imageUrl }} />

// ✅ Correct - prioritizes onchainImageUrl
<TokenBadge metadata={{
  imageUrl: item.onchainImageUrl || item.imageUrl
}} />
```

2. **Check cache refresh:**
```bash
# Should see in console after enrichment:
[WalletProfile] 🎨 Enrichment complete - triggering TokenPerformance refetch
[TokenPerformance] 🔄 Parent-triggered refetch starting
[TokenPerformance] 🔄 Fetching data: ...
```

**Fix:**
1. Ensure image priority is correct (see `TokenPerformanceTab.tsx:118`)
2. Ensure enrichment callback triggers refetch (see `WalletProfileLayout.tsx:467-483`)

---

### Issue #3: Scope Changes Show Old Data

**Symptoms:**
- Click "1m" scope
- Table shows 7d data for few seconds
- Then shows 1m data

**Diagnosis:**
```typescript
// ❌ keepPreviousData: true causes this
useSWR(key, fetcher, {
  keepPreviousData: true
});
```

**Fix:**
```typescript
// ✅ Set keepPreviousData: false
useSWR(key, fetcher, {
  keepPreviousData: false
});
```

---

### Issue #4: Manual Refresh Required

**Symptoms:**
- Data in database is fresh
- Frontend doesn't update automatically
- Refresh button works

**Diagnosis:**

1. **Check dedupingInterval:**
```typescript
// ❌ Too long - blocks updates for 5 minutes
dedupingInterval: 300000
```

2. **Check revalidateIfStale:**
```typescript
// ❌ Blocks updates
revalidateIfStale: false
```

**Fix:**
```typescript
useSWR(key, fetcher, {
  dedupingInterval: 3000,      // 3 seconds
  revalidateIfStale: true,     // Allow updates
});
```

---

## Best Practices

### ✅ DO:

1. **Use Direct Mutate Pattern** for parent-child cache invalidation
2. **Keep `dedupingInterval` short** (3-5 seconds) for real-time updates
3. **Set `keepPreviousData: false`** to avoid showing stale data
4. **Set `revalidateIfStale: true`** to allow cache updates
5. **Log cache operations** for debugging:
   ```typescript
   onSuccess: (data) => console.log('[Component] Data received:', data),
   ```
6. **Prioritize `onchainImageUrl`** over `imageUrl` for images
7. **Include scope params in cache keys** (startDate, endDate)

### ❌ DON'T:

1. **Don't use global mutate with filters** - use Direct Mutate instead
2. **Don't set `dedupingInterval` > 10 seconds** - blocks updates
3. **Don't use `keepPreviousData: true`** for frequently changing data
4. **Don't set `revalidateIfStale: false`** - prevents updates
5. **Don't rely on automatic revalidation** - trigger explicitly
6. **Don't forget to expose mutate** when child needs parent invalidation
7. **Don't skip TypeScript types** for onchain fields

---

## Common Pitfalls

### Pitfall #1: Assuming Global Mutate Works

```typescript
// ❌ PITFALL: Expecting this to work
await globalMutate((key) => key.includes('wallet'));
// Component doesn't refetch!
```

**Why:** SWR filter-based invalidation has limitations

**Fix:** Use Direct Mutate Pattern

---

### Pitfall #2: Over-Optimizing Cache Duration

```typescript
// ❌ PITFALL: "Optimizing" by caching for 10 minutes
dedupingInterval: 600000  // 10 minutes
```

**Why:** Blocks updates after enrichment/analysis

**Fix:** Keep it short (3-5 seconds) - the backend handles load, not the cache duration

---

### Pitfall #3: Forgetting Cache Key Scope

```typescript
// ❌ PITFALL: Same key for different scopes
const key = `/wallets/${address}/token-performance`;
```

**Why:** Switching scopes doesn't trigger refetch (same key)

**Fix:** Include scope params in key
```typescript
const key = `/wallets/${address}/token-performance?startDate=${start}&endDate=${end}`;
```

---

### Pitfall #4: Missing Type Definitions

```typescript
// ❌ PITFALL: Using onchainImageUrl without type definition
item.onchainImageUrl  // TypeScript error!
```

**Why:** TypeScript interface missing onchain fields

**Fix:** Add to interface (see `dashboard/src/types/api.ts:169-179`)

---

## Implementation Checklist

When adding new data fetching:

- [ ] Define cache key with all relevant params
- [ ] Set `dedupingInterval: 3000` or similar short duration
- [ ] Set `keepPreviousData: false` if data changes frequently
- [ ] Set `revalidateIfStale: true`
- [ ] Add `onSuccess` logging for debugging
- [ ] If parent needs to invalidate: implement Direct Mutate Pattern
- [ ] Include scope/filter params in cache key
- [ ] Test cache behavior with console logs
- [ ] Verify refetch happens after data changes
- [ ] Test with network throttling

---

## References

### Key Files

- **Global Config:** `dashboard/src/lib/swr-config.ts`
- **TokenPerformanceTab:** `dashboard/src/components/dashboard/TokenPerformanceTab.tsx`
- **WalletProfileLayout:** `dashboard/src/components/layout/WalletProfileLayout.tsx`
- **API Types:** `dashboard/src/types/api.ts`

### External Resources

- [SWR Documentation](https://swr.vercel.app/)
- [SWR Mutation Guide](https://swr.vercel.app/docs/mutation)
- [SWR Advanced Patterns](https://swr.vercel.app/docs/advanced/cache)

---

## Changelog

### October 31, 2025
- **Initial version created** after recurring cache invalidation issues
- Documented Direct Mutate Pattern (fixes global mutate limitations)
- Added comprehensive troubleshooting guide
- Documented all cache pitfalls and solutions

---

## Need Help?

If you encounter cache issues:

1. **Check console logs** - Look for fetch/invalidation patterns
2. **Read this document** - Especially "Troubleshooting Guide"
3. **Use Direct Mutate Pattern** - When in doubt, use this approach
4. **Add logging** - `console.log` is your friend for cache debugging

**Remember:** Cache issues are subtle and time-consuming. This document exists to prevent wasting hours debugging the same problems repeatedly.
