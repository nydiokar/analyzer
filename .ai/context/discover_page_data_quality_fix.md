# Discover Page - Data Quality & Classification Fix

**Status:** Planning
**Priority:** Critical
**Created:** 2024-12-23
**Goal:** Fix fundamental data quality issues preventing Discover page from being useful

---

## Executive Summary

The Discover page is currently **unusable** due to fundamental data quality issues:
- Trading style filter returns 0 results (value mismatch)
- Holders show "0 tokens" despite having active positions
- PnL shows cost basis (-1700 SOL) instead of unrealized gains/losses
- Behavior tags are generic ("Curated pick") instead of data-driven
- No distinction between realized vs unrealized metrics
- Classification system doesn't surface holder-specific data

**Impact:** Landing page shows misleading/wrong data to users.

**Solution:** Fix backend metrics, API responses, and classification logic before continuing UI work.

---

## Current State - What's Broken

### 1. Trading Style Filter - Returns Nothing

```
Frontend Filter Options:
┌─────────────────────────────────┐
│ • any                           │
│ • flipper    ← searches for     │
│ • swing         exact match     │
│ • position                      │
│ • holder                        │
│ • scalper                       │
│ • sniper                        │
└─────────────────────────────────┘
                ↓
        WHERE tradingStyle = 'flipper'
                ↓
Database Values (actual):
┌──────────────────────────────────┐
│ "DAY_TRADER (ACCUMULATOR)"       │
│ "SWING_TRADER (HOLDER)"          │
│ "FLIPPER (BALANCED)"     ← No match!
│ "SNIPER (ACCUMULATOR)"           │
│ "POSITION_TRADER (DISTRIBUTOR)"  │
└──────────────────────────────────┘

Result: 0 rows returned
```

**Root cause:** Frontend searches for "flipper", backend has "FLIPPER (BALANCED)"

---

### 2. Holder Metrics - Fundamentally Wrong

**Example wallet (real data):**
```
Address: [some wallet]
Actual state:
  - 38 total trades (buys)
  - Currently holding 117.87 SOL in 1 token
  - Bought 6 months ago
  - Never sold (0 exits)

What Discover shows:
  ✓ Trades: 38              ← Correct
  ✗ Tokens: 0               ← WRONG! Should be 1
  ✗ PnL: -1700 SOL          ← WRONG! This is cost basis
  ✗ Win rate: 0%            ← WRONG! No exits = N/A
  ✗ Hold time: —            ← WRONG! Should show 6mo
  ✗ Trading style: Unknown  ← WRONG! Should be HOLDER
```

**Why this happens:**

```
Current Metrics Calculation:
┌────────────────────────────────────────────────┐
│ uniqueTokensTraded = tokens with BUY + SELL    │
│   → Holders have 0 because no SELL             │
│                                                 │
│ realizedPnl = sum(sells) - sum(buys)           │
│   → Holders show -costBasis (negative!)        │
│                                                 │
│ winRate = profitable_exits / total_exits       │
│   → Holders = 0/0 = 0% (misleading!)           │
│                                                 │
│ medianHoldTime = median(exit_time - entry)     │
│   → Holders = no exits = null = "—"            │
└────────────────────────────────────────────────┘
```

---

### 3. Behavior Tags - Not Descriptive

**Current:**
```
┌──────────────────────────────────────────┐
│ Behavior Tag        | What it tells you  │
├──────────────────────────────────────────┤
│ "Curated pick"      | Nothing            │
│ "Warming up"        | Nothing            │
│ "Fast rotations"    | Vague              │
│ "Patient moves"     | Vague              │
└──────────────────────────────────────────┘
```

**Should be:**
```
┌─────────────────────────────────────────────────────┐
│ Data-Driven Tag              | Clear meaning        │
├─────────────────────────────────────────────────────┤
│ "Heavy accumulator"          | 45 buys / 0 sells    │
│ "Single-token bet"           | 1 token, 6mo hold    │
│ "Fast flipper"               | 2h avg, 85% win      │
│ "Profit-taking holder"       | Sells 20% at peaks   │
└─────────────────────────────────────────────────────┘
```

---

## Data Flow - Current vs Needed

### Current (Broken):

```
Database
    ↓
┌───────────────────────────────────┐
│ BehaviorProfile:                  │
│  - totalTradeCount: 38            │
│  - uniqueTokensTraded: 0  ← BUG   │
│  - tradingStyle: "Unknown"        │
│  - medianHoldTime: null           │
│                                   │
│ PnlSummary:                       │
│  - realizedPnl: -1700  ← COST     │
│  - winRate: 0%                    │
└───────────────────────────────────┘
    ↓
Discover API (as-is, no enrichment)
    ↓
Frontend displays wrong data
```

### Needed (Fixed):

```
Database
    ↓
┌─────────────────────────────────────────┐
│ BehaviorProfile: (enhanced)             │
│  - totalBuys: 38                        │
│  - totalSells: 0                        │
│  - uniqueTokensTraded: 0  ← Completed   │
│  - activeTokenCount: 1     ← NEW        │
│  - longestActiveHoldHours: 4320 ← NEW   │
│                                         │
│ PnlSummary: (enhanced)                  │
│  - realizedPnl: 0                       │
│  - unrealizedPnl: -145.3  ← NEW         │
│  - currentHoldingsValue: 117.87 ← NEW   │
│  - totalCostBasis: 263.17  ← NEW        │
└─────────────────────────────────────────┘
    ↓
Discover API (enriched with computed fields)
    ↓
┌─────────────────────────────────────────┐
│ DiscoverWalletDto:                      │
│  - trades: "38 (38↑ / 0↓)"             │
│  - tokens: "1 active (0 completed)"     │
│  - pnl: "-145.3 SOL (unrealized)"       │
│  - hold: "6mo (current)"                │
│  - style: "HOLDER (ACCUMULATOR)"        │
│  - behavior: "Single-token bet"         │
└─────────────────────────────────────────┘
    ↓
Frontend displays accurate data
```

---

## Required Changes

### Phase 1: Database Schema (if needed)

**Check if these columns exist, add if missing:**

```sql
-- BehaviorProfile table
ALTER TABLE behavior_profile ADD COLUMN IF NOT EXISTS
  active_token_count INTEGER DEFAULT 0;

ALTER TABLE behavior_profile ADD COLUMN IF NOT EXISTS
  longest_active_hold_hours FLOAT DEFAULT NULL;

-- PnlSummary table
ALTER TABLE pnl_summary ADD COLUMN IF NOT EXISTS
  unrealized_pnl FLOAT DEFAULT NULL;

ALTER TABLE pnl_summary ADD COLUMN IF NOT EXISTS
  current_holdings_value_sol FLOAT DEFAULT NULL;

ALTER TABLE pnl_summary ADD COLUMN IF NOT EXISTS
  total_cost_basis FLOAT DEFAULT NULL;
```

**Note:** Check Prisma schema first. Some fields may already exist in `AdvancedStats`.

---

### Phase 2: Behavior Analysis Service

**File:** `src/api/services/behavior.service.ts`

**Add method:** `calculateHolderMetrics()`

```
Purpose: For wallets with active positions, calculate:
  1. activeTokenCount - tokens currently held (balance > dust threshold)
  2. longestActiveHoldHours - oldest position's hold time
  3. currentHoldingsValueSol - sum of current position values
  4. unrealizedPnl - (current value - cost basis)
  5. holderBehaviorPattern - classify holder type:
     - "SINGLE_TOKEN_BET": 1 token, >90d hold
     - "ACCUMULATOR": only buys, no sells
     - "PROFIT_TAKER": sells at peaks, holds rest
     - "PARTIAL_HOLDER": mix of exits and holds
```

**Integration point:**
```
In analyzeBehavior() or similar:
  1. Calculate existing metrics (trades, style, etc.)
  2. IF wallet has active positions (currentBalances > 0):
       - Call calculateHolderMetrics()
       - Add to behaviorProfile
  3. Save to database
```

---

### Phase 3: Discover Service Enhancement

**File:** `src/api/services/discover.service.ts`

#### Change 1: Fix Trading Style Filter

**Current (line 59-67):**
```typescript
// Searches for exact match: tradingStyle = 'flipper'
if (style) {
  const normalizedStyle = style.toLowerCase();
  where.behaviorProfile = {
    is: {
      tradingStyle: { equals: normalizedStyle, mode: 'insensitive' }
    }
  };
}
```

**Fixed:**
```typescript
// Use CONTAINS/LIKE to match partial string
if (style) {
  const normalizedStyle = style.toUpperCase(); // Match DB format
  where.behaviorProfile = {
    is: {
      tradingStyle: {
        contains: normalizedStyle,  // ← Changed
        mode: 'insensitive'
      }
    }
  };
}
```

#### Change 2: Enhance Wallet Mapping

**Current `mapWallet()` returns:**
```typescript
{
  totalTrades: number,
  uniqueTokensTraded: number,  // ← Only completed
  realizedPnl: number,          // ← Misleading for holders
  medianHoldHours: number,      // ← Only realized
  tradingStyle: string          // ← Unparsed
}
```

**Enhanced version returns:**
```typescript
{
  // Trade breakdown
  totalTrades: number,
  totalBuys: number,        // ← NEW
  totalSells: number,       // ← NEW

  // Token counts
  uniqueTokensTraded: number,      // Completed cycles
  activeTokenCount: number,         // ← NEW: Currently held

  // PnL (separated)
  realizedPnl: number,              // From exits
  unrealizedPnl: number,            // ← NEW: Current positions
  currentHoldingsValueSol: number,  // ← NEW

  // Hold time
  medianHoldHours: number,          // Realized
  longestActiveHoldHours: number,   // ← NEW: Current positions

  // Classification
  tradingStyle: string,             // Full: "DAY_TRADER (ACCUMULATOR)"
  speedCategory: string,            // ← NEW: "DAY_TRADER"
  behaviorPattern: string,          // ← NEW: "ACCUMULATOR"
  holderType: string | null,        // ← NEW: "SINGLE_TOKEN_BET", etc.
}
```

#### Change 3: Improve Behavior Tag Logic

**Current `deriveReason()` (line 211-263):**
- Returns generic tags: "Curated pick", "Interesting mix"
- Doesn't use holder-specific data

**Enhanced version:**
```
Input: All metrics (including new holder fields)

Logic:
  1. IF activeTokenCount > 0 AND totalSells < 3:
       → Use holder-specific tags

  2. IF activeTokenCount === 1 AND longestActiveHoldHours > 2160 (90d):
       code: "SINGLE_TOKEN_BET"
       text: "Single-token bet · {X}mo hold · {unrealizedPnl} SOL"

  3. IF totalBuys > 10 AND totalSells === 0:
       code: "ACCUMULATOR"
       text: "Heavy accumulator · {totalBuys} buys / 0 sells · holding {value} SOL"

  4. IF totalSells > 0 AND activeTokenCount > 0:
       code: "PARTIAL_HOLDER"
       text: "Profit taker · {totalSells} exits · still holding {activeTokenCount} tokens"

  5. ELSE (existing logic for traders):
       Use flipperScore, tradingStyle, etc.
```

---

### Phase 4: Frontend Updates

**File:** `dashboard/src/types/discover.ts`

**Update interface:**
```typescript
export interface DiscoverWalletMetrics {
  // Trades
  totalTrades?: number | null;
  totalBuys?: number | null;        // NEW
  totalSells?: number | null;       // NEW

  // Tokens
  uniqueTokensTraded?: number | null;      // Completed
  activeTokenCount?: number | null;         // NEW

  // PnL
  realizedPnl?: number | null;
  unrealizedPnl?: number | null;            // NEW
  currentHoldingsValueSol?: number | null;  // NEW

  // Hold time
  medianHoldHours?: number | null;
  longestActiveHoldHours?: number | null;   // NEW

  // Classification
  tradingStyle?: string | null;
  speedCategory?: string | null;            // NEW
  behaviorPattern?: string | null;          // NEW
  holderType?: string | null;               // NEW

  // Existing
  averageHoldHours?: number | null;
  winRatePercent?: number | null;
  lastActiveAt?: string | null;
  stalenessMinutes?: number | null;
}
```

**File:** `dashboard/src/app/discover/page.tsx`

**Update style filter options:**
```typescript
// OLD (broken):
const styleOptions = [
  { value: 'any', label: 'Any style' },
  { value: 'flipper', label: 'Flipper' },     // ← Won't match
  { value: 'swing', label: 'Swing' },
  // ...
];

// NEW (matches DB):
const styleOptions = [
  { value: 'any', label: 'Any style' },
  { value: 'SNIPER', label: 'Sniper' },
  { value: 'SCALPER', label: 'Scalper' },
  { value: 'FLIPPER', label: 'Flipper' },
  { value: 'DAY_TRADER', label: 'Day Trader' },
  { value: 'SWING', label: 'Swing' },
  { value: 'POSITION', label: 'Position' },
  { value: 'HOLDER', label: 'Holder' },
];
```

**Update table columns:**

```
Trades column:
  Display: "38" (main)
           "38↑ / 0↓" (sub-text in green/red)

Tokens column:
  Display: "1 active" (if activeTokenCount > 0)
           "5 completed" (if uniqueTokensTraded > 0)

PnL column:
  IF unrealizedPnl !== null:
    Display: "-145.3 SOL"
             "unrealized" (muted text)
  ELSE:
    Display: realizedPnl
             "realized" (muted text)

Hold column:
  IF longestActiveHoldHours > 0:
    Display: "6mo" (current hold)
  ELSE IF medianHoldHours > 0:
    Display: "2h" (avg exits)
  ELSE:
    Display: "—"
```

---

## Implementation Plan

### Step 1: Backend - Metrics Calculation
**Files:**
- `src/api/services/behavior.service.ts`
- `src/queues/processors/behavior-analysis.processor.ts`

**Tasks:**
1. Add `calculateHolderMetrics()` method
2. Compute active position data from FIFO balances
3. Calculate unrealized PnL using current token prices
4. Save to `behaviorProfile` table

**Success criteria:**
- Wallets with holdings show `activeTokenCount > 0`
- `longestActiveHoldHours` populated for holders
- No breaking changes to existing metrics

---

### Step 2: Backend - Discover Service
**Files:**
- `src/api/services/discover.service.ts`

**Tasks:**
1. Fix trading style filter (contains instead of equals)
2. Enhance `mapWallet()` to include new fields
3. Improve `deriveReason()` with holder-specific logic
4. Add tests for holder classification

**Success criteria:**
- Style filter returns results
- Holders show accurate token counts
- Behavior tags are data-driven

---

### Step 3: Frontend - Types & Display
**Files:**
- `dashboard/src/types/discover.ts`
- `dashboard/src/app/discover/page.tsx`

**Tasks:**
1. Update `DiscoverWalletMetrics` interface
2. Fix style filter options (use uppercase values)
3. Update table to show buy/sell breakdown
4. Add unrealized PnL display
5. Show current hold time for active positions

**Success criteria:**
- No TypeScript errors
- Trades show "X↑ / Y↓"
- PnL clearly labeled as realized/unrealized
- Holders show current hold time

---

### Step 4: Visual Polish
**Files:**
- `dashboard/src/app/discover/page.tsx`

**Tasks:**
1. Fix Recency column layout (cleaner spacing)
2. Ensure behavior tags are prominent
3. Add tooltips for unrealized PnL explanation
4. Color coding (green buys, red sells)

**Success criteria:**
- Recency column readable
- Clear visual hierarchy
- User understands unrealized vs realized

---

## Testing Checklist

### Holders (Most critical)
- [ ] Wallet with 1 token, never sold: Shows "1 active token"
- [ ] Unrealized PnL calculated correctly
- [ ] Current hold time shown (not "—")
- [ ] Behavior tag: "Single-token bet" or similar
- [ ] Trading style: "HOLDER" (not "Unknown")

### Traders
- [ ] High-frequency trader: Shows correct buy/sell breakdown
- [ ] Realized PnL for completed trades
- [ ] Median hold time from exits
- [ ] Behavior tag: "Fast flipper" or data-driven

### Filters
- [ ] Style filter: "HOLDER" returns holder wallets
- [ ] Style filter: "DAY_TRADER" returns day traders
- [ ] Style filter: "FLIPPER" returns flippers
- [ ] Hold bias filter works correctly
- [ ] Min trades/tokens filters work

---

## Edge Cases to Handle

1. **Wallet with no exits:**
   - uniqueTokensTraded = 0 ✓
   - activeTokenCount > 0 ✓
   - Show unrealized PnL, not realized

2. **Wallet with dust positions:**
   - Filter out balances < 0.01 SOL
   - Don't count as "active tokens"

3. **Wallet with stale prices:**
   - If token price unavailable, show cost basis
   - Add warning icon

4. **Mixed trader/holder:**
   - Has both completed trades AND active positions
   - Show both metrics separately

---

## Success Metrics

### Before Fix:
- Trading style filter: 0 results (broken)
- Holders show: 0 tokens, -1700 SOL "PnL", 0% win rate
- Behavior tags: Generic, meaningless
- User confusion: High

### After Fix:
- Trading style filter: Returns correct wallets
- Holders show: Accurate token counts, unrealized PnL, current hold time
- Behavior tags: Data-driven, descriptive
- User confidence: High

---

## Notes for Implementation

- **Backward compatibility:** Existing fields must remain unchanged
- **Performance:** Holder metrics calculation should be fast (<100ms per wallet)
- **Data freshness:** Consider caching unrealized PnL (requires price updates)
- **API versioning:** If breaking changes needed, version the API

---

## Related Files

**Backend:**
- `src/api/services/discover.service.ts` - Main service
- `src/api/services/behavior.service.ts` - Metrics calculation
- `src/types/behavior.ts` - Type definitions
- `src/api/shared/dto/discover-wallet.dto.ts` - API response DTOs

**Frontend:**
- `dashboard/src/app/discover/page.tsx` - UI component
- `dashboard/src/types/discover.ts` - Frontend types

**Database:**
- Prisma schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/`

---

## Questions to Resolve

1. **Price data source:** How to get current token prices for unrealized PnL?
   - DexScreener API?
   - Cached in database?
   - Real-time vs batch updates?

2. **Dust threshold:** What balance counts as "active position"?
   - Current: 0.01 SOL equivalent?
   - Configurable?

3. **Hold time precision:**
   - Show "6mo" or "182d" or "4,320h"?
   - User preference?

4. **Classification confidence:**
   - Should we show confidence scores?
   - Warning for low-data wallets?
