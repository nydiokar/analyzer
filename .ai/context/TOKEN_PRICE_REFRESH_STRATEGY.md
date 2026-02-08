# Token Price Refresh Strategy Specification

## Context
- Current UI uses `/wallets/:walletAddress/token-performance` as the primary data source for token performance.
- That response embeds price-dependent fields (e.g., current value, unrealized PnL) and token metadata.
- `/token-info` returns token metadata and price fields, but the UI does not merge `/token-info` prices into token performance.
- We need fresher prices without refetching heavy token performance responses, and we are in the middle of an API restructuring.

## Goals
1) Keep token performance UX stable (no flicker, no full reloads for price-only changes).
2) Support fast, cheap price refresh.
3) Preserve backward compatibility for clients relying on the monolithic token-performance response.
4) Provide a clean, future-proof split between wallet-scoped data and token-scoped price data.

## Non-Goals
- Real-time streaming prices (out of scope).
- Replacing token-performance as the full snapshot endpoint (it stays).
- Large UI rewrites before API restructure is finalized.

## Phase 1: Tactical (Minimal Change)
### API: Extend `/token-info` to support a price-only batch mode
- Endpoint: `POST /token-info`
- Request body (new optional flags):
  ```json
  {
    "tokenAddresses": ["<mint>", "<mint>", ...],
    "include": ["price"]
  }
  ```
- Response (price-only mode):
  ```json
  [
    {
      "tokenAddress": "<mint>",
      "priceUsd": "<string|number|null>",
      "marketCapUsd": "<number|null>",
      "dexscreenerUpdatedAt": "<iso|null>",
      "updatedAt": "<iso>"
    }
  ]
  ```
- Default behavior remains unchanged if `include` is omitted.
- Cacheable with short TTL (e.g., 30-60s on server).

### UI: Client-side price overlay for Token Performance
- Source of truth for balances/cost-basis remains the token-performance response.
- On focus (or manual refresh), fetch price-only data via `/token-info` for tokens currently displayed.
- Merge price data into existing rows (without replacing the full dataset).
- Recompute only price-dependent fields in the UI layer:
  - `currentHoldingsValueUsd`
  - `unrealizedPnlUsd`
  - any price display fields
- Do NOT re-fetch `/wallets/:walletAddress/token-performance` just for price updates.

### Behavior
- On initial load: use token-performance response as-is.
- On focus after idle: refresh token prices only if stale.
- Manual refresh remains available (can refresh token-performance or just prices depending on UX decision).

## Phase 2: Strategic (API Restructure)
### API: Make token-performance price-agnostic by default
- `/wallets/:walletAddress/token-performance` returns wallet-scoped fields and token identifiers.
- Price-dependent fields become optional or flagged as stale:
  - Either omit price fields or include `priceUpdatedAt` to indicate staleness.
- Add `includePrices=true` query param to preserve full snapshot response when needed.

### API: Token price as a first-class resource
Option A (preferred):
- New endpoint: `POST /token-prices`
- Request body: `{ "tokenAddresses": ["<mint>", ...] }`
- Response: `[ { "tokenAddress": "<mint>", "priceUsd": ..., "updatedAt": ... } ]`

Option B (acceptable):
- Continue with `/token-info` + `include: ["price"]` and treat it as the price API.

## Client Merge Algorithm (Conceptual)
1) Load token-performance rows (base data).
2) Batch fetch prices for visible mints (page or full list).
3) Merge price data into rows in-memory without invalidating the base dataset.
4) UI renders with merged values; base cache remains stable.

## Caching Guidance
- Token performance TTL: 5-10 minutes (costly endpoint; avoid churn).
- Token price TTL: 30-60 seconds (cheap; allows freshness).
- Revalidate on focus if stale; keep previous data to avoid flicker.

## Migration/Compatibility
- Existing clients that rely on `/wallets/:walletAddress/token-performance` continue to work.
- Price-only mode is additive to `/token-info` and non-breaking.
- The `includePrices=true` flag is an opt-in path for full snapshot consumers.

## Open Questions
- Do we want price updates to recompute `currentHoldingsValueSol` as well? (needs SOL/USD source)
- Should manual refresh in Token Performance trigger prices-only or full data re-fetch?
- Do we expose `updatedAt` in UI or keep it implicit?

## Implementation Checklist (Phase 1)
- [ ] Backend: add `include: ["price"]` support to `/token-info` response.
- [ ] Backend: ensure response contains `tokenAddress`, `priceUsd`, `marketCapUsd`, `dexscreenerUpdatedAt`, `updatedAt`.
- [ ] Frontend: add price-only fetch in TokenPerformanceTab (focus + manual refresh).
- [ ] Frontend: merge price fields into existing rows without replacing table data.
- [ ] Frontend: keep existing token-performance fetch unchanged.

## Implementation Checklist (Phase 2)
- [ ] Backend: split price fields from token-performance default response.
- [ ] Backend: add `includePrices=true` param to preserve full snapshot.
- [ ] Frontend: prefer price-only endpoint for refresh cycles.

