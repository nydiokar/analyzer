# Holder Profiles Snapshot History — Implementation Plan

**Date:** 2026-03-24
**Branch:** `feature/holder-profile-snapshot-history`
**Scope:** Token-mode only (wallet-mode history is per-wallet, less useful as a grouped timeline)

---

## Problem Statement

Every time a user runs "Holder Profiles" for a token, the results are computed fresh
(with caching for freshness). The UX today replaces the current view with new results.
Users want to compare *previous checks* — "how was this token's holder composition
3 days ago vs. today?" — without losing the current view.

---

## Root Cause Analysis

### Critical gap discovered during research:
Token-mode jobs **never call `saveSnapshot()`** — only wallet-mode individual jobs do
(in `processAnalyzeHolderProfilesWallet`). The `HolderProfileSnapshot` table has
per-wallet rows, but they are only populated during wallet-mode runs, not token runs.

This means: **we must first start saving token-mode snapshots**, then build the
history API on top of them.

---

## Architecture

### Data Model (existing, no migration needed)

```
HolderProfileSnapshot {
  id            Int       (autoincrement PK)
  walletAddress String    (FK → Wallet)
  tokenMint     String?   (set for token-mode, null for wallet-mode)
  analysisMode  String    ('token' | 'wallet')
  holderRank    Int?
  supplyPercent Float?
  topN          Int?
  jobId         String?   ← KEY: groups all wallets in a single run
  requestId     String?
  computedAt    DateTime  @default(now())
  profile       Json      (full HolderProfile blob)
  metadata      Json?

  @@index([tokenMint, computedAt])
  @@index([walletAddress, tokenMint, computedAt])
}
```

A "snapshot run" = all rows sharing the same `jobId` for a given `tokenMint`.
The orchestration job ID (`job.id` in `processAnalyzeHolderProfiles`) is the
natural grouping key.

---

## Changes Required

### 1. Backend — Processor: Save token-mode snapshots

**File:** `src/queues/processors/analysis-operations.processor.ts`

After `cacheTokenResult` (line ~1639), save each profile as a snapshot row
with the orchestration `job.id` as `jobId`:

```typescript
// Save snapshot for history (token-mode)
if (!tokenCacheOnly) {  // Only persist "real" runs, skip pure-cache hits
  await Promise.allSettled(
    hydratedFinalProfiles.map((profile) =>
      this.holderProfilesCacheService.saveSnapshot({
        walletAddress: profile.walletAddress,
        tokenMint,
        analysisMode: 'token',
        holderRank: profile.rank,
        supplyPercent: profile.supplyPercent,
        topN,
        jobId: job.id?.toString() ?? null,
        requestId: job.data.requestId,
        profile,
        metadata: { mode: 'token', topN },
      })
    )
  );
}
```

**Why `!tokenCacheOnly`**: Cache-only runs (all wallets served from Tier-2 snapshot
cache) should NOT create new snapshot rows — they are the same data. Only genuine
re-analyses produce new history entries.

**Why `Promise.allSettled`**: Snapshot save failures must never crash the job.

---

### 2. Backend — Database: New query methods

**File:** `src/core/services/database-service.ts`

#### `getHolderProfileRunsForToken(tokenMint, topN?, limit?)`

Returns a list of distinct "runs" for a token, grouped by `jobId`:

```sql
SELECT
  "jobId",
  MIN("computedAt") AS "runAt",
  COUNT(*) AS "profileCount",
  MAX("topN") AS "topN"
FROM "HolderProfileSnapshot"
WHERE "tokenMint" = $1
  AND "analysisMode" = 'token'
  AND "jobId" IS NOT NULL
  [AND "topN" = $2]  -- optional filter
GROUP BY "jobId"
ORDER BY "runAt" DESC
LIMIT $3
```

Returns: `Array<{ jobId: string; runAt: Date; profileCount: number; topN: number | null }>`

**Implementation note**: Use `prisma.$queryRaw` (Prisma doesn't support `GROUP BY`
with aggregates in `findMany`).

#### `getHolderProfileSnapshotsByJobId(tokenMint, jobId)`

Returns all profile rows for a specific run:

```typescript
prisma.holderProfileSnapshot.findMany({
  where: { tokenMint, jobId, analysisMode: 'token' },
  orderBy: { holderRank: 'asc' },
})
```

---

### 3. Backend — API: History endpoints

**File:** `src/api/controllers/analyses.controller.ts`

#### `GET /analyses/holder-profiles/history`

Query params: `tokenMint` (required), `topN` (optional), `limit` (optional, default 10, max 20)

Response:
```json
{
  "runs": [
    { "jobId": "...", "runAt": "2026-03-24T12:00:00Z", "profileCount": 10, "topN": 10 },
    { "jobId": "...", "runAt": "2026-03-22T08:00:00Z", "profileCount": 10, "topN": 10 }
  ]
}
```

**Auth**: Same guard as other analyses endpoints (auth required).
**Rate limit**: Standard throttle (no special limit needed — it's a read).

#### `GET /analyses/holder-profiles/snapshot`

Query params: `tokenMint` (required), `jobId` (required)

Response: Full `HolderProfilesResult` reconstructed from the snapshot rows:
```json
{
  "mode": "token",
  "tokenMint": "...",
  "profiles": [ ...HolderProfile[] ],
  "metadata": {
    "totalHoldersRequested": 10,
    "totalHoldersAnalyzed": 10,
    "totalProcessingTimeMs": 0,
    "avgProcessingTimePerWalletMs": 0,
    "snapshotJobId": "...",
    "snapshotRunAt": "2026-03-24T12:00:00Z"
  }
}
```

**Important**: Re-sort by `holderRank` before returning (rank is stored per-row).

---

### 4. Frontend — Hook: `useHolderProfileHistory`

**File:** `dashboard/src/hooks/useHolderProfileHistory.ts`

```typescript
// SWR hook — fetches lazily only when tokenMint is set
// Returns: { runs, isLoading, error, refetch }
```

Fetches from `GET /analyses/holder-profiles/history?tokenMint=...&topN=...`.

**Trigger**: Fetch only after `tokenStatus === 'completed'` (don't fetch during
analysis — it creates unnecessary noise and the latest run won't be there yet).
Add a small delay (500ms) after completion to allow DB write to settle.

---

### 5. Frontend — Component: `SnapshotHistoryModal`

**File:** `dashboard/src/components/holder-profiles/SnapshotHistoryModal.tsx`

- Triggered by a "History" button (clock icon) near the TokenPulse header
- Shows a small popover/dropdown listing past runs: `"Mar 22 at 8:14 AM — Top 10 (10 holders)"`
- Clicking a run: fetches `GET /analyses/holder-profiles/snapshot?tokenMint=...&jobId=...`
  then opens a full-screen modal with:
  - Banner: `"Snapshot from [date] — Top [N]"` in muted/amber color
  - Full `<TokenPulse>` render (no similarity, no retry button)
  - Close button

**UX decisions:**
- Modal does NOT replace page state — current result stays intact underneath
- No similarity analysis for historical snapshots (would require re-running)
- History button only appears when `tokenStatus === 'completed'` and `runs.length > 1`
  (no point showing "history" if there's only the current run)
- Loading state inside modal while fetching snapshot data

---

### 6. Frontend — Page: Wire into holder profiles page

**File:** `dashboard/src/app/tools/holder-profiles/page.tsx`

Add near the `<TokenPulse>` render:
- Import `useHolderProfileHistory` hook
- Import `SnapshotHistoryModal` component
- Render a "History" icon button above/beside TokenPulse when `runs.length > 1`
- Pass open/close state and selected snapshot to the modal

---

## Choke Points & Mitigations

| Risk | Mitigation |
|------|-----------|
| Token-mode jobs currently emit `cacheOnly=true` for cache hits — we'd create duplicate snapshot rows on every cache hit | Guard with `!tokenCacheOnly` — only save for genuine re-analyses |
| `jobId` is nullable — some very old jobs may not have it | `getHolderProfileRunsForToken` filters `WHERE jobId IS NOT NULL` |
| DB write latency after job completion — history fetch on frontend arrives before DB row is visible | 500ms delay in the hook after `tokenStatus === 'completed'` before first fetch |
| Large topN (50 wallets) → 50 DB inserts per run | `Promise.allSettled` in parallel; these are small JSONB rows (~2-5KB each) |
| `prisma.$queryRaw` for GROUP BY needs careful type safety | Use `Prisma.sql` tagged template + explicit return type |
| Modal holding heavy `TokenPulse` while parent re-renders | Modal is unmount-on-close; snapshot data is local state inside modal |
| `HolderProfilesResult` type has no `snapshotJobId`/`snapshotRunAt` fields | Add optional metadata fields (no breaking change — existing consumers ignore them) |
| History only useful for token-mode; wallet-mode runs are per-wallet and have no shared `jobId` grouping | Explicitly scoped to token-mode only; wallet-mode history is a separate future concern |

---

## What We Are NOT Doing

- No migration or schema change — existing table is sufficient
- No cleanup job for old snapshots (pre-existing TODO in the codebase)
- No history for wallet-mode (different UX problem, different shape)
- No diff view between snapshots (out of scope — future feature)
- No public API exposure of history (internal dashboard only)

---

## File Changelist

| File | Change |
|------|--------|
| `src/queues/processors/analysis-operations.processor.ts` | Save per-profile snapshots after token-mode job completes |
| `src/core/services/database-service.ts` | Add `getHolderProfileRunsForToken`, `getHolderProfileSnapshotsByJobId` |
| `src/api/controllers/analyses.controller.ts` | Add `GET /history` and `GET /snapshot` endpoints |
| `dashboard/src/hooks/useHolderProfileHistory.ts` | New SWR hook |
| `dashboard/src/components/holder-profiles/SnapshotHistoryModal.tsx` | New modal component |
| `dashboard/src/app/tools/holder-profiles/page.tsx` | Wire history button + modal |
