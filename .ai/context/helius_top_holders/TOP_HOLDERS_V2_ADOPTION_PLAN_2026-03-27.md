# Helius Top Holders V2 Adoption Plan

Date: 2026-03-27
Scope: add a side-by-side `getProgramAccountsV2` path for token holders without breaking the current `getTokenLargestAccounts` flow.

## Goal

Keep the current top-20 path intact, but add a new internal method that can produce true top-N holders such as top 50 or top 100 when we decide to switch specific flows over.

Primary constraints:
- minimal disruption to the repo
- easy runtime selection between legacy and V2 paths
- support both legacy SPL Token and Token-2022 mints
- avoid the foot-shot of returning thousands of zero-balance token accounts for large mints

## Current Behavior

Observed in code:
- `src/api/services/token-holders.service.ts` calls `HeliusApiClient.getTokenLargestAccounts(mint, commitment)`.
- `src/core/services/helius-api-client.ts` documents that `getTokenLargestAccounts` is capped at 20 by RPC.
- `src/api/controllers/token-info.controller.ts` exposes `GET :mint/top-holders` with no `topN` parameter today.

Result:
- current endpoint can only return the RPC-native top 20
- it cannot produce top 50 without a different fetch path
- it will also fail for Token-2022 mints if we keep assuming `Tokenkeg...` for deeper account scans

## Root Cause

The limitation is not in our service layer. It is in the upstream RPC method choice:
- `getTokenLargestAccounts` returns at most 20
- `getProgramAccountsV2` can return all token accounts for a mint, but it is not pre-sorted by balance

So the real top-50 solution is:
1. fetch token accounts for the mint with `getProgramAccountsV2`
2. parse owner + amount
3. drop zero balances early in our code path
4. rank client-side
5. hydrate only the final selected holders with any extra metadata/labels we need

## Live Findings For Example Mint

Mint tested:
- `J5DnHXXmKsXmCAeSvPRc5qR64ruYKcZHKwZijv9HnZgK`

Observed live:
- mint owner program: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
- token standard: Token-2022
- decimals: `6`
- total token accounts returned by `getProgramAccountsV2`: `1331`
- non-zero token accounts: `199`
- zero-balance token accounts: `1132`

Important conclusion:
- raw `getProgramAccountsV2` is not enough by itself for top holders
- large mints will return many empty accounts
- we need an explicit zero-pruning and ranking strategy

## Recommended Minimal Design

Do not replace `getTokenLargestAccounts` yet.

Add a second path next to it:
- keep `HeliusApiClient.getTokenLargestAccounts(...)` unchanged
- add `HeliusApiClient.getTokenAccountsForMintV2(...)`
- add `TokenHoldersService.getTopHoldersV2(...)`
- keep the existing controller endpoint stable at first
- optionally add a guarded query param or feature flag later to switch per request or per environment

This preserves backwards compatibility and lets us test V2 safely.

## Proposed File Changes

### 1. `src/core/services/helius-api-client.ts`

Add new methods:
- `getMintProgramOwner(mintPubkey: string, commitment?: string): Promise<'token' | 'token-2022'>`
- `getTokenAccountsForMintV2(args): Promise<MintTokenAccountScanResult>`

Suggested args:

```ts
type GetTokenAccountsForMintV2Args = {
  mintPubkey: string;
  commitment?: string;
  limit?: number;
  topN?: number;
  excludeZeroBalances?: boolean;
  scanEncoding?: 'base64' | 'jsonParsed';
};
```

Suggested return shape:

```ts
type MintTokenAccountBalanceRow = {
  tokenAccount: string;
  ownerAccount: string;
  amount: string;
  decimals: number;
};

type MintTokenAccountScanResult = {
  context: { slot: number; apiVersion?: string };
  totalScannedAccounts: number;
  nonZeroAccounts: number;
  zeroAccountsDropped: number;
  holders: MintTokenAccountBalanceRow[];
};
```

Implementation details:
- detect program owner from `getAccountInfo(mint)`
- use:
  - `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` for classic SPL Token
  - `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` for Token-2022
- fetch via `getProgramAccountsV2`
- paginate with `paginationKey`
- maintain a running top-N selection in memory instead of retaining every account when possible

### 2. `src/api/services/token-holders.service.ts`

Add:
- `getTopHoldersV2(mint: string, commitment?: string, topN = 50): Promise<TopHoldersResponse>`

Logic:
- call the new client method
- preserve the current `HolderWithLabel` output shape
- reuse existing known-wallet and owner-label logic
- only run owner-account enrichment on the final selected top-N holders, not the whole scanned universe

### 3. `src/api/controllers/token-info.controller.ts`

Do not break the current route initially.

Phase 1:
- leave `GET :mint/top-holders` as-is

Phase 2 options:
- add query params:
  - `topN`
  - `method=legacy|v2|auto`
- or add a separate endpoint first:
  - `GET :mint/top-holders-v2`

Recommended minimal rollout:
- separate endpoint first, then merge later if stable

## Zero-Balance Strategy

This is the key performance issue.

### What we cannot do cleanly at RPC level

There is no safe generic RPC filter for "amount > 0".

`getProgramAccountsV2` supports:
- `memcmp`
- `dataSize`
- pagination params
- encoding options

But it does not provide a numeric comparison filter for token amount.

So we should assume:
- zero-balance accounts will still come back from Helius
- pruning must happen in our client code

### Best practical mitigation

Use a two-stage scan:

Stage A:
- call `getProgramAccountsV2` with `encoding: 'base64'`
- use `dataSlice` to fetch only the bytes needed for ranking
- parse:
  - mint
  - owner
  - amount

Stage B:
- after top-N is known, hydrate only those token accounts via `getMultipleAccounts(..., 'jsonParsed')` if we need parsed convenience fields

Why this is better:
- much smaller payload than `jsonParsed` for every account
- zero-balance accounts are still received, but they are cheap to discard
- only the final top-N gets expensive enrichment

### Data slice recommendation

For the token account base layout, fetch the leading bytes needed for:
- mint: 32 bytes
- owner: 32 bytes
- amount: 8 bytes

Recommended starting point:

```json
{
  "encoding": "base64",
  "dataSlice": { "offset": 0, "length": 72 }
}
```

Notes:
- this should be validated against both classic SPL Token and Token-2022 account parsing in our implementation
- Token-2022 extensions append data, but the base token account fields are still at the front
- if any edge case appears, fall back to full base64 account data for that mint

## Recommended RPC Payloads

### 1. Fast scan payload

Use this for ranking:

```json
{
  "jsonrpc": "2.0",
  "id": "mint-accounts-v2",
  "method": "getProgramAccountsV2",
  "params": [
    "TOKEN_PROGRAM_ID",
    {
      "encoding": "base64",
      "filters": [
        {
          "memcmp": {
            "offset": 0,
            "bytes": "MINT_PUBKEY"
          }
        }
      ],
      "dataSlice": { "offset": 0, "length": 72 },
      "limit": 5000,
      "commitment": "confirmed"
    }
  ]
}
```

### 2. Simpler first implementation payload

Use this if we want the fastest code path to ship first:

```json
{
  "jsonrpc": "2.0",
  "id": "mint-accounts-v2",
  "method": "getProgramAccountsV2",
  "params": [
    "TOKEN_PROGRAM_ID",
    {
      "encoding": "jsonParsed",
      "filters": [
        {
          "memcmp": {
            "offset": 0,
            "bytes": "MINT_PUBKEY"
          }
        }
      ],
      "limit": 5000,
      "commitment": "confirmed"
    }
  ]
}
```

Tradeoff:
- `jsonParsed` is easier to implement
- `base64 + dataSlice` is much safer for large tokens

## Heap-Based Top-N Recommendation

For very large tokens, do not:
- aggregate every account into a huge array
- sort the entire dataset if we only need top 50

Instead:
- keep counters for total scanned / zero dropped
- maintain a min-heap of size `topN`
- for each non-zero account:
  - push if heap size < `topN`
  - otherwise replace the smallest if current amount is larger

Benefits:
- bounded memory
- bounded ranking cost
- much safer for large holder sets

If we want minimal code first:
- sort the collected non-zero rows

If we want production-safe code:
- implement heap selection from the start

## Config / Feature Flags

Add a dedicated config block so adoption is easy to control:

```ts
export const HELIUS_TOP_HOLDERS_V2_CONFIG = {
  enabled: boolFromEnv('ENABLE_HELIUS_TOP_HOLDERS_V2', false),
  defaultMethod: process.env.HELIUS_TOP_HOLDERS_METHOD || 'legacy',
  defaultTopN: numFromEnv('HELIUS_TOP_HOLDERS_DEFAULT_TOP_N', 50),
  pageLimit: numFromEnv('HELIUS_TOP_HOLDERS_V2_PAGE_LIMIT', 5000),
  commitment: process.env.HELIUS_TOP_HOLDERS_V2_COMMITMENT || 'confirmed',
  useDataSlice: boolFromEnv('HELIUS_TOP_HOLDERS_V2_USE_DATASLICE', true),
  excludeZeroBalances: boolFromEnv('HELIUS_TOP_HOLDERS_V2_EXCLUDE_ZERO_BALANCES', true),
} as const;
```

Recommended defaults:
- keep feature disabled by default
- default method: `legacy`
- default commitment: `confirmed`
- default topN: `50`
- page limit: `5000`
- use data slice: `true`
- exclude zero balances: `true`

## Rollout Plan

### Phase 1: Internal-only

Implement client + service methods only.

Acceptance:
- no public API behavior change
- internal method can return correct top 50 for a test mint

### Phase 2: Safe exposure

Expose one of:
- a separate `top-holders-v2` endpoint
- or `method=v2` on the existing endpoint

Acceptance:
- legacy behavior preserved when method not specified
- V2 path works for both Token and Token-2022 mints

### Phase 3: Controlled defaulting

After enough validation:
- optionally switch `auto` or default path to V2
- keep legacy method as a fallback

Acceptance:
- same or better holder quality than current top 20
- no latency blowups for large mints

## Verification Plan

### Unit tests

Add tests for:
- program detection from mint owner
- Token vs Token-2022 program selection
- pagination handling with `paginationKey`
- zero-balance pruning
- top-N ranking correctness
- fallback behavior if V2 returns malformed data

### Manual test mints

Cover at least:
- classic SPL Token mint
- Token-2022 mint
- mint with many zero accounts
- mint with fewer than 20 holders

### Performance checks

Track:
- total scanned accounts
- zero accounts dropped
- non-zero accounts retained
- page count
- final topN count
- total latency per request

## Open Decisions

1. Public API shape:
- separate V2 endpoint first, or query param on the current route

2. First implementation shape:
- easy path: `jsonParsed`
- better path: `base64 + dataSlice + hydrate final topN only`

3. Ranking implementation:
- simple sort of non-zero rows
- or min-heap from day one

## Recommendation

Implement in this exact order:

1. Add `getMintProgramOwner(...)` to the Helius client.
2. Add `getTokenAccountsForMintV2(...)` using `jsonParsed` first so the logic is easy to verify.
3. Add zero-balance pruning immediately.
4. Add `topN` selection in service code.
5. Validate correctness against a few live mints.
6. If payload size is an issue, switch the V2 scan to `base64 + dataSlice` and hydrate only final top-N token accounts.
7. Only then expose it publicly behind a flag or separate endpoint.

This gives the smallest safe path while keeping the door open to the more memory-efficient version before rollout.
