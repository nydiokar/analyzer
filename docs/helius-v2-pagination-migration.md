### Helius V2 Pagination Migration Plan (Cursor-Based APIs)

This document is an implementation-ready guide to adopt Helius V2 cursor-based pagination for token-account queries, with a feature flag, automatic fallback, and optional incremental updates via changedSinceSlot. It includes ideation, technical design, risks, rollout, and a step-by-step task list an LLM can execute.

- Reference: Helius Optimization Techniques — Enhanced Pagination Methods (V2) (`https://www.helius.dev/docs/rpc/optimization-techniques#enhanced-pagination-methods-v2`)

---

### Why adopt V2 (benefits)
- Reliability at scale: Cursor pagination with high per-page limits reduces timeouts for large owners.
- Lower latency/cost: Fewer round trips; stream pages instead of loading all at once.
- Incremental sync: Use changedSinceSlot for fast re-reads.
- Minimal churn: Swap internals of existing client method; keep callers and return types stable.

---

### Scope and affected areas in this repo
- Calls to `getTokenAccountsByOwner(...)`:
  - `src/core/services/wallet-balance-service.ts`
  - `src/queues/processors/similarity-operations.processor.ts`
  - `src/core/services/token-first-buyers-service.ts` (mint-specific, typically 0–1 ATA → low impact)
- Only `HeliusApiClient.getTokenAccountsByOwner(...)` needs internal changes. Callers remain unchanged.

---

### Functional goals
1) Use `getTokenAccountsByOwnerV2` with cursor pagination and a safe page size (2k–5k) and return the legacy `GetTokenAccountsByOwnerResult` shape `{ context, value }` to callers.
2) Automatic fallback to V1 on method/validation errors; log once at warn.
3) Optional incremental mode using `changedSinceSlot` with a per-owner watermark stored in DB. Update watermark only after successful sweep.
4) Optional payload reduction via `dataSlice` when only counts are needed.

---

### Feature flag and configuration
- Env: `ENABLE_HELIUS_V2_PAGINATION` → `true|false` (default: true in staging/prod, false in local if you prefer).
- Optional env to tune page size: `HELIUS_V2_PAGE_LIMIT` (default: 5000; min 1000, max 10000 per docs).
- Optional env to enable incremental fetch: `ENABLE_HELIUS_V2_INCREMENTAL` → `true|false` (default: false until watermark table is added).
- Add to `src/config/constants.ts`:
  - `export const HELIUS_V2_CONFIG = { enablePagination: boolFromEnv('ENABLE_HELIUS_V2_PAGINATION', true), pageLimit: numFromEnv('HELIUS_V2_PAGE_LIMIT', 5000), enableIncremental: boolFromEnv('ENABLE_HELIUS_V2_INCREMENTAL', false) } as const;`

---

### API behavior mapping (V2 → legacy shape)
- V2 request (internal):
```json
{
  "jsonrpc": "2.0",
  "id": "get-token-accounts-v2",
  "method": "getTokenAccountsByOwnerV2",
  "params": [
    "OWNER_PUBKEY",
    {
      "mint": "OPTIONAL_MINT",
      "encoding": "jsonParsed",
      "limit": 5000,
      "paginationKey": "OPTIONAL",
      "changedSinceSlot": 235000000
    }
  ]
}
```
- V2 response (conceptual): `{ accounts: [...], paginationKey?: string, context: { slot, apiVersion? } }`
- Adaptation: aggregate `accounts` across pages into legacy `.value` array; propagate `context.slot`.
- Fallback trigger conditions: RPC `-32601` (method not found), invalid params, or schema mismatch. On trigger: log once (warn), switch to V1 for this process.

---

### Database addition for incremental (optional, recommended)
- Add a watermark table to persist the last processed slot per owner and filter:
  - Suggested Prisma model (simplified):
```prisma
model OwnerTokenAccountWatermark {
  id                String   @id @default(cuid())
  ownerPubkey       String
  filterKey         String   // e.g. "spl-token-all" or `mint:<mint>`
  lastProcessedSlot Int
  updatedAt         DateTime @updatedAt
  @@unique([ownerPubkey, filterKey])
}
```
- Filter key examples:
  - All SPL: `program:spl-token`
  - Token-2022: `program:token-2022`
  - Specific mint: `mint:<mint-address>`
- Watermark advancement rule: update only after a successful full page sweep for the given filter.

---

### Implementation steps (exact sequence)
1) Types (non-breaking):
   - `src/types/helius-api.ts`: optionally add V2 response interfaces (not required if you adapt to legacy shape internally). If adding:
     - `GetTokenAccountsByOwnerV2Response` with `{ accounts: TokenAccount[]; paginationKey?: string; context: { slot: number; apiVersion?: string } }`.

2) Config:
   - `src/config/constants.ts`: add `HELIUS_V2_CONFIG` helpers and defaults (see Feature flag section).

3) Client internals:
   - `src/core/services/helius-api-client.ts` → `getTokenAccountsByOwner(...)`:
     - If `HELIUS_V2_CONFIG.enablePagination` is true, call a new private helper `fetchAllTokenAccountsByOwnerV2(...)` that:
       - Builds the V2 payload with `{ encoding, limit, paginationKey, changedSinceSlot? }`.
       - Loops until `paginationKey` is absent.
       - Aggregates `accounts` and returns `{ context, value }` in legacy shape.
       - Streams pages to avoid memory spikes (push into the array but consider yielding to event loop between pages).
     - On any V2 hard failure (method not found, invalid params), log-once warn, set an in-memory circuit variable `this.disableV2ForProcess = true`, and fall back to existing V1 path.
     - Preserve existing rate limiter/backoff.

4) Incremental mode (optional initially):
   - Add `DatabaseService` methods:
     - `getOwnerTokenAccountWatermark(ownerPubkey: string, filterKey: string): Promise<number | null>`
     - `setOwnerTokenAccountWatermark(ownerPubkey: string, filterKey: string, slot: number): Promise<void>`
   - In `fetchAllTokenAccountsByOwnerV2(...)`:
     - Build `filterKey` from params (mint or program).
     - If `HELIUS_V2_CONFIG.enableIncremental` is true and watermark exists, pass `changedSinceSlot`.
     - After full success, advance watermark to `response.context.slot` (from the last page or the highest slot seen).

5) Utilization improvements at call sites (no required changes now):
   - `SimilarityOperationsProcessor.detectSystemWalletsEarly()`:
     - If only counts are needed, consider using `dataSlice` to reduce payload (keep `jsonParsed` when reusing parsed data).
   - `WalletBalanceService.fetchWalletBalancesRaw()`:
     - No change required; benefits from V2 internally. Optionally, tune commitment and page size via envs.
   - `TokenFirstBuyersService`: low impact; leave unchanged.

6) Logging and metrics:
   - Log once on fallback: `Helius V2 disabled for this process due to <reason>`.
   - Optional counters (debug): v2_pages_fetched, v2_total_accounts, v2_errors, fallback_to_v1_count.

---

### Pseudocode: V2 fetch loop (client helper)
```ts
async function fetchAllTokenAccountsByOwnerV2(ownerPubkey, { mint, programId, encoding, pageLimit, changedSinceSlot }): Promise<GetTokenAccountsByOwnerResult> {
  const limit = clamp(pageLimit, 1000, 10000);
  const paramsBase: any = { encoding: encoding ?? 'jsonParsed', limit };
  if (mint) paramsBase.mint = mint; else paramsBase.programId = programId;
  if (Number.isFinite(changedSinceSlot)) paramsBase.changedSinceSlot = changedSinceSlot;

  let paginationKey: string | undefined;
  const aggregated: any[] = [];
  let contextSlot: number = 0;

  do {
    const params = paginationKey ? [{ ...paramsBase, paginationKey }] : [paramsBase];
    const { result, error } = await postRpc('getTokenAccountsByOwnerV2', [ownerPubkey, ...params]);
    if (error) throw rpcError(error);
    if (result?.accounts?.length) aggregated.push(...result.accounts);
    paginationKey = result?.paginationKey;
    contextSlot = result?.context?.slot ?? contextSlot;
    await rateLimit(); // reuse existing limiter
  } while (paginationKey);

  return { context: { slot: contextSlot }, value: aggregated };
}
```

---

### Testing plan
- Unit (mock axios):
  - Single page and multi-page aggregation.
  - Fallback to V1 on -32601 or invalid params.
  - Incremental with `changedSinceSlot` and watermark rules.
  - Adapter correctness: returned `.value` equals concatenated V2 `accounts`.
- Integration (staging key):
  - Large owner pagination end-to-end.
  - Re-run with incremental enabled and verify fewer pages and stable results.

---

### Rollout plan
1) Ship behind `ENABLE_HELIUS_V2_PAGINATION` flag; default on in staging.
2) Canary: run against large/system wallets; track fallbacks/timeouts.
3) Enable in production; keep flag as kill-switch.
4) After 24–48h stable, consider enabling `ENABLE_HELIUS_V2_INCREMENTAL`.

---

### Risks and mitigations
- Upstream rollout bugs → Feature flag + auto-fallback keeps stability.
- Pagination key misuse → Always rebuild params from the same filter set; do not reuse keys across different filters.
- Watermark skew/reorgs → Use `confirmed` by default; allow `finalized` override. Update watermark only after full success.
- Memory pressure → Stream pages; avoid building massive intermediate structures.

---

### Step-by-step LLM task checklist (do these in order)
1) Add env & constants:
   - Create `ENABLE_HELIUS_V2_PAGINATION`, `HELIUS_V2_PAGE_LIMIT`, `ENABLE_HELIUS_V2_INCREMENTAL` in `.env.example` and `.env` docs.
   - In `src/config/constants.ts`, add `HELIUS_V2_CONFIG` with helpers.
   - Acceptance: `HELIUS_V2_CONFIG` available and typed.

2) Types (optional but recommended):
   - Update `src/types/helius-api.ts` with V2 response type names if needed.
   - Acceptance: Type-check passes; no callers changed.

3) Client implementation:
   - In `src/core/services/helius-api-client.ts`:
     - Add private `fetchAllTokenAccountsByOwnerV2(...)` (per pseudocode) using existing `makeRpcRequest` or a local RPC POST with `this.rpcUrl`.
     - Update `getTokenAccountsByOwner(...)` to prefer V2 when `HELIUS_V2_CONFIG.enablePagination` is true; on error, log-once warn and fallback to V1.
   - Acceptance: Existing callers compile and return identical shapes.

4) Optional incremental:
   - Prisma: add `OwnerTokenAccountWatermark` model. Run migration.
   - `DatabaseService`: add `getOwnerTokenAccountWatermark`/`setOwnerTokenAccountWatermark`.
   - Wire the watermark into the V2 helper as `changedSinceSlot`.
   - Acceptance: Repeated calls with incremental enabled fetch fewer pages without losing updates.

5) Utilization enhancements (optional):
   - `similarity-operations.processor.ts`: if only counts are needed in early detection, add a mode that uses `dataSlice` to reduce payload; otherwise keep `jsonParsed` for reuse.
   - Acceptance: Behavior identical; lower payload when count-only path is used.

6) Tests:
   - Add unit tests for V2 loop, fallback, incremental, and adapter.
   - Optional integration smoke test script against staging.
   - Acceptance: Green tests; manual run confirms pages aggregate correctly.

7) Rollout:
   - Enable flag in staging; measure page counts, latency, error/fallback counts.
   - Promote to prod if metrics are healthy; keep flag as kill switch.

---

### Verification checklist (manual)
- Large-wallet balance fetch returns without timeouts; token count matches previous baseline.
- Early system-wallet detection no longer trips memory/stack overflow on oversized wallets.
- Fallback metric remains near zero.
- With incremental on, second run fetches substantially fewer pages.

---

### Notes on maximizing utility per docs
- Use high `limit` (up to 10k) when safe; prefer 2k–5k for smoothness.
- Prefer `jsonParsed` where balances/data are reused; use `dataSlice` to minimize payload for count-only checks.
- Choose `commitment: 'confirmed'` unless you require `finalized` consistency.
- Pair with your existing global rate limiter and exponential backoff.

---

### Appendix: Minimal V2 POST example
```bash
curl -sS -X POST "https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "getTokenAccountsByOwnerV2",
    "params": [
      "OWNER_PUBKEY",
      { "encoding": "jsonParsed", "limit": 5000 }
    ]
  }'
```


