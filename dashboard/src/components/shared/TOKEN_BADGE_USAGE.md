# TokenBadge Usage Guide

## TL;DR

**Just pass the mint address. TokenBadge handles the rest.**

```tsx
// ✅ CORRECT - Simple and recommended
<TokenBadge mint="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" />

// ✅ ALSO CORRECT - Optimization for bulk operations
<TokenBadge
  mint="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  metadata={tokenData} // If parent already has it
/>

// ❌ WRONG - Don't fetch metadata separately
const metadata = await fetcher('/token-info', { ... })
<TokenBadge mint={mint} metadata={metadata} /> // Unnecessary
```

---

## How It Works

TokenBadge is **self-sufficient**. It automatically:

1. ✅ Fetches token metadata if not provided
2. ✅ Triggers enrichment if data is stale/missing
3. ✅ Shows fallback display while loading
4. ✅ Updates when enrichment completes

---

## When to Pass Metadata (Optional)

Only pass metadata when your parent component **already has it** from an API response:

```tsx
// Example: Token Performance Tab
const { data } = useSWR(`/wallets/${address}/token-performance`)

// API already returns metadata for each token
data.items.map(token => (
  <TokenBadge
    mint={token.tokenAddress}
    metadata={token} // Parent already fetched it
  />
))
```

**Why?** Avoids redundant API calls when data is already available.

---

## When to Let TokenBadge Fetch (Recommended)

For everything else, just pass the mint:

```tsx
// ✅ Exit timing drilldown
const { tokens } = await fetcher(`/wallets/${address}/exit-timing-tokens/day`)
tokens.map(mint => <TokenBadge mint={mint} />)

// ✅ Single token display
<TokenBadge mint={selectedTokenMint} />

// ✅ Small lists (<50 tokens)
recentTokens.map(mint => <TokenBadge mint={mint} />)
```

**Why?** Simple, clean, and TokenBadge handles enrichment intelligently.

---

## Important Rules

### ⚠️ DO NOT

- ❌ Call enrichment APIs manually when using TokenBadge
- ❌ Fetch metadata separately before passing to TokenBadge (unless optimizing bulk)
- ❌ Worry about enrichment timing or WebSocket subscriptions

### ✅ DO

- ✅ Just pass the mint address for simple cases
- ✅ Pass metadata when parent already has it (performance optimization)
- ✅ Trust TokenBadge to handle the rest

---

## Performance Notes

- **< 50 tokens**: Let TokenBadge fetch automatically (fine)
- **100+ tokens**: Consider fetching metadata in parent and passing down
- **Metadata prop**: Optional but recommended for bulk operations

---

## Architecture

```
Component passes mint
       ↓
TokenBadge checks if metadata provided
       ↓
If NO → POST /token-info (triggers enrichment + returns current data)
       ↓
If YES → Use provided metadata (skip fetch)
       ↓
Display token with metadata
```

**Backend `/token-info` endpoint does:**
1. Trigger background enrichment job (fire-and-forget)
2. Return whatever metadata exists NOW
3. Frontend shows fallback → enrichment completes → updates display

---

## Examples from Codebase

### ✅ Exit Timing Drilldown (Simplified)
```tsx
// dashboard/src/components/holder-profiles/v2/ExitTimingDrilldownPanel.tsx
const { tokens } = await fetcher(`/wallets/${address}/exit-timing-tokens/${bucket}`)
tokens.map(mint => <TokenBadge mint={mint} size="sm" />)
```

### ✅ Token Performance Tab (Optimized)
```tsx
// dashboard/src/components/dashboard/TokenPerformanceTab.tsx
data.items.map(item => (
  <TokenBadge
    mint={item.tokenAddress}
    metadata={{
      name: item.name,
      symbol: item.symbol,
      imageUrl: item.imageUrl,
      // ... parent already has all fields
    }}
  />
))
```

---

## Questions?

Check the JSDoc comment at the top of `TokenBadge.tsx` for detailed architecture explanation.
