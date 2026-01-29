# Favorites Import & Analysis Strategy

**Status:** Implementation Spec
**Created:** 2026-01-29
**Last Updated:** 2026-01-29

## Overview

This document defines the strategy for importing favorite wallets and queueing analysis jobs. The design balances three competing goals:

1. **User Experience** - Pleasant, useful, realistic functionality
2. **System Protection** - Attack-resistant, reasonable resource usage
3. **Data Quality** - Enable quality behavioral analysis without artificial limits

## Core Constraints

### Resource Limits (What Actually Costs Money)

```typescript
// Per-analysis signature caps (Helius API cost)
DASHBOARD_MAX_SIGNATURES = 3000      // Max per wallet analysis
SIMILARITY_LAB_MAX_SIGNATURES = 500  // Max per wallet similarity

// Queue processing limits
ANALYSIS_QUEUE_CONCURRENCY = 12      // Concurrent analysis jobs
ANALYSIS_RATE_LIMIT = 50/sec         // BullMQ burst protection
```

**Key Insight:** Cost is in *signature count per operation*, NOT in *how many wallets* or *how often users refresh*. A user analyzing 100 wallets × 3k sigs each costs THE SAME as 1 whale wallet if we cap it at 3k sigs.

### User Limits

```typescript
export const USER_FAVORITES_CONFIG = {
  // Core limits
  MAX_FAVORITES: 300,
  MAX_IMPORT_BATCH: 300,

  // Import auto-analysis
  IMPORT_FLASH_IMMEDIATE: 50,        // High priority, runs now
  IMPORT_FLASH_BACKGROUND: 250,      // Low priority, spread over 1 hour
  IMPORT_BACKGROUND_DELAY_MS: 14400, // 14.4 sec between background jobs

  // Batch operations
  BATCH_DEEP_ANALYSIS_LIMIT: 20,     // Can queue 20 deep at once
  COLLECTION_REFRESH_LIMIT: 100,     // Can refresh full collection

  // Import cooldown (prevent abuse)
  IMPORT_COOLDOWN_SECONDS: 3600,     // 1 hour between bulk imports

  // Freshness checks (prevent duplicate work)
  FLASH_FRESHNESS_MINUTES: 30,       // Don't re-analyze if < 30min old
  WORKING_FRESHNESS_MINUTES: 180,    // Don't re-analyze if < 3h old
  DEEP_FRESHNESS_MINUTES: 720,       // Don't re-analyze if < 12h old
} as const;
```

## Import Flow

### User Imports Wallets (via UI)

**Input:** CSV or JSON file with up to 300 wallets

**Process:**

1. **Validation**
   - Check import cooldown (1 hour since last import)
   - Deduplicate within import file
   - Validate wallet addresses
   - Check total favorites count (max 300)

2. **Database Insert**
   ```typescript
   const result = await db.bulkUpsertFavoriteWallets({
     userId,
     favorites: wallets,
     mergeCollections: true,
     overwriteNickname: false,
     mergeMetadata: true,
   });
   // Returns: { added, updated, skipped, overLimit, createdWallets }
   ```

3. **Auto-Queue Flash Analysis**
   ```typescript
   const newWallets = result.createdWallets;

   // First 50: Immediate flash (HIGH priority)
   const immediate = newWallets.slice(0, 50);
   for (const wallet of immediate) {
     queueFlashAnalysis(wallet, { priority: HIGH, delay: 0 });
   }

   // Remaining 250: Background flash (LOW priority, spread over 1 hour)
   const background = newWallets.slice(50);
   for (const [idx, wallet] of background.entries()) {
     const delay = idx * 14400; // 14.4 sec spacing
     queueFlashAnalysis(wallet, { priority: LOW, delay });
   }
   ```

4. **User Feedback**
   ```
   "50 wallets imported and analyzing now.
    250 queued for analysis (est. 1 hour).
    Open a wallet to run deep analysis."
   ```

### Analysis Tiers

```typescript
const ANALYSIS_TIERS = {
  flash: {
    targetSignatureCount: 250,
    historyWindowDays: 7,
    freshnessMinutes: 30,
    use: 'Quick overview, import auto-queue',
  },
  working: {
    targetSignatureCount: 2000,
    historyWindowDays: 30,
    freshnessMinutes: 180,
    use: 'Manual refresh from wallet view',
  },
  deep: {
    targetSignatureCount: 3000,
    historyWindowDays: 0, // full history
    freshnessMinutes: 720,
    use: 'Explicit "Deep Analysis" button',
  },
};
```

## Batch Operations

### Multi-Select Deep Analysis

**UI:** User selects 5-20 wallets → clicks "Analyze Selected (Deep)"

**Endpoint:** `POST /users/me/favorites/batch-analyze`

```typescript
{
  walletAddresses: string[];  // Max 20
  scope: 'working' | 'deep';
}
```

**Validation:**
- Max 20 wallets per request
- Check freshness for each wallet
- Skip recently analyzed wallets
- Queue remaining with NORMAL priority

**Response:**
```typescript
{
  queued: 15,
  skipped: 5,
  skippedReasons: [
    { wallet: "abc...", reason: "Analyzed 2h ago, available in 1h" }
  ],
  requestId: "batch-xyz123"
}
```

### Collection Refresh

**UI:** User views "Whale Watch" collection → clicks "Refresh Collection"

**Endpoint:** `POST /users/me/favorites/collections/{name}/refresh`

**Process:**
1. Get all wallets in collection (max 100)
2. Queue flash analysis for all (LOW priority)
3. Skip if refreshed < 6h ago

**Response:**
```
"30 wallets queued for flash analysis.
 Estimated completion: 5 minutes."
```


## Features to change

### Import/export

Import collection name is out of process, you set up a name and there is no logical connection with importing a list of wallets. 

Export is onlyu exporting into csv, but competitors accept and export in this schema (txt files): 

 [
  {
    "trackedWalletAddress": "6LChaYRYtEYjLEHhzo4HdEmgNwu2aia8CM8VhR9wn6n7",
    "name": "DINNER",
    "emoji": "😀",
    "alertsOn": true
  },
{
    "trackedWalletAddress": "2W14ahXD3XBfWJchQ4K5NLXmguWWcTTUTuHDhEzeuvP3",
    "name": "VELOCEMAIN",
    "emoji": "😀",
    "alertsOn": true
  },
  {
    "trackedWalletAddress": "5vxZr7Mh8XKZBYJ6NUdGdD7RwvQKGTToRNdjFVWswD7q",
    "name": "MIMI1",
    "emoji": "😀",
    "alertsOn": true
  },
  {
    "trackedWalletAddress": "TYC4KQpTXTqaApAg6URQ9rtvKPc6UftFFAcMQ27XsNS",
    "name": "MIMI2",
    "emoji": "😀",
    "alertsOn": true
  },
 ]

Improt is expectecting csv, json but should expect txt as well. 

Export gives a completion tost before the user have saved the list, but at the time of clicking the button.

## Attack Resistance

### Import Spam Protection

**Problem:** User uploads 300 wallets every minute

**Solution:**
```typescript
// Check last import time
const lastImport = await db.getUserLastImportTime(userId);
if (Date.now() - lastImport < IMPORT_COOLDOWN_SECONDS * 1000) {
  const remainingSec = Math.ceil((IMPORT_COOLDOWN_SECONDS * 1000 - (Date.now() - lastImport)) / 1000);
  throw new ConflictException(`Import available in ${remainingSec} seconds`);
}
```

### Refresh Spam Protection

**Problem:** User clicks "Refresh" 100 times on same wallet

**Solution:** Freshness checks before queuing
```typescript
async function canQueueAnalysis(wallet: string, scope: DashboardAnalysisScope): Promise<boolean> {
  const lastAnalysis = await db.getLastAnalysis(wallet, scope);
  if (!lastAnalysis) return true;

  const freshnessMinutes = USER_FAVORITES_CONFIG[`${scope.toUpperCase()}_FRESHNESS_MINUTES`];
  const age = Date.now() - lastAnalysis.completedAt.getTime();

  return age > freshnessMinutes * 60 * 1000;
}

// Before queuing:
if (!await canQueueAnalysis(wallet, 'deep')) {
  throw new ConflictException('Analysis is fresh, retry later');
}
```

### Batch Abuse Protection

**Problem:** User queues 20 deep analyses 50 times in a row

**Solution:** Batch size limits + existing queue concurrency
- Max 20 wallets per batch (enforced)
- Queue concurrency: 12 jobs at once (existing)
- Rate limiter: 50 jobs/sec (existing BullMQ config)

Combined effect: Even if user spams batches, queue processes at controlled rate.

## Database Schema Updates

### Track Last Analysis Times

**Required:** Add fields to track when each scope was last analyzed

```prisma
model UserFavoriteWallet {
  userId              String
  walletAddress       String
  createdAt           DateTime  @default(now())
  lastViewedAt        DateTime?
  lastFlashAnalysis   DateTime?
  lastWorkingAnalysis DateTime?
  lastDeepAnalysis    DateTime?
  // ... existing fields

  @@id([userId, walletAddress])
  @@index([lastFlashAnalysis])
  @@index([lastWorkingAnalysis])
  @@index([lastDeepAnalysis])
}
```

**Migration:**
```sql
ALTER TABLE "UserFavoriteWallet"
  ADD COLUMN "lastFlashAnalysis" TIMESTAMP,
  ADD COLUMN "lastWorkingAnalysis" TIMESTAMP,
  ADD COLUMN "lastDeepAnalysis" TIMESTAMP;

CREATE INDEX "UserFavoriteWallet_lastFlashAnalysis_idx" ON "UserFavoriteWallet"("lastFlashAnalysis");
CREATE INDEX "UserFavoriteWallet_lastWorkingAnalysis_idx" ON "UserFavoriteWallet"("lastWorkingAnalysis");
CREATE INDEX "UserFavoriteWallet_lastDeepAnalysis_idx" ON "UserFavoriteWallet"("lastDeepAnalysis");
```

### Track Last Import Time

**Required:** Enforce import cooldown

```prisma
model User {
  id                  String    @id @default(cuid())
  // ... existing fields
  lastBulkImportAt    DateTime?

  @@index([lastBulkImportAt])
}
```

**Migration:**
```sql
ALTER TABLE "User" ADD COLUMN "lastBulkImportAt" TIMESTAMP;
CREATE INDEX "User_lastBulkImportAt_idx" ON "User"("lastBulkImportAt");
```

## API Changes

### Update Bulk Import DTO

**Current Problem:** DTO accepts params that are ignored (confusing)

**Solution:** Remove unused params, document behavior clearly

```typescript
export class BulkImportFavoriteWalletsDto {
  @ApiProperty({ description: 'Wallets to import', type: [BulkImportWalletItemDto] })
  wallets: BulkImportWalletItemDto[];

  @ApiProperty({
    description: 'Default collections applied to every imported wallet',
    required: false,
    example: ['Whale Watch'],
  })
  defaultCollections?: string[] | string;

  @ApiProperty({
    description: 'Merge collections into existing favorites (default true)',
    required: false,
  })
  mergeCollections?: boolean;

  @ApiProperty({
    description: 'Overwrite existing nickname when provided (default false)',
    required: false,
  })
  overwriteNickname?: boolean;

  // REMOVED: analyze, analysisScope, analysisLimit, targetSignatureCount, etc.
  // Import now ALWAYS queues flash analysis (first 50 immediate, rest background)
}
```

**API Docs Update:**
```
POST /users/me/favorites/import

Imports wallets and automatically queues flash analysis:
- First 50 wallets: Analyzed immediately (HIGH priority)
- Remaining wallets: Queued for background analysis over 1 hour (LOW priority)

For deep analysis, use the batch analyze endpoint or open individual wallets.

Rate Limit: 1 import per hour
```

### New Endpoint: Batch Analyze

```typescript
export class BatchAnalyzeFavoritesDto {
  @ApiProperty({ description: 'Wallet addresses to analyze', type: [String], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  walletAddresses: string[];

  @ApiProperty({ description: 'Analysis scope', enum: ['working', 'deep'] })
  @IsEnum(['working', 'deep'])
  scope: 'working' | 'deep';
}

// Controller
@Post('batch-analyze')
async batchAnalyze(@Body() dto: BatchAnalyzeFavoritesDto, @Req() req: AuthenticatedRequest) {
  return this.userFavoritesService.batchAnalyze(req.user.id, dto);
}
```

### New Endpoint: Collection Refresh

```typescript
@Post('collections/:name/refresh')
async refreshCollection(@Param('name') name: string, @Req() req: AuthenticatedRequest) {
  return this.userFavoritesService.refreshCollection(req.user.id, name);
}
```

## Implementation Checklist

- [x] God mode import script (`scripts/god-mode-import-favorites.ts`)
- [ ] Database migration (add lastXAnalysis fields, lastBulkImportAt)
- [ ] Update constants (`USER_FAVORITES_CONFIG`)
- [ ] Clean up import DTO (remove unused params)
- [ ] Implement import cooldown check
- [ ] Implement freshness check helper
- [ ] Update import controller (50 immediate + 250 background)
- [ ] Implement batch analyze endpoint
- [ ] Implement collection refresh endpoint
- [ ] Update frontend UI (batch select, collection refresh button)
- [ ] Update API documentation

## Testing Strategy

### Manual Testing (God Mode Script)

```bash
# Test with your wallet list
npm run god-mode:import wallets.json --scope deep --sigs 5000 --batch-size 10

# Dry run first
npm run god-mode:import wallets.json --dry-run

# Test different scopes
npm run god-mode:import wallets.json --scope flash --batch-size 50
npm run god-mode:import wallets.json --scope working --batch-size 20
```

### Integration Testing

1. **Import Flow**
   - Import 100 wallets → verify 50 queued HIGH, 50 queued LOW
   - Try re-import < 1h later → verify cooldown error
   - Import 300 wallets → verify limit enforcement

2. **Batch Analyze**
   - Select 20 wallets → verify all queued
   - Try 21 wallets → verify error
   - Analyze same wallets again → verify freshness check

3. **Collection Refresh**
   - Refresh collection with 30 wallets → verify flash queued
   - Try refresh < 6h later → verify cooldown

## Migration Path

**Phase 1: Backend (This PR)**
1. Add database migrations
2. Update constants
3. Clean up import DTO
4. Implement cooldowns and freshness checks
5. Add batch analyze endpoint
6. Add collection refresh endpoint

**Phase 2: Frontend (Next PR)**
1. Add import cooldown feedback
2. Add multi-select checkbox UI
3. Add "Analyze Selected" button
4. Add "Refresh Collection" button
5. Show freshness indicators

**Phase 3: Monitoring (Future)**
1. Track import frequency per user
2. Track analysis costs per user
3. Alert on abuse patterns
4. Optimize batch delays based on load

## Future Enhancements (Out of Scope)

- **Auto-refresh collection:** User opts wallets into daily flash refresh
- **Smart upgrade:** Auto-queue working analysis for active wallets after flash
- **User tiers:** Premium users get higher limits
- **Webhooks:** Real-time updates instead of manual refresh
- **Scheduled refresh:** User sets refresh schedule per collection

---

## Summary

This spec defines a **deliberate, attack-resistant import strategy** that:

✅ Gives users reasonable batch operations (20 deep, 100 collection refresh)
✅ Protects against abuse (cooldowns, freshness checks, batch limits)
✅ Scales to 300 favorites without choking the system (signature caps + queue management)
✅ Enables quality analysis (no artificial daily quotas that block viewing wallets)
✅ Provides god mode for admin testing (bypass all constraints)

The cost is controlled by **signature count per operation** (3k max), not by how many wallets or how often users refresh. This aligns with actual API costs and enables the behavioral analysis quality you need.
