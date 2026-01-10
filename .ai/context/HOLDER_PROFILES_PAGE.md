# Holder Profiles Page Refactor

## Overview
Major restructuring of the Holder Profiles page to improve layout, add new analytics components, and integrate similarity analysis results.

## Changes Required

### 1. Input/Analysis Area (Top Section)
**Current Issue:** Takes up too much vertical space

**Changes:**
- Make input area **slim and compact**
- **Input field** for token/address on the left
- **Top N dropdown** on the right side of input (e.g., "50")
- **Button** changed from "Analyze" to **"Check"** on the right
- **Token/Wallet mode buttons** positioned inline with less spacing between input and buttons
- Overall: more horizontal layout, less vertical space

**Layout:**
```
[Token/Address____________________] [Top N: 50▾] [Check]  [Token][Wallet]
```

### 2. Token Badge & Stats Row
**Current:** Multiple rows with stats spread out
**New:** Single compact row with all key stats

**Components (Left to Right):**
1. **Token Badge** - Existing token badge component
2. **Outcome** - e.g., "+$45K"
3. **Speed** - e.g., "Fast" (keep current implementation)
4. **Quality Data** - Format: `3/12` where:
   - Numerator = count of quality data profiles (GOLD + SILVER)
   - Denominator = total holders
   - **IMPORTANT:** Currently only GOLD is counted, must include SILVER too
5. **Mean Behavior Similarity** - e.g., "68%" (currently used in similarity analysis)
   - This replaces the current "flipper score" or 3rd metric

**Layout:**
```
[TOKEN] Outcome: +$45K  Speed: Fast  Quality: 3/12  Mean Behavior Similarity: 68%
```

### 3. Trader Distribution Bar Chart
**Replace:** Current component showing category counts
**New:** Compact horizontal bar chart showing holding time distribution

**Specifications:**
- Time ranges: 1sec-1m, 1m-1h, 1h-6h, 6h-24h, 24h+
- Display format: Bar + percentage + count
- Must be compact but clearly readable
- Example: `████ 1s-1m (23%, n=45)`

**Layout:**
```
TRADER DISTRIBUTION (Holding Time)
████ 1s-1m    (23%, n=45)
██████ 1m-1h  (35%, n=70)
███ 1h-6h     (18%, n=36)
██ 6h-24h     (12%, n=24)
█ 24h+        (12%, n=24)
```

### 4. Approaching Typical Hold Time Component
**New Component** - Position: Right next to bar chart

**Purpose:** Show percentage of holders approaching their typical holding time vs current hold duration

**Content:**
- Compact display
- Well-aligned with bar chart
- Not too large

**Example:**
```
[APPROACHING TYPICAL HOLD TIME]
45% of holders approaching their typical holding time
vs 32% of current hold duration
```

**Note:** Need to investigate if we can derive this data when implementing

### 5. Holders Table
**Columns (Left to Right):**

1. **Rank** (with tooltip ⓘ)
   - Tooltip: "Position based on holding value and behavioral similarity"

2. **Wallet**
   - Wallet badge component (name + address)

3. **Holding Value**
   - Value in USD (not token amount)
   - Example: "$24.5K"

4. **PnL**
   - Profit/Loss for this holder

5. **Category + Time Holding** (Merged Column)
   - Behavioral category + how long they've held
   - Example: "Fast Flip (held 6h)" or "Smart Hold (held 2d)"
   - Must be neat and readable, not weird formatting

6. **Current Holding Time** (significant tokens only)
   - Holding time for tokens with value > 0.3 SOL
   - Example: "2.5h" or "12h"
   - **Note:** Need to investigate if we can derive this - add to plan

7. **SOL Balance**
   - Current SOL balance
   - Example: "450 SOL"

### 6. Similarity Analysis Sidebar (Right Side)
**New Section:** Integrate similarity results as vertical list of cards

**Specifications:**
- **Reuse components** from similarity lab if possible, or create new compact version
- **Non-expandable** cards
- Show **only essential information**:
  - Overall similarity percentage
  - Capital similarity percentage
  - Behavioral similarity percentage
  - Number of shared tokens
  - Value and percentage of shared tokens

**Per Card Content:**
```
┌───────────────┐
│ Overall: 72%  │
│ Capital: 85%  │
│ Behavior: 59% │
│ 8 shared toks │
│ ($12.5K, 45%) │
└───────────────┘
```

**Layout:** Vertical stack of these cards on the right side of the page

## Complete ASCII Layout

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  Holder Profiles                                                               │
│                                                                                │
│  [Token/Address____________________] [Top N: 50▾] [Check]  [Token][Wallet]   │
│                                                                                │
├────────────────────────────────────────────────────────────┬───────────────────┤
│ [TOKEN] Outcome: +$45K  Speed: Fast  Quality: 3/12         │ SIMILARITY        │
│         Mean Behavior Similarity: 68%                      │                   │
│                                                            │ ┌───────────────┐ │
│ ┌──────────────────────────────────────────────────────┐  │ │ Overall: 72%  │ │
│ │ TRADER DISTRIBUTION (Holding Time)                   │  │ │ Capital: 85%  │ │
│ │ ████ 1s-1m    (23%, n=45)                           │  │ │ Behavior: 59% │ │
│ │ ██████ 1m-1h  (35%, n=70)                           │  │ │ 8 shared toks │ │
│ │ ███ 1h-6h     (18%, n=36)                           │  │ │ ($12.5K, 45%) │ │
│ │ ██ 6h-24h     (12%, n=24)                           │  │ └───────────────┘ │
│ │ █ 24h+        (12%, n=24)                           │  │                   │
│ └──────────────────────────────────────────────────────┘  │ ┌───────────────┐ │
│                                                            │ │ Overall: 65%  │ │
│ [APPROACHING TYPICAL HOLD TIME]                            │ │ Capital: 78%  │ │
│ 45% of holders approaching their typical holding time      │ │ Behavior: 52% │ │
│ vs 32% of current hold duration                            │ │ 6 shared toks │ │
│                                                            │ │ ($8.2K, 38%)  │ │
├─────┬─────────────┬──────────┬────────┬──────────────┬────┴───────────────────┤
│Rank │ Wallet      │ Holding  │ PnL    │ Category     │ Hold Time  │ SOL Bal   │
│  ⓘ │             │ Value    │        │ + Time       │ (>0.3 SOL) │           │
├─────┼─────────────┼──────────┼────────┼──────────────┼────────────┼───────────┤
│  1  │ [Whale1]    │ $24.5K   │ +$12K  │ Fast Flip    │ 2.5h       │ 450 SOL   │
│     │  7xD2e...   │          │        │ (held 6h)    │            │           │
├─────┼─────────────┼──────────┼────────┼──────────────┼────────────┼───────────┤
│  2  │ [Smart2]    │ $18.2K   │ +$8K   │ Smart Hold   │ 12h        │ 230 SOL   │
│     │  9mK4p...   │          │        │ (held 2d)    │            │           │
├─────┼─────────────┼──────────┼────────┼──────────────┼────────────┼───────────┤
│  3  │ [Degen3]    │ $12.8K   │ -$2K   │ Risky Fast   │ 45m        │ 89 SOL    │
│     │  3nB7w...   │          │        │ (held 1.5h)  │            │           │
└─────┴─────────────┴──────────┴────────┴──────────────┴────────────┴───────────┘
```

## Implementation Notes

### Critical Changes

1. **Quality Data Calculation**
   - Currently only counts GOLD profiles
   - Must include SILVER profiles in count
   - Format: `qualifying_profiles/total_holders`

2. **Mean Behavior Similarity**
   - Replace existing "flipper score" metric
   - Use existing similarity analysis calculation
   - Already available in codebase

3. **Trader Distribution Bar Chart**
   - New component needed
   - Time-based distribution: 1s-1m, 1m-1h, 1h-6h, 6h-24h, 24h+
   - Must be compact and readable

4. **Approaching Hold Time Component**
   - Investigate data availability during implementation
   - May need new calculations
   - Document in plan if additional data needed

5. **Similarity Sidebar**
   - Investigate reusing similarity lab components
   - If not feasible, create new compact card component
   - Must show: overall/capital/behavioral similarity + shared tokens info

### Data Requirements

- Holding time distribution by time ranges
- Quality profile counts (GOLD + SILVER)
- Mean behavioral similarity
- Current holding time for significant positions
- Similarity analysis results integration

### UI/UX Goals

- Drastically reduce vertical space in input area
- Consolidate stats into single row
- Replace category counts with more informative time distribution
- Integrate similarity results for better holder analysis
- Keep table clean and scannable with merged category+time column
