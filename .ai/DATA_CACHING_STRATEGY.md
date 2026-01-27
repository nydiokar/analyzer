# Data Caching & Persistence Strategy

## Problem Statement

Components were regressing into skeleton states after prolonged inactivity or tab switching, particularly:
1. **AccountSummaryCard** (Wallet Profile) - turning into skeleton after 20 minutes
2. **TokenHolderPicker** (Similarity Lab) - losing holder list after 10 minutes
3. **GlobalMetricsCard** (Similarity Lab) - losing total value display over time

## Root Cause Analysis

### The Cache Expiration Cascade

```
Time 0:00  → User loads page → Data fetched → Cache populated
Time 10:00 → Cache TTL expires → get() returns undefined
           → SWR sees undefined + keepPreviousData=false
           → Shows skeleton loader
           → revalidateIfStale=true triggers refetch
           → BUT if window is inactive/background...
           → Request throttled by browser
           → Skeleton persists until tab is active again
```

**Key findings:**
1. `AppCacheProvider` automatically expires and deletes data based on TTL
2. `keepPreviousData: false` in SWR config forced skeleton display instead of showing cached data
3. `revalidateOnFocus: false` prevented automatic refresh when user returned to tab
4. No localStorage persistence for critical state like `analysisResult`

## Solution: Differentiated Caching Strategy

### Philosophy

Different data types have different refresh requirements:

| Data Type | Update Frequency | User Expectation | Strategy |
|-----------|------------------|------------------|----------|
| **Wallet Summary** | Only on new trades + re-analysis | See latest from DB | Stable cache + manual refresh |
| **Token Holders** | Changes slowly (hours/days) | Consistent during analysis | Per-token freeze + manual refresh |
| **Analysis Results** | User-generated, one-time | Never lose work | localStorage persistence |

### Implementation

#### 1. Global SWR Config: Conservative Defaults

**File**: `dashboard/src/lib/swr-config.ts`

```typescript
export const defaultSWRConfig: SWRConfiguration = {
  fetcher,
  revalidateOnFocus: false,     // ← Keep false by default (opt-in per hook)
  revalidateOnReconnect: false,
  revalidateOnMount: true,
  dedupingInterval: 5000,
  keepPreviousData: true,       // ← CRITICAL: Changed from false - prevents skeleton after initial load
  revalidateIfStale: true,
  shouldRetryOnError: (error) => {
    if (error?.status >= 400 && error?.status < 500) return false;
    return true;
  },
  errorRetryCount: 1,
  errorRetryInterval: 2000,
  refreshInterval: 0,
  focusThrottleInterval: 60000,
};

// Preset configs for different data refresh strategies
export const swrPresets = {
  // For data that rarely changes (wallet summary, historical analysis)
  stable: {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000, // 1 minute
  },

  // For data that changes frequently (prices, live balances)
  dynamic: {
    revalidateOnFocus: true,
    focusThrottleInterval: 30000, // 30 seconds
    dedupingInterval: 10000, // 10 seconds
  },

  // For user-initiated queries (search, holders)
  onDemand: {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 300000, // 5 minutes - only refresh on explicit user action
  },
};
```

**Key change**: `keepPreviousData: true` ensures components show last known data instead of skeleton state.

---

#### 2. WalletSummary: Stable Cache + Event-Driven Refresh

**File**: `dashboard/src/components/layout/WalletProfileLayout.tsx`

**Current behavior** (line 566-577):
```typescript
const { data: walletSummary, error: summaryError } = useSWR<WalletSummaryData>(
  walletSummaryKey,
  fetcher,
  {
    refreshInterval: 0,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  }
);
```

**Update to**:
```typescript
const { data: walletSummary, error: summaryError } = useSWR<WalletSummaryData>(
  walletSummaryKey,
  fetcher,
  {
    ...swrPresets.stable,  // Use stable preset
    // Refresh happens via globalMutate() after job completion (line 444)
  }
);
```

**Why this works:**
- ✅ `keepPreviousData: true` (from global config) prevents skeleton
- ✅ Shows DB data immediately (doesn't change unless user trades or re-analysis runs)
- ✅ When analysis job completes → `globalMutate()` at line 444 explicitly refreshes
- ✅ No unnecessary auto-refreshes

---

#### 3. Token Holders: Per-Token Freeze Strategy

**File**: `dashboard/src/hooks/useTopHolders.ts`

**Problem**: Auto-refresh during user workflow causes flickering and selection loss.

**Scenario to avoid:**
```
t=0:00  → User loads token XYZ, selects holders #5, #12, #23
t=1:00  → Cache expires → auto-refetch → ranks shift → selections break!
```

**Solution**: Cache indefinitely per token, refresh only on token change or manual action.

**Current code** (line 55-68):
```typescript
export function useTopHolders(mint?: string, commitment?: 'finalized' | 'confirmed' | 'processed') {
  const key = mint ? `/token-info/${mint}/top-holders${commitment ? `?commitment=${commitment}` : ''}` : null;
  const { data, error, isLoading, mutate } = useSWR<TopHoldersResponse>(
    key,
    fetcher,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
  return { data, error, isLoading, refresh: mutate };
}
```

**Update to**:
```typescript
export function useTopHolders(mint?: string, commitment?: 'finalized' | 'confirmed' | 'processed') {
  const key = mint ? `/token-info/${mint}/top-holders${commitment ? `?commitment=${commitment}` : ''}` : null;

  const { data, error, isLoading, mutate } = useSWR<TopHoldersResponse>(
    key,
    fetcher,
    {
      revalidateOnFocus: false,      // Don't auto-refresh on tab focus
      revalidateOnReconnect: false,  // Don't auto-refresh on reconnect
      revalidateOnMount: false,      // Only fetch if not already cached
      dedupingInterval: Infinity,    // Cache forever per token
      // When mint changes → key changes → fresh fetch automatically
    }
  );

  return { data, error, isLoading, refresh: mutate };
}
```

**Why `dedupingInterval: Infinity` is safe:**
- When user changes token → SWR key changes → automatic fresh fetch
- No stale data risk because cache is per-token
- Prevents mid-workflow data changes

---

#### 4. Token Holder Picker: Add Manual Refresh Control

**File**: `dashboard/src/components/similarity-lab/TokenHolderPicker.tsx`

**Add manual refresh button** (after line 104):

```typescript
import { RefreshCw } from 'lucide-react';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export function TokenHolderPicker({ ... }: TokenHolderPickerProps) {
  const { data: holdersData, isLoading, refresh } = useTopHolders(tokenMint, 'finalized');

  // ... existing code ...

  return (
    <div className="flex flex-col space-y-2 max-h-[400px] w-full min-w-0">
      <div className="space-y-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedAddresses.length} / {holders.length}
          </span>
          <div className="flex items-center gap-1">
            {onTrackSelected && (
              <Button variant="outline" size="sm" onClick={onTrackSelected} disabled={selectedAddresses.length === 0} className="h-6 text-xs px-2">
                <Bookmark className="h-3 w-3 mr-1" />
                Track selected
              </Button>
            )}

            {/* ADD: Manual refresh button */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => refresh()}
                    className="h-6 px-2"
                    disabled={isLoading}
                  >
                    <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh holder list</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Button variant="ghost" size="sm" onClick={selectAll} className="h-6 text-xs px-2">All</Button>
            <Button variant="ghost" size="sm" onClick={clearAll} className="h-6 text-xs px-2">Clear</Button>
          </div>
        </div>
      </div>
      {/* ... rest of component ... */}
    </div>
  );
}
```

**User control:**
- ✅ Holder list stays frozen during analysis
- ✅ User can explicitly refresh when needed
- ✅ No surprise data changes

---

#### 5. Analysis Results: localStorage Persistence

**File**: `dashboard/src/app/similarity-lab/page.tsx`

**Problem**: `analysisResult` state is loaded from localStorage (line 366-382) but never saved back.

**Current code**:
```typescript
// Line 49: State definition
const [analysisResult, setAnalysisResult] = useState<CombinedSimilarityResult | null>(null);

// Line 366-382: Load on mount ✅
useEffect(() => {
  try {
    const savedResult = localStorage.getItem('analysisResult');
    if (savedResult) {
      const parsedResult = JSON.parse(savedResult);
      setAnalysisResult(parsedResult);
    }
  } catch (error) {
    console.error("Failed to parse analysis result from localStorage", error);
    localStorage.removeItem('analysisResult');
  }
}, []);
```

**Add save effect** (after line 382):
```typescript
// Save analysisResult to localStorage whenever it changes
useEffect(() => {
  if (analysisResult) {
    try {
      localStorage.setItem('analysisResult', JSON.stringify(analysisResult));
    } catch (e) {
      console.warn('Failed to save analysis result:', e);
    }
  }
}, [analysisResult]);
```

**Triggers**:
- ✅ Analysis completes → `setAnalysisResult(data)` (line 235) → save effect runs
- ✅ Enrichment completes → `setAnalysisResult(prev => ...)` (line 332-341) → save effect runs
- ✅ User refreshes page → load effect runs → state restored
- ✅ User switches tabs → state persists in memory AND localStorage

---

## Summary of Changes

| File | Line | Change | Impact |
|------|------|--------|--------|
| `swr-config.ts` | 35 | `keepPreviousData: false` → `true` | Prevents skeleton regressions globally |
| `swr-config.ts` | 31 | Add `swrPresets` object | Allows per-hook caching strategy |
| `WalletProfileLayout.tsx` | 569 | Use `...swrPresets.stable` | Explicit caching strategy for wallet summary |
| `useTopHolders.ts` | 60 | Add `dedupingInterval: Infinity` | Freezes holder list per token |
| `useTopHolders.ts` | 59 | Add `revalidateOnMount: false` | Only fetch if not cached |
| `TokenHolderPicker.tsx` | ~110 | Add refresh button with icon | User control over holder refresh |
| `similarity-lab/page.tsx` | ~383 | Add save effect for `analysisResult` | Persist across sessions |

---

## Expected Behavior After Changes

### Wallet Profile Page
```
User loads page → Sees account summary immediately (from DB cache)
User switches tabs for 30 minutes → Returns → Still sees summary (keepPreviousData)
Analysis job completes → globalMutate() refreshes → New data appears
```

### Similarity Lab - Token Holders
```
User enters token mint → Fetches holders → Cached indefinitely
User selects holders #5, #12, #23 → Starts analysis
[10 minutes pass] → Holder list stays frozen (no flickering)
User changes token mint → New cache key → Fresh fetch automatically
User clicks refresh button → Manual refresh → Latest holders
```

### Similarity Lab - Analysis Results
```
User runs analysis → Results displayed
User closes tab → Results saved to localStorage
User opens tab next day → Results restored from localStorage
Enrichment completes → Results updated → Saved to localStorage
```

---

## Testing Checklist

- [ ] Load wallet profile → Wait 25 minutes → Verify no skeleton appears
- [ ] Switch tabs → Wait 15 minutes → Return → Verify data persists
- [ ] Load token holders → Select some → Wait 10 minutes → Verify selections don't break
- [ ] Run similarity analysis → Close tab → Reopen → Verify results restored
- [ ] Change token mint → Verify fresh holder list fetched
- [ ] Click holder refresh button → Verify manual refresh works

---

## Design Principles

1. **Never show skeleton after initial load** - `keepPreviousData: true` globally
2. **Per-data-type refresh strategy** - Use `swrPresets` for explicit control
3. **User control over refreshes** - Add manual refresh buttons where needed
4. **Persist user work** - localStorage for analysis results
5. **Freeze during workflow** - Don't change data mid-analysis (token holders)

---

## Future Considerations

If we need real-time price updates in the future:
- Add WebSocket subscriptions for live price feeds
- Use separate state for prices vs. holder lists
- Update prices without disrupting holder selections

For now, this strategy provides:
- ✅ No skeleton regressions
- ✅ No unexpected data changes
- ✅ No unnecessary API spam
- ✅ Simple, predictable behavior
