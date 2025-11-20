Smart TokenBadge Architecture - Centralized Metadata Handling ✅
Last Updated: 2025-11-20

STATUS: TokenBadge is now self-sufficient and handles enrichment automatically.

## What Changed:

### Problem:
- Token metadata enrichment logic was scattered across multiple components
- Every component using TokenBadge had to manually fetch & pass metadata
- Duplicate enrichment calls happening everywhere
- Inconsistent patterns (exit timing did enrichment, token performance didn't)
- Performance issues from redundant API calls

### Solution: Smart TokenBadge Component

**TokenBadge is now self-sufficient:**
```tsx
// BEFORE: Manual enrichment everywhere
const data = await fetch('/wallets/123/exit-timing-tokens/day')
const enrichedTokens = data.tokens // Backend enriched it
<TokenBadge mint={token.mint} metadata={token.metadata} />

// NOW: TokenBadge handles everything
const data = await fetch('/wallets/123/exit-timing-tokens/day')
const mints = data.tokens // Backend just returns mints
<TokenBadge mint={mint} /> // Fetches metadata automatically
```

## Implementation Details:

### 1. Smart TokenBadge (dashboard/src/components/shared/TokenBadge.tsx)
- **Auto-fetches metadata**: If no metadata provided, calls POST `/token-info` automatically
- **Triggers enrichment**: POST `/token-info` triggers background enrichment job
- **Performance optimized**: Accepts optional metadata prop to avoid fetching when parent has it
- **Documented**: Added comprehensive JSDoc explaining usage patterns

### 2. Exit Timing Endpoint Simplified (src/api/controllers/wallets.controller.ts:917-988)
- **BEFORE**: Backend enriched tokens, returned full metadata objects
- **NOW**: Backend reads cached `holdTimeTokenMap` from database, returns mint addresses only
- **Fast**: Database read (~5ms) instead of enrichment orchestration
- **Response**: `{ tokens: ['mint1', 'mint2', ...], count: N }`

### 3. Frontend Simplified (dashboard/src/components/holder-profiles/v2/ExitTimingDrilldownPanel.tsx)
- **BEFORE**:
  - Fetch enriched tokens
  - Handle refreshing after enrichment
  - Pass all metadata fields to TokenBadge
- **NOW**:
  - Fetch mint addresses
  - Pass to TokenBadge
  - TokenBadge handles rest

### 4. Caching Architecture (from previous fix)
- `holdTimeTokenMap` stored in `WalletBehaviorProfile` database table
- No more re-running full behavior analysis on every click
- Backend reads cached data instantly

## Usage Guidelines:

### When to pass metadata (optional optimization):
```tsx
// Bulk operations where parent fetches metadata for many tokens
const response = await fetcher('/wallets/123/token-performance')
response.data.map(token => (
  <TokenBadge
    mint={token.tokenAddress}
    metadata={token} // Parent already has it, pass it down
  />
))
```

### When to let TokenBadge fetch (recommended for simple cases):
```tsx
// Small lists, drilldowns, single tokens
const mints = await fetcher('/wallets/123/exit-timing-tokens/day')
mints.tokens.map(mint => (
  <TokenBadge mint={mint} /> // Fetches automatically
))
```

## Components Updated:

1. **TokenBadge.tsx** - Now smart with auto-fetch logic
2. **ExitTimingDrilldownPanel.tsx** - Simplified to just fetch mints
3. **WalletsController** - Exit timing endpoint returns mints only
4. **BehaviorService** - Reads from cached database profile

## Components NOT Changed (already optimal):

- **TokenPerformanceTab.tsx** - Already passes metadata from API response
- **TopHoldersPanel.tsx** - Already passes metadata
- **TokenHoldingRow.tsx** - Already passes metadata
- **MostCommonTokens.tsx** - Already passes metadata with custom wrapper

## Benefits:

✅ **DRY Principle**: ONE place handles enrichment (TokenBadge)
✅ **Performance**: No duplicate enrichment calls
✅ **Simplicity**: Components just pass mint address
✅ **Consistency**: All tokens show metadata the same way
✅ **Flexibility**: Metadata prop still works for optimization
✅ **Fast**: Backend returns cached mints instantly
✅ **Self-documenting**: JSDoc explains usage patterns

## Important Rules:

⚠️ **DO NOT** manually call enrichment APIs when using TokenBadge
⚠️ **DO NOT** fetch token metadata separately before passing to TokenBadge (unless optimizing bulk operations)
⚠️ **DO** just pass the mint address for simple cases
⚠️ **DO** pass metadata when parent already has it (e.g., from table/list API response)

## Testing:

- Exit timing drilldown shows tokens with metadata ✅
- No duplicate enrichment calls in logs ✅
- TokenBadge shows fallback while loading ✅
- Metadata appears after enrichment completes ✅
- Works with or without metadata prop ✅
