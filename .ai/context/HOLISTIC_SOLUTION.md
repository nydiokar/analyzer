# Holistic Solution: Import Tracking + Historical Mode Bug

**Date:** 2026-01-29
**Context:** User wants to finish tracked wallets wiring but has historical mode bug blocking visibility

---

## 🎯 Your Questions Answered

### Q1: "Do we need to create a whole job for favorites?"

**Answer: NO.** You don't need a new job type.

**Why:**
- Import already queues `dashboard-wallet-analysis` jobs (same as manual refresh)
- These jobs run, complete successfully, and emit WebSocket events
- The problem is **not the jobs** - it's two separate issues:
  1. Frontend doesn't subscribe to the job IDs
  2. Jobs complete but don't persist data (historical mode bug)

**Current Flow:**
```
Import → Queue 50+250 dashboard-wallet-analysis jobs
       → Jobs run on analysisOperationsQueue
       → Jobs emit job-progress, job-completed events
       → ❌ Frontend not listening (never subscribed)
       → ❌ Jobs skip persistence (historical mode bug)
```

---

### Q2: "If user is already subscribed to the user room, why aren't they receiving dashboard job completion?"

**Excellent question!** The user **IS** receiving the events.

**The Issue:** Frontend receives ALL events in the user room, but:

1. **`useJobProgress` only tracks jobs it knows about**
   ```typescript
   // In useJobProgress.ts:
   const trackedJobIds = useRef<Set<string>>(new Set());

   function subscribeToJob(jobId: string) {
     trackedJobIds.current.add(jobId);
     socket.emit('subscribe-job', { jobId });
   }

   // On job-completed:
   if (!trackedJobIds.current.has(data.jobId)) {
     return; // ← Ignores untracked jobs!
   }
   ```

2. **Import doesn't call `subscribeToJob()`**
   ```typescript
   // In trackers/page.tsx (import flow):
   const response = await fetcher('/users/me/favorites/import', {...});
   // ❌ Never calls subscribeToJob(response.analysisJobIds)
   // Result: Jobs are tracked in backend, but frontend ignores events
   ```

**Why This Design?**
- Prevents pollution: User may have 100s of jobs from different features
- Each component explicitly subscribes to jobs it cares about
- `useJobProgress` filters events by tracked job IDs

**Proof:**
```typescript
// WalletProfileLayout.tsx (lines 231-255):
const registerJobSubscription = useCallback(async (scope, jobId) => {
  jobIdToScopeRef.current[jobId] = scope;
  setScopeStates(prev => ({ ...prev, [scope]: { jobId, status: 'queued' } }));
  await subscribeToJob(jobId);  // ← Explicitly subscribes!
}, [subscribeToJob]);

// Then triggers analysis:
const response = await triggerDashboardScope('flash');
await registerJobSubscription('flash', response.jobId);  // ← Tracks it!
```

**Import flow is missing this step.**

---

### Q3: "Is what you're proposing the correct solution?"

**Answer: Yes, BUT there are two separate problems to solve.**

---

## 🔍 The Two Distinct Problems

### Problem #1: Frontend Doesn't Track Import Jobs (UX Issue)

**Symptom:**
- User imports wallets
- Jobs run silently in background
- User has no idea jobs are running/completing
- Even if data was saved, user wouldn't know when to refresh

**Root Cause:**
- Import endpoint returns `analysisJobIds` only if `includeJobIds: true`
- Frontend doesn't set this flag
- Even if it did, frontend doesn't subscribe to those job IDs

**Impact:**
- Poor UX (no visibility)
- User confusion ("Did it work?")
- But jobs DO complete successfully

---

### Problem #2: Jobs Don't Persist Data (Persistence Bug)

**Symptom:**
- Flash analysis completes
- Log shows: "Analysis completed for {wallet}: 500 transactions → 24 tokens"
- But then: "Historical/time-range analysis detected... skipping persistence"
- Frontend queries `WalletPnlSummary` → not found → shows "unanalyzed"

**Root Cause:**
```typescript
// Processor always sets timeRange for flash/working:
const timeRange = scope === 'deep' ? undefined : { startTs: ..., endTs: ... };

// PNL service treats ANY timeRange as historical:
const isHistoricalView = !!timeRange;
if (isHistoricalView) {
  // Skip saving WalletPnlSummary, AnalysisResult, FIFO lots
}
```

**Impact:**
- Analysis runs but data is lost
- Wallet appears "unanalyzed"
- Manual refresh works (triggers new job that somehow persists?)
  - **Actually:** Manual refresh might trigger deep scope or hit different code path

---

## ✅ Holistic Solution (Two-Phase Approach)

### Phase 1: Fix Frontend Tracking (Immediate - 30 min)

**This unblocks user visibility without touching the persistence bug.**

#### Step 1.1: Return Job IDs from Import

**File:** `src/api/controllers/user-favorites.controller.ts`

**Change:** Always return job IDs (remove conditional)

```typescript
// Line 214 - Remove the conditional check:
// OLD:
if (dto.includeJobIds) {
  jobs.forEach(job => {
    if (job.id) {
      jobIds.push(String(job.id));
    }
  });
}

// NEW: Always include (or make includeJobIds default to true)
jobs.forEach(job => {
  if (job.id) {
    jobIds.push(String(job.id));
  }
});
```

**Result:** Response always includes `analysisJobIds: string[]`

---

#### Step 1.2: Subscribe to Jobs in Frontend

**File:** `dashboard/src/app/trackers/page.tsx`

**Add after import completes:**

```typescript
// After line 541 (after mutateFavorites):
if (response.analysisJobIds?.length && subscribeToJob) {
  // Track import jobs for progress visibility
  setImportJobsInProgress(response.analysisJobIds);

  response.analysisJobIds.forEach(jobId => {
    subscribeToJob(jobId);
  });

  toast.info('Background Analysis', {
    description: `Analyzing ${response.analysisJobIds.length} wallets in background. You'll be notified when complete.`
  });
}
```

---

#### Step 1.3: Handle Job Completion

**File:** `dashboard/src/app/trackers/page.tsx`

**Add state and completion handler:**

```typescript
const [importJobsInProgress, setImportJobsInProgress] = useState<string[]>([]);

// Add to useJobProgress callbacks:
const jobProgressCallbacks = useMemo(() => ({
  onJobCompleted: (data) => {
    if (importJobsInProgress.includes(data.jobId)) {
      // Remove from tracking
      setImportJobsInProgress(prev => prev.filter(id => id !== data.jobId));

      // Refresh favorites list to show updated analysis state
      mutateFavorites();

      // Show completion toast
      if (importJobsInProgress.length === 1) {
        // Last job
        toast.success('All wallets analyzed!');
      }
    }
  },
  onJobFailed: (data) => {
    if (importJobsInProgress.includes(data.jobId)) {
      setImportJobsInProgress(prev => prev.filter(id => id !== data.jobId));
      toast.error('Analysis failed', {
        description: `Wallet analysis failed: ${data.error}`
      });
    }
  }
}), [importJobsInProgress, mutateFavorites]);

useJobProgress(jobProgressCallbacks);
```

---

#### Step 1.4: Show Progress Badge

**File:** `dashboard/src/app/trackers/page.tsx`

**Add progress indicator:**

```typescript
{importJobsInProgress.length > 0 && (
  <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
    <span className="text-sm text-blue-500">
      Analyzing {importJobsInProgress.length} wallet{importJobsInProgress.length > 1 ? 's' : ''}...
    </span>
  </div>
)}
```

**Result:** User sees real-time progress, knows when jobs complete.

---

### Phase 2: Fix Persistence Bug (Requires Deeper Changes - 2-4 hours)

**This actually saves the data so wallets show as "analyzed".**

#### Option A: Quick Fix (Bandaid - 30 min)

**Change the detection logic to distinguish dashboard scopes:**

**File:** `src/core/services/pnl-analysis-service.ts`

```typescript
// Line 155 - OLD:
const isHistoricalView = !!timeRange;

// NEW:
// Dashboard scopes (flash/working/deep) are progressive snapshots, NOT historical queries
// Only user-triggered custom time ranges (via TimeRangeSelector) are true historical views
const isDashboardScope = options?.isDashboardScope ?? false;
const isHistoricalView = !!timeRange && !isDashboardScope;
```

**File:** `src/queues/processors/analysis-operations.processor.ts`

```typescript
// Line 549 - Pass isDashboardScope flag:
const pnlResult = await this.pnlAnalysisService.analyzeWalletPnl(walletAddress, timeRange, {
  preFetchedBalances: balanceData,
  solPriceUsd,
  isDashboardScope: true,  // ← Add this flag
});
```

**Result:** Flash/working persist data even with timeRange set.

**Trade-offs:**
- ✅ Quick fix (30 min)
- ✅ Unblocks imports immediately
- ⚠️ Doesn't implement snapshot architecture
- ⚠️ FIFO lots might get overwritten incorrectly

---

#### Option B: Proper Fix (Period Keys + Snapshots - 4 hours)

**Cherry-pick from `pnl-balance-fixes` branch:**

1. **Period key utilities** - Uniquely identify analysis results
2. **Live balance overlay** - Show current holdings even if analysis old
3. **Frontend guards** - Detect stale responses
4. **Metadata in responses** - Track period info

**Then implement snapshot logic:**
- Dashboard scopes → save to canonical tables (WalletPnlSummary, AnalysisResult)
- Custom time ranges → view-only (don't persist)
- Keep FIFO lots only for deep/all-time analysis

**Result:** Complete, production-ready solution.

**Trade-offs:**
- ❌ Takes 4 hours
- ✅ Correct architecture
- ✅ Future-proof
- ✅ No data corruption risk

---

## 🎯 My Recommendation

**Do BOTH, but in sequence:**

### Immediate (Today - 1 hour total):
1. **Fix import tracking** (Phase 1 - 30 min)
   - Return job IDs
   - Subscribe in frontend
   - Show progress badge
   - Result: User sees jobs running

2. **Quick persistence fix** (Option A - 30 min)
   - Add `isDashboardScope` flag
   - Skip historical mode for dashboard scopes
   - Result: Data actually saves

**Combined Result:**
- ✅ User sees progress (Phase 1)
- ✅ Wallet shows as analyzed (Phase 2A)
- ✅ Import flow fully functional
- ✅ Can demo to users immediately

### Later (Next Session - 4 hours):
3. **Cherry-pick from `pnl-balance-fixes`** (Phase 2B)
   - Period key system
   - Live balance overlay
   - Frontend guards
   - Full snapshot architecture

**Result:**
- Production-ready, correct solution
- No data corruption
- Resilient to stale data

---

## 🔑 Key Insights

### Why Both Problems Matter:

1. **Without Phase 1:** Even if persistence works, user has no visibility
2. **Without Phase 2:** Even if user sees progress, data isn't saved

### Why They're Separate:

1. **Tracking = Frontend UX problem**
   - Jobs run correctly
   - Events are emitted
   - Frontend just doesn't listen

2. **Persistence = Backend Logic bug**
   - Wrong assumption: `timeRange` = historical query
   - Reality: Dashboard scopes are progressive snapshots
   - Fix: Distinguish dashboard vs custom time ranges

### Why Manual Refresh "Works":

**Theory:** When you manually click refresh, one of these happens:
1. It triggers a `deep` scope (which has `timeRange = undefined`)
2. Or it uses a different code path that bypasses historical check
3. Or the second attempt somehow works (race condition?)

**Need to investigate:** Why does manual refresh persist data?

---

## 📋 Action Plan

### Step 1: Fix Import Tracking (30 min)
- [ ] Update import controller to always return job IDs
- [ ] Add job subscription in trackers/page.tsx
- [ ] Add progress badge in UI
- [ ] Test: Import wallets, see progress badge
- [ ] Test: Wait for completion, see success toast

### Step 2: Quick Persistence Fix (30 min)
- [ ] Add `isDashboardScope` to PNL service options
- [ ] Pass flag from processor
- [ ] Change `isHistoricalView` logic
- [ ] Test: Import wallet, check WalletPnlSummary exists
- [ ] Test: Visit wallet profile, shows as analyzed

### Step 3: Validate Fix (15 min)
- [ ] Import fresh wallet
- [ ] Monitor logs: Should see "WalletPnlSummary saved"
- [ ] Visit wallet profile immediately
- [ ] Should show data (not "unanalyzed")

### Step 4: Document (15 min)
- [ ] Update CONTEXT.md with fix completion
- [ ] Add note about snapshot architecture for later
- [ ] Commit changes with proper message

**Total Time: ~1.5 hours**

---

## 🚨 Important Notes

### Don't Overthink the Fix:

The quick fix (Option A) is **correct** for dashboard scopes:
- Flash/working/deep ARE snapshots of current state
- They SHOULD persist to canonical tables
- FIFO lots update with each scope (flash → working → deep)
- This is the intended behavior

The only reason to implement full snapshot architecture is:
- Support user-triggered custom time ranges (TimeRangeSelector)
- Keep those separate from canonical state
- Avoid confusion between "7-day snapshot" vs "custom 7-day query"

**But for now:** Dashboard scopes should persist. That's the fix.

---

## 🎓 What We Learned from `pnl-balance-fixes`

### Good Ideas to Keep:
1. **Period keys** - Great for cache busting and stale detection
2. **Live balance overlay** - Always show current holdings
3. **Frontend guards** - Prevent displaying wrong data
4. **Metadata in responses** - Track analysis provenance

### What's Overkill for Now:
1. **Snapshot tables** - Not needed if dashboard scopes persist normally
2. **Complex snapshot routing** - Only needed for custom time ranges
3. **Separate snapshot read paths** - Can add later if needed

### The Insight:
**`pnl-balance-fixes` worked around the bug instead of fixing it.**

It made the frontend resilient to missing data by:
- Overlaying live balances (so UI shows current state)
- Detecting stale responses (so wrong data isn't shown)
- Auto-triggering re-analysis (to eventually get correct data)

**But it never fixed the root cause:** Flash/working shouldn't trigger historical mode.

---

**Bottom Line:** Fix the root cause first (1 hour), cherry-pick the workarounds later (optional enhancement).

