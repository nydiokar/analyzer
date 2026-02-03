# 🎯 Wallet HUD Integration Plan - Layer Overlay Pattern

**Status:** 📝 Ready for Implementation
**Created:** 2026-02-03
**Estimated Effort:** 2-3 days (14-20 hours)
**Priority:** P1 - High Value UX Enhancement

---

## 🎨 Core Design Philosophy: Layer Overlay Pattern

> **Critical Principle:** HUD is a **layer overlay** on WalletBadge, not a replacement. When activated/hovered, it "completes" the badge with additional data.

**What this means:**
- WalletBadge remains the **primary component** with its current UI/behavior **unchanged**
- HUD data **enhances** the badge, appearing **on-demand** (hover, click, toggle)
- Zero clutter by default - information appears only when user requests it
- The badge and HUD are **separate visual layers** that work together

**Metaphor:** Think of WalletBadge as a baseball card's front (photo, name, basic stats) and HUD as the detailed stats on the back (batting average, ERA, etc.). Users can flip the card to see more, but the front remains clean and recognizable.

---

## 🏗️ Architecture Overview

### **Component Hierarchy**

```
WalletBadge (Primary Component - UNCHANGED)
├─ Current UI (avatar, address, metrics, actions)
└─ HUD Layer (NEW - Conditional Rendering)
   ├─ Mode 1: Inline Row (expandable, below badge)
   ├─ Mode 2: Tooltip Overlay (floating, delayed hover)
   └─ Mode 3: Expanded Grid (always visible, profile pages)
```

### **Three HUD Display Modes**

**Why three modes?** Different contexts need different presentation:

| Mode | Use Case | Trigger | Visual Pattern |
|------|----------|---------|----------------|
| **Inline** | Tables with many wallets | Toggle button | Expandable sub-row below badge |
| **Tooltip** | Compact lists, cards | Hover 800ms | Floating overlay on intentional hover |
| **Expanded** | Wallet profile pages | Always on | Full grid section below badge |

---

## 🎨 Visual Design Specifications

### **Mode 1: Inline (Expandable Row)**

**Context:** Holder Profiles table, Similarity Lab pairs, Tracked Wallets, Token Holders

**Pattern:** The HUD appears as an **indented sub-row** below the wallet badge row

```
┌──────────────────────────────────────────────────────────────┐
│  [📊 Show HUD]  ← Table-level toggle button                 │
├──────────────────────────────────────────────────────────────┤
│  Address           │ Holdings  │ Win Rate │ Last Active     │
├──────────────────────────────────────────────────────────────┤
│  DNfu...BHm        │ 1.2M BONK │ 68%      │ ~1h ago    [-] │ ← Main row
│  └─ 🥇 M7.2h  +2.1 / -0  33% WR  40.1 T/D  🐋              │ ← HUD row (expanded)
├──────────────────────────────────────────────────────────────┤
│  8xQe...VFin       │ 980K BONK │ 45%      │ ~6h ago    [+] │ ← Main row
└──────────────────────────────────────────────────────────────┘ ← HUD hidden
```

**Key Features:**
- **Table-level toggle:** Single button controls HUD for entire table
- **Per-row expand/collapse:** Individual [+]/[-] icons for granular control
- **Batch loading:** All HUD data fetched once when toggle enabled
- **Smooth animation:** 200ms ease-in-out on expand/collapse
- **Full colspan:** HUD row spans all columns for maximum space

**HUD Content Format (Inline Compact):**
```
🥇 M7.2h  +2.1 / -0  33% WR  40.1 T/D  🐋
│  │  │    │    │    │       │        └─ Whale badge (conditional)
│  │  │    │    │    │       └─────────── Avg trades per day
│  │  │    │    │    └─────────────────── Win rate percentage
│  │  │    │    └──────────────────────── Median P/L per token
│  │  │    └───────────────────────────── Trimmed mean PNL
│  │  └────────────────────────────────── Median hold time
│  └───────────────────────────────────── Behavior code (M=Momentum)
└──────────────────────────────────────── Data quality (🥇=Gold)
```

---

### **Mode 2: Tooltip (Delayed Hover)**

**Context:** Similarity pair cards, Top holders panel, Compact lists

**Pattern:** The HUD appears as a **floating tooltip** on intentional hover (800ms delay)

```
Normal State (no hover):
┌──────────────────────────────────────────────────────────────┐
│  Most Similar Pairs                                          │
├──────────────────────────────────────────────────────────────┤
│  1. DNfu...BHm ↔ 8xQe...VFin     Similarity: 0.85           │
│  2. 3kLp...Qr9 ↔ 7mWx...Hs2      Similarity: 0.82           │
└──────────────────────────────────────────────────────────────┘

Hover State (800ms delay, intentional):
┌──────────────────────────────────────────────────────────────┐
│  Most Similar Pairs                                          │
├──────────────────────────────────────────────────────────────┤
│  1. DNfu...BHm ↔ 8xQe...VFin  ┌──────────────────────────┐ │
│     ↑ Hover (intentional)     │ 🥇 GOLD • DAY_TRADER     │ │
│                                │ ───────────────────────  │ │
│                                │ Trimmed PNL: +2.1 SOL    │ │
│                                │ Median P/L: -0 SOL       │ │
│                                │ Median Hold: 7.2h        │ │
│                                │ Win Rate: 33%            │ │
│                                │ Trades/Day: 40.1         │ │
│                                │ ───────────────────────  │ │
│                                │ 🐋 Whale (633.7 SOL)     │ │
│                                └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Key Features:**
- **800ms delay:** Prevents accidental triggers from mouse movement
- **Smart positioning:** Adapts to viewport (right/left/top/bottom)
- **Batch loading:** Pre-fetch HUD for all wallets on page
- **Touch-friendly:** Tap to show on mobile (no delay)
- **Esc to close:** Keyboard accessibility

**HUD Content Format (Tooltip Detailed):**
```
┌──────────────────────────┐
│ 🥇 GOLD • MOMENTUM      │ ← Header: Quality + Behavior
│ ─────────────────────── │
│ Trimmed PNL: +1.2K SOL  │ ← Core metrics (5 lines)
│ Median P/L: 890 SOL     │
│ Median Hold: 4.2h       │
│ Win Rate: 68%           │
│ Trades/Day: 12.5        │
│ ─────────────────────── │
│ 🤖 Bot detected         │ ← Conditional badges
│ 🐋 Whale (633.7 SOL)    │
└──────────────────────────┘
```

---

### **Mode 3: Expanded (Always Visible)**

**Context:** Wallet Profile pages

**Pattern:** The HUD appears as a **full grid section** below the main badge

```
┌─────────────────────────────────────────────────────────────┐
│  Wallet Profile: DNfuF1L6...                                │
├─────────────────────────────────────────────────────────────┤
│  [WalletBadge Component]                                    │
│  [Avatar] DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm      │
│  ↑145/↓82  68% WR  Last active: ~3h ago                     │
│  [Copy] [Solscan] [Profile] [★ Tracked]                     │
├─────────────────────────────────────────────────────────────┤
│  Performance HUD                                            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  🥇        M          +1.2K      890       68%       │ │
│  │  GOLD   MOMENTUM   Trimmed   Median    Win Rate     │ │
│  │                      PNL       P/L                   │ │
│  │                                                       │ │
│  │           12.5           4.2h                        │ │
│  │        Trades/Day    Median Hold                     │ │
│  │                                                       │ │
│  │         🤖              🐋                            │ │
│  │    Bot Detected   Whale Wallet                       │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Key Features:**
- **Always visible:** No interaction needed
- **Full detail:** All metrics prominently displayed
- **Grid layout:** 2-3 column responsive grid
- **Large text:** Easy to scan at a glance
- **Reuses existing component:** `WalletHudOverlay` with `display="expanded"`

---

## 🔧 Technical Implementation

### **Component Structure**

#### **1. WalletBadge.tsx (Primary Component - MODIFIED)**

**Modifications Required:**
```typescript
// ADD new props to existing interface
interface WalletBadgeProps {
  // ... all existing props remain unchanged

  // NEW HUD-specific props
  showHud?: boolean;                    // Enable HUD display (default: false)
  hudDisplay?: 'inline' | 'tooltip' | 'expanded' | 'none'; // Display mode
  hudData?: WalletHudDto | null;        // Pre-fetched HUD data (from batch)
  hudDelayMs?: number;                  // Tooltip hover delay (default: 800ms)
  hudPosition?: 'auto' | 'top' | 'right' | 'bottom' | 'left'; // Tooltip position
}
```

**Integration Pattern:**
```typescript
const WalletBadge = memo(({
  address,
  showHud = false,
  hudDisplay = 'tooltip',
  hudData: providedHudData,
  hudDelayMs = 800,
  hudPosition = 'auto',
  // ... other existing props
}: WalletBadgeProps) => {
  // Fetch HUD data if not provided (fallback for single wallets)
  const { data: fetchedHudData } = useWalletHud(
    address,
    { enabled: showHud && !providedHudData }
  );

  const hudData = providedHudData ?? fetchedHudData;

  // Existing badge rendering (UNCHANGED)
  const badgeContent = (
    <div className="wallet-badge">
      {/* All existing badge UI */}
    </div>
  );

  // NEW: Wrap with HUD layer based on mode
  if (!showHud || !hudData) {
    return badgeContent; // No HUD, return unchanged badge
  }

  switch (hudDisplay) {
    case 'inline':
      // Inline mode: badge + HUD row rendered by parent table
      // Badge itself doesn't wrap, parent component handles HUD row
      return badgeContent;

    case 'tooltip':
      // Tooltip mode: wrap badge in tooltip trigger
      return (
        <Tooltip delayDuration={hudDelayMs}>
          <TooltipTrigger asChild>
            {badgeContent}
          </TooltipTrigger>
          <TooltipContent
            side={getTooltipSide(hudPosition, variant)}
            align="start"
          >
            <WalletHudOverlay
              walletAddress={address}
              display="tooltip"
            />
          </TooltipContent>
        </Tooltip>
      );

    case 'expanded':
      // Expanded mode: badge + expanded HUD below
      return (
        <div>
          {badgeContent}
          <div className="mt-4">
            <WalletHudOverlay
              walletAddress={address}
              display="expanded"
            />
          </div>
        </div>
      );

    case 'none':
    default:
      return badgeContent;
  }
});
```

**Key Implementation Notes:**
- **CRITICAL:** Existing WalletBadge UI/behavior must remain **100% unchanged** when `showHud={false}`
- HUD is **additive only** - wraps or extends existing badge, never modifies it
- Backward compatibility: All existing usages continue to work without changes
- New props are all optional with sensible defaults

---

#### **2. WalletHudInline.tsx (NEW Component)**

**Purpose:** Compact single-line HUD variant for table rows

**Location:** `dashboard/src/components/shared/WalletHudInline.tsx`

**Requirements:**
```typescript
interface WalletHudInlineProps {
  data: WalletHudDto;
  className?: string;
}

export const WalletHudInline = memo(({ data, className }: WalletHudInlineProps) => {
  // Render single-line compact HUD
  // Format: 🥇 M7.2h  +2.1 / -0  33% WR  40.1 T/D  🐋

  // MUST include:
  // - Data quality emoji (🥇/🥈/🥉/❓)
  // - Behavior code + median hold time (M7.2h)
  // - Trimmed PNL / Median P/L (+2.1 / -0)
  // - Win rate (33% WR)
  // - Trades per day (40.1 T/D)
  // - Conditional badges (🤖/🐋)

  // MUST reuse:
  // - Color schemes from WalletHudOverlay.tsx
  // - Formatting utilities (formatPnl, formatHoldTime, etc.)
  // - Tooltip wrappers for emoji explanations
});
```

**Design Constraints:**
- Maximum height: 24px (single line)
- Responsive: Should not wrap on mobile (use abbreviations)
- Color-coded: Behavior and PNL colors match existing HUD
- Accessible: Tooltips on emojis explain meanings

---

#### **3. useBatchWalletHud.ts (NEW Hook)**

**Purpose:** Fetch HUD data for multiple wallets in a single API call

**Location:** `dashboard/src/hooks/useBatchWalletHud.ts`

**Requirements:**
```typescript
export function useBatchWalletHud(
  addresses: string[],
  options?: { enabled?: boolean }
): {
  data: Record<string, WalletHudDto> | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isValidating: boolean;
}

// Implementation:
// - Use SWR for caching/revalidation
// - POST to /api/wallet-hud/batch endpoint
// - Dedupe by sorted address list (cache key)
// - 60 second dedupe interval (HUD data is semi-static)
// - Return map of address -> HUD data for O(1) lookup
```

**Cache Strategy:**
- **Deduplication:** 60 seconds (prevent duplicate requests)
- **Revalidation:** On focus = false (HUD data doesn't change frequently)
- **Error handling:** Graceful degradation (missing HUD = no display)
- **Max addresses:** 200 per batch (backend limit)

**Usage Pattern:**
```typescript
// In a table component with 50 wallets
const walletAddresses = holders.map(h => h.address);
const { data: hudData, isLoading } = useBatchWalletHud(walletAddresses);

// Pass down to individual badges
holders.map(holder => (
  <WalletBadge
    address={holder.address}
    showHud={true}
    hudDisplay="inline"
    hudData={hudData?.[holder.address]} // Pre-fetched
  />
));
```

---

#### **4. useTableHudToggle.ts (NEW Hook)**

**Purpose:** Manage table-level HUD toggle state + batch fetching

**Location:** `dashboard/src/hooks/useTableHudToggle.ts`

**Requirements:**
```typescript
export function useTableHudToggle(walletAddresses: string[]): {
  showHud: boolean;                          // Is HUD enabled for table?
  expandedRows: Set<string>;                 // Which rows are expanded?
  hudData: Record<string, WalletHudDto> | undefined; // HUD data map
  isLoading: boolean;                        // Is batch fetch in progress?
  toggleAll: () => void;                     // Enable/disable HUD for table
  toggleRow: (address: string) => void;      // Expand/collapse single row
  isRowExpanded: (address: string) => boolean; // Check if row expanded
}

// Implementation:
// - useState for showHud (table-level toggle)
// - useState for expandedRows (Set of addresses)
// - useBatchWalletHud hook (only when showHud=true)
// - toggleAll: flips showHud, expands/collapses all rows
// - toggleRow: adds/removes address from expandedRows Set
```

**State Management:**
- **Table toggle:** Controls whether HUD section is active
- **Batch fetch:** Triggered only when toggle enabled (performance optimization)
- **Row expansion:** Individual control per wallet (granular UX)
- **Auto-expand:** When toggle enabled, expand all rows by default
- **Auto-collapse:** When toggle disabled, collapse all rows

**Usage Pattern:**
```typescript
// In MinimalHoldersTable.tsx
const {
  showHud,
  expandedRows,
  hudData,
  isLoading,
  toggleAll,
  toggleRow,
  isRowExpanded,
} = useTableHudToggle(holders.map(h => h.address));

// Render toggle button
<Button onClick={toggleAll}>
  {showHud ? 'Hide HUD' : 'Show HUD'}
</Button>

// Render expandable rows
{holders.map(holder => (
  <>
    <tr>{/* Main row */}</tr>
    {showHud && isRowExpanded(holder.address) && (
      <tr>{/* HUD row */}</tr>
    )}
  </>
))}
```

---

## 📊 Implementation Roadmap

### **Phase 1: Foundation (Day 1, 4-6 hours)**

**Goal:** Create reusable HUD components and hooks

**Tasks:**
1. **Create WalletHudInline.tsx**
   - Copy color schemes from `WalletHudOverlay.tsx`
   - Copy formatting utilities (formatPnl, formatHoldTime, etc.)
   - Implement compact single-line layout
   - Add Tooltip wrappers for emoji explanations
   - Test with sample HUD data

2. **Create useBatchWalletHud.ts**
   - Implement SWR hook with POST to /api/wallet-hud/batch
   - Add cache key deduplication (sorted addresses)
   - Add error handling
   - Test with 1, 10, 50, 100+ wallet addresses

3. **Create useTableHudToggle.ts**
   - Implement state management (showHud, expandedRows)
   - Integrate useBatchWalletHud hook
   - Add toggle functions (toggleAll, toggleRow)
   - Test state transitions

**Validation Criteria:**
- ✅ WalletHudInline renders correctly with sample data
- ✅ useBatchWalletHud fetches and caches 50+ wallets
- ✅ useTableHudToggle state updates work smoothly

---

### **Phase 2: WalletBadge Integration (Day 1-2, 3-4 hours)**

**Goal:** Extend WalletBadge to support HUD overlay pattern

**Tasks:**
1. **Add HUD props to WalletBadgeProps interface**
   - Add showHud, hudDisplay, hudData, hudDelayMs, hudPosition
   - Ensure all new props are optional
   - Add JSDoc comments explaining each prop

2. **Implement conditional HUD rendering**
   - Add switch statement for hudDisplay modes
   - Implement tooltip wrapper (with delay)
   - Implement expanded wrapper (badge + HUD below)
   - Inline mode: no wrapper (parent handles HUD row)

3. **Add fallback HUD fetching**
   - Use useWalletHud hook when hudData not provided
   - Only fetch if showHud=true and no pre-fetched data
   - Handle loading and error states gracefully

4. **Add smart tooltip positioning**
   - Implement getTooltipSide() based on variant
   - Account for viewport boundaries (Radix UI handles this)
   - Test positioning in different scroll positions

**Validation Criteria:**
- ✅ WalletBadge renders unchanged when showHud=false
- ✅ Tooltip appears after 800ms hover with hudDisplay="tooltip"
- ✅ Expanded HUD renders below badge with hudDisplay="expanded"
- ✅ Batch-provided hudData takes precedence over individual fetch

**Critical Testing:**
- Test ALL existing WalletBadge usages still work (no regressions)
- Test with missing HUD data (graceful degradation)
- Test tooltip positioning at viewport edges
- Test mobile tap behavior (no hover delay)

---

### **Phase 3: Table Integration - Expandable Rows (Day 2, 4-5 hours)**

**Goal:** Add table-level HUD toggle with expandable rows

**Priority Order:**
1. **MinimalHoldersTable.tsx** (Test case)
2. **EnhancedKeyInsights.tsx** (Similarity pairs)
3. **trackers/page.tsx** (Tracked wallets)
4. **TokenHolderPicker.tsx** (Token holders)

**Implementation Pattern (same for all tables):**

```typescript
// 1. Extract wallet addresses from table data
const walletAddresses = holders.map(h => h.address);

// 2. Use table HUD toggle hook
const {
  showHud,
  expandedRows,
  hudData,
  isLoading,
  toggleAll,
  toggleRow,
  isRowExpanded,
} = useTableHudToggle(walletAddresses);

// 3. Add toggle button to table toolbar
<div className="flex justify-between mb-4">
  <h3>Table Title</h3>
  <Button variant="outline" size="sm" onClick={toggleAll}>
    {showHud ? (
      <><ChevronUp className="h-4 w-4 mr-1" />Hide HUD</>
    ) : (
      <><ChevronDown className="h-4 w-4 mr-1" />Show HUD</>
    )}
  </Button>
</div>

// 4. Render expandable rows
<tbody>
  {holders.map(holder => (
    <Fragment key={holder.address}>
      {/* Main row - unchanged */}
      <tr>
        <td>
          <WalletBadge
            address={holder.address}
            variant="minimal"
            showHud={false} // Important: no tooltip in table mode
          />
        </td>
        {/* ... other columns */}
        {showHud && (
          <td>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleRow(holder.address)}
            >
              {isRowExpanded(holder.address) ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </td>
        )}
      </tr>

      {/* HUD row - expandable */}
      {showHud && isRowExpanded(holder.address) && (
        <tr className="bg-muted/30">
          <td colSpan={999} className="py-2 px-4">
            {hudData?.[holder.address] ? (
              <WalletHudInline data={hudData[holder.address]} />
            ) : (
              <div className="text-xs text-muted-foreground">
                Loading HUD data...
              </div>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  ))}
</tbody>
```

**Validation Criteria:**
- ✅ Toggle button shows/hides HUD section
- ✅ Batch fetch triggers only when toggle enabled
- ✅ Individual expand/collapse works per row
- ✅ Smooth animation on expand/collapse (200ms)
- ✅ Loading state shows while batch fetch in progress
- ✅ HUD data displays correctly in inline format

**Design Notes:**
- **Expand all by default:** When toggle enabled, all rows expand (user can collapse individually)
- **Column span:** HUD row uses `colSpan={999}` to span all columns
- **Background color:** `bg-muted/30` distinguishes HUD rows from main rows
- **Indentation:** HUD content has left padding to show hierarchy

---

### **Phase 4: Tooltip Integration - Delayed Hover (Day 2-3, 2-3 hours)**

**Goal:** Add delayed hover tooltips to compact lists

**Priority Order:**
1. **GlobalMetricsCard.tsx** (Top 5 similar pairs)
2. **TopHoldersPanel.tsx** (Top holders)
3. **MostCommonTokens.tsx** (Wallet badges in token cards)

**Implementation Pattern:**

```typescript
// 1. Extract all wallet addresses from page data
const allAddresses = pairs.flatMap(p => [p.wallet1, p.wallet2]);

// 2. Batch fetch HUD for all wallets
const { data: hudData } = useBatchWalletHud(allAddresses);

// 3. Render WalletBadge with tooltip mode
<WalletBadge
  address={wallet.address}
  variant="compact"
  showHud={true}
  hudDisplay="tooltip"
  hudData={hudData?.[wallet.address]}
  hudDelayMs={800} // 800ms delay for intentional hover
/>
```

**Validation Criteria:**
- ✅ Tooltip appears after 800ms hover (not instant)
- ✅ Tooltip disappears immediately on mouse leave
- ✅ Tooltip doesn't block underlying content
- ✅ Smart positioning prevents viewport clipping
- ✅ Mobile: tap to show (no delay)
- ✅ Keyboard: Esc to close

**Design Notes:**
- **Delay purpose:** 800ms prevents accidental triggers from mouse movement
- **Intentional hover:** User must hover and stay still for 800ms
- **Quick dismiss:** Tooltip closes immediately on mouse leave (no delay)
- **Batch optimization:** Pre-fetch all HUD data on page load (no per-hover fetching)

---

### **Phase 5: Profile Page Integration (Day 3, 1 hour)**

**Goal:** Add expanded HUD to wallet profile pages

**Files to Modify:**
- `dashboard/src/components/layout/WalletProfileLayout.tsx`

**Implementation:**

```typescript
// In WalletProfileLayout.tsx
export function WalletProfileLayout({ address }: { address: string }) {
  return (
    <div>
      {/* Existing wallet header with WalletBadge */}
      <WalletBadge
        address={address}
        variant="card"
        size="l"
        showActions={true}
        // ... other existing props
      />

      {/* NEW: Performance HUD section */}
      <div className="mt-6">
        <h3 className="text-sm font-medium mb-3">Performance HUD</h3>
        <WalletHudOverlay
          walletAddress={address}
          display="expanded"
        />
      </div>
    </div>
  );
}
```

**Validation Criteria:**
- ✅ Expanded HUD renders below main badge
- ✅ Grid layout is responsive (2 cols mobile, 3 cols desktop)
- ✅ Data loads without flickering
- ✅ Styling matches page theme

---

## 🎯 Context-Specific Implementation Guide

### **Where to Apply Each Mode**

#### **Inline Mode (Expandable Row)**
**Apply to:** Tables with 10+ wallets where users need to compare HUD metrics

| File | Component | Wallet Count | Notes |
|------|-----------|--------------|-------|
| `MinimalHoldersTable.tsx` | Holder Profiles table | 50-100 | **Start here** - best test case |
| `EnhancedKeyInsights.tsx` | Similarity pairs table | 20-50 | High-value context |
| `trackers/page.tsx` | Tracked wallets table | 10-100 | User's favorite wallets |
| `TokenHolderPicker.tsx` | Token holders table | 20-50 | When analyzing tokens |

**Implementation Checklist for Each File:**
- [ ] Import `useTableHudToggle` hook
- [ ] Import `WalletHudInline` component
- [ ] Import `ChevronUp`, `ChevronDown` icons
- [ ] Extract wallet addresses from table data
- [ ] Add `useTableHudToggle()` hook call
- [ ] Add toggle button to table toolbar
- [ ] Add expand/collapse icon column (when showHud=true)
- [ ] Add HUD row below each main row (when expanded)
- [ ] Set WalletBadge `showHud={false}` (no tooltip in table mode)
- [ ] Test: toggle on/off, expand/collapse individual rows

---

#### **Tooltip Mode (Delayed Hover)**
**Apply to:** Compact lists/cards where space is limited

| File | Component | Wallet Count | Notes |
|------|-----------|--------------|-------|
| `GlobalMetricsCard.tsx` | Top 5 similar pairs | 10 | Compact pair list |
| `TopHoldersPanel.tsx` | Top holders panel | 10-20 | Side panel context |
| `MostCommonTokens.tsx` | Wallet badges in token cards | 5-10 per token | Very compact |
| `OverlapHeatmap.tsx` | Heatmap connections | 20-30 | Visual context |

**Implementation Checklist for Each File:**
- [ ] Import `useBatchWalletHud` hook
- [ ] Extract all wallet addresses from component data
- [ ] Add `useBatchWalletHud()` hook call at component level
- [ ] Pass `hudData` prop to each WalletBadge
- [ ] Set `showHud={true}` on WalletBadge
- [ ] Set `hudDisplay="tooltip"` on WalletBadge
- [ ] Set `hudDelayMs={800}` on WalletBadge
- [ ] Test: hover 800ms shows tooltip, immediate dismiss on leave
- [ ] Test: mobile tap shows tooltip

---

#### **Expanded Mode (Always Visible)**
**Apply to:** Wallet profile pages (single wallet focus)

| File | Component | Wallet Count | Notes |
|------|-----------|--------------|-------|
| `WalletProfileLayout.tsx` | Wallet profile page | 1 | Full detail view |

**Implementation Checklist:**
- [ ] Add new section below existing WalletBadge
- [ ] Add section heading "Performance HUD"
- [ ] Add `WalletHudOverlay` component with `display="expanded"`
- [ ] Ensure responsive grid layout
- [ ] Test: data loads without flash
- [ ] Test: mobile layout (stacks to 2 columns)

---

## 🔍 Critical Implementation Details

### **1. Layer Overlay Pattern Compliance**

**DO:**
- ✅ Keep WalletBadge UI 100% unchanged when `showHud={false}`
- ✅ Render HUD as separate visual layer (tooltip, sub-row, or section)
- ✅ Make HUD **additive** - it enhances, never replaces badge content
- ✅ Use conditional rendering based on `showHud` prop
- ✅ Preserve all existing WalletBadge functionality

**DON'T:**
- ❌ Modify WalletBadge's core UI to accommodate HUD
- ❌ Replace existing metrics with HUD metrics
- ❌ Change WalletBadge layout/spacing when HUD disabled
- ❌ Break existing WalletBadge usages
- ❌ Make HUD required or always-on by default

---

### **2. Performance Optimization**

**Batch Fetching:**
- Always use `useBatchWalletHud` for components with 2+ wallets
- Fetch at component level, pass down as prop to badges
- Single fetch for entire page, not per-wallet fetching

**Caching Strategy:**
- SWR deduplication: 60 seconds (prevents duplicate requests)
- Revalidate on focus: false (HUD data is semi-static)
- Cache key: sorted address list (order-independent deduplication)

**Conditional Fetching:**
- Only fetch when `showHud={true}` (table toggle pattern)
- Use `enabled` option in SWR to prevent unnecessary requests
- Graceful degradation: missing HUD = no error, just no display

---

### **3. User Experience Details**

**Tooltip Delay Logic:**
- **Desktop:** 800ms hover delay (intentional hover detection)
- **Mobile:** Tap to show, no delay (touch-friendly)
- **Dismiss:** Immediate on mouse leave (no delay)
- **Keyboard:** Esc key closes tooltip (accessibility)

**Table Expand/Collapse:**
- **Default state:** All rows collapsed (clean table view)
- **Toggle on:** All rows expand by default (show all HUD)
- **Individual control:** [+]/[-] icons per row (granular control)
- **Animation:** 200ms ease-in-out (smooth transition)

**Loading States:**
- **Batch fetch:** Show loading spinner in toggle button
- **HUD row:** Show "Loading HUD data..." text in row
- **Tooltip:** Show skeleton in tooltip while loading
- **Error:** Graceful degradation (no HUD = no error message)

---

### **4. Styling Consistency**

**Colors:**
- Reuse color schemes from `WalletHudOverlay.tsx`
- Behavior codes: red (fast) → green (slow) gradient
- PNL: green (positive), red (negative), gray (zero)
- Quality tiers: yellow (gold), gray (silver), orange (bronze)

**Typography:**
- Inline HUD: `text-xs` (compact)
- Tooltip HUD: `text-xs` to `text-sm` (readable)
- Expanded HUD: `text-lg` to `text-2xl` (prominent)

**Spacing:**
- HUD row padding: `py-2 px-4` (comfortable spacing)
- Inline gap: `gap-2` (between metrics)
- Tooltip padding: `p-4` (readable whitespace)

---

### **5. Accessibility**

**Keyboard Navigation:**
- Tooltip: Esc key to close
- Toggle button: Space/Enter to activate
- Expand icons: Space/Enter to toggle row

**Screen Readers:**
- Add `aria-label` to toggle buttons
- Add `aria-expanded` to row expand icons
- Add descriptive text for emoji (via Tooltip)

**Focus Management:**
- Tooltip doesn't trap focus
- Table rows maintain focus on expand/collapse
- Toggle button shows focus ring

---

## 🧪 Testing Checklist

### **Component Tests**

**WalletHudInline:**
- [ ] Renders all 6 core metrics correctly
- [ ] Conditional badges (bot/whale) show/hide correctly
- [ ] Colors match WalletHudOverlay color scheme
- [ ] Tooltips explain emoji meanings
- [ ] Fits in single line (no wrapping)

**useBatchWalletHud:**
- [ ] Fetches 1 wallet correctly
- [ ] Fetches 50 wallets correctly
- [ ] Fetches 200 wallets correctly (max limit)
- [ ] Deduplicates requests (same addresses = 1 fetch)
- [ ] Handles errors gracefully
- [ ] Cache persists for 60 seconds

**useTableHudToggle:**
- [ ] toggleAll() enables HUD and expands all rows
- [ ] toggleAll() again disables HUD and collapses all rows
- [ ] toggleRow() expands single row
- [ ] toggleRow() again collapses single row
- [ ] isRowExpanded() returns correct state
- [ ] Batch fetch only triggered when showHud=true

---

### **Integration Tests**

**WalletBadge:**
- [ ] showHud={false}: Badge renders unchanged (baseline)
- [ ] showHud={true} + hudDisplay="tooltip": Tooltip appears after 800ms hover
- [ ] showHud={true} + hudDisplay="expanded": HUD renders below badge
- [ ] showHud={true} + hudDisplay="inline": Badge renders unchanged (parent handles HUD row)
- [ ] Batch-provided hudData: No individual fetch triggered
- [ ] Missing hudData: Fallback fetch triggered
- [ ] All existing WalletBadge usages still work (regression test)

**Table Integration:**
- [ ] Toggle button shows/hides HUD section
- [ ] Batch fetch triggers when toggle enabled
- [ ] HUD rows appear below wallet rows
- [ ] Expand/collapse icons work per row
- [ ] Smooth animation on state changes
- [ ] Loading state shows during batch fetch
- [ ] No performance issues with 50+ rows

**Tooltip Integration:**
- [ ] Tooltip appears after 800ms hover
- [ ] Tooltip disappears on mouse leave
- [ ] Tooltip positioned correctly (no clipping)
- [ ] Tooltip works on mobile (tap to show)
- [ ] Batch fetch loads all wallets on page load
- [ ] No tooltip flicker on re-render

---

### **Cross-Browser Tests**

- [ ] Chrome: Tooltip positioning, animations
- [ ] Firefox: Tooltip positioning, animations
- [ ] Safari: Tooltip positioning, animations
- [ ] Mobile Safari: Tap to show tooltip
- [ ] Mobile Chrome: Tap to show tooltip

---

### **Performance Tests**

- [ ] Batch fetch 100 wallets: <500ms
- [ ] Table toggle on/off: <100ms (smooth)
- [ ] Row expand/collapse: <50ms (smooth)
- [ ] Tooltip show/hide: <50ms (smooth)
- [ ] No re-renders when hovering over non-HUD elements
- [ ] Memory usage: No leaks on repeated toggle/expand

---

## 📋 Implementation Checklist Summary

### **Phase 1: Foundation ✅**
- [ ] Create `WalletHudInline.tsx` component
- [ ] Create `useBatchWalletHud.ts` hook
- [ ] Create `useTableHudToggle.ts` hook
- [ ] Test all three in isolation

### **Phase 2: WalletBadge Integration ✅**
- [ ] Add HUD props to `WalletBadgeProps` interface
- [ ] Implement conditional HUD rendering (3 modes)
- [ ] Add fallback HUD fetching
- [ ] Test with all variants (card, inline, minimal, etc.)
- [ ] Regression test: all existing usages still work

### **Phase 3: Table Integration ✅**
- [ ] MinimalHoldersTable.tsx (test case)
- [ ] EnhancedKeyInsights.tsx (similarity pairs)
- [ ] trackers/page.tsx (tracked wallets)
- [ ] TokenHolderPicker.tsx (token holders)

### **Phase 4: Tooltip Integration ✅**
- [ ] GlobalMetricsCard.tsx (top 5 pairs)
- [ ] TopHoldersPanel.tsx (top holders)
- [ ] MostCommonTokens.tsx (wallet badges)

### **Phase 5: Profile Integration ✅**
- [ ] WalletProfileLayout.tsx (wallet profile)

### **Phase 6: Polish & Testing ✅**
- [ ] Cross-browser testing
- [ ] Mobile responsiveness
- [ ] Performance audit
- [ ] Accessibility audit
- [ ] User feedback iteration

---

## 🎓 Key Learnings for Future LLM

### **The Layer Overlay Pattern**

**Core Concept:**
> The HUD is NOT a replacement for WalletBadge. It's a **supplementary layer** that appears on-demand to provide additional context.

**Think of it like:**
- **Baseball card:** Front (WalletBadge) + Back (HUD stats)
- **Tooltip:** Visible UI (badge) + Hidden details (HUD)
- **Expandable row:** Compact view (badge) + Detailed view (HUD)

**Implementation principle:**
```
if (showHud) {
  return <Badge> + <HUD Layer>;
} else {
  return <Badge>; // Unchanged, no HUD
}
```

The badge's core UI never changes. The HUD is always **additive**.

---

### **Why Three Display Modes?**

**Problem:** Different contexts have different constraints
- Tables: Limited vertical space, many wallets, need comparison
- Lists: Compact, hover-friendly, few wallets
- Profiles: Plenty of space, single wallet focus

**Solution:** Three modes for three contexts
1. **Inline:** Expandable rows for tables (opt-in, controlled)
2. **Tooltip:** Delayed hover for lists (non-intrusive)
3. **Expanded:** Always visible for profiles (prominent)

**Don't try to force one mode everywhere.** Context matters.

---

### **Why Batch Fetching is Critical**

**Bad pattern:**
```typescript
// This triggers 50 API calls for 50 wallets ❌
wallets.map(w => (
  <WalletBadge address={w} showHud={true} />
));
```

**Good pattern:**
```typescript
// This triggers 1 API call for 50 wallets ✅
const { data: hudData } = useBatchWalletHud(wallets);

wallets.map(w => (
  <WalletBadge
    address={w}
    showHud={true}
    hudData={hudData?.[w]}
  />
));
```

**Always batch fetch at the component level, pass down as props.**

---

### **Why 800ms Tooltip Delay?**

**Problem:** Instant tooltips on hover create "tooltip spam" as users move mouse across page

**Solution:** 800ms delay = intentional hover detection
- **<800ms:** Mouse just passing through (ignore)
- **≥800ms:** User is hovering intentionally (show tooltip)

**Trade-off:** Slight delay before tooltip appears, but prevents accidental triggers

**Mobile:** No delay on tap (different interaction model)

---

### **Common Pitfalls to Avoid**

1. **❌ Modifying WalletBadge when showHud={false}**
   - Keep badge UI unchanged when HUD disabled
   - HUD is additive, not transformative

2. **❌ Per-wallet HUD fetching in loops**
   - Always batch fetch, never in loops
   - Pass pre-fetched data as prop

3. **❌ Instant tooltip on hover**
   - Use 800ms delay to prevent hover spam
   - Mobile gets no delay (tap interaction)

4. **❌ Breaking existing WalletBadge usages**
   - All new props must be optional
   - Default behavior = no HUD (backward compatible)

5. **❌ Forgetting to handle loading/error states**
   - Graceful degradation: missing HUD = no display, no error
   - Show loading skeletons during batch fetch

---

## 📁 File Structure Summary

**New Files:**
```
dashboard/src/components/shared/
  └─ WalletHudInline.tsx              (150-200 lines)

dashboard/src/hooks/
  ├─ useBatchWalletHud.ts             (50-70 lines)
  └─ useTableHudToggle.ts             (80-100 lines)

.ai/
  └─ HUD_INTEGRATION_PLAN.md          (this file)
```

**Modified Files:**
```
dashboard/src/components/shared/
  └─ WalletBadge.tsx                  (+80-120 lines)

dashboard/src/components/holder-profiles/v2/
  └─ MinimalHoldersTable.tsx          (+40-60 lines)

dashboard/src/components/similarity-lab/results/
  ├─ EnhancedKeyInsights.tsx          (+40-60 lines)
  ├─ GlobalMetricsCard.tsx            (+20-30 lines)
  └─ MostCommonTokens.tsx             (+15-20 lines)

dashboard/src/components/similarity-lab/
  ├─ TokenHolderPicker.tsx            (+40-60 lines)
  └─ TopHoldersPanel.tsx              (+20-30 lines)

dashboard/src/app/trackers/
  └─ page.tsx                         (+40-60 lines)

dashboard/src/components/layout/
  └─ WalletProfileLayout.tsx          (+10-15 lines)

.ai/
  └─ CONTEXT.md                       (+20-30 lines)
```

**Total LOC Estimate:** ~700-1000 lines across all files

---

## 🎯 Success Metrics

**Functionality:**
- ✅ All 3 display modes work correctly in their contexts
- ✅ Batch fetching works for 1-200 wallets
- ✅ No regressions in existing WalletBadge usages
- ✅ Smooth animations (no jank)

**Performance:**
- ✅ Batch fetch 100 wallets in <500ms
- ✅ Table toggle response in <100ms
- ✅ Zero tooltip flicker on re-render
- ✅ No memory leaks on repeated use

**UX:**
- ✅ No "tooltip spam" (800ms delay works)
- ✅ Table toggle is discoverable (users find it)
- ✅ HUD data is easy to scan at-a-glance
- ✅ Mobile tap interaction works well

**Code Quality:**
- ✅ Type-safe (no `any` types)
- ✅ Well-documented (JSDoc comments)
- ✅ Reusable (DRY principle)
- ✅ Testable (pure functions, clear interfaces)

---

## 🚀 Ready to Implement

This plan provides:
- ✅ **Clear architecture** (3 modes, layer overlay pattern)
- ✅ **Detailed implementation guide** (code patterns, file locations)
- ✅ **Step-by-step roadmap** (5 phases, estimated hours)
- ✅ **Context-specific guidance** (which mode where, why)
- ✅ **Testing checklist** (component, integration, performance)
- ✅ **Common pitfalls** (what to avoid)

**Next steps:**
1. Review this plan with the team
2. Confirm design decisions (3 modes, 800ms delay, etc.)
3. Proceed with Phase 1 implementation
4. Iterate based on user feedback

**Estimated total effort:** 2-3 days (14-20 hours) for full implementation + testing

---

**Document Version:** 1.0
**Last Updated:** 2026-02-03
**Status:** Ready for Implementation 🚀
