# TokenBadge Usage Guide

## TL;DR

**Just pass the mint address + choose your variant. TokenBadge handles the rest.**

```tsx
// ✅ CORRECT - Simple and recommended (card variant, default)
<TokenBadge mint="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" />

// ✅ INLINE VARIANT - For tables/lists/grids (2-row compact horizontal)
<TokenBadge
  mint="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  variant="inline"
  size="s"
/>

// ✅ WITH METADATA - Optimization for bulk operations
<TokenBadge
  mint="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  metadata={tokenData} // If parent already has it
  variant="inline"
/>

// ❌ WRONG - Don't fetch metadata separately
const metadata = await fetcher('/token-info', { ... })
<TokenBadge mint={mint} metadata={metadata} /> // Unnecessary
```

---

## Layout Variants

TokenBadge has **two layout variants** to fit different UI contexts:

### **"card" (default)** - Vertical 2-row card

```
┌──────────────────────────────────────┐
│ [🪙] TokenName                       │
│      [SYM] (copy button)             │
│                                      │
│ ──────────────────────────────────── │
│ [Mcap: $12.3M]  [📈][🐦][🌐][📱]    │
└──────────────────────────────────────┘
```

**Use for**: Feature sections, headers, standalone token displays
**Height**: ~100-120px (taller, spacious)

### **"inline"** - Horizontal 2-row compact

```
┌──────────────────────────────────────┐
│ [🪙] TokenName [SYM] | [Mcap: $12M] │  ← Row 1
│             [📈][🐦][🌐][📱]         │  ← Row 2
└──────────────────────────────────────┘
```

**Use for**: Tables, lists, grids - anywhere you need low vertical height
**Height**: ~50-70px (compact, lean)
**Width**: Fits in 280px+ columns

**Key benefits:**
- ✅ Shows ALL social buttons (no popovers needed)
- ✅ Compact vertical footprint for tables
- ✅ Horizontal-oriented, fits in narrow grids
- ✅ Action buttons on 2nd row (aligned right, tidy)

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

### ✅ Table Cell (Token Performance Tab)
```tsx
// dashboard/src/components/dashboard/TokenPerformanceTab.tsx
// Inline variant + size="s" for compact table rows
<TokenBadge
  mint={item.tokenAddress}
  metadata={item} // Parent already has metadata
  variant="inline"
  size="s"
/>
```

### ✅ Toolbar (Top Holders Panel)
```tsx
// dashboard/src/components/similarity-lab/TopHoldersPanel.tsx
// Inline variant in flex-wrap toolbar
<TokenBadge
  mint={debouncedMint}
  metadata={tokenMeta}
  variant="inline"
  size="sm"
/>
```

### ✅ Grid Item (Holdings Display)
```tsx
// dashboard/src/components/holder-profiles/v2/WalletBaseballCard.tsx
// Inline variant in 2-column grid
<TokenBadge
  mint={holding.tokenAddress}
  variant="inline"
  size="sm"
/>
```

### ✅ Header/Feature (Token Pulse)
```tsx
// dashboard/src/components/holder-profiles/v2/TokenPulse.tsx
// Card variant (default) for prominent display
<TokenBadge
  mint={result.tokenMint}
  size="lg"
/>
```

### ✅ Simple List (Exit Timing Drilldown)
```tsx
// dashboard/src/components/holder-profiles/v2/ExitTimingDrilldownPanel.tsx
const { tokens } = await fetcher(`/wallets/${address}/exit-timing-tokens/${bucket}`)
tokens.map(mint => (
  <TokenBadge
    mint={mint}
    variant="inline"
    size="sm"
  />
))
```

---

## Questions?

Check the JSDoc comment at the top of `TokenBadge.tsx` for detailed architecture explanation.
