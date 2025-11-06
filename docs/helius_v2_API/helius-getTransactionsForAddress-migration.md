## Migration to Helius getTransactionsForAddress (Phase 1 only)

Reference: Helius getTransactionsForAddress docs: [`https://www.helius.dev/docs/rpc/gettransactionsforaddress`](https://www.helius.dev/docs/rpc/gettransactionsforaddress)

**Implementation Status:** ✅ **COMPLETE BUT NOT RECOMMENDED** (Phase 1 implemented 2025-11-06)
- Feature is behind flag `ENABLE_HELIUS_TX_FOR_ADDRESS_SIGNATURES` (default: `false`)
- ⚠️ **Cost-benefit analysis shows this is NOT worthwhile to enable**
- V2 costs 100 credits/page vs 0 for legacy `getSignaturesForAddress`
- Performance gain is minimal (~100ms for 2000 signatures, ~15% Phase 1 improvement)
- Phase 2 (real bottleneck at ~10 seconds) uses same `/v0/transactions` endpoint
- **Recommendation:** Keep disabled unless Helius deprecates legacy endpoint
- Full backward compatibility maintained with automatic fallback to legacy
- See [Cost-Benefit Analysis](#cost-benefit-analysis) section below

### Context and current architecture

Today our transaction ingestion is split into two phases inside `HeliusApiClient.getAllTransactionsForAddress`:

- Phase 1 (discovery): page `getSignaturesForAddress` (RPC, 1000/page) to collect signatures, optionally bounded by a stop signature and time filters; then apply client-side filters.
- Phase 2 (enrichment): batch-fetch enriched transactions for uncached signatures via Helius Enhanced Transactions API (`/v0/transactions`), stream-map to our DB, and update wallet state.

`HeliusSyncService` orchestrates “newer” first and optionally “older” fetches, passing state (`newestProcessedTimestamp`, `firstProcessedTimestamp`, `newestProcessedSignature`) and limits, while streaming batches to the mapper and DB.

### What changes with getTransactionsForAddress

The new endpoint unifies signature discovery with:

- Server-side filtering: time (`blockTime {gte/gt/lte/lt/eq}`), slot, signature bounds, and status.
- Sorting: `asc` (chronological) or `desc` (newest-first).
- Pagination: single `paginationToken` (format `slot:position`).
- Detail levels:
  - `transactionDetails: "signatures"` (up to 1000/page; fastest; ideal for discovery)
  - `transactionDetails: "full"` (up to 100/page; mirrors `getTransaction` encoding)

Important: our mapper relies on Enhanced transactions (fields like `tokenTransfers`, `nativeTransfers`, `events.swap`), which come from `/v0/transactions`. The RPC "full" encoding mirrors standard `getTransaction`, not Enhanced. Therefore, for now we keep Phase 2 unchanged and swap only Phase 1 to this new endpoint.

### Do we drop “newer” / “older” flows?

- For stateful syncing, “newer vs older” is still conceptually useful (we need to advance newest and optionally backfill oldest). With the new endpoint, these become server-side filters instead of bespoke client loops.
- For dashboard/analytics requesting a specific period: yes, we can query precise time windows directly via `filters.blockTime` and appropriate `sortOrder`, and then enrich those signatures in Phase 2.
- Net: we keep the semantics but unify the mechanism under one query interface (period- or boundary-based), using server-side time/signature filters.

### Phase 1 migration: exact behavior

- Replace `getSignaturesForAddress` with `getTransactionsForAddress` in `transactionDetails: "signatures"` mode.
- Preserve page size 1000.
- Push boundaries to server via `filters` to minimize over-fetch:
  - Newer: `filters.blockTime.gt = newestProcessedTimestamp` (and `status: "succeeded"` when appropriate), `sortOrder: "asc"`.
  - Older: `filters.blockTime.lte = firstProcessedTimestamp`, `sortOrder: "desc"`.
  - Stop at signature: `filters.signature.lt = stopAtSignature` (or `lte`).
- Use `paginationToken` for sequential pages.
- Keep `commitment: "finalized"` and `maxSupportedTransactionVersion: 0` for consistency.
- Continue Phase 2 enrichment with `/v0/transactions` unchanged.

### Limits, cost, and performance

- Signatures mode still returns up to 1000 items/page, but is much faster and more flexible due to server-side filters and cursor.
- "Full" mode returns up to 100 items/page; we will not adopt it now because we need Enhanced payloads. If a feature only needs standard Solana tx detail and not Enhanced, it could optionally use "full" mode later.
- Cost: docs note this endpoint requires a Developer plan and costs 100 credits/request. Using precise time windows and status filters reduces page count. Monitor credit spend per wallet.

Optional pre-triage for newest page(s):
- For the most recent page(s), you may call `getTransactionsForAddress` with `transactionDetails: "full"` and `encoding: "jsonParsed"` to quickly compute per-account SOL/SPL deltas and determine relevance before calling Enhanced.
- Only send signatures that actually touch the wallet to `/v0/transactions`. This can reduce Enhanced volume while keeping Phase 2 for swap attribution and enriched transfers.
- Keep the cap at ≤100 for "full" pages; use this only as a fast filter for the freshest batches, not for full history.

### Concrete call templates (Phase 1)

Newer (chronological, signatures only):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTransactionsForAddress",
  "params": [
    "WALLET",
    {
      "transactionDetails": "signatures",
      "sortOrder": "asc",
      "limit": 1000,
      "filters": {
        "blockTime": { "gt": NEWEST_TS },
        "status": "succeeded"
      },
      "commitment": "finalized",
      "maxSupportedTransactionVersion": 0
    }
  ]
}
```

Older (newest-first, signatures only):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTransactionsForAddress",
  "params": [
    "WALLET",
    {
      "transactionDetails": "signatures",
      "sortOrder": "desc",
      "limit": 1000,
      "filters": { "blockTime": { "lte": FIRST_TS } }
    }
  ]
}
```

Stop at signature boundary (example):

```json
"filters": { "signature": { "lt": "STOP_SIG" } }
```

Pagination (next page):

```json
{
  "transactionDetails": "signatures",
  "limit": 1000,
  "paginationToken": "SLOT:POSITION"
}
```

### Code integration plan (minimal change, behind a flag)

✅ **IMPLEMENTED** (2025-11-06)

- `HeliusApiClient` (`src/core/services/helius-api-client.ts`)
  - ✅ Added `getTransactionsForAddressSignatures` wrapper that posts RPC method `getTransactionsForAddress` with signatures detail, filters, sort, limit, `paginationToken`.
  - ✅ In `getAllTransactionsForAddress`, behind flag `HELIUS_V2_CONFIG.enableTransactionsForAddressSignatures`, uses this wrapper for Phase 1 instead of `getSignaturesForAddress`.
  - ✅ On hard failure (method not found / invalid params / RPC error), falls back to legacy and sets `disableV2TxForAddressForProcess` circuit breaker.
  - ✅ Server-side filtering implemented:
    - Time-based: `filters.blockTime.gt` for newer sync, `filters.blockTime.lte` for older sync
    - Signature boundary: `filters.signature.lt` for stopAtSignature
    - Status filtering: `filters.status = 'succeeded'` for newer sync (configurable)
  - ✅ Separate pagination state: `v2PaginationToken` for V2, `lastRpcSignature` for legacy
  - ✅ Telemetry tracking: page count, credit usage (100 per V2 request), duration, total signatures

- `HeliusSyncService` (`src/core/services/helius-sync-service.ts`)
  - ✅ No changes required - server-side filtering is transparent to sync service
  - ✅ Existing time/signature bounds are automatically mapped to server-side filters
  - ✅ Streaming, mapping, and DB updates work identically with V2
  - ⚠️ Pre-triage optimization (using `transactionDetails: "full"`) NOT implemented - deferred as optional optimization

- Config (`src/config/constants.ts`)
  - ✅ Added flags to `HELIUS_V2_CONFIG`:
    - `enableTransactionsForAddressSignatures` (env: `ENABLE_HELIUS_TX_FOR_ADDRESS_SIGNATURES`, default: `false`)
    - `txForAddressSignaturesPageLimit` (env: `HELIUS_TX_FOR_ADDRESS_PAGE_LIMIT`, default: `1000`, range: 100-1000)
    - `txForAddressUseStatusSucceededForNewer` (env: `HELIUS_TX_FOR_ADDRESS_USE_STATUS_SUCCEEDED`, default: `true`)

### Acceptance criteria

- End-to-end sync (newer and older) produces the same DB results as legacy path when run to completion, with fewer calls and lower wall-clock time.
- Incremental runs fetch only truly new data via server-side time filters.
- Credit usage is monitored and stable per wallet under typical workloads.

### Cost-Benefit Analysis

**Test Results (2025-11-06):**

Tested with 2000 transactions on two different wallets:

```
Legacy (getSignaturesForAddress):
  - Phase 1: 663ms, 2 pages, 0 credits
  - Phase 2: ~9.5 seconds (Enhanced /v0/transactions, same for both paths)
  - Total: 10132ms

V2 (getTransactionsForAddress signatures mode):
  - Phase 1: 565ms, 2 pages, 200 credits
  - Phase 2: ~11 seconds (Enhanced /v0/transactions, same for both paths)
  - Total: 11666ms

Delta:
  - Phase 1: V2 saves 98ms (14.8% faster) ✅
  - Cost: V2 costs 200 credits vs 0 for legacy ❌
  - Total time: V2 is actually 1534ms slower (variance) ⚠️
```

**Conclusion:**
- ❌ **Not cost-effective:** Spending 100 credits per 1000 signatures to save ~50ms is poor ROI
- ❌ **Phase 2 unchanged:** The real bottleneck (~10 seconds for 2000 txs) uses the same `/v0/transactions` endpoint
- ⚠️ **No filtering benefit:** We still fetch full Enhanced data for all signatures
- ✅ **Keep as fallback:** Useful infrastructure if Helius deprecates `getSignaturesForAddress`

**When to enable:**
1. Helius deprecates `getSignaturesForAddress` RPC method
2. You implement Phase 2 optimization (using V2 `transactionDetails: "full"` to pre-filter signatures)
3. You need server-side time/signature filtering for specific use cases
4. Credit cost becomes negligible relative to performance needs

### Rollout

**Current Status: Implemented but DISABLED by default** (as of 2025-11-06)

**To enable for testing:**
```bash
# Set environment variable
ENABLE_HELIUS_TX_FOR_ADDRESS_SIGNATURES=true

# Optional: adjust page limit (100-1000, default 1000)
HELIUS_TX_FOR_ADDRESS_PAGE_LIMIT=1000

# Optional: disable status filter for newer sync (default true)
HELIUS_TX_FOR_ADDRESS_USE_STATUS_SUCCEEDED=false
```

**Rollout Steps:**
1) ✅ **Implemented** - Feature behind flag `ENABLE_HELIUS_TX_FOR_ADDRESS_SIGNATURES` (default: `false`)
2) **Testing Phase** (current) - Enable flag in test environment, run wallet syncs, monitor:
   - Telemetry logs: `Phase 1 Telemetry: Pages=X, Credits=Y, Duration=Zms, Signatures=N`
   - Compare page counts and duration vs legacy
   - Verify DB results match legacy path (same signatures, same transactions)
   - Monitor for circuit breaker triggers (logged as warnings if V2 fails)
3) **Burn-in** - Run on production sample set for 1-2 days with flag enabled
4) **Make default** - Change `HELIUS_V2_CONFIG.enableTransactionsForAddressSignatures` default from `false` to `true` in `src/config/constants.ts`
5) **Optional optimization** - For features not requiring Enhanced payloads, consider using `transactionDetails: "full"` directly

**Monitoring Points:**
- Circuit breaker activation: `"Helius getTransactionsForAddress V2 disabled for this process due to hard failure"`
- Telemetry comparison: V2 should show `Pages <= legacy pages` and `Duration <= legacy duration`
- Credit usage: V2 costs 100 credits/request (same as legacy Enhanced transactions)
- Error rates: Should be identical between V2 and legacy paths

### Utilities

- Script to compare endpoints and validate Phase 1/2 assumptions: `scripts/compare_helius_endpoints.ts`.
  - Reads `HELIUS_API_KEY` from environment (supports `.env`).
  - Compares discovery parity between `getSignaturesForAddress` and `getTransactionsForAddress(transactionDetails: "signatures")`.
  - Confirms that `transactionDetails: "full"` lacks Enhanced-only fields vs `/v0/transactions`.
  - Example run (PowerShell):

```
npx ts-node scripts/compare_helius_endpoints.ts WALLET_ADDRESS --limit 200 --network mainnet
```

### Replacing Phase 2 using getTransactionsForAddress (full) — considerations and plan (DEFFER not worht the overhead)

Helius `getTransactionsForAddress` supports `transactionDetails: "full"` (limit ≤ 100) with encodings identical to `getTransaction` (`json`, `jsonParsed`, `base64`, `base58`). Our current Phase 2 relies on Helius Enhanced Transactions (`/v0/transactions`) which include pre-parsed, enriched fields (`tokenTransfers`, `nativeTransfers`, `events.swap`, etc.) used by our mapper. Fully replacing Phase 2 means consuming standard Solana transaction/meta formats and re-implementing enrichment logic we currently get from Helius.

Key differences vs current mapper inputs:

- Current: `HeliusTransaction` (Enhanced) provides:
  - `tokenTransfers[]`, `nativeTransfers[]`, `accountData[]` with balance deltas
  - `events.swap` with token inputs/outputs, amounts, user accounts
  - `feePayer`, `signature`, `timestamp`
- New (standard full tx via RPC):
  - `transaction.message.accountKeys`, versioned messages, address table lookups
  - `meta.preBalances`/`postBalances` (lamports), `meta.preTokenBalances`/`postTokenBalances`
  - `meta.innerInstructions` with low-level instructions; `meta.logMessages`
  - Optional `blockTime`, `slot`, `err`

Implications for the mapper (`mapHeliusTransactionsToIntermediateRecords`):

- Address relevance filtering:
  - Replace checks against `tokenTransfers/nativeTransfers/events.swap` with logic derived from:
    - SOL changes: `meta.postBalances[i] - meta.preBalances[i]`
    - SPL changes: compare `meta.preTokenBalances` vs `meta.postTokenBalances` per account/mint
    - Fee payer: `transaction.message.accountKeys[0]` (or explicit `feePayer` if available)
- Token amount/decimals:
  - Use `meta.preTokenBalances[*].uiTokenAmount.decimals` (jsonParsed) when available; otherwise resolve mint decimals via `getTokenSupply`/`getMint` or cached metadata.
- Transfer extraction:
  - For SOL: derive from balance deltas
  - For tokens: infer deltas per (account, mint); inner instructions may provide transfer ops if using `jsonParsed` encoding
- Swap detection (hard part):
  - Our current `events.swap` is protocol-agnostic thanks to Helius enrichment. With standard RPC data, we need protocol-aware heuristics:
    - Identify CPI/program IDs (Raydium, Orca, Meteora, Whirlpool, Jupiter, etc.) via `innerInstructions` `programIdIndex` and logs
    - Reconstruct input/output token amounts from per-account deltas
    - Attribute to the user account (fee payer or detected associated token accounts)
  - This is a significant engineering effort and the primary risk area for parity.

Performance and cost:

- Limit: `full` returns up to 100 tx per request. `/v0/transactions` often batches ~100 signatures per request. Request counts are similar, but `getTransactionsForAddress` adds powerful server-side filtering and linear pagination.
- Credits: `getTransactionsForAddress` costs 100 credits/request (per docs). Validate current `/v0/transactions` billing and compare under our typical workloads before flipping defaults. Cost: Enhanced Transactions costs 100 credits; getTransactionsForAddress also costs 100

Recommended staged plan to replace Phase 2:

1) Minimal viable enrichment (no swaps):
   - Use `transactionDetails: "full"` with `encoding: "jsonParsed"`.
   - Implement mapper path that builds our intermediate records with:
     - SOL transfers and SPL transfers (sender/receiver/amount/mint)
     - Fee payer and timestamps/signatures
   - Skip `events.swap` initially; gate features that depend on swaps behind the current Enhanced path.

2) Hybrid routing by feature:
   - For dashboards/metrics that don’t require swap attribution, source from the new Phase 2 (full RPC) path.
   - Keep Enhanced `/v0/transactions` for swap/KPI features until parity.

3) Protocol plugin architecture for swaps:
   - Introduce a mapper plugin interface: given standard tx/meta, detect and produce a normalized `events.swap` equivalent.
   - Start with most common sources (Jupiter routed swaps, Raydium, Orca). Use log messages and known program IDs.
   - Validate with a golden set of historical tx signatures and compare against current Enhanced outputs.

4) Parity and flip:
   - When coverage reaches >95% parity on sampled wallets, offer a feature flag to route all Phase 2 through `getTransactionsForAddress(full)`.
   - Maintain fallback to Enhanced in case of protocol changes.

Concrete API template for Phase 2 (full):

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTransactionsForAddress",
  "params": [
    "WALLET",
    {
      "transactionDetails": "full",
      "encoding": "jsonParsed",
      "sortOrder": "asc",  // or "desc" depending on the stage
      "limit": 100,
      "filters": {
        "blockTime": { "gte": START_TS, "lt": END_TS },
        "status": "succeeded"
      },
      "maxSupportedTransactionVersion": 0
    }
  ]
}
```

Mapper refactor checklist:

- Define a `StandardTransaction` input type mirroring `getTransaction(jsonParsed)` response.
- Add converters:
  - SOL deltas → nativeTransfers
  - SPL deltas → tokenTransfers
  - Derive `feePayer`, timestamp, signature, slot
- Keep existing IntermediateRecord schema, but make `events.swap` optional when not detected.
- Build protocol detectors (heuristics) incrementally and unit test each.

Testing and validation:

- Create fixtures of transactions and expected IntermediateRecords derived from the current Enhanced path.
- Run both pipelines on sampled wallets; diff IntermediateRecords and P/L end results.
- Track mismatch categories (amount rounding, protocol mis-detection, missing swap attribution) and iterate.

Risk summary:

- The biggest risk is swap attribution parity. Until protocol detectors mature, rely on Enhanced for swap-dependent features.
- Some txs lack `blockTime` (rare). Use slot-based filters as secondary bounds when needed.
- Versioned messages and address lookup tables must be handled when resolving account keys.

Rollout suggestion for Phase 2 replacement:

- Start as opt-in (feature flag) for analytics that don’t depend on swaps.
- Keep `/v0/transactions` as the default for P/L and behavioral metrics until detectors are proven.
- Maintain dual-path for a while; decide based on parity metrics and cost/latency measurements.

### FAQ

- Can we remove “newer/older” entirely? For stateful database sync, we still advance newest and (optionally) backfill oldest. The new endpoint lets us implement both with precise time/signature filters rather than distinct traversal code paths. For dashboard/period queries, we can directly specify ranges and skip split phases.
- Can we drop Phase 2 now? Not safely—our mapper depends on Enhanced fields only provided by `/v0/transactions`. We keep Phase 2 unchanged to retain behavior and schema.

—

Docs: [`https://www.helius.dev/docs/rpc/gettransactionsforaddress`](https://www.helius.dev/docs/rpc/gettransactionsforaddress)

