# System Wallet Detection Service - Design Document

**Date:** 2026-01-12
**Status:** 🚧 Design Phase
**Context:** Need centralized system wallet detection to prevent wasting compute on vaults/AMM accounts

## 🎯 Problem Statement

### Current Situation
- **Reactive Detection**: System wallets detected AFTER expensive operations (sync, PnL, behavior)
- **Duplicated Logic**: Detection code exists in similarity processor only
- **Inconsistent Coverage**: Holder profiles flow has NO dynamic detection
- **Manual Maintenance**: `KNOWN_SYSTEM_WALLETS` list requires manual updates + restart
- **Wasted Resources**: Raydium Vault (370k tokens) processed to 95% before detection

### Example Flow (Current)
```
Token Mint → Top Holders API
  ↓
Holder Profiles (processes 10 wallets)
  ↓ Wallet sync (20s)
  ↓ PnL analysis (10s)  ↓ Behavior analysis (5s)
  ↓ 95% complete (35s wasted)
  ↓
Similarity Analysis → "Oh shit, system wallet!" (detected at 370k tokens)
```

**Cost per system wallet**: 35s × 10 = 5.8 minutes wasted, multiple RPC calls

---

## 🔍 Deep Analysis

### 1. What Defines a "System Wallet"?

**Tier 1: Static Known List** (Fast, 100% accurate)
- ✅ `KNOWN_SYSTEM_WALLETS` (50+ addresses)
- ✅ Jupiter aggregator accounts
- ✅ Known Raydium vaults
- ✅ CEX deposit addresses

**Tier 2: Program Analysis** (Fast, high accuracy)
- ✅ Program-owned accounts (not system-owned)
- ✅ Executable accounts
- ✅ PDAs with non-empty data
- ✅ Already implemented in `TokenHoldersService:82-97`

**Tier 3: Dynamic Detection** (Slow, heuristic-based)
- Token count threshold (10k? 50k? 100k?)
- Trading patterns (too fast, too frequent)
- Balance patterns (vault-like behavior)
- **Question**: What threshold is safe?

### 2. Threshold Analysis

| Wallet Type | Typical Token Count | Should Block? |
|-------------|---------------------|---------------|
| Normal trader | 10-100 | ❌ No |
| Active trader | 100-1,000 | ❌ No |
| KOL/Whale | 1,000-5,000 | ❌ No |
| Very active trader | 5,000-15,000 | ⚠️ **GRAY ZONE** |
| Market maker | 15,000-50,000 | ⚠️ **GRAY ZONE** |
| System vault | 50,000+ | ✅ Yes |
| Raydium vault | 370,000+ | ✅ **DEFINITELY** |

**Current threshold**: 10,000 tokens
**Problem**: Too aggressive - catches active traders/KOLs

**Proposed tiered approach**:
```typescript
const THRESHOLDS = {
  CERTAIN_SYSTEM: 50000,    // Block immediately
  LIKELY_SYSTEM: 20000,     // Block + log for review
  GRAY_ZONE: 10000,         // Log only, don't block (yet)
  NORMAL: 0,                // Process normally
};
```

**Alternative signals** (to combine with token count):
- **No activity**: High token count + no transactions in 30 days = vault
- **Uniform balances**: All tokens have identical amounts = system distribution
- **Program ownership**: High token count + program-owned = AMM/vault

### 3. Data Storage Strategy

**Existing Infrastructure** (already in place!):
```typescript
// Wallet table (schema.prisma:10-37)
classification: String?               // "SYSTEM", "INVALID", "LARGE", etc.
classificationConfidence: Float?      // 0.0-1.0 confidence score
classificationUpdatedAt: DateTime?    // When was this set?
classificationMethod: String?         // How was it detected?
```

**Storage locations**:

1. **Database (Wallet table)** - Permanent record
   - ✅ Already exists
   - ✅ Indexed on `classification`
   - ✅ Survives restarts
   - ✅ Single source of truth
   - ❌ Slow (DB roundtrip per query)

2. **Redis Cache** - Fast lookup layer
   - ✅ O(1) lookup: `system-wallet:{address}` → `{"isSystem": true, "reason": "..."}`
   - ✅ TTL-based expiry (7 days?)
   - ✅ Separate from other caches
   - ⚠️ Memory overhead (estimate: 50 bytes × 10k wallets = 500KB)

3. **In-Memory Set** - Ultra-fast, process-level
   - ✅ O(1) lookup: `Set<string>` for known system wallets
   - ✅ Zero latency
   - ✅ Loaded on startup from database
   - ❌ Not shared across processes
   - ❌ Loses dynamic detections on restart

**Proposed strategy**: 3-tier caching
```
Request → In-Memory Set (10ms)
  ↓ miss
  ↓ → Redis Cache (50ms)
      ↓ miss
      ↓ → Database (200ms) + Dynamic Detection (500ms)
          ↓ found
          ↓ → Cache in Redis + Memory
```

### 4. Detection Performance & Cost

**RPC Call Costs**:
- `getTokenAccountsByOwner` = 1 RPC call = ~200ms
- For 10 wallets = 10 RPC calls = 2s
- For 50 wallets = 50 RPC calls = 10s ❌ **TOO EXPENSIVE**

**Optimization strategies**:

**A) Batch Detection** (Recommended)
```typescript
async detectSystemWallets(addresses: string[]): Promise<Map<string, DetectionResult>> {
  // 1. Check database in batch (1 query for all)
  const wallets = await db.wallet.findMany({ where: { address: { in: addresses } } });

  // 2. Check Redis in batch (1 MGET for all)
  const cached = await redis.mget(addresses.map(a => `system:${a}`));

  // 3. Only check RPC for uncached wallets (parallel, with rate limit)
  const needsCheck = addresses.filter(a => !wallets.get(a) && !cached.get(a));
  const results = await Promise.all(needsCheck.map(a => checkTokenCount(a)));
}
```

**B) Lazy Detection** (Current approach in similarity)
- Check each wallet as needed during processing
- ✅ No upfront cost
- ❌ Wastes compute if system wallet detected late

**C) Proactive Filtering** (Ideal)
- Check ALL wallets BEFORE queueing jobs
- ✅ Zero wasted compute
- ❌ Higher upfront cost (but worth it!)

**Cost-Benefit Analysis**:
| Approach | Upfront Cost | Wasted Compute | Best For |
|----------|--------------|----------------|----------|
| Lazy | 0s | High (35s per system wallet) | Small batches (<5 wallets) |
| Batch | 2-10s | Zero | Medium batches (5-20 wallets) |
| Proactive | 10s | Zero | Large batches (20+ wallets) |

**Recommendation**: Use **Batch Detection** with threshold:
- If batch size < 5: Skip detection (low risk)
- If batch size >= 5: Proactive batch detection (worth the upfront cost)

### 5. Integration Points

**Where to inject detection:**

#### A) `TokenHoldersService.getTopHolders()` ✅ **HIGHEST PRIORITY**
- **When**: Before returning top holders list
- **Why**: Catches system wallets at the source (all flows benefit)
- **Cost**: Already fetching account info, minimal additional cost
- **Impact**: Holder profiles, similarity, dashboard all benefit

#### B) `AnalysisOperationsProcessor.processAnalyzeHolderProfiles()` ✅ **HIGH PRIORITY**
- **When**: After fetching top holders, before queueing jobs
- **Why**: Safety net if upstream filtering missed anything
- **Cost**: 2-10s for batch detection
- **Impact**: Prevents wasting compute on holder profiles

#### C) `SimilarityOperationsProcessor` (refactor existing) ✅ **MEDIUM PRIORITY**
- **When**: Before fetching balances
- **Why**: Already has detection, just move to service
- **Cost**: No additional cost (refactor only)
- **Impact**: Cleaner code, consistent with other flows

#### D) `HeliusSyncService.syncWallet()` (optional) ⚠️ **LOW PRIORITY**
- **When**: Before syncing a wallet
- **Why**: Skip sync entirely for system wallets
- **Cost**: 200ms DB lookup
- **Impact**: Saves sync time (20s) but rare (usually caught upstream)
- **Note**: Already has `classification === 'INVALID'` check (line 167)

### 6. Metadata & Context

**Detection Result Schema**:
```typescript
interface SystemWalletDetectionResult {
  address: string;
  isSystemWallet: boolean;
  confidence: number;          // 0.0-1.0 (0.9+ = high confidence)
  reason: string;              // Human-readable reason
  method: string;              // "static_list" | "program_owned" | "token_count" | "composite"
  tokenCount?: number;         // If detected via token count
  detectedAt: Date;            // When was this detected

  // Actionable flags
  shouldBlock: boolean;        // Should we skip processing?
  shouldLog: boolean;          // Should we log this detection?
  shouldReview: boolean;       // Gray zone - needs manual review
}
```

**Storage in Database**:
```typescript
// When detected
await db.wallet.update({
  where: { address },
  data: {
    classification: 'INVALID',                    // or 'SYSTEM' or 'LARGE'
    classificationConfidence: 0.95,              // High confidence
    classificationMethod: 'token_count_50k+',    // Detection method
    classificationUpdatedAt: new Date(),         // Timestamp
  }
});
```

**Storage in Redis** (7-day TTL):
```typescript
// Key: system-wallet:{address}
// Value: JSON
{
  "isSystem": true,
  "confidence": 0.95,
  "reason": "370174 tokens (threshold: 50000)",
  "method": "token_count",
  "detectedAt": "2026-01-12T20:53:06Z"
}
```

### 7. User Control & Observability

**Configuration** (via constants):
```typescript
export const SYSTEM_WALLET_DETECTION_CONFIG = {
  // Thresholds
  CERTAIN_SYSTEM_THRESHOLD: 50000,   // Block immediately
  LIKELY_SYSTEM_THRESHOLD: 20000,    // Block + log
  GRAY_ZONE_THRESHOLD: 10000,        // Log only

  // Caching
  REDIS_TTL_DAYS: 7,                 // How long to cache results
  ENABLE_MEMORY_CACHE: true,         // In-process cache

  // Behavior
  AUTO_TAG_DATABASE: true,           // Automatically update Wallet.classification
  BLOCK_SYSTEM_WALLETS: true,        // Skip processing or just log?
  ALLOW_MANUAL_OVERRIDE: false,      // Future: Let users force-analyze system wallets

  // Performance
  BATCH_DETECTION_THRESHOLD: 5,      // Min wallets to trigger batch detection
  PARALLEL_RPC_LIMIT: 5,             // Max parallel token count checks
};
```

**Logging Strategy**:
```typescript
// High-confidence detections: WARN
logger.warn(`🚨 SYSTEM WALLET BLOCKED: ${address} (370k tokens, confidence: 0.99)`);

// Gray zone: INFO
logger.info(`⚠️ LARGE WALLET DETECTED: ${address} (15k tokens, processing anyway)`);

// Manual overrides: LOG
logger.log(`🔓 USER OVERRIDE: Analyzing system wallet ${address} (forced)`);

// Stats: DEBUG
logger.debug(`Detection cache hit rate: 85% (170/200 wallets cached)`);
```

**Metrics to track**:
- System wallets detected per flow
- Detection method breakdown (static, dynamic, composite)
- Cache hit/miss rates
- False positive rate (if we build a review queue)
- Compute time saved

### 8. Edge Cases & Error Handling

**Scenario 1: Detection fails (RPC error)**
- **Action**: Fail open - process wallet anyway
- **Log**: Warn that detection was skipped
- **Cache**: Do NOT cache negative result (might be transient error)

**Scenario 2: Gray zone wallet (10k-20k tokens)**
- **Action**: Process wallet, log for review
- **Classification**: Mark as "LARGE", not "INVALID"
- **Future**: Build admin UI to review and reclassify

**Scenario 3: Wallet BECOMES system wallet (market maker → vault)**
- **Detection**: Re-check on next analysis (TTL expiry)
- **Cache invalidation**: Manual `/admin/invalidate-classification/{address}` endpoint
- **Note**: Rare, not a priority

**Scenario 4: False positive (KOL with 15k tokens)**
- **Current**: No override mechanism
- **Future**: `/admin/override-classification/{address}` endpoint
- **Workaround**: Remove from `KNOWN_SYSTEM_WALLETS`, mark as "NORMAL" in DB

**Scenario 5: New vault appears (not in static list)**
- **Detection**: Caught by token count threshold
- **Auto-tag**: Added to database as "INVALID"
- **Manual add**: Engineer adds to `KNOWN_SYSTEM_WALLETS` for future

---

## 🎨 Proposed Architecture

### Service Interface

```typescript
@Injectable()
export class SystemWalletDetectionService {
  private readonly logger = new Logger(SystemWalletDetectionService.name);
  private readonly memoryCache = new Set<string>(); // In-memory known system wallets

  constructor(
    private readonly heliusClient: HeliusApiClient,
    private readonly databaseService: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.loadKnownSystemWallets(); // Load from DB on startup
  }

  // === TIER 1: Fast Checks (< 10ms) ===

  /**
   * Check if wallet is in static known list or memory cache.
   * O(1) lookup, no I/O.
   */
  isKnownSystemWallet(address: string): boolean;

  // === TIER 2: Cached Checks (< 100ms) ===

  /**
   * Check Redis cache + database classification.
   * Returns cached result if available.
   */
  async getClassification(address: string): Promise<WalletClassification | null>;

  // === TIER 3: Dynamic Detection (< 500ms) ===

  /**
   * Perform full dynamic detection:
   * 1. Check token count via RPC
   * 2. Analyze patterns
   * 3. Auto-tag in database
   * 4. Cache result
   */
  async detectSystemWallet(address: string): Promise<SystemWalletDetectionResult>;

  // === BATCH OPERATIONS (Optimized) ===

  /**
   * Filter multiple wallets efficiently:
   * - Batch DB lookup
   * - Batch Redis lookup
   * - Parallel RPC checks (rate-limited)
   * Returns { valid: string[], filtered: Map<address, reason> }
   */
  async filterSystemWallets(
    addresses: string[],
    options?: { skipDynamic?: boolean }
  ): Promise<FilterResult>;

  // === ADMIN OPERATIONS ===

  /**
   * Invalidate cached detection result.
   * Forces re-detection on next check.
   */
  async invalidateCache(address: string): Promise<void>;

  /**
   * Manually override classification.
   * For handling false positives.
   */
  async overrideClassification(
    address: string,
    classification: string,
    reason: string
  ): Promise<void>;
}
```

---

## 🚀 Implementation Plan

### Phase 1: Core Service (30 min)
- [ ] Create `SystemWalletDetectionService`
- [ ] Implement tiered detection (static → cache → dynamic)
- [ ] Add Redis caching layer
- [ ] Add database auto-tagging
- [ ] Unit tests for detection logic

### Phase 2: Integration (30 min)
- [ ] Refactor `SimilarityOperationsProcessor` to use service
- [ ] Add to `AnalysisOperationsProcessor.processAnalyzeHolderProfiles()`
- [ ] Add upstream filtering to `TokenHoldersService` (optional but recommended)
- [ ] Update constants (export thresholds)

### Phase 3: Observability (15 min)
- [ ] Add structured logging
- [ ] Add metrics/stats tracking
- [ ] Document detection reasons in logs

**Total time**: ~75 minutes

---

## ❓ Open Questions for User

### 1. **Threshold Strategy**
   - **Option A**: Conservative (50k tokens) - fewer false positives, might miss some system wallets
   - **Option B**: Aggressive (10k tokens) - catches more system wallets, higher false positive rate
   - **Option C**: Tiered (10k log, 20k warn, 50k block) - best of both worlds

   **Recommendation**: **Option C** - Tiered approach with logging at 10k, blocking at 50k+

### 2. **Upfront Cost vs Lazy Detection**
   - **Option A**: Always check before processing (2-10s upfront, zero waste)
   - **Option B**: Check during processing (0s upfront, waste if system wallet)
   - **Option C**: Adaptive (check if batch >= 5 wallets)

   **Recommendation**: **Option C** - Adaptive based on batch size

### 3. **Cache TTL**
   - How long should we cache detection results?
   - **Option A**: 1 day (re-check daily)
   - **Option B**: 7 days (long-term cache)
   - **Option C**: Permanent (manual invalidation only)

   **Recommendation**: **Option B** - 7 days with manual invalidation endpoint

### 4. **Gray Zone Handling**
   - What to do with wallets in 10k-50k range?
   - **Option A**: Block them (safe but might block legitimate traders)
   - **Option B**: Process them but log (less safe but preserves data)
   - **Option C**: Mark as "LARGE" classification, process, review later

   **Recommendation**: **Option C** - Process but mark for review

### 5. **Integration Priority**
   - Where to add detection first?
   - **Option A**: Holder profiles only (your immediate pain point)
   - **Option B**: Holder profiles + similarity (full coverage)
   - **Option C**: Add to `TokenHoldersService` (upstream filtering, benefits all flows)

   **Recommendation**: **Option C** - Maximum impact, all flows benefit

---

## 🎯 Recommendation Summary

Based on the analysis, here's what I recommend:

1. **Implement tiered threshold approach**: 10k (log), 20k (warn), 50k+ (block)
2. **Use batch detection for efficiency**: Check in batch if >= 5 wallets
3. **3-tier caching**: Memory → Redis (7d TTL) → Database
4. **Integrate at `TokenHoldersService`**: Catch system wallets at the source
5. **Add safety net in holder profiles**: Batch check before queueing jobs
6. **Refactor similarity processor**: Use new service instead of inline detection
7. **Log gray zone wallets**: Mark as "LARGE", process anyway, review later

**Total implementation time**: ~75 minutes
**Compute savings**: 5-10 minutes per batch with system wallets

---

## 📊 Success Metrics

After implementation, we should see:
- ✅ Zero system wallets reach holder profiles processing stage
- ✅ Detection happens in < 2s for batches of 10 wallets
- ✅ Cache hit rate > 80% after warm-up period
- ✅ No false positives (traders with < 50k tokens processed normally)
- ✅ Logs clearly show why wallets were filtered
