  # Holder Profiles — Final Implementation Spec

  **Version:** 1.0 (Unified)
  **Timeline:** 2-3 days
  **Philosophy:** Cognitive value over metric volume. Answer questions, don't show data.

  ---

  ## TL;DR — What Changed

  **Problems with current UI:**
  1. ❌ "Avg Median Hold Time" — mathematically nonsense (averaging medians)
  2. ❌ Table-first design — user has to interpret raw numbers
  3. ❌ No clear answer — "Is this token alive?" "Should I follow this wallet?"
  4. ❌ Equal visual weight to data quality as actual insights

  **The Fix:**
  - ✅ **Cognitive primitives** — Speed, Conviction, Consistency (not raw metrics)
  - ✅ **Outcome strips** — Immediate verdict: "High churn, likely short-lived"
  - ✅ **Visual hierarchy** — Answer first, details second, table last
  - ✅ **Two clear modes** — Token Pulse (alive/dead?) + Wallet Classifier (follow/ignore?)
  - ✅ **Wallet compare-ready** — Wallet mode scales from 1 to 6 addresses using the same primitives and layout rules

  ---

  ## Core Design Principles

  1. **Answer questions, don't show data**
     Users don't care about "42s median hold" — they care about "Is this a bot?"

  2. **Cognitive primitives over raw metrics**
     - Speed (not "median hold time")
     - Conviction (not "flip ratio")
     - Consistency (not "cycle count")

  3. **Visual > Tabular**
     Tables support decisions; they don't make them.

  4. **Outcome-first hierarchy**
     1st: The answer (outcome strip)
     2nd: The reasoning (cognitive primitives)
     3rd: The evidence (composition bar / table)

  5. **No over-engineering**
     - No heavy glassmorphism
     - No radar charts (can add later)
     - Multi-wallet comparison optimized for up to 6 addresses (wrap + scroll beyond that)

  ---

  ## Data Model (What We Have)

  From `HolderProfile` interface:

  ```typescript
  interface HolderProfile {
    // Identity
    walletAddress: string;
    rank: number;                       // Token mode only
    supplyPercent: number;              // Token mode only

    // Core Metrics
    medianHoldTimeHours: number | null;
    avgHoldTimeHours: number | null;
    dailyFlipRatio: number | null;      // % of positions held <5min

    // Classification
    behaviorType: string | null;        // SNIPER, SCALPER, SWING, HOLDER, etc.
    exitPattern: string | null;         // GRADUAL, ALL_AT_ONCE

    // Quality
    dataQualityTier: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
    completedCycleCount: number;
    confidence: number;                 // 0-1
    insufficientDataReason?: string;

    processingTimeMs: number;
  }
  ```

  **What we derive:**
  - **Speed category** from `medianHoldTimeHours`
  - **Conviction category** from `dailyFlipRatio`
  - **Consistency category** from `completedCycleCount` + `confidence`
  - **Outcome verdict** from all three + `behaviorType` + `dataQualityTier`

  ---

  ## Mode 1: Token Pulse — "Is this token alive?"

  ### Input
  - Token Mint (text)
  - Top N (number, default 10, max 50)

  ### Layout Structure

  ```
  ┌─────────────────────────────────────────────────────────────┐
  │  OUTCOME STRIP (Full-width, prominent)                      │
  │  "High churn, likely short-lived"                           │
  │  Top holders exit within minutes. Dominated by bots.        │
  └─────────────────────────────────────────────────────────────┘

  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │  🕐 SPEED        │  │  💎 CONVICTION   │  │  📊 CONSISTENCY  │
  │  Median 42s      │  │  Flip 81%        │  │  8/10 High       │
  │  Ultra-fast      │  │  Low conviction  │  │  quality data    │
  └──────────────────┘  └──────────────────┘  └──────────────────┘

  ┌─────────────────────────────────────────────────────────────┐
  │  BEHAVIOR COMPOSITION BAR                                    │
  │  ▓▓▓▓▓▓▓▓▓▓░░░                                              │
  │  Dominant: 8 Snipers, 2 Holders                             │
  └─────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────┐
  │  MINIMAL TABLE (supporting detail)                          │
  │  Rank | Wallet | Behavior | Speed | Flip | Quality          │
  └─────────────────────────────────────────────────────────────┘
  ```


  #### Single Wallet Layout
  - Hero card remains primary with full outcome sentence, primitives row, and follow actions.
  - Notes/actions area sits under the card (copy address, open in Solscan).

  #### Multi-wallet Compare (2-6 wallets)
  - Parse the shared input into an array, dedupe, cap the UI at 6 for now, and surface inline chips with remove buttons.
  - Show a responsive grid of `WalletCompareCard`s (2-up on desktop for <=3, 3-up with wrap/h-scroll for 4-6, stacked on mobile).
  - Each compare card mirrors the hero card info but in compact form: address header, behavior badge + confidence, mini primitives row, and a 1-line outcome verdict.
  - Include quick actions per card (copy, follow, alert) and highlight the currently focused wallet for cross-ref in the table.
  - Surface an inline zero-state when only one wallet is entered to remind users they can paste up to five more.

  #### Group Insights Row (only when >1 wallet)
  - Lives above the grid to summarize what changes across the group.
  - Callouts: dominant behavior, fastest exit, highest conviction, weakest data quality.

  ```typescript
  interface WalletGroupInsight {
    label: string;
    value: string;
    description: string;
    color: string;
  }

  function getWalletGroupInsights(profiles: HolderProfile[]): WalletGroupInsight[] {
    if (profiles.length < 2) return [];
    const comparable = profiles.filter(p => !!p.behaviorType);
    const counts = countBy(comparable, 'behaviorType');
    const sortedByCount = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const dominantBehavior = sortedByCount[0]?.[0];
    const sortedBySpeed = [...profiles].sort((a, b) => {
      return (a.medianHoldTimeHours ?? Number.POSITIVE_INFINITY) - (b.medianHoldTimeHours ?? Number.POSITIVE_INFINITY);
    });
    const sortedByConviction = [...profiles].sort((a, b) => (a.dailyFlipRatio ?? 0) - (b.dailyFlipRatio ?? 0));
    const weakestQuality = profiles.find(p => p.dataQualityTier !== 'HIGH');

    return [
      {
        label: 'Dominant behavior',
        value: dominantBehavior ?? 'Mixed',
        description: dominantBehavior
          ? `${counts[dominantBehavior]} of ${profiles.length}`
          : 'No clear leader',
        color: dominantBehavior ? BEHAVIOR_COLORS[dominantBehavior] : 'slate'
      },
      {
        label: 'Fastest exit',
        value: sortedBySpeed[0]?.walletAddress ?? 'N/A',
        description: sortedBySpeed[0]
          ? `${formatHoldTime(sortedBySpeed[0].medianHoldTimeHours)} median hold`
          : 'Insufficient data',
        color: 'red'
      },
      {
        label: 'Highest conviction',
        value: sortedByConviction[0]?.walletAddress ?? 'N/A',
        description: sortedByConviction[0]
          ? `${sortedByConviction[0].dailyFlipRatio?.toFixed(0)}% flip`
          : 'Insufficient data',
        color: 'green'
      },
      {
        label: 'Data warning',
        value: weakestQuality ? weakestQuality.walletAddress : 'All high quality',
        description: weakestQuality
          ? `${weakestQuality.dataQualityTier} quality`
          : 'No issues',
        color: weakestQuality ? 'yellow' : 'emerald'
      }
    ];
  }
  ```

  ---

  ### 1. Outcome Strip

  **Purpose:** Answer "Is this token alive?" in one glance.

  **Logic:** (deterministic, no AI)

  ```typescript
  function getTokenOutcome(profiles: HolderProfile[]): Outcome {
    const valid = profiles.filter(p => p.dataQualityTier !== 'INSUFFICIENT');

    // Calculate aggregate primitives
    const medianSpeed = median(valid.map(p => p.medianHoldTimeHours));
    const avgFlip = average(valid.map(p => p.dailyFlipRatio));
    const behaviorCounts = countBy(valid, 'behaviorType');
    const dominantBehavior = maxBy(Object.entries(behaviorCounts), ([_, count]) => count);

    // Decision tree
    if (medianSpeed < 0.1 && avgFlip > 70) {
      return {
        verdict: 'High churn, likely short-lived',
        description: 'Top holders exit within minutes. Dominated by bots.',
        color: 'red',
        icon: '⚠️'
      };
    }

    if (medianSpeed < 24 && avgFlip > 40 && dominantBehavior[0] in ['SNIPER', 'SCALPER', 'MOMENTUM'])
           +  {
      return {
        verdict: 'Mixed behavior, token still has room',
        description: 'Some fast flippers, some mid-term holders.',
        color: 'yellow',
        icon: '⚡'
      };
    }

    if (medianSpeed > 24 && avgFlip < 40) {
      return {
        verdict: 'Relatively stable',
        description: 'Early holders are not dumping immediately.',
        color: 'green',
        icon: '✓'
      };
    }

    return {
      verdict: 'Mixed signals',
      description: 'Diverse holder base with varied strategies.',
      color: 'blue',
      icon: 'ℹ️'
    };
  }
  ```

  **UI:**
  - Full-width banner at the top
  - Large text (verdict) + supporting sentence (description)
  - Background color based on verdict (red/yellow/green/blue)
  - Icon on left

  ---

  ### 2. Cognitive Primitives Row (Token)

  Three cards, same height, grid layout.

  #### Card 1: Speed
  ```typescript
  function getSpeedPrimitive(medianHoldHours: number) {
    if (medianHoldHours < 1/60) return { value: `${Math.round(medianHoldHours * 3600)}s`, label:
           + 'Ultra-fast' };
    if (medianHoldHours < 1) return { value: `${Math.round(medianHoldHours * 60)}m`, label: 'Fast' };
    if (medianHoldHours < 24) return { value: `${medianHoldHours.toFixed(1)}h`, label: 'Intraday' };
    if (medianHoldHours < 168) return { value: `${(medianHoldHours/24).toFixed(1)}d`, label:
           + 'Multi-day' };
    return { value: `${(medianHoldHours/168).toFixed(1)}w`, label: 'Long-term' };
  }
  ```

  **Display:**
  - Icon: 🕐
  - Label: "SPEED"
  - Value: "Median 42s" (formatted)
  - Subtext: "Ultra-fast" (category)

  #### Card 2: Conviction
  ```typescript
  function getConvictionPrimitive(flipRatio: number) {
    if (flipRatio > 70) return { label: 'Low conviction', color: 'red', description: 'Frequent flips'
           +  };
    if (flipRatio > 40) return { label: 'Mixed conviction', color: 'yellow', description: 'Moderate
           + flips' };
    return { label: 'High conviction', color: 'green', description: 'Rare flips' };
  }
  ```

  **Display:**
  - Icon: 💎
  - Label: "CONVICTION"
  - Value: "Flip 81%"
  - Subtext: "Low conviction" (category) + color indicator

  #### Card 3: Consistency
  ```typescript
  function getConsistencyPrimitive(profiles: HolderProfile[]) {
    const highQuality = profiles.filter(p => p.dataQualityTier === 'HIGH').length;
    const total = profiles.length;
    const ratio = highQuality / total;

    if (ratio > 0.7) return { label: 'Consistent', description: `${highQuality}/${total} high
           + quality` };
    if (ratio > 0.4) return { label: 'Moderate', description: `${highQuality}/${total} reliable` };
    return { label: 'Chaotic', description: `Only ${highQuality}/${total} reliable` };
  }
  ```

  **Display:**
  - Icon: 📊
  - Label: "CONSISTENCY"
  - Value: "8/10 High"
  - Subtext: "Consistent data" (category)

  ---

  ### 3. Behavior Composition Bar

  **Purpose:** Visual pattern recognition — what kind of holders dominate?

  **Component:** Horizontal stacked bar

  ```typescript
  interface BehaviorSegment {
    type: string;           // SNIPER, SCALPER, etc.
    count: number;
    percentage: number;
    color: string;
  }

  function getBehaviorComposition(profiles: HolderProfile[]): BehaviorSegment[] {
    const valid = profiles.filter(p => p.behaviorType !== null);
    const counts = countBy(valid, 'behaviorType');

    return Object.entries(counts).map(([type, count]) => ({
      type,
      count,
      percentage: (count / valid.length) * 100,
      color: BEHAVIOR_COLORS[type]
    }));
  }
  ```

  **Visual:**
  ```html
  <div class="w-full h-8 flex rounded-lg overflow-hidden">
    <div style="width: 80%; background: red">SNIPER (8)</div>
    <div style="width: 20%; background: green">HOLDER (2)</div>
  </div>
  <p class="text-sm">Dominant: 8 Snipers, 2 Holders</p>
  ```

  **Description logic:**
  - If one type > 60%: "Dominated by [type]"
  - If top two > 80%: "Mix of [type1] and [type2]"
  - Else: "Diverse: [breakdown]"

  ---

  ### 4. Minimal Table

  **Columns (reduced from current 9 to 6):**
  1. **Rank** — `#1`, `#2`
  2. **Wallet** — Truncated + link
  3. **Behavior** — Badge with color + tooltip
  4. **Speed** — `42s` (median only, no avg)
  5. **Flip** — `81%` with color
  6. **Quality** — Badge (HIGH/MED/LOW/INSUFF)

  **Remove:**
  - ❌ Supply % (not important for quick scan)
  - ❌ Avg Hold (redundant with median)
  - ❌ Exit Pattern (nice-to-have, not critical)

  **Styling:**
  - Dense rows (less padding)
  - Subtle borders
  - Light hover state
  - Sits below composition bar (supporting role)

  ---

  ## Mode 2: Wallet Classifier — "Should I follow this wallet?"

  ### Input
  - Up to 6 wallet addresses (comma or space separated input; warn + gracefully degrade beyond 6)
  - Auto-detect layout: 1 wallet = hero card, 2-3 wallets = split view/grid, 4-6 wallets = multi-row grid with wrap/horizontal scroll
  - Warn when >6 wallets are entered (suggest bulk mode / CSV upload later)

  ### Layout Structure

  ```
  ┌─────────────────────────────────────────────────────────────┐
  │  WALLET CARD                                                 │
  │  ┌───────────────────────────────────────────────────────┐  │
  │  │ DfMx...Xhzj  🔗                    Quality: HIGH ✓    │  │
  │  │                                                        │  │
  │  │               🎯 SNIPER (89%)                         │  │
  │  │         Ultra-fast trading bot                        │  │
  │  │                                                        │  │
  │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │  │
  │  │  │ Speed       │ │ Conviction  │ │ Consistency │    │  │
  │  │  │ 42s         │ │ Flip 81%    │ │ 47 cycles   │    │  │
  │  │  │ Ultra-fast  │ │ Low         │ │ High conf.  │    │  │
  │  │  └─────────────┘ └─────────────┘ └─────────────┘    │  │
  │  │                                                        │  │
  │  │  Outcome: Ultra-fast sniper. Not safe to follow for  │  │
  │  │  more than seconds.                                   │  │
  │  └───────────────────────────────────────────────────────┘  │
  └─────────────────────────────────────────────────────────────┘
  ```

  ---

  ### 1. Wallet Hero Card

  **Header Row:**
  - Left: Wallet address (truncated) + external link icon → Solscan
  - Right: Quality badge (small, subtle)

  **Behavior Badge (Probabilistic):**

  Since we have discrete classification but no probability scores in the current data, we show
           + confidence instead:

  ```typescript
  function getBehaviorBadge(profile: HolderProfile) {
    return {
      primary: profile.behaviorType,
      confidence: Math.round(profile.confidence * 100),
      displayText: `${profile.behaviorType} (${Math.round(profile.confidence * 100)}%)`
    };
  }
  ```

  **Display:**
  - Large badge in center
  - Icon (behavior-specific emoji)
  - Type name + confidence percentage
  - Description below

  **Behavior Icons:**
  ```typescript
  const BEHAVIOR_CONFIG = {
    SNIPER: { icon: '🎯', description: 'Ultra-fast trading bot' },
    SCALPER: { icon: '⚡', description: 'Lightning-fast scalping' },
    MOMENTUM: { icon: '📈', description: 'Momentum chasing' },
    INTRADAY: { icon: '🔄', description: 'Intraday trading' },
    DAY_TRADER: { icon: '📊', description: 'Active day trading' },
    SWING: { icon: '🌊', description: 'Swing trading (1-7 days)' },
    POSITION: { icon: '🎯', description: 'Position trading' },
    HOLDER: { icon: '💎', description: 'Long-term holder' }
  };
  ```

  ---

  ### 2. Cognitive Primitives Row (Wallet)

  Same pattern as token mode, but wallet-specific:

  #### Speed
  ```typescript
  function getWalletSpeed(profile: HolderProfile) {
    const hours = profile.medianHoldTimeHours;
    return {
      value: formatHoldTime(hours),
      category: getSpeedCategory(hours),
      color: getSpeedColor(hours)
    };
  }
  ```

  #### Conviction
  ```typescript
  function getWalletConviction(profile: HolderProfile) {
    const flip = profile.dailyFlipRatio;
    return {
      value: `${flip.toFixed(0)}%`,
      category: flip > 70 ? 'Low' : flip > 40 ? 'Mixed' : 'High',
      color: flip > 70 ? 'red' : flip > 40 ? 'yellow' : 'green'
    };
  }
  ```

  #### Consistency
  ```typescript
  function getWalletConsistency(profile: HolderProfile) {
    const cycles = profile.completedCycleCount;
    const confidence = profile.confidence;

    if (cycles >= 20 && confidence > 0.9) {
      return { label: 'Consistent', description: `${cycles} cycles, high confidence` };
    }
    if (cycles >= 10 && confidence > 0.7) {
      return { label: 'Moderate', description: `${cycles} cycles, good data` };
    }
    return { label: 'Low confidence', description: `Only ${cycles} cycles` };
  }
  ```

  ---

  ### 3. Outcome Sentence

  **Purpose:** Give the verdict — "Follow or ignore?"

  **Logic:**

  ```typescript
  function getWalletOutcome(profile: HolderProfile): string {
    const quality = profile.dataQualityTier;
    const behavior = profile.behaviorType;
    const flip = profile.dailyFlipRatio;
    const median = profile.medianHoldTimeHours;

    // Insufficient data
    if (quality === 'INSUFFICIENT') {
      return `Outcome: Insufficient data. ${profile.insufficientDataReason || 'Not enough trading
           + history'}. Do not rely on this wallet.`;
    }

    // High-frequency bots
    if (behavior === 'SNIPER' && median < 1/60) {
      return 'Outcome: Ultra-fast sniper. Not safe to follow for more than seconds.';
    }

    if (behavior === 'SCALPER' && flip > 80) {
      return 'Outcome: High-frequency scalper. Only follow if you can exit within minutes.';
    }

    // Mid-term traders
    if (behavior === 'SWING' && median > 24 && median < 168) {
      return 'Outcome: Mid-term swing wallet. Sometimes worth following across 1-3 days.';
    }

    // Long-term holders
    if (behavior === 'HOLDER' && median > 168) {
      return 'Outcome: Long-term holder. Safe to follow for weeks if fundamentals align.';
    }

    // Default
    return `Outcome: ${behavior?.replace('_', ' ') || 'Unknown'} pattern. Review metrics before
           + following.`;
  }
  ```

  **Display:**
  - Full-width text at bottom of card
  - Subtle background (light gray)
  - Icon based on verdict (⚠️ / ℹ️ / ✓)

  ---

  ## Visual Design System

  ### Behavior Colors (Reuse existing)

  ```typescript
  const BEHAVIOR_COLORS = {
    SNIPER:       { bg: 'red-500',     text: 'red-700',     border: 'red-500/20' },
    SCALPER:      { bg: 'orange-500',  text: 'orange-700',  border: 'orange-500/20' },
    MOMENTUM:     { bg: 'yellow-500',  text: 'yellow-700',  border: 'yellow-500/20' },
    INTRADAY:     { bg: 'amber-500',   text: 'amber-700',   border: 'amber-500/20' },
    DAY_TRADER:   { bg: 'blue-500',    text: 'blue-700',    border: 'blue-500/20' },
    SWING:        { bg: 'cyan-500',    text: 'cyan-700',    border: 'cyan-500/20' },
    POSITION:     { bg: 'green-500',   text: 'green-700',   border: 'green-500/20' },
    HOLDER:       { bg: 'emerald-600', text: 'emerald-700', border: 'emerald-500/20' }
  };
  ```

  ### Quality Colors (Reuse existing)

  ```typescript
  const QUALITY_COLORS = {
    HIGH:         { bg: 'green-500',  icon: '✓' },
    MEDIUM:       { bg: 'blue-500',   icon: '◐' },
    LOW:          { bg: 'yellow-500', icon: '⚠' },
    INSUFFICIENT: { bg: 'red-500',    icon: '✗' }
  };
  ```

  ### Typography

  ```css
  .metric-card-label {
    font-size: 0.875rem;      /* text-sm */
    color: var(--muted-foreground);
    font-weight: 500;
  }

  .metric-card-value {
    font-size: 1.5rem;        /* text-2xl */
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .metric-card-subtext {
    font-size: 0.75rem;       /* text-xs */
    color: var(--muted-foreground);
  }

  .outcome-strip-verdict {
    font-size: 1.25rem;       /* text-xl */
    font-weight: 700;
  }

  .outcome-strip-description {
    font-size: 0.875rem;      /* text-sm */
  }
  ```

  ### Spacing

  ```css
  .section-gap: gap-6;           /* Between major sections */
  .card-gap: gap-4;              /* Between cards in grid */
  .card-padding: p-6;            /* Inside cards */
  .metric-spacing: gap-3;        /* Inside metric cards */
  ```

  ---

  ## Component Structure

  ### File Organization

  ```
  dashboard/src/components/holder-profiles/
  ├── v2/
  │   ├── TokenPulse.tsx                  # Token mode container
  │   ├── WalletClassifier.tsx            # Wallet mode container
  │   ├── WalletCompareGrid.tsx         # Responsive layout for 2-6 wallets (wrap + scroll)
  │   ├── WalletCompareCard.tsx         # Compact card for compare mode
  │   ├── WalletGroupInsights.tsx       # Aggregated callouts above the grid
  │   ├── OutcomeStrip.tsx                # Verdict banner
  │   ├── CognitivePrimitivesRow.tsx      # Speed/Conviction/Consistency cards
  │   ├── BehaviorCompositionBar.tsx      # Stacked bar chart
  │   ├── MinimalHoldersTable.tsx         # Simplified table
  │   └── utils/
  │       ├── cognitive-primitives.ts     # Speed/Conviction/Consistency logic
  │       ├── outcome-logic.ts            # Verdict decision trees
  │       └── formatting.ts               # Display formatters
  ```

  ### Reusable Components

  ```typescript
  // CognitiveMetricCard.tsx
  interface CognitiveMetricCardProps {
    icon: string;
    label: string;
    value: string;
    subtext: string;
    color?: string;
  }

  // OutcomeStrip.tsx
  interface OutcomeStripProps {
    verdict: string;
    description: string;
    color: 'red' | 'yellow' | 'green' | 'blue';
    icon: string;
  }

  // BehaviorBadge.tsx (enhanced)
  interface BehaviorBadgeProps {
    type: string;
    confidence: number;
    description: string;
  }
  ```

  ---

  ## Implementation Plan (2-3 Days)

  ### Day 1: Token Pulse Foundation

  **Morning:**
  1. Create utility functions:
     - `cognitive-primitives.ts` → Speed/Conviction/Consistency helpers
     - `outcome-logic.ts` → Token outcome decision tree
     - Fix stats calculation (no more "avg median"!)

  **Afternoon:**
  2. Build components:
     - `OutcomeStrip.tsx`
     - `CognitivePrimitivesRow.tsx` (3 cards)
     - Wire up to existing token mode

  **Evening:**
  3. Test with various tokens (fast, slow, mixed)

  ---

  ### Day 2: Behavior Composition + Wallet Classifier

  **Morning:**
  1. Build `BehaviorCompositionBar.tsx`
  2. Simplify table (remove columns, reduce to minimal)
  3. Polish token mode

  **Afternoon:**
  4. Build wallet mode:
     - `WalletClassifier.tsx` (single wallet hero)
     - `WalletCompareGrid.tsx` + `WalletCompareCard.tsx` handling up to 6 wallets with wrap/scroll states
     - `WalletGroupInsights.tsx` (dominant behavior, fastest exit, conviction, data warning)
     - Probabilistic behavior badge + wallet outcome logic shared across layouts

  **Evening:**
  5. Test wallet mode (single + multi)
  6. Responsive design pass (mobile + 3-card wrap)

  ---

  ### Day 3: Polish + Edge Cases

  **Morning:**
  1. Loading states (skeleton cards)
  2. Error states (insufficient data, API errors)
  3. Empty states

  **Afternoon:**
  4. Tooltips (minimal, only where needed)
  5. Animations (subtle, not overdone)
  6. Color adjustments for dark mode

  **Evening:**
  7. Cross-browser testing
  8. Final QA

  ---

  ## Out of Scope (Can Add Later)

  - Bulk wallet comparison beyond 6 addresses / saved cohorts / CSV upload
  - ❌ Radar charts
  - ❌ Historical trend charts
  - ❌ Export to CSV/PDF
  - ❌ Wallet grouping / cohort detection
  - ❌ Heavy glassmorphism / complex animations
  - ❌ AI-generated summaries

  ---

  ## Success Criteria

  ### User Experience
  - ✅ User can answer "Is this token alive/dead?" in <3 seconds (token mode)
  - ✅ User can answer "Should I follow this wallet?" in <3 seconds (wallet mode)
  - ✅ Cognitive primitives are immediately understandable
  - ✅ Tables are supporting, not primary

  ### Technical
  - ✅ No breaking changes to API
  - ✅ Reuses existing data structures
  - ✅ Components are composable and reusable
  - ✅ Fast render (<1s)

  ### Design
  - ✅ Visual hierarchy: Outcome → Primitives → Evidence
  - ✅ No mathematical nonsense ("avg median" fixed)
  - ✅ Color-coded by behavior type
  - ✅ Responsive on all screen sizes

  ---

  ## My Honest Assessment

  ### What's Great About This Plan

  1. **Cognitive primitives are brilliant** — Speed/Conviction/Consistency is way better than raw
           + metrics
  2. **Outcome-first is the right approach** — users want answers, not data
  3. **Implementable in 2-3 days** — no over-engineering, reuses existing components
  4. **Fixes mathematical nonsense** — no more "avg median hold time"
  5. **Clear modes** — Token Pulse vs Wallet Classifier makes sense

  ### What I'd Be Cautious About

  1. **Outcome logic needs tuning** — The decision trees are initial guesses, you'll need to refine
           + thresholds based on real data
  2. **Behavior composition bar** — Make sure it's not just "chart for chart's sake" (but I think
           + it's valuable for quick pattern recognition)
  3. **Consistency primitive** — Current definition (high quality count / total) is okay, but could
           + be improved with actual variance calculation later
  4. **Probabilistic badges** — We're showing confidence as a proxy for probability, which is fine,
           + but label it clearly

  ### If It Were Me

  I'd do this in exactly this order:

  1. **Day 1:** Fix the stats calculations + build cognitive primitives utilities
  2. **Day 2:** Token mode (outcome strip + primitives + composition bar)
  3. **Day 3:** Wallet mode (hero card + outcome)
  4. **Day 4 (bonus):** Polish, edge cases, mobile

  **Key focus:** Get the outcome logic right. Everything else is just presentation. The value is in
           + answering the user's question correctly, not in pretty gradients.

  **What to watch:** Don't let the design distract from the logic. The cognitive primitives are only
           + valuable if they're correctly derived and the thresholds make sense. Test with real wallets you know
           +  (bots, holders, traders) and adjust the decision trees until they're accurate.

  ---

  ## Final Thoughts

  **Design 1** (redesign.md) was too ambitious — 5-6 days, too many variations, over-designed.

  **Design 2** (design2.md) nailed the philosophy — cognitive primitives, outcome-first, 2-day
           + timeline.

  **This spec** takes the best of both:
  - Cognitive primitives from Design 2
  - Visual system from Design 1
  - Practical implementation scope
  - No over-engineering

  **Result:** Powerful, beautiful, implementable in 2-3 days.

  ---

  **Ready to build.** 🚀
