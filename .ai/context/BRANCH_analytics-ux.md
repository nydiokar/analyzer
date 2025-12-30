# Branch: discover-analytics-ux

**LLM**: Agent 1
**Focus**: UI Enhancements & Analytics Visualizations
**Base Branch**: `discover`
**Target**: Merge back to `discover` when complete

---

## Tasks Overview

### ✨ Task 1: Polish & UX Improvements
**Priority**: High
**Estimated Effort**: 2-3 hours

#### Scope:
1. **Loading Skeletons**
   - Add to Discover page table rows
   - Add to Trackers page table rows
   - Use shadcn Skeleton component
   - Show during initial data fetch and pagination

2. **Error Message Standardization**
   - Create centralized error message formatter
   - Consistent toast error format across app
   - Better error descriptions (avoid generic "Failed to fetch")
   - Example: "Failed to load wallets" → "Unable to load tracked wallets. Please try again."

3. **Empty States**
   - Discover page: "No wallets found matching your filters"
   - Trackers page: Already done (shows empty state)
   - Token Performance: "No tokens traded in this period"
   - Better icons and messaging

4. **Tooltip Improvements**
   - Ensure all metrics have tooltips
   - Consistent tooltip styling
   - Add keyboard shortcut hints where applicable

#### Files to Modify:
- `dashboard/src/app/discover/page.tsx`
- `dashboard/src/app/trackers/page.tsx`
- `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx`
- Possibly create: `dashboard/src/lib/error-messages.ts`

---

### 📊 Task 2: Collection-Based Analytics
**Priority**: Medium
**Estimated Effort**: 3-4 hours

#### Goal:
Add analytics card to Trackers page sidebar showing collection performance

#### Requirements:

**Visual Design:**
- Card in sidebar below "Portfolio Overview" card
- Title: "Collections Performance"
- Shows top 5 collections (or all if ≤5)
- Each row:
  ```
  [Collection Badge] Portfolio
  5 wallets · 45.2 SOL avg · +127.8 SOL total
  ```

**Metrics Per Collection:**
- Wallet count in collection
- Average PnL per wallet
- Total PnL for collection
- Average balance per wallet

**Interactions:**
- Click collection row → filters main table to that collection
- Highlight active filter with colored border
- Clear filter button

**Data Source:**
```typescript
// Already available from useFavorites():
favoriteWallets: FavoriteWallet[] // Has collections, pnl, currentSolBalance
```

**Chart Option (Optional Enhancement):**
- Small pie chart showing collection distribution
- Use Recharts: `<PieChart>` or `<BarChart>`
- Colors from `getCollectionColorFilled()`

#### Files to Create/Modify:
- `dashboard/src/app/trackers/page.tsx` (add to sidebar)
- Possibly create: `dashboard/src/components/trackers/CollectionAnalytics.tsx`

#### Implementation Notes:
```typescript
// Aggregate data:
const collectionStats = useMemo(() => {
  if (!favoriteWallets) return [];

  const stats = new Map<string, {
    walletCount: number;
    totalPnl: number;
    totalBalance: number;
  }>();

  favoriteWallets.forEach(wallet => {
    wallet.collections?.forEach(collection => {
      const existing = stats.get(collection) || { walletCount: 0, totalPnl: 0, totalBalance: 0 };
      stats.set(collection, {
        walletCount: existing.walletCount + 1,
        totalPnl: existing.totalPnl + (wallet.pnl || 0),
        totalBalance: existing.totalBalance + (wallet.currentSolBalance || 0),
      });
    });
  });

  return Array.from(stats.entries())
    .map(([collection, data]) => ({
      collection,
      ...data,
      avgPnl: data.totalPnl / data.walletCount,
      avgBalance: data.totalBalance / data.walletCount,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl); // Sort by total PnL
}, [favoriteWallets]);
```

---

### 📈 Task 3: Speed/Flow Analytics in Discover
**Priority**: Medium
**Estimated Effort**: 3-4 hours

#### Goal:
Add analytics sidebar to Discover page showing wallet distribution

#### Visual Design:
Currently Discover is full-width table. Add sidebar on right (like Trackers page):
- Main table: 3/4 width
- Sidebar: 1/4 width

**Sidebar Cards:**
1. **Speed Distribution Card**
   - Title: "Speed Categories"
   - Shows count per speed category (SNIPER, SCALPER, etc.)
   - Colored badges using `getSpeedColor()`
   - Format: `SNIPER: 12 wallets (8%)`

2. **Flow Distribution Card**
   - Title: "Flow Patterns"
   - Shows count per flow pattern (ACCUMULATOR, BALANCED, etc.)
   - Colored badges using `getFlowColor()`
   - Format: `ACCUMULATOR: 23 wallets (15%)`

3. **Active Filters Summary** (Optional)
   - Shows which filters are active
   - Quick way to see current query state

#### Data Source:
```typescript
// From discover API response:
wallets: DiscoverWallet[] // Has speedCategory, flowPattern
```

#### Implementation:
```typescript
const speedDistribution = useMemo(() => {
  if (!wallets) return [];

  const counts = new Map<string, number>();
  wallets.forEach(wallet => {
    if (wallet.speedCategory) {
      counts.set(wallet.speedCategory, (counts.get(wallet.speedCategory) || 0) + 1);
    }
  });

  return Array.from(counts.entries())
    .map(([category, count]) => ({
      category,
      count,
      percentage: (count / wallets.length) * 100,
    }));
}, [wallets]);
```

#### Files to Modify:
- `dashboard/src/app/discover/page.tsx` (add sidebar layout)
- Possibly create: `dashboard/src/components/discover/AnalyticsSidebar.tsx`

#### Layout Change:
```tsx
{/* Before: Full width table */}
<Card>
  <Table>...</Table>
</Card>

{/* After: Split layout */}
<div className="flex gap-6">
  {/* Main Content - 3/4 width */}
  <div className="flex-1">
    <Card>
      <Table>...</Table>
    </Card>
  </div>

  {/* Sidebar - 1/4 width */}
  <div className="w-80 flex-shrink-0 space-y-4">
    <SpeedDistributionCard />
    <FlowDistributionCard />
  </div>
</div>
```

---

### 🎭 Task 4: Exit Timing Drilldown Panel Redesign
**Priority**: High
**Estimated Effort**: 4-5 hours

#### Current Issues (User Feedback):
The exit timing drilldown panel that opens when clicking a time bucket has several UX problems:

**Problem 1: The Drilldown Panel (`ExitTimingDrilldownPanel.tsx`)**
- "Complete garbage" - spawns weirdly with only 3-4 tokens visible
- Non-intuitive resize handle (only bottom-right corner, users expect all edges)
- Tokens displayed 2x2 in grid with no ordering or sorting
- No context - just token badges with no additional info
- Intended use: Open 2-3 panels side-by-side to compare buckets, but current implementation makes this painful

**Problem 2: Hold Metrics Structure (`WalletBaseballCard.tsx`)**
- 4 numbers all getting progressively larger (median < avg < holding)
- "Mesh" of holding times vs exit timings is confusing
- Need better visual separation between:
  - Exit timing metrics (completed trades)
  - Current holdings metrics (active positions)
- Users get lost in which number means what

#### Your Mission:
Think like a UX designer solving an information architecture problem. The data exists, but the presentation is broken. Consider:

**For the Drilldown Panel:**
- How would YOU want to review 20-50 tokens from a specific time bucket?
- What context would help? (PnL? Win rate? Hold duration within that bucket?)
- Should tokens be sortable? By what? (PnL, date, alphabetical?)
- How should multi-panel comparison work? Side-by-side? Tabs? Something else?
- Should resize work like normal windows (drag any edge)? Or different pattern?
- Should there be categories/grouping within the panel?

**For Hold Metrics:**
- How do you visually separate "what they DID" (exit patterns) from "what they HAVE" (current holdings)?
- Is the 4-number progression (median/avg/weighted/current) necessary? Can it be simplified?
- Would cards/sections help? Color coding? Icons?
- Think: Progressive disclosure - show essential, hide details until clicked

#### Hints (Not Requirements):
- Consider table view vs. grid view for tokens
- Modal/Dialog might be better than floating panel
- Cards within the panel for different metrics
- Visual hierarchy: primary metric vs. secondary details
- Reference existing patterns in the app (how do other modals work?)

#### Files to Investigate:
- `dashboard/src/components/holder-profiles/v2/ExitTimingDrilldownPanel.tsx` - The drilldown panel
- `dashboard/src/components/holder-profiles/v2/WalletBaseballCard.tsx` - The baseball card structure
- Look at lines 228-270 in WalletBaseballCard for `HoldMetricCard` component

#### Success = When:
- User can open panel and immediately understand what they're looking at
- Comparing 2-3 buckets feels natural, not hacky
- The distinction between "exited positions" and "current holdings" is crystal clear
- Token list is useful (sorted, has context, feels professional)

**Note**: This is a "figure it out" task. User described pain points, you design the solution. Be bold, propose a complete redesign if needed. Just make it intuitive.

---

## Success Criteria

### Task 1:
- [ ] Loading skeletons visible during data fetch
- [ ] All error messages follow consistent format
- [ ] Empty states have proper messaging and icons
- [ ] No console errors or warnings

### Task 2:
- [ ] Collections analytics card displays correctly
- [ ] Shows top 5 collections with metrics
- [ ] Click collection filters main table
- [ ] Data calculations are accurate
- [ ] Colors match existing collection color scheme

### Task 3:
- [ ] Sidebar layout implemented without breaking table
- [ ] Speed distribution shows all categories present in data
- [ ] Flow distribution shows all patterns
- [ ] Percentages add up to 100%
- [ ] Updates when filters change

### Task 4:
- [ ] Drilldown panel opens in intuitive way
- [ ] Token list is sortable and has context
- [ ] Resize behavior feels natural (not janky)
- [ ] Can open multiple panels to compare buckets
- [ ] Hold metrics clearly separate exit patterns from holdings
- [ ] User can instantly tell which metric means what
- [ ] No more "median/avg/weighted/holding" confusion

---

## Testing Checklist

- [ ] Test with empty data (no wallets)
- [ ] Test with 1 wallet
- [ ] Test with 50+ wallets
- [ ] Test collection filter interaction
- [ ] Test responsive behavior (desktop only for now)
- [ ] Test dark mode compatibility
- [ ] No TypeScript errors
- [ ] `npm run lint --prefix dashboard` passes

---

## Dependencies & Libraries

**Existing:**
- React, Next.js 14
- shadcn/ui components
- Tailwind CSS
- `lucide-react` for icons
- Existing color utilities: `getCollectionColorFilled()`, `getSpeedColor()`, `getFlowColor()`

**New (If Needed):**
- Recharts for charts: `npm install recharts --prefix dashboard`

---

## Notes for LLM

- **Don't break existing functionality** - These are additive features
- **Follow existing patterns** - Look at Trackers page sidebar for reference
- **Use existing components** - Card, Badge, Button from shadcn/ui
- **Keep mobile in mind** - But focus on desktop for now
- **Test incrementally** - Complete one task before moving to next
