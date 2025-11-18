# Holder Profiles Page — Complete Redesign Specification

**Version:** 1.0
**Date:** 2025-11-18
**Status:** Design Specification

---

## 1. Problem Statement

### Current Issues
1. **Mathematical Nonsense**: "Avg Median Hold Time" - mixing average and median is incoherent
2. **Data Duplication**: Same wallet shows conflicting values (1m vs 42s vs 3m)
3. **No Source of Truth**: Summary cards and table show different data
4. **Visual Hierarchy Disaster**: "High Quality Data" gets huge space while insights are cramped
5. **Mode Confusion**: UI language inconsistent between single/multi wallet modes
6. **Redundant Information**: Table header repeats wallet info shown elsewhere
7. **Poor UX**: User can't quickly grasp "what kind of trader is this?"

### User Needs
- **Token Mode**: "What's the overall holder sentiment for this token?"
- **Wallet Mode**: "What kind of trader is this wallet?" (with ability to compare 2-3)
- **Trust**: "Can I rely on this data?"
- **Quick Scan**: Answer within 3 seconds of viewing

---

## 2. Design Principles

1. **Clarity over Complexity**: One clear metric is better than three confusing ones
2. **Hierarchy by Impact**: Behavior classification is more valuable than data quality
3. **No Duplication**: Every piece of information appears exactly once
4. **Mathematical Correctness**: All metric names must be mathematically valid
5. **Scannable**: Critical insights visible without scrolling or hovering
6. **Beautiful Simplicity**: Modern, sleek, minimal — no visual clutter
7. **Progressive Disclosure**: Show summary first, details on demand (hover/expand)

---

## 3. Information Architecture

### Two Modes (Simplified)

#### Mode 1: Wallet Analysis (Adaptive)
**Use Case**: Analyze 1-3 wallets (single or comparative analysis)
**Input**: 1-3 wallet addresses (comma/space separated in one input field)
**Output**: UI adapts based on count:
- **1 wallet** → Full hero card (large, detailed, center-focused)
- **2 wallets** → 2 comparison cards (side by side, equal width)
- **3 wallets** → 3 comparison cards (grid layout, compact)

**Why Adaptive?** No mode switching needed. User simply enters addresses and UI responds. Same analysis, different layouts optimized for the count.

#### Mode 2: Token Holders View
**Use Case**: Analyze top holders of a specific token
**Input**: Token mint + top N count (1-50)
**Output**: Aggregate metrics (3 summary cards) + sortable table of all holders

---

## 4. Visual Design System

### Color Palette

#### Behavior Colors (Semantic)
```
SNIPER:       Red-500     #ef4444    (Danger/Fast)
SCALPER:      Orange-500  #f97316    (Warning/Quick)
MOMENTUM:     Yellow-500  #eab308    (Attention/Fast)
INTRADAY:     Amber-500   #f59e0b    (Caution/Medium)
DAY_TRADER:   Blue-500    #3b82f6    (Info/Medium)
SWING:        Cyan-500    #06b6d4    (Cool/Slower)
POSITION:     Green-500   #22c55e    (Safe/Long)
HOLDER:       Emerald-600 #059669    (Trust/Very Long)
```

#### Quality Indicators
```
HIGH:         Green-500   #22c55e    ✓ checkmark
MEDIUM:       Blue-500    #3b82f6    ◐ half-circle
LOW:          Yellow-500  #eab308    ⚠ warning
INSUFFICIENT: Red-500     #ef4444    ✗ cross
```

#### Background Gradients (for hero cards)
```
SNIPER:       linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)  (red-100 to red-200)
SCALPER:      linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%)  (orange-100 to orange-200)
HOLDER:       linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)  (emerald-100 to emerald-200)
DEFAULT:      linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)  (slate-100 to slate-200)
```

### Typography
```
Hero Title (Behavior):     3xl (1.875rem) font-bold tracking-tight
Wallet Address:            base (1rem) font-mono text-muted-foreground
Primary Metrics:           2xl (1.5rem) font-semibold
Secondary Metrics:         base (1rem) font-medium
Labels:                    sm (0.875rem) text-muted-foreground
Tooltips:                  xs (0.75rem)
```

### Spacing & Layout
```
Card Padding:              6 (1.5rem)
Card Gap (grid):           4 (1rem)
Section Gap:               6 (1.5rem)
Metric Spacing:            3 (0.75rem)
Border Radius:             lg (0.5rem)
Border Radius (cards):     xl (0.75rem)
```

### Shadows & Depth
```
Card Shadow:               shadow-sm (subtle)
Hover Shadow:              shadow-md (medium)
Active Shadow:             shadow-lg (pronounced)
Border:                    1px solid hsl(var(--border))
```

---

## 5. Mode-Specific Designs

### MODE 1: Wallet Analysis (Adaptive Layout)

#### Input Section (Same for 1-3 wallets)
```
┌─────────────────────────────────────────────────────────────────┐
│  INPUT SECTION                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Wallet Address(es) — separate multiple with comma/space  │  │
│  │ [_________________________________________________]       │  │
│  │ Example: DfMx...Xhzj, AbCd...Xyz                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│  [Analyze Wallet(s)] button                                     │
└─────────────────────────────────────────────────────────────────┘
```

#### Layout A: Single Wallet (1 address entered)
**Use:** Deep dive into one wallet's behavior
**Display:** Large hero card, center-focused, maximum detail

```
┌─────────────────────────────────────────────────────────────────┐
│  HERO CARD (Full Width, Maximum Detail)                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ [Gradient Background based on behavior type]               │  │
│  │                                                             │  │
│  │  DfMx...Xhzj  🔗                            Quality: HIGH ✓│  │
│  │                                                             │  │
│  │                      🎯 SNIPER                             │  │
│  │               Ultra-fast trading bot                       │  │
│  │               < 1 minute hold times                        │  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Median Hold        Avg Hold          Flip Ratio    │  │  │
│  │  │     42s               3m                81%         │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  │  Exit Pattern: ALL_AT_ONCE  •  Confidence: 100%           │  │
│  │  Based on 47 completed cycles                             │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

#### Component Breakdown

**Hero Card Elements:**
1. **Header Row** (top-right corner)
   - Wallet address (left): `DfMx...Xhzj` + link icon (opens Solscan)
   - Quality badge (right): `HIGH ✓` (small, subtle)

2. **Behavior Section** (center, large)
   - Icon: Emoji or Lucide icon representing behavior
   - Behavior Type: `SNIPER` (large, bold)
   - Description: `Ultra-fast trading bot` (subtitle)
   - Time Range: `< 1 minute hold times` (hint text)

3. **Metrics Row** (center, grid 3 columns)
   ```
   ┌────────────┐  ┌────────────┐  ┌────────────┐
   │ Median Hold│  │  Avg Hold  │  │ Flip Ratio │
   │    42s     │  │     3m     │  │    81%     │
   └────────────┘  └────────────┘  └────────────┘
   ```
   Each with tooltip on hover explaining the metric

4. **Footer Row** (bottom, small text)
   - Exit Pattern + Confidence + Cycle Count

#### Gradient Backgrounds
- Changes dynamically based on `behaviorType`
- Subtle gradient (light in light mode, darker in dark mode)
- Text color adapts for contrast

---

#### Layout B: Two Wallets (2 addresses entered)
**Use:** Side-by-side comparison of two wallets
**Display:** 2-column grid, equal width cards, comparison-optimized

```
┌─────────────────────────────────────────────────────────────────┐
│  COMPARISON CARDS (2 Column Grid)                               │
│                                                                  │
│  ┌───────────────────────────┐  ┌───────────────────────────┐  │
│  │ WALLET 1                  │  │ WALLET 2                  │  │
│  │ DfMx...Xhzj  🔗  HIGH ✓   │  │ AbCd...Xyz  🔗  MED ◐     │  │
│  │                           │  │                           │  │
│  │      🎯 SNIPER            │  │      📈 SWING             │  │
│  │   Ultra-fast bot          │  │   1-7 day holds           │  │
│  │                           │  │                           │  │
│  │   42s / 3m                │  │   2d / 5d                 │  │
│  │   Flip: 81%               │  │   Flip: 12%               │  │
│  │                           │  │                           │  │
│  │   Exit: ALL_AT_ONCE       │  │   Exit: GRADUAL           │  │
│  └───────────────────────────┘  └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

#### Layout C: Three Wallets (3 addresses entered)
**Use:** Compare three wallets at once
**Display:** 3-column grid, compact cards, quick-scan format

```
┌─────────────────────────────────────────────────────────────────┐
│  COMPARISON CARDS (3 Column Grid)                               │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ WALLET 1     │  │ WALLET 2     │  │ WALLET 3     │         │
│  │ DfMx...Xhzj  │  │ AbCd...Xyz   │  │ EfGh...Qrs   │         │
│  │              │  │              │  │              │         │
│  │ 🎯 SNIPER    │  │ 📈 SWING     │  │ 💎 HOLDER    │         │
│  │ Ultra-fast   │  │ 1-7 days     │  │ Long-term    │         │
│  │              │  │              │  │              │         │
│  │ 42s / 3m     │  │ 2d / 5d      │  │ 45d / 78d    │         │
│  │ Flip: 81%    │  │ Flip: 12%    │  │ Flip: 3%     │         │
│  │              │  │              │  │              │         │
│  │ Quality: HIGH│  │ Quality: MED │  │ Quality: HIGH│         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

#### Comparison Card Design Notes
- **Compact version** of hero card (scaled down for multi-column)
- **All cards same height** for aligned comparison
- **Color-coded borders** based on behavior type
- **Quick-scan format**: `median / avg` combined on one line
- **Gradient backgrounds** change per wallet behavior
- **Behavior icons** for instant recognition
- **Vertically aligned metrics** for easy comparison across columns

---

### MODE 2: Token Holders View

#### Layout
```
┌─────────────────────────────────────────────────────────────────┐
│  INPUT SECTION                                                   │
│  ┌──────────────────────────────┐  ┌────────────┐              │
│  │ Token Mint: [_______________] │  │ Top N: [10]│              │
│  └──────────────────────────────┘  └────────────┘              │
│  [Analyze Token Holders] button                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  CONTEXT BAR                                                     │
│  Token: DfMx...Xhzj  •  10 holders analyzed  •  9/10 high quality ✓
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  AGGREGATE METRICS (3 Cards)                                    │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐│
│  │ 🕐 Median Hold   │  │ ⚡ Flip Activity │  │ 👥 Holder Mix ││
│  │                  │  │                  │  │               ││
│  │       42s        │  │       81%        │  │   8 Snipers   ││
│  │    (typical)     │  │   High Risk ⚠   │  │   2 Holders   ││
│  │                  │  │                  │  │               ││
│  │ Most holders exit│  │ 81% of positions │  │ Dominated by  ││
│  │ within seconds   │  │ flipped in <5min │  │ fast traders  ││
│  └──────────────────┘  └──────────────────┘  └───────────────┘│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  HOLDERS TABLE                                                   │
│  ┌───┬──────────┬──────────┬──────┬──────────┬────────┐        │
│  │ # │ Wallet   │ Hold Time│ Flip │ Behavior │Quality │        │
│  ├───┼──────────┼──────────┼──────┼──────────┼────────┤        │
│  │ 1 │DfMx...zj │ 42s (3m) │ 81% │  SNIPER  │ HIGH ✓ │        │
│  │ 2 │AbCd...yz │ 2d (5d)  │ 12% │  SWING   │ HIGH ✓ │        │
│  │...│          │          │      │          │        │        │
│  └───┴──────────┴──────────┴──────┴──────────┴────────┘        │
│                                                                  │
│  [Export CSV] [Sort by Hold Time ▼] [Filter: All Behaviors ▼]  │
└─────────────────────────────────────────────────────────────────┘
```

#### Aggregate Metrics Cards

**Card 1: Median Hold**
- **Value**: Median of all holders' median hold times
- **Label**: "Median Hold (typical)"
- **Description**: Contextual interpretation
  - `< 1m`: "Most holders exit within seconds"
  - `1m-1h`: "Short-term trading dominates"
  - `1h-1d`: "Intraday trading pattern"
  - `1d-7d`: "Multi-day holding typical"
  - `> 7d`: "Long-term holding mindset"

**Card 2: Flip Activity**
- **Value**: Average flip ratio across all holders
- **Label**: "Flip Activity"
- **Risk Level** (dynamic):
  - `> 70%`: "High Risk ⚠" (red)
  - `40-70%`: "Moderate Risk ◐" (yellow)
  - `< 40%`: "Stable ✓" (green)
- **Description**: "X% of positions flipped in <5min"

**Card 3: Holder Mix**
- **Value**: Breakdown of behavior types
- **Format**:
  - If dominated (>60% one type): "8 Snipers, 2 Holders"
  - If mixed: "Mixed: 4 Snipers, 3 Swing, 3 Holders"
- **Description**: Interpretation
  - Dominated: "Dominated by [type]"
  - Mixed: "Diverse holder base"

---

## 6. Component Specifications

### WalletHeroCard Component

**Props:**
```typescript
interface WalletHeroCardProps {
  walletAddress: string;
  behaviorType: BehaviorType;
  medianHoldTimeHours: number;
  avgHoldTimeHours: number;
  dailyFlipRatio: number;
  exitPattern: string;
  dataQualityTier: QualityTier;
  confidence: number;
  completedCycleCount: number;
  insufficientDataReason?: string;
}
```

**Behavior Mapping:**
```typescript
const BEHAVIOR_CONFIG = {
  SNIPER: {
    icon: '🎯',
    title: 'SNIPER',
    description: 'Ultra-fast trading bot',
    timeRange: '< 1 minute hold times',
    gradient: 'from-red-100 to-red-200',
    color: 'red-500',
  },
  SCALPER: {
    icon: '⚡',
    title: 'SCALPER',
    description: 'Lightning-fast scalping',
    timeRange: '1-5 minute holds',
    gradient: 'from-orange-100 to-orange-200',
    color: 'orange-500',
  },
  HOLDER: {
    icon: '💎',
    title: 'HOLDER',
    description: 'Long-term investor',
    timeRange: '30+ day holds',
    gradient: 'from-emerald-100 to-emerald-200',
    color: 'emerald-600',
  },
  // ... etc for all types
};
```

**Layout Structure:**
```tsx
<Card className="relative overflow-hidden">
  {/* Gradient Background */}
  <div className="absolute inset-0 bg-gradient-to-br {gradient} opacity-50" />

  <div className="relative z-10 p-8 space-y-6">
    {/* Header */}
    <div className="flex justify-between items-start">
      <WalletAddressLink address={walletAddress} />
      <QualityBadge tier={dataQualityTier} />
    </div>

    {/* Behavior Hero */}
    <div className="text-center space-y-2">
      <div className="text-6xl">{icon}</div>
      <h2 className="text-3xl font-bold">{title}</h2>
      <p className="text-lg text-muted-foreground">{description}</p>
      <p className="text-sm text-muted-foreground">{timeRange}</p>
    </div>

    {/* Metrics Grid */}
    <div className="grid grid-cols-3 gap-4">
      <MetricCard label="Median Hold" value={formatHoldTime(median)} />
      <MetricCard label="Avg Hold" value={formatHoldTime(avg)} />
      <MetricCard label="Flip Ratio" value={`${flip}%`} />
    </div>

    {/* Footer */}
    <div className="text-center text-sm text-muted-foreground">
      Exit: {exitPattern} • Confidence: {confidence}% • {cycleCount} cycles
    </div>
  </div>
</Card>
```

---

### HolderAggregateMetrics Component

**Props:**
```typescript
interface HolderAggregateMetricsProps {
  profiles: HolderProfile[];
}
```

**Calculations:**
```typescript
// Median of medians (not average!)
const medianHoldTime = calculateMedian(
  profiles
    .filter(p => p.dataQualityTier !== 'INSUFFICIENT')
    .map(p => p.medianHoldTimeHours)
    .filter(h => h !== null)
);

// Average flip ratio
const avgFlipRatio = calculateAverage(
  profiles
    .filter(p => p.dataQualityTier !== 'INSUFFICIENT')
    .map(p => p.dailyFlipRatio)
    .filter(r => r !== null)
);

// Behavior breakdown
const behaviorCounts = countBy(
  profiles.filter(p => p.behaviorType !== null),
  'behaviorType'
);
```

**Risk Interpretation:**
```typescript
const getRiskLevel = (flipRatio: number): RiskLevel => {
  if (flipRatio >= 70) return { level: 'HIGH', color: 'red', label: 'High Risk ⚠' };
  if (flipRatio >= 40) return { level: 'MODERATE', color: 'yellow', label: 'Moderate Risk ◐' };
  return { level: 'STABLE', color: 'green', label: 'Stable ✓' };
};
```

---

### HoldersTable Component

**Columns:**
1. **Rank** (token mode only): `#1`, `#2`, etc.
2. **Wallet**: Truncated address + link icon
3. **Hold Time**: `42s (3m)` format - median (average)
4. **Flip**: `81%` with color coding
5. **Behavior**: Badge with color + tooltip
6. **Quality**: Badge with icon

**Simplified Column Layout:**
```
Rank  Wallet        Hold Time    Flip    Behavior       Quality
#1    DfMx...Xhzj   42s (3m)    81%     SNIPER         HIGH ✓
```

**Sorting:**
- Default: By rank (token mode) or by median hold time (wallet mode)
- Allow sorting by: Rank, Hold Time, Flip Ratio, Behavior

**Filtering:**
- Filter by behavior type
- Filter by quality tier

**Table Actions:**
- Click wallet → Navigate to wallet detail page
- Click behavior → Filter by that behavior
- Export to CSV

---

## 7. Interaction Design

### Hover States

**Hero Card:**
- Hover → Slight shadow increase + scale(1.01)
- Transition: 200ms ease-in-out

**Metric Cards:**
- Hover → Show tooltip with detailed explanation
- Tooltip content:
  - **Median Hold**: "Median holding time across all completed positions. Less affected by outliers than average."
  - **Avg Hold**: "Weighted average holding time, accounting for position size."
  - **Flip Ratio**: "Percentage of completed positions held for less than 5 minutes. Higher = more short-term trading."

**Quality Badge:**
- Hover → Tooltip showing:
  ```
  Data Quality: HIGH
  Completed Cycles: 47
  Confidence: 100%
  Based on sufficient transaction history
  ```

**Behavior Badge:**
- Hover → Tooltip showing time range and description
  ```
  SNIPER
  < 1 minute hold times
  Bot or MEV behavior
  ```

### Transitions

**Page Load:**
1. Input section fades in (0ms)
2. Results section slides up + fade in (200ms delay)
3. Cards stagger in left-to-right (50ms between each)

**Mode Switch:**
- Smooth transition between token/wallet tabs
- Results fade out (150ms) → new results fade in (150ms)

**Loading States:**
- Skeleton cards with shimmer animation
- Progress bar for job completion
- Real-time WebSocket updates

---

## 8. Responsive Design

### Breakpoints
```
sm:  640px   (Mobile landscape)
md:  768px   (Tablet)
lg:  1024px  (Desktop)
xl:  1280px  (Large desktop)
```

### Mobile (< 768px)
- Single column layout for all cards
- Stack metrics vertically in hero card
- Simplified table (hide rank, show essential columns only)
- Larger touch targets (48px minimum)

### Tablet (768px - 1024px)
- 2-column grid for comparison cards
- 2-column grid for aggregate metrics
- Full table with horizontal scroll if needed

### Desktop (> 1024px)
- 3-column grid for comparison cards
- 3-column grid for aggregate metrics
- Full table with all columns visible

---

## 9. Accessibility

### ARIA Labels
```tsx
<Card aria-label="Wallet behavior analysis for {address}">
<Badge aria-label="Data quality: {tier}, Confidence: {confidence}%">
<Tooltip aria-describedby="median-hold-tooltip">
```

### Keyboard Navigation
- Tab order: Input → Analyze button → Results cards → Table rows
- Enter on wallet link → Navigate to detail page
- Escape on tooltip → Close tooltip

### Screen Readers
- Announce behavior type on card focus
- Announce metric values with units
- Announce quality level and confidence

### Color Contrast
- All text meets WCAG AA standards (4.5:1 minimum)
- Behavior badges have both color AND text/icon
- Quality indicators have both color AND symbol (✓, ◐, ⚠, ✗)

---

## 10. Edge Cases & Error States

### Insufficient Data
```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠ INSUFFICIENT DATA                                            │
│                                                                  │
│  This wallet has only 3 completed trading cycles.               │
│  We need at least 5 cycles for reliable analysis.               │
│                                                                  │
│  Preliminary Analysis:                                          │
│  - Limited data suggests SCALPER behavior                       │
│  - Median hold: 2m (very low confidence)                        │
│  - Quality: INSUFFICIENT                                        │
│                                                                  │
│  [Try analyzing a more active wallet]                           │
└─────────────────────────────────────────────────────────────────┘
```

### Loading State
```
┌─────────────────────────────────────────────────────────────────┐
│  Analyzing wallet DfMx...Xhzj...                                │
│  ████████████░░░░░░░░░░░░░░░░  45%                             │
│  Fetching transaction history...                                │
└─────────────────────────────────────────────────────────────────┘
```

### Error State
```
┌─────────────────────────────────────────────────────────────────┐
│  ✗ Analysis Failed                                              │
│                                                                  │
│  Could not fetch data for wallet DfMx...Xhzj                    │
│  Error: RPC node timeout                                        │
│                                                                  │
│  [Retry Analysis] [Try Different Wallet]                        │
└─────────────────────────────────────────────────────────────────┘
```

### Empty State (No Holders)
```
┌─────────────────────────────────────────────────────────────────┐
│  No Top Holders Found                                           │
│                                                                  │
│  This token has no holders with sufficient transaction history  │
│  to analyze.                                                    │
│                                                                  │
│  Try a more established token with active trading.              │
└─────────────────────────────────────────────────────────────────┘
```

### Mixed Quality Data
- Show only HIGH/MEDIUM quality holders in aggregate metrics
- Display all holders in table, but visually de-emphasize LOW/INSUFFICIENT
- Show warning: "2 of 10 holders excluded from metrics due to insufficient data"

---

## 11. Metrics Definitions

### Median Hold Time
**Formula:** `median(all completed position hold durations for this wallet)`

**Definition:** The middle value when all hold times are sorted. Less affected by outliers than average.

**Example:** Wallet has hold times: 30s, 45s, 1m, 2m, 3h
Median = 1m (the middle value)

**When to Use:** Best represents "typical" hold time for wallets with some outlier positions.

---

### Average Hold Time
**Formula:** `weighted_average(position_hold_duration * position_size)`

**Definition:** Average hold time weighted by position size. Larger positions have more influence.

**Example:**
- 5 small positions held 30s each
- 1 large position held 3h
Average (weighted) ≈ 2h

**When to Use:** Better represents actual capital deployment time.

---

### Flip Ratio
**Formula:** `(positions held < 5min / total completed positions) * 100`

**Definition:** Percentage of positions exited within 5 minutes. Higher = more flipping.

**Thresholds:**
- `> 70%`: High-frequency trader / bot
- `40-70%`: Active trader
- `< 40%`: Patient trader / holder

---

### Behavior Type Classification

| Type | Hold Time Range | Description |
|------|----------------|-------------|
| SNIPER | < 1 minute | Bot/MEV behavior, instant exits |
| SCALPER | 1-5 minutes | Ultra-fast scalping |
| MOMENTUM | 5-30 minutes | Momentum trading |
| INTRADAY | 30 min - 4 hours | Short-term intraday |
| DAY_TRADER | 4-24 hours | Day trading |
| SWING | 1-7 days | Swing trading |
| POSITION | 7-30 days | Position trading |
| HOLDER | 30+ days | Long-term holding |

**Classification Logic:**
1. Calculate median hold time
2. Map to time range above
3. Validate with flip ratio (if median is short but flip is low, adjust classification)

---

### Exit Pattern

| Pattern | Definition |
|---------|------------|
| ALL_AT_ONCE | Single large exit transaction (> 80% of position) |
| GRADUAL | Multiple smaller exits over time |
| PARTIAL | Mix of partial sells and final exit |
| STOP_LOSS | Rapid exit during price drop (loss > 20%) |
| TAKE_PROFIT | Exit during price spike (profit > 50%) |

---

### Data Quality Tiers

| Tier | Criteria | Confidence |
|------|----------|-----------|
| HIGH | ≥ 20 completed cycles | > 95% |
| MEDIUM | 10-19 completed cycles | 75-95% |
| LOW | 5-9 completed cycles | 50-75% |
| INSUFFICIENT | < 5 completed cycles | < 50% |

**Insufficient Data Reasons:**
- "New wallet" - Created within 7 days
- "Inactive wallet" - No transactions in 30 days
- "Few cycles" - Less than 5 completed buy-sell cycles
- "Incomplete data" - Missing transaction history

---

## 12. Sleek Modern Design Elements

### Glassmorphism Effects
```css
.card-glass {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.1);
}
```

### Gradient Borders
```css
.card-gradient-border {
  border: 2px solid transparent;
  background:
    linear-gradient(white, white) padding-box,
    linear-gradient(135deg, #667eea 0%, #764ba2 100%) border-box;
}
```

### Animated Metrics
- Numbers count up on first render (using `react-countup`)
- Smooth color transitions based on values
- Pulse animation for critical alerts

### Micro-interactions
- Button hover: Slight lift + shadow increase
- Card hover: Subtle border glow
- Icon hover: Gentle rotation or scale
- Loading: Smooth progress bar with shimmer

### Typography Hierarchy
- Use `font-feature-settings: 'tnum'` for tabular numbers
- Use `letter-spacing: -0.02em` for headings (tighter)
- Use `font-variant-numeric: tabular-nums` for aligned metrics

### Visual Flourishes
- Behavior icons with subtle drop shadows
- Quality badges with soft glow effects
- Gradient text for hero titles
- Animated gradient backgrounds on hover

---

## 13. Implementation Plan

### Phase 1: Component Foundation (Day 1)
1. Create new component files:
   - `WalletHeroCard.tsx`
   - `WalletComparisonCard.tsx`
   - `HolderAggregateMetrics.tsx`
   - `HoldersTableSimplified.tsx`

2. Define constants:
   - `holder-behavior-config.ts` (behavior definitions, colors, icons)
   - `holder-metrics-utils.ts` (calculation utilities)

3. Create utility functions:
   - `formatHoldTime()` - Ultra-precise formatting
   - `calculateMedian()` - Proper median calculation
   - `getRiskLevel()` - Flip ratio interpretation
   - `getBehaviorConfig()` - Behavior configuration lookup

### Phase 2: Single Wallet Mode (Day 2)
1. Implement `WalletHeroCard` component
2. Add gradient backgrounds based on behavior
3. Implement tooltips for all metrics
4. Add quality badge to header
5. Test with various wallet types

### Phase 3: Multi-Wallet Mode (Day 2-3)
1. Implement input parsing (comma/space separated)
2. Create `WalletComparisonCard` component (compact version)
3. Implement responsive grid (2-3 columns)
4. Add side-by-side comparison styling
5. Test with 1, 2, and 3 wallets

### Phase 4: Token Mode (Day 3-4)
1. Fix aggregation calculations (median, not average!)
2. Implement `HolderAggregateMetrics` with 3 cards
3. Simplify table to essential columns
4. Add sorting and filtering
5. Add export functionality

### Phase 5: Polish & Edge Cases (Day 4-5)
1. Implement all loading states
2. Implement error states
3. Implement insufficient data state
4. Add animations and transitions
5. Test responsive design on all breakpoints

### Phase 6: Accessibility & Testing (Day 5)
1. Add ARIA labels
2. Test keyboard navigation
3. Test screen reader compatibility
4. Verify color contrast
5. Cross-browser testing

---

## 14. Success Metrics

### User Experience Goals
- **Time to Insight**: User understands wallet behavior within 3 seconds
- **Clarity**: 90%+ of users can correctly identify behavior type
- **Trust**: Quality indicators clearly communicate data reliability
- **Comparison**: Users can easily compare 2-3 wallets side by side

### Technical Goals
- **Performance**: Page renders in < 1 second
- **Accessibility**: WCAG AA compliance
- **Responsive**: Perfect rendering on all screen sizes
- **Error Handling**: Graceful degradation for all edge cases

### Design Goals
- **Visual Hierarchy**: Behavior classification is immediately visible
- **No Duplication**: Each metric appears exactly once
- **Mathematical Correctness**: All calculations and labels are accurate
- **Beautiful Simplicity**: Modern, sleek design without clutter

---

## 15. Future Enhancements (Post-MVP)

### Advanced Features
1. **Historical Trends**: Show behavior changes over time
2. **Wallet Grouping**: Identify related wallets (same owner)
3. **Risk Scoring**: Composite risk score (0-100)
4. **Alerts**: Notify when holder behavior changes
5. **Portfolio View**: Analyze multiple tokens at once
6. **Export Reports**: PDF/CSV export of full analysis

### AI Insights
1. **Behavior Prediction**: Predict future behavior based on patterns
2. **Anomaly Detection**: Flag unusual trading patterns
3. **Cohort Analysis**: Group similar holders together
4. **Sentiment Analysis**: Combine with social data

### Social Features
1. **Share Analysis**: Generate shareable links
2. **Watchlists**: Save and track favorite wallets
3. **Comparison History**: Compare changes over time
4. **Community Insights**: See what other analysts are viewing

---

## Appendix: Component File Structure

```
dashboard/src/components/holder-profiles/
├── WalletHeroCard.tsx              # Single wallet hero display
├── WalletComparisonCard.tsx        # Compact comparison card
├── HolderAggregateMetrics.tsx      # Token aggregate metrics (3 cards)
├── HoldersTableSimplified.tsx      # Simplified table with essential columns
├── QualityBadge.tsx                # Reusable quality indicator
├── BehaviorBadge.tsx               # Reusable behavior badge
├── MetricCard.tsx                  # Reusable metric display
└── utils/
    ├── holder-behavior-config.ts   # Behavior definitions & styling
    ├── holder-metrics-utils.ts     # Calculation utilities
    └── holder-formatting-utils.ts  # Display formatting
```

---

**End of Specification**

This design balances **simplicity, correctness, and beauty**. Every element serves a purpose. No duplication. Clear hierarchy. Mathematical accuracy. Modern aesthetics.

Ready to implement.
