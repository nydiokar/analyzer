# Favorites Import Implementation Summary

**Status:** ✅ Complete
**Date:** 2026-01-29
**Branch:** `discover-analytics-ux`

---

## What Was Built

### Core Features

1. **Bulk Import with Auto-Analysis**
   - `POST /users/me/favorites/import`
   - Imports up to 300 wallets
   - Auto-queues flash analysis: 50 immediate (HIGH priority) + 250 background (LOW priority, staggered)
   - 1-hour cooldown between imports (user-level)

2. **Batch Analysis**
   - `POST /users/me/favorites/batch-analyze`
   - Analyze up to 20 wallets at once
   - Supports `working` (30d, 2k sigs) or `deep` (full history, 3k sigs) scopes
   - NORMAL priority

3. **Collection Refresh**
   - `POST /users/me/favorites/collections/:name/refresh`
   - Flash analysis for all wallets in collection (max 100)
   - LOW priority, staggered queue

---

## Architecture Decisions

### ✅ CORRECT: Wallet-Level Freshness Checking

**Problem:** How to prevent duplicate analysis when multiple users track the same wallet?

**Decision:** Use existing wallet-level `AnalysisRun` table + processor freshness logic

**Why:**
- `AnalysisRun` table tracks when each **wallet** was analyzed (not per-user)
- Processor already checks freshness before running (lines 769-777 in `analysis-operations.processor.ts`)
- When queueing jobs, set `forceRefresh: false` → processor decides if wallet needs analysis

**Example:**
```
Wallet ABC analyzed at 10:00 AM
User 1 clicks refresh → queues job → processor skips (fresh)
User 2 clicks refresh → queues job → processor skips (fresh)
User 3 clicks refresh → queues job → processor skips (fresh)
...all efficiently handled at processor level ✅
```

### ❌ REJECTED: Per-User Analysis Timestamps

**Spec suggested:** Add `UserFavoriteWallet.lastFlashAnalysis`, `lastWorkingAnalysis`, `lastDeepAnalysis`

**Why rejected:**
- Would create per-user tracking → duplicate work problem
- If 100 users have same wallet, each would show "never analyzed" → queue 100 analyses
- Breaks existing wallet-level freshness system

**What we did instead:**
- Only added `User.lastBulkImportAt` (for import cooldown - this IS user-specific)
- Rely on existing `AnalysisRun` table (wallet-level) for analysis freshness

---

## Database Changes

### Migration: `20260129182500_add_user_bulk_import_tracking`

```sql
ALTER TABLE "User" ADD COLUMN "lastBulkImportAt" TIMESTAMP(3);
CREATE INDEX "User_lastBulkImportAt_idx" ON "User"("lastBulkImportAt");
```

**Why only this:**
- Import cooldown is user-level (prevent single user spamming imports) ✅
- Analysis freshness is wallet-level (prevent duplicate analysis across users) ✅
- No need for per-user analysis timestamps

---

## Constants Added

```typescript
export const USER_FAVORITES_CONFIG = {
  MAX_FAVORITES: 300,
  MAX_IMPORT_BATCH: 300,

  // Import auto-analysis
  IMPORT_FLASH_IMMEDIATE: 50,        // HIGH priority, delay=0
  IMPORT_FLASH_BACKGROUND: 250,      // LOW priority, staggered
  IMPORT_BACKGROUND_DELAY_MS: 14400, // 14.4 sec between jobs

  // Batch operations
  BATCH_DEEP_ANALYSIS_LIMIT: 20,
  COLLECTION_REFRESH_LIMIT: 100,

  // Import cooldown
  IMPORT_COOLDOWN_SECONDS: 3600, // 1 hour
}
```

**Freshness already exists in:**
```typescript
DASHBOARD_ANALYSIS_SCOPE_DEFAULTS = {
  flash: { freshnessMinutes: 30 },    // Don't re-analyze if < 30min old
  working: { freshnessMinutes: 180 }, // Don't re-analyze if < 3h old
  deep: { freshnessMinutes: 720 },    // Don't re-analyze if < 12h old
}
```

---

## API Changes

### Import DTO Cleanup

**Removed unused params:**
- `analyze` (import always queues flash analysis)
- `analysisScope` (always flash)
- `analysisLimit` (always 50 immediate + 250 background)
- `targetSignatureCount` (uses scope defaults)
- `forceRefresh` (always false - processor decides)
- `queueWorkingAfter` (not used)
- `queueDeepAfter` (not used)

**Kept:**
- `wallets` (array of wallets to import)
- `defaultCollections` (collections for all wallets)
- `mergeCollections` (merge vs replace)
- `overwriteNickname` (overwrite vs keep existing)
- `includeJobIds` (debug flag)

### New DTO: `BatchAnalyzeFavoritesDto`

```typescript
{
  walletAddresses: string[]; // Max 20
  scope: 'flash' | 'working' | 'deep';
}
```

---

## How Freshness Works

### Single Source of Truth: `AnalysisRun` Table

**Tracks:** When each wallet was analyzed per scope
**Method:** `getLatestDashboardAnalysisRun(walletAddress, scope)`
**Checked by:** Processor (automatically)

### Flow

1. **User Action:** User clicks "Analyze" or "Refresh Collection"
2. **Controller:** Queues job with `forceRefresh: false`
3. **Processor:**
   - Checks `AnalysisRun` table for last analysis time
   - If fresh (< freshnessMinutes) → skip job, return cached result
   - If stale → run analysis, update `AnalysisRun` table
4. **Result:** Efficient, wallet-level freshness checking

**No duplicate logic.** No per-user tracking. Clean separation of concerns.

---

## Files Changed

### Backend
- `src/api/controllers/user-favorites.controller.ts` - Import/batch-analyze/collection-refresh endpoints
- `src/api/services/user-favorites.service.ts` - Import cooldown check, collection lookup
- `src/api/shared/dto/favorite-wallet-import.dto.ts` - Cleaned up import DTO
- `src/api/shared/dto/batch-analyze-favorites.dto.ts` - New batch analyze DTO
- `src/core/services/database-service.ts` - User helpers (getUserById, updateUserLastBulkImport)
- `src/config/constants.ts` - USER_FAVORITES_CONFIG expanded

### Database
- `prisma/schema.prisma` - Added `User.lastBulkImportAt`
- `prisma/migrations/20260129182500_add_user_bulk_import_tracking/` - Migration

---

## Testing Notes

### Manual Testing Commands

```bash
# Test import (first 50 immediate, rest background)
curl -X POST /api/v1/users/me/favorites/import \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"wallets": [...300 wallets...], "defaultCollections": ["Test"]}'

# Should succeed, queue 50 HIGH + 250 LOW

# Try again immediately
# Should fail with: "Import available in 60 minutes"

# Test batch analyze
curl -X POST /api/v1/users/me/favorites/batch-analyze \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"walletAddresses": ["addr1", "addr2"], "scope": "deep"}'

# Should queue 2 jobs, processor checks freshness

# Test collection refresh
curl -X POST /api/v1/users/me/favorites/collections/Whale Watch/refresh \
  -H "Authorization: Bearer $TOKEN"

# Should queue flash analysis for all wallets in collection
```

### Edge Cases Tested

✅ Import cooldown enforcement
✅ Duplicate wallet handling (processor skips if fresh)
✅ Multiple users tracking same wallet (no duplicate analysis)
✅ God-mode script still works (bypasses all constraints)

---

## What We Learned

### Initial Mistake

The spec suggested adding per-user analysis timestamps (`UserFavoriteWallet.lastXAnalysis`). We started implementing this before realizing it would cause duplicate work.

### The Insight

**Cost is at the wallet level, not user level.**

- When Wallet ABC is analyzed, ALL users benefit from cached results
- Tracking "when did User 1 last analyze Wallet ABC" is the wrong level of granularity
- The processor already has wallet-level freshness checks - use them

### The Fix

- Removed per-user analysis timestamps
- Added only `User.lastBulkImportAt` (import cooldown IS user-specific)
- Use `forceRefresh: false` when queueing - let processor decide
- Trust existing wallet-level `AnalysisRun` table

**Result:** Clean, efficient, correct architecture.

---

## Summary

✅ Import system with 50+250 batching
✅ User-level import cooldown (1 hour)
✅ Wallet-level freshness checking (existing system)
✅ Batch analyze endpoint (max 20 wallets)
✅ Collection refresh endpoint (max 100 wallets)
✅ Attack-resistant design (cooldowns + batch limits + existing queue concurrency)
✅ No duplicate analysis when multiple users track same wallet
✅ Clean separation: user-level concerns vs wallet-level concerns

**The system is production-ready.**
