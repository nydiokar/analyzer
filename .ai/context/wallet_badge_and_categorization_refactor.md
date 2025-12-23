# Wallet Badge & Categorization Architecture Refactor

**Status:** Proposal
**Priority:** Critical - Architectural debt
**Created:** 2024-12-23

---

## Problems Identified

### 1. **No Centralized Categorization System** 🚨

**Current State:**
```
categorize-holdings.ts (script)
  → Uses standardized time buckets
  → FIFO weighted hold time
  → NOT used by any component

discover.service.ts
  → Ad-hoc categories: ACCUMULATOR, PARTIAL_HOLDER, FLIPPER, etc.
  → Hardcoded logic

Each component invents its own categories!
```

**Issue:** `categorize-holdings.ts` has sophisticated logic but it's a standalone script. We're reinventing the wheel everywhere.

---

### 2. **Sort/Display Mismatch**

**Current:**
```
Column header: "PnL"
Sort mode: "best_pnl" → sorts by realizedPnl
Display: Shows unrealizedPnl (for holders) OR realizedPnl (for traders)
```

**Problem:** Sorting by realized PnL but showing unrealized = misleading rankings!

**Example:**
```
Row 1: Holder with +500 SOL unrealized (sorted low because realized = 0)
Row 2: Trader with +50 SOL realized (sorted higher)
User sees holder ranked below trader despite 10x better position!
```

---

### 3. **Recency Column Confusion**

**Current label:** "Recency"
**Shows:** "Updated 15d ago" = when WE analyzed the wallet
**User expects:** When THEY last traded

**This is useless!** Users don't care when we ran our analyzer.

---

### 4. **Hold Time Ambiguity**

**Current display:** "32d"

**Questions:**
- Is this median hold time?
- Average?
- Weighted?
- For ALL tokens or completed tokens?
- For this specific token or all their trades?

**No context = confusion!**

---

### 5. **Inefficient Table Layout**

**Current Discover table:**
```
┌────────┬─────────┬─────────────┬──────────────┬────────┬────────┬──────┬──────┬─────┬────┐
│ Wallet │ Recency │ Behavior    │ Trading      │ Trades │ Tokens │ Hold │ PnL  │ Win │ →  │
│        │         │ tag         │ style        │        │        │      │      │     │    │
└────────┴─────────┴─────────────┴──────────────┴────────┴────────┴──────┴──────┴─────┴────┘
         ↑                                       ↑                  ↑      ↑
      Useless!                               Could be      Unclear  Unclear
                                             in badge               what it
                                                                    represents
```

**Wasted space:**
- Recency (useless "Updated 15d ago")
- Hold (ambiguous "32d")
- Separate Trades/Tokens columns (could be in badge)

---

## Proposed Solution

### **Architecture: Enhanced WalletBadge Component**

**Pattern: Mirror TokenBadge design**

```typescript
<WalletBadge
  address="888K...wynx"
  variant="inline"  // or "card"
  size="m"
  showMetrics={true}
  showActions={true}
/>
```

#### **Inline Variant (for Discover table):**

```
┌─────────────────────────────────────────────────────────────┐
│ Row 1: [👤] 888K...wynx  [📋] [🔗] [↗️]                      │
│                                                              │
│ Row 2: 38↑/0↓  •  -145 SOL unreal  •  0% WR  •  Last: 6h   │
└─────────────────────────────────────────────────────────────┘
```

**Benefits:**
- Compact (2 rows like TokenBadge)
- Shows: trades split, PnL type, win rate, last active
- Frees up 3+ table columns!
- Action icons (copy, solscan, profile link)

---

### **New Table Layout (with Enhanced WalletBadge):**

```
┌───────────────────────────────┬─────────────────┬───────────────────┬──────────────┐
│ Wallet (Enhanced Badge)       │ Behavior Tag    │ Trading Analysis  │ Classification│
│                               │                 │                   │              │
│ [👤] 888K...wynx  [📋][🔗][↗️] │ [Accumulator]  │ Median: 4.2d      │ HOLDER       │
│ 38↑/0↓  •  -145 unreal  •  6h│                 │ Weighted: 12.1d   │ (ACCUMULATOR)│
│                               │                 │ Active: 180d      │              │
└───────────────────────────────┴─────────────────┴───────────────────┴──────────────┘
```

**Column Breakdown:**

1. **Wallet (Enhanced Badge):**
   - Row 1: Address + action icons
   - Row 2: Trades (buy/sell), PnL (labeled!), Win rate, Last active

2. **Behavior Tag:**
   - Data-driven tag (from centralized system)
   - Colored badge

3. **Trading Analysis:**
   - Median hold time (completed cycles)
   - Weighted hold time (position-weighted)
   - Active position time (if holder)
   - **All clearly labeled!**

4. **Classification:**
   - Speed category (SNIPER, DAY_TRADER, HOLDER, etc.)
   - Behavior pattern (ACCUMULATOR, DISTRIBUTOR, etc.)

---

## Centralized Categorization System

### **Extract `categorize-holdings.ts` Logic to Service**

**File:** `src/api/services/wallet-categorization.service.ts`

```typescript
export class WalletCategorizationService {

  // Time-based buckets (from categorize-holdings.ts)
  static readonly TIME_BUCKETS = {
    INSTANT: { minMin: 0, maxMin: 1/60, label: '< 1 second' },
    ULTRA_FAST: { minMin: 1/60, maxMin: 1, label: '1 sec - 1 min' },
    FAST: { minMin: 1, maxMin: 5, label: '1-5 min' },
    MOMENTUM: { minMin: 5, maxMin: 30, label: '5-30 min' },
    INTRADAY: { minMin: 30, maxMin: 240, label: '30min - 4h' },
    DAY: { minMin: 240, maxMin: 1440, label: '4-24 hours' },
    SWING: { minMin: 1440, maxMin: 10080, label: '1-7 days' },
    POSITION: { minMin: 10080, maxMin: Infinity, label: '> 7 days' },
  };

  // Behavior categories (centralized!)
  static readonly BEHAVIOR_TAGS = {
    // Holders
    ACCUMULATOR: 'Heavy accumulator',
    PARTIAL_HOLDER: 'Profit taker',
    SINGLE_TOKEN_BET: 'Single-token bet',

    // Traders
    FLIPPER: 'Fast trader',
    SCALPER: 'Scalper',
    SNIPER: 'Sniper',

    // Explorers
    EXPLORER: 'Token explorer',

    // Activity
    RECENT: 'Warming up',
    PNL: 'Profitable',
    INTERESTING: 'Curated pick',
  };

  /**
   * Determine wallet's primary behavior category
   * Uses data, not heuristics
   */
  categorizeBehavior(params: {
    totalBuys: number;
    totalSells: number;
    unrealizedPnl: number | null;
    uniqueTokensTraded: number;
    medianHoldTimeHours: number | null;
    activePositionCount?: number;
  }): BehaviorCategory {
    // Pure accumulator
    if (params.totalBuys > 10 && params.totalSells === 0) {
      return {
        code: 'ACCUMULATOR',
        label: this.BEHAVIOR_TAGS.ACCUMULATOR,
        description: `${params.totalBuys} buys / 0 sells`,
        confidence: 1.0,
      };
    }

    // Partial holder
    if (params.totalBuys > 5 && params.totalSells > 0 && params.totalSells < 3) {
      return {
        code: 'PARTIAL_HOLDER',
        label: this.BEHAVIOR_TAGS.PARTIAL_HOLDER,
        description: `${params.totalSells} exits, still holding`,
        confidence: 0.9,
      };
    }

    // etc...
  }

  /**
   * Categorize hold time bucket
   */
  categorizeHoldTime(minutes: number): string {
    for (const [key, bucket] of Object.entries(this.TIME_BUCKETS)) {
      if (minutes >= bucket.minMin && minutes < bucket.maxMin) {
        return key;
      }
    }
    return 'POSITION';
  }

  /**
   * Calculate weighted hold time using FIFO
   * (from categorize-holdings.ts)
   */
  calculateFIFOWeightedHoldTime(trades: Trade[]): number {
    // ... existing logic from script
  }
}
```

**Benefits:**
- Single source of truth for categories
- Used by: Discover service, Holder profiles, Analytics
- Testable, maintainable
- Clear category definitions

---

## PnL Display & Sorting Fix

### **Option A: Dual-Column Approach**

```
┌──────────────┬──────────────┐
│ Realized PnL │ Unrealized   │
│              │ PnL          │
├──────────────┼──────────────┤
│ +50 SOL      │ —            │ ← Trader (exited)
│ 0 SOL        │ +500 SOL     │ ← Holder (active)
│ +20 SOL      │ +100 SOL     │ ← Mixed
└──────────────┴──────────────┘
```

**Sort options:**
- "Best Realized PnL"
- "Best Unrealized PnL"
- "Best Total PnL" (realized + unrealized)

**Pros:** Crystal clear
**Cons:** Takes 2 columns

---

### **Option B: Smart Single Column (Recommended)**

```
┌──────────────────────────────┐
│ PnL                          │
├──────────────────────────────┤
│ +50 SOL (realized)           │
│ +500 SOL (unrealized)        │
│ +120 SOL (+20R / +100U)      │ ← Shows both!
└──────────────────────────────┘
```

**Sort:** Total PnL (realized + unrealized)

**Pros:** Compact, accurate
**Cons:** Slightly more complex display logic

---

### **Option C: Move to WalletBadge (Recommended!)**

**Table becomes:**
```
┌───────────────────────────────┬─────────────────┬───────────────────┐
│ Wallet (Enhanced Badge)       │ Behavior Tag    │ Trading Analysis  │
│                               │                 │                   │
│ [👤] 888K...wynx  [📋][🔗][↗️] │ [Accumulator]  │ Median: 4.2d      │
│ 38↑/0↓  •  +500 unreal  •  6h│                 │ Weighted: 12.1d   │
│                               │                 │ Active: 180d      │
└───────────────────────────────┴─────────────────┴───────────────────┘
                 ↑
          PnL shown here (labeled!)
          No separate column needed
```

**Benefits:**
- PnL always labeled (realized/unrealized)
- No column space wasted
- User sees PnL right next to wallet address

**Sort:** Total PnL (R+U combined)

---

## Hold Time Clarity

### **Current (Ambiguous):**
```
Hold: 32d
```

### **Proposed (Clear):**
```
┌──────────────────────────┐
│ Trading Analysis         │
├──────────────────────────┤
│ Median: 4.2d             │ ← Median of completed cycles
│ Weighted: 12.1d          │ ← Position-weighted average
│ Active: 180d             │ ← Longest current holding
└──────────────────────────┘
```

**Benefits:**
- Clear what each metric means
- Shows multiple dimensions
- Users understand trading behavior

---

## Recency Column Fix

### **Option A: Remove It**

**Current:** "Updated 15d ago" (useless)
**Fix:** Delete column entirely

**Recency data moves to:**
- WalletBadge: "Last: 6h ago" (last trade)
- Tooltip: "Analyzed 15d ago" (if needed)

---

### **Option B: Repurpose to "Last Active"**

```
┌──────────────┐
│ Last Active  │
├──────────────┤
│ 6 hours ago  │ ← Last trade timestamp
│ 2 days ago   │
│ 1 month ago  │
└──────────────┘
```

**Sort:** Recently active first

**Benefits:**
- Actually useful!
- Shows wallet activity, not our analyzer activity

---

## Implementation Plan

### **Phase 1: Centralize Categorization (Backend)**

1. Extract `categorize-holdings.ts` logic to `WalletCategorizationService`
2. Define canonical behavior categories (enum)
3. Implement data-driven categorization logic
4. Add tests

**Files:**
- `src/api/services/wallet-categorization.service.ts` (new)
- `src/types/wallet-categories.ts` (new)

---

### **Phase 2: Enhanced WalletBadge (Frontend)**

1. Create `WalletBadge` component (mirror TokenBadge pattern)
2. Variants: `inline` (for tables) and `card` (for profiles)
3. Show: address, trades (↑/↓), PnL (labeled), WR, last active
4. Action icons: copy, solscan, profile

**Files:**
- `dashboard/src/components/shared/WalletBadge.tsx` (enhance existing)
- `dashboard/src/hooks/useWalletMetrics.ts` (new)

---

### **Phase 3: Refactor Discover Page**

1. Replace Wallet + Recency columns with single Enhanced WalletBadge column
2. Add "Trading Analysis" column (median/weighted/active hold times)
3. Update "Behavior Tag" to use centralized categories
4. Fix PnL sorting (total = realized + unrealized)

**Files:**
- `dashboard/src/app/discover/page.tsx`
- Update table layout
- Remove redundant columns

---

### **Phase 4: Update Discover Service**

1. Use `WalletCategorizationService` for behavior tags
2. Remove ad-hoc categorization logic
3. Ensure consistent categories across app

**Files:**
- `src/api/services/discover.service.ts`

---

## Success Metrics

### **Before:**
- ❌ Inconsistent categories across components
- ❌ PnL column misleading (shows unrealized, sorts by realized)
- ❌ Recency column useless ("Updated 15d ago")
- ❌ Hold time ambiguous ("32d" - what does this mean?)
- ❌ Table cluttered (9+ columns)

### **After:**
- ✅ Centralized categorization system
- ✅ PnL clearly labeled (realized/unrealized)
- ✅ Recency shows actual trading activity
- ✅ Hold time metrics all labeled
- ✅ Compact table (5-6 columns)
- ✅ WalletBadge shows key metrics inline

---

## Open Questions

1. **WalletBadge metadata fetching:**
   - Should we batch-fetch wallet metrics like TokenBadge does?
   - Or rely on parent component providing data?

2. **Active position time:**
   - Currently not tracked in DB
   - Need to calculate from FIFO balances?
   - Or add `longestActiveHoldHours` to behaviorProfile?

3. **Sort mode for PnL:**
   - Total (R+U)?
   - Separate sorts for realized vs unrealized?
   - Default to which?

4. **Backward compatibility:**
   - Can we phase this in gradually?
   - Or breaking change requiring migration?

---

## Files to Create/Modify

### **New Files:**
```
src/api/services/wallet-categorization.service.ts
src/types/wallet-categories.ts
dashboard/src/hooks/useWalletMetrics.ts
```

### **Modified Files:**
```
src/api/services/discover.service.ts
dashboard/src/components/shared/WalletBadge.tsx
dashboard/src/app/discover/page.tsx
dashboard/src/types/discover.ts
```

---

## Next Steps

1. **Review this proposal** - Get alignment on approach
2. **Prototype WalletBadge** - Build inline variant, test in Discover
3. **Centralize categories** - Extract to service, update Discover
4. **Refactor table** - New layout with WalletBadge
5. **Test & iterate** - Ensure clarity, usability
