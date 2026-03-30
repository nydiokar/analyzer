# Bug: POST /intel/token/:mint/holders/deep — broken similarity chaining

**Filed:** 2026-03-03
**Severity:** Medium — endpoint works but delivers wrong UX promise
**Status:** Documented, not yet fixed

---

## What the endpoint is supposed to do

`POST /intel/token/:mint/holders/deep` (35cr) is the "all-in-one" endpoint for token holder intelligence. The intent:

> Fetch the top N holders of a token, analyze each wallet's profile, then run similarity analysis across those same holder wallets — in one API call, at a discount vs calling `/holders` (20cr) + `/similarity` (20cr) separately.

The agent should only need to know the token mint and `topN`. The server does the rest.

---

## What it actually does (the bug)

The controller (`src/api/controllers/intel.controller.ts`, `queueTokenHoldersDeep`) currently:

1. Queues a holder-profiles job for the token mint → this job will internally fetch top N holders from Helius
2. **Immediately** also tries to queue a similarity job — but needs wallet addresses for that
3. Since the holder-profiles job hasn't run yet, the controller has no idea who the holders are
4. So it requires the caller to pass `wallets[]` in the request body

```typescript
class IntelTokenHoldersDeepRequestDto extends IntelTokenHoldersRequestDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  wallets: string[];  // ← caller must provide these upfront
}
```

**This is a circular dependency**: the whole point of the endpoint is to discover who the holders are. Requiring the caller to already know them defeats the purpose. The only valid use case under the current implementation is when the caller already ran `/holders` first — at which point `/deep` is redundant.

---

## Root cause

The two jobs are queued **simultaneously** at the controller level, before any computation has happened. The holder-profiles processor (`processAnalyzeHolderProfiles`) fetches holders from Helius internally during execution — those addresses are never surfaced back to the controller.

The processor does the right thing internally (fetches holders → analyzes each wallet → stores result) but has no mechanism to chain a downstream similarity job using those discovered addresses.

---

## Why not just do a round-trip?

An agent could work around this today:

```
POST /intel/token/:mint/holders (20cr)
  → poll until completed
  → GET /jobs/result/by-key?key=holder-profiles:result:<requestId>
  → extract wallet addresses from result.profiles[].walletAddress
  → POST /intel/wallets/similarity (20cr) with those addresses
```

Total: 40cr, two separate calls. This works but:
- Costs 5cr more than `/deep` (no discount realized)
- Requires the agent to implement the chaining logic itself
- Adds significant latency (holder-profiles can take 3–8 min before similarity even starts)
- The `/deep` endpoint exists precisely to avoid this

---

## Proposed fix — `chainSimilarity` flag in job data

The fix must not couple the processor to the controller or introduce a new round-trip. The cleanest approach: add an optional flag to the job data that tells the processor to auto-queue a similarity job after completion, using the wallet addresses it already has in memory.

### Step 1 — Extend job data type

`src/queues/jobs/types/index.ts`:

```typescript
export interface AnalyzeHolderProfilesJobData {
  mode: 'token' | 'wallet';
  userId?: string;
  tokenMint?: string;
  topN?: number;
  walletAddress?: string;
  requestId?: string;
  _holderContext?: { ... };
  chainSimilarity?: boolean;        // NEW — if true, processor queues similarity after completion
  chainSimilarityRequestId?: string; // NEW — caller-provided requestId for the chained similarity job
}
```

### Step 2 — Controller: remove `wallets[]`, pass the flag

`src/api/controllers/intel.controller.ts`:

```typescript
// Remove IntelTokenHoldersDeepRequestDto.wallets entirely
class IntelTokenHoldersDeepRequestDto extends IntelTokenHoldersRequestDto {
  // wallets[] removed — server discovers them from Helius
}

// In queueTokenHoldersDeep:
const chainedSimilarityRequestId = `intel-holders-deep-sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const holderProfilesJobData: AnalyzeHolderProfilesJobData = {
  mode: 'token',
  userId: req.user?.id,
  tokenMint: mint,
  topN,
  requestId: holderProfilesRequestId,
  chainSimilarity: true,                              // NEW
  chainSimilarityRequestId: chainedSimilarityRequestId, // NEW
};
```

Return both requestIds to the caller upfront so they can poll the similarity result key once it appears:

```typescript
return {
  status: 'queued',
  tokenMint: mint,
  topN,
  holderProfiles: {
    jobId: holderProfilesJob.id,
    requestId: holderProfilesRequestId,
    monitoringUrl: `/api/v1/jobs/${holderProfilesJob.id}`,
  },
  similarity: {
    jobId: null,           // not queued yet — processor will queue it
    requestId: chainedSimilarityRequestId,
    resultKey: `similarity:result:${chainedSimilarityRequestId}`,
    message: 'Similarity job will be queued automatically after holder-profiles completes. Poll resultKey for result.',
  },
};
```

### Step 3 — Processor: chain similarity after holder-profiles completes

`src/queues/processors/analysis-operations.processor.ts`, in `processAnalyzeHolderProfilesWithMetrics`, after the result is stored in Redis:

```typescript
// After: await this.redisClient.set(resultKey, JSON.stringify(result), 'EX', ...)

if (job.data.chainSimilarity && result.mode === 'token' && result.success) {
  const walletAddresses = result.profiles
    .map(p => p.walletAddress)
    .filter(addr => addr && isValidSolanaAddress(addr));

  if (walletAddresses.length >= 2) {
    const walletStatuses = await this.databaseService.getWalletsStatus(walletAddresses);
    const walletsNeedingSync = walletStatuses.statuses
      .filter(s => s.status === 'STALE' || s.status === 'MISSING')
      .map(s => s.walletAddress);

    const similarityJobData: ComprehensiveSimilarityFlowData = {
      walletAddresses,
      userId: job.data.userId,
      requestId: job.data.chainSimilarityRequestId,
      walletsNeedingSync,
      enrichMetadata: false,
      includeBalances: false,
      includeVectors: false,
      failureThreshold: 0.8,
      timeoutMinutes: walletsNeedingSync.length > 0 ? 45 : 15,
      similarityConfig: { vectorType: 'capital' },
    };

    try {
      await this.similarityOperationsQueue.addSimilarityAnalysisFlow(similarityJobData, {
        priority: JobPriority.NORMAL,
        delay: 0,
      });
      this.logger.log(`Chained similarity job queued for holder-profiles job ${job.id} (${walletAddresses.length} wallets)`);
    } catch (chainError) {
      // Non-fatal — holder-profiles result is already stored. Log and continue.
      // Agent can manually call POST /intel/wallets/similarity as fallback.
      this.logger.error(`Failed to chain similarity job after holder-profiles ${job.id}: ${chainError}`);
    }
  } else {
    this.logger.warn(`chainSimilarity requested but only ${walletAddresses.length} valid wallets found — skipping`);
  }
}
```

### Step 4 — Agent polling strategy (no round-trip needed)

The agent receives `chainedSimilarityRequestId` upfront. It polls the holder-profiles job until complete, then polls `similarity:result:<chainedSimilarityRequestId>` until it appears (the processor queued the similarity job internally). No extra API call needed to discover wallet addresses.

```
POST /intel/token/:mint/holders/deep
  → { holderProfiles: { jobId, requestId }, similarity: { resultKey } }

Poll GET /jobs/<holderProfilesJobId> until completed
  → processor auto-queues similarity job using discovered holders

Poll GET /jobs/result/by-key?key=similarity:result:<chainedSimilarityRequestId>
  → 404 while similarity is still running
  → 200 with result when done
```

---

## What must not break

- **Internal `/analyses/holder-profiles` requests** — these have `requestId` starting with `holder-profiles-` and `chainSimilarity` will be `undefined` (falsy). No change to their behavior.
- **`POST /intel/token/:mint/holders`** (standalone) — no `chainSimilarity` flag, no change.
- **Cache-only refund path** — still scoped to `isInternalHolderProfilesRequest` check. `chainSimilarity` flag does not affect this.
- **Existing similarity queue** — the chained job uses the same `addSimilarityAnalysisFlow` call as the controller does today. No new code path in the similarity processor.

---

## Files to change

| File | Change |
|:-----|:-------|
| `src/queues/jobs/types/index.ts` | Add `chainSimilarity?`, `chainSimilarityRequestId?` to `AnalyzeHolderProfilesJobData` |
| `src/api/controllers/intel.controller.ts` | Remove `wallets[]` from `IntelTokenHoldersDeepRequestDto`, pass flag in job data, update response shape |
| `src/queues/processors/analysis-operations.processor.ts` | Add chain block after result stored in Redis (inject `SimilarityOperationsQueue`) |
| `documentation/skill/SKILL.md` | Update `/deep` curl example + description (remove `wallets[]` from body) |

---

## Current workaround (for agents using the broken endpoint today)

Call separately:

```bash
# Step 1 — queue holder-profiles (20cr)
curl -X POST http://localhost:3001/api/v1/intel/token/TOKEN_MINT/holders \
  -H "X-Api-Key: ak_your_key" \
  -H "Content-Type: application/json" \
  -d '{"topN": 20}'

# Step 2 — poll until completed, then read result
curl "http://localhost:3001/api/v1/jobs/result/by-key?key=holder-profiles:result:REQUEST_ID" \
  -H "X-Api-Key: ak_your_key"

# Step 3 — extract walletAddresses from result.profiles[].walletAddress
# Step 4 — queue similarity (20cr)
curl -X POST http://localhost:3001/api/v1/intel/wallets/similarity \
  -H "X-Api-Key: ak_your_key" \
  -H "Content-Type: application/json" \
  -d '{"wallets": ["ADDR_1", "ADDR_2", ...]}'
```

Total: 40cr. The fixed `/deep` will cost 35cr and require no manual chaining.
