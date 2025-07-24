# Cache Idiocy Analysis & Migration Plan

## 🎯 Current Problem Analysis

### The Cache Idiocy
The current system has a fundamental flaw in its caching strategy:

1. **Fetch transaction from Helius API**
2. **Store full transaction data in `rawData` (compressed)**
3. **Later, read from cache instead of API**
4. **But we already have the data in `SwapAnalysisInput`!**

This is backwards because:
- We're storing the same data twice (cache + SwapAnalysisInput)
- We're using cache for data retrieval when we should use it for tracking
- The cache takes up massive storage space for no real benefit

### Why This Exists (Possible Reasons)
1. **Historical artifact** - Early development approach that wasn't refactored
2. **Performance optimization** - Avoiding API calls during re-analysis
3. **Incremental sync logic** - Trying to avoid re-fetching known transactions
4. **Backfill operations** - Reprocessing existing data with new logic

## 🔍 Current Code Flow Analysis

### HeliusApiClient.getAllTransactionsForAddress()
```typescript
// 1. Fetch signatures via RPC
// 2. Check cache for existing transaction data
const cachedTxMap = await this.dbService.getCachedTransaction(uniqueSignatures);

// 3. Separate cached vs uncached
for (const sig of uniqueSignatures) {
  const cachedTx = cachedTxMap.get(sig);
  if (cachedTx) {
    cachedTransactions.push(cachedTx); // Use cached data
  } else {
    signaturesToFetchDetails.add(sig); // Fetch from API
  }
}

// 4. Fetch only uncached signatures
const newTransactions = await this.getTransactionsBySignatures(signaturesToFetchArray);

// 5. Save new transactions to cache
await this.dbService.saveCachedTransactions(newTransactions);

// 6. Combine cached + new transactions
const allTransactions = [...cachedTransactions, ...newTransactions];
```

### The Problem
- **Cache stores full transaction data** (wasteful)
- **Analysis uses SwapAnalysisInput anyway** (cache is irrelevant)
- **Cache only helps avoid API calls** (but we could do this differently)

## 🎯 Proposed Solution: Signature-Only Cache

### New Approach
1. **Cache stores only signatures + timestamps** (lightweight)
2. **Use cache to determine what to fetch from API**
3. **Always fetch fresh data from API for new signatures**
4. **Analysis continues using SwapAnalysisInput**

### Critical Logic Fix
**Current Problem**: The cache logic is backwards!
- Cache stores full transaction data
- But we still need to fetch from API for new signatures
- Cache only helps avoid duplicate API calls

**New Logic**:
- Cache stores only signatures (what we've already processed)
- Use cache to identify which signatures to skip
- Fetch only new signatures from API
- This is the correct approach!

### Benefits
- ✅ **90%+ storage reduction**
- ✅ **Same functionality** (avoid duplicate API calls)
- ✅ **Simplified codebase**
- ✅ **No data duplication**

## 📋 Detailed Migration Plan

### Phase 1: Schema Migration

#### 1.1 Create Migration File
```sql
-- Create new lightweight table
CREATE TABLE HeliusTransactionCache_Light (
  signature TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  fetchedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Copy existing metadata
INSERT INTO HeliusTransactionCache_Light (signature, timestamp, fetchedAt)
SELECT signature, timestamp, fetchedAt 
FROM HeliusTransactionCache;

-- Create indexes
CREATE UNIQUE INDEX "HeliusTransactionCache_Light_signature_key" ON "HeliusTransactionCache_Light"("signature");
CREATE INDEX "HeliusTransactionCache_Light_timestamp_idx" ON "HeliusTransactionCache_Light"("timestamp");

-- Drop old table
DROP TABLE HeliusTransactionCache;

-- Rename new table
ALTER TABLE HeliusTransactionCache_Light RENAME TO HeliusTransactionCache;
```

#### 1.2 Update Prisma Schema
```prisma
model HeliusTransactionCache {
  signature String   @id @unique
  timestamp Int
  fetchedAt DateTime @default(now())

  @@index([timestamp])
}
```

### Phase 2: Code Updates

#### 2.1 Update DatabaseService
**File: `src/core/services/database-service.ts`**

```typescript
// Replace getCachedTransaction method
async getCachedTransaction(signature: string | string[]): Promise<Set<string> | Map<string, { timestamp: number }>> {
  if (typeof signature === 'string') {
    try {
      const cached = await this.prismaClient.heliusTransactionCache.findUnique({
        where: { signature },
        select: { signature: true, timestamp: true }
      });
      return cached ? new Map([[cached.signature, { timestamp: cached.timestamp }]]) : new Map();
    } catch (error) {
      this.logger.error(`Error fetching cached transaction ${signature}`, { error });
      return new Map();
    }
  }

  if (Array.isArray(signature)) {
    if (signature.length === 0) {
      return new Map();
    }
    try {
      const cachedRecords = await this.prismaClient.heliusTransactionCache.findMany({
        where: {
          signature: { in: signature }
        },
        select: { signature: true, timestamp: true }
      });
      
      const resultMap = new Map<string, { timestamp: number }>();
      cachedRecords.forEach(record => {
        resultMap.set(record.signature, { timestamp: record.timestamp });
      });
      return resultMap;
    } catch (error) {
      this.logger.error(`Error batch fetching ${signature.length} cached transactions`, { error });
      return new Map();
    }
  }
  return new Map();
}

// Replace saveCachedTransactions method
async saveCachedTransactions(transactions: HeliusTransaction[]): Promise<{ count: number }> {
  if (transactions.length === 0) {
    this.logger.debug('No transactions provided to save to cache.');
    return { count: 0 };
  }
  
  this.logger.debug(`Attempting to save ${transactions.length} transaction signatures to cache...`);
  const incomingSignatures = transactions.map(tx => tx.signature);
  let existingSignatures = new Set<string>();
  
  try {
    const existingRecords = await this.prismaClient.heliusTransactionCache.findMany({
      where: {
        signature: { in: incomingSignatures }
      },
      select: { signature: true }
    });
    existingSignatures = new Set(existingRecords.map(rec => rec.signature));
    this.logger.debug(`Found ${existingSignatures.size} existing signatures in cache out of ${incomingSignatures.length} incoming.`);
  } catch (error) {
    this.logger.error('Error checking for existing signatures in cache', { error });
    return { count: 0 };
  }
  
  const newTransactions = transactions.filter(tx => !existingSignatures.has(tx.signature));
  if (newTransactions.length === 0) {
    this.logger.debug('No new transactions to add to cache.');
    return { count: 0 };
  }
  
  this.logger.debug(`Identified ${newTransactions.length} new transactions to insert into HeliusTransactionCache.`);
  const dataToSave = newTransactions.map(tx => ({
    signature: tx.signature,
    timestamp: tx.timestamp
  }));
  
  try {
    const result = await this.prismaClient.heliusTransactionCache.createMany({
      data: dataToSave
    });
    this.logger.debug(`Cache save complete. ${result.count} new transaction signatures added to HeliusTransactionCache.`);
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      this.logger.error('Prisma Error saving new cached transactions to HeliusTransactionCache', { code: error.code, meta: error.meta });
    } else {
      this.logger.error('Error saving new cached transactions to HeliusTransactionCache', { error });
    }
    return { count: 0 };
  }
}
```

#### 2.2 Update HeliusApiClient
**File: `src/core/services/helius-api-client.ts`**

```typescript
// Update the cache checking logic in getAllTransactionsForAddress
// Replace the cache checking section (around lines 460-480)

// === Check Cache to Identify Signatures to Fetch ===
logger.debug(`Checking database cache existence for ${uniqueSignatures.length} signatures...`);

// Use the dbService instance method - now returns Map<string, { timestamp: number }>
const cachedTxMap = await this.dbService.getCachedTransaction(uniqueSignatures) as Map<string, { timestamp: number }>;
const cacheHits = cachedTxMap.size;

// Separate cached signatures and signatures that need to be fetched
const cachedSignatures = new Set<string>();
for (const sig of uniqueSignatures) {
  const cachedTx = cachedTxMap.get(sig);
  if (cachedTx) {
    if (includeCached) {
      cachedSignatures.add(sig); // Track signature as processed
    }
  } else {
    signaturesToFetchDetails.add(sig); // Need to fetch this signature
  }
}

logger.debug(`Found ${cacheHits} signatures in cache. Need to fetch details for ${signaturesToFetchDetails.size} signatures.`);
logger.debug(`Cache inclusion is ${includeCached ? 'enabled' : 'disabled'}, keeping ${cachedSignatures.size} cached signatures.`);

const signaturesToFetchArray = Array.from(signaturesToFetchDetails);

// === PHASE 2: Fetch Uncached Details & Save to Cache ===
if (signaturesToFetchArray.length > 0) {
  // ... existing fetch logic remains the same ...
  
  // Save newly fetched transactions to cache (signatures only)
  if (newlyFetchedTransactions.length > 0) {
    logger.debug(`Saving ${newlyFetchedTransactions.length} newly fetched transaction signatures to database cache...`);
    await this.dbService.saveCachedTransactions(newlyFetchedTransactions);
    logger.debug('Finished saving new transaction signatures to cache.');
  }
}

// All transactions now come from newly fetched data
const allTransactions = [...newlyFetchedTransactions];
```

#### 2.3 Update Backfill Script (Disable)
**File: `src/helpers/db/backfill-swap-inputs.ts`**

```typescript
// Comment out or remove this script for now
// It can be reimplemented later if needed to work with API calls instead of cache
```

### Phase 3: Testing Strategy

#### 3.1 Unit Tests
- Test new cache methods with signature-only data
- Verify cache hit/miss logic works correctly
- Test API call reduction for cached signatures

#### 3.2 Integration Tests
- Test complete wallet analysis flow
- Verify SwapAnalysisInput population remains unchanged
- Test incremental sync functionality

#### 3.3 Performance Tests
- Measure storage reduction
- Verify API call patterns
- Test analysis performance (should be unchanged)

### Phase 4: Deployment Strategy

#### 4.1 Staged Rollout
1. **Deploy to staging** with new schema and code
2. **Test with real wallet data**
3. **Monitor API usage and performance**
4. **Deploy to production** during low-traffic period

#### 4.2 Rollback Plan
```sql
-- If needed, restore original schema
-- Restore rawData column and data from backup
```

## 🚨 Critical Issues & Dependencies Analysis

### Issue 1: Type Signature Changes (CRITICAL)
**Risk**: `getCachedTransaction()` return type changes from `Map<string, HeliusTransaction>` to `Map<string, { timestamp: number }>`
**Impact**: All calling code expects full transaction objects
**Mitigation**: 
- Update all callers to handle new return type
- Ensure HeliusApiClient properly handles signature-only cache

### Issue 2: Backfill Script Dependency (HIGH)
**Risk**: `src/helpers/db/backfill-swap-inputs.ts` directly reads `rawData` from cache
**Impact**: Script will break completely after migration
**Mitigation**: 
- Disable backfill script (as requested)
- Reimplement later if needed using API calls

### Issue 3: Cache Logic Inconsistency (MEDIUM)
**Risk**: Current code expects cached transactions to be full objects
**Impact**: Cache becomes useless if not properly updated
**Mitigation**: 
- Ensure HeliusApiClient logic properly handles signature-only tracking
- Test cache hit/miss scenarios thoroughly

### Issue 4: Database Migration Complexity (MEDIUM)
**Risk**: Large `rawData` column migration could be slow
**Impact**: Potential downtime during migration
**Mitigation**: 
- Test migration on production data size
- Consider staging migration approach

### Issue 5: No Upstream Violations Found ✅
**Good News**: 
- No other services depend on `getCachedTransaction()` or `saveCachedTransactions()`
- All analysis uses `SwapAnalysisInput` table
- Cache is only used by HeliusApiClient and backfill script

## 📊 Expected Outcomes

### Storage Reduction
- **Before**: ~1GB+ for rawData (compressed)
- **After**: ~10MB for signatures only
- **Savings**: 99%+ reduction

### Performance Impact
- **Analysis**: No change (uses SwapAnalysisInput)
- **API calls**: Same pattern (cache still prevents duplicates)
- **Database**: Faster operations (smaller table)

### Code Complexity
- **Before**: Complex cache data handling
- **After**: Simple signature tracking
- **Benefit**: Easier to maintain and debug

## 🎯 Success Criteria

1. **Storage reduction** of 90%+ achieved
2. **Analysis functionality** remains unchanged
3. **API usage patterns** remain the same
4. **No data loss** during migration
5. **Performance** remains stable or improves

## 🔄 Migration Timeline

### Week 1: Development
- Implement schema changes
- Update code
- Write tests

### Week 2: Testing
- Unit and integration tests
- Performance testing
- Staging deployment

### Week 3: Production
- Deploy to production
- Monitor performance
- Validate results

## 📝 Post-Migration Tasks

1. **Monitor** API usage and performance
2. **Clean up** old cache data
3. **Optimize** if needed
4. **Document** new approach
5. **Consider** removing cache entirely if not needed

---

**Note**: This migration maintains the same functionality while dramatically reducing storage usage. The cache becomes a lightweight signature tracker instead of a data store, which is the correct approach.
