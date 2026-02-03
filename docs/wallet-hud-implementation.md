# Wallet HUD Implementation - High Signal Design

## Philosophy

**Like a Poker HUD**: Show only the most critical signals that let you evaluate a wallet at a glance. No clutter, maximum signal density, instant comprehension.

**Integration Pattern**: HUD is a *layer overlay* on `WalletBadge`, not a replacement. When activated/hovered, it "completes" the badge with additional data, not replacing existing info.

---

## Core Metrics (6 metrics + 2 conditional badges)

### Always Visible (6 metrics)

| Metric | Source | Format | Why |
|--------|--------|--------|-----|
| **Trimmed Mean PNL** | `AdvancedTradeStats.trimmedMeanPnlPerToken` | `+1.2K` / `-450` | Consistent performance (outliers removed) |
| **Median P/L per Token** | `AdvancedTradeStats.medianPnlPerToken` | `890` | True center of distribution |
| **Behavior Category** | `WalletBehaviorProfile.tradingStyle` | `M` (Momentum) / `F` (Flipper) / `H` (Holder) | Trading pattern (letter encoded) |
| **Avg Trades/Day** | Calculated: `totalTradeCount / daysActive` | `12.5` | Activity intensity |
| **Win Rate %** | `WalletPnlSummary.tokenWinRate` | `68%` | Success rate |
| **Data Quality Tier** | Calculated from data completeness | `🥇`/`🥈`/`🥉`/`❓` | GOLD/SILVER/BRONZE/INSUFFICIENT |

### Conditional Badges (only when applicable)

| Badge | Condition | Display |
|-------|-----------|---------|
| **Bot** | `uniqueTokensPerDay > 60` | `🤖` |
| **Whale** | `currentHoldingsSol > 200` OR `currentHoldingsUsd > 20000` | `🐋` |

---

## Visual Encoding Strategy

### Behavior Category Letters

```typescript
const BEHAVIOR_CODES = {
  // Primary categories
  'MOMENTUM_TRADER': 'M',
  'TRUE_FLIPPER': 'F',
  'POSITION_HOLDER': 'H',
  'ACCUMULATOR': 'A',

  // Speed variants
  'INSTANT_FLIPPER': 'I',
  'SWING_TRADER': 'S',

  // Fallback
  'UNKNOWN': '?',
};
```

### Color Coding

```typescript
const BEHAVIOR_COLORS = {
  M: 'text-blue-500',    // Momentum - moving fast
  F: 'text-red-500',     // Flipper - hot/quick
  H: 'text-green-500',   // Holder - stable/long
  A: 'text-purple-500',  // Accumulator - strategic
  I: 'text-orange-500',  // Instant - very hot
  S: 'text-cyan-500',    // Swing - medium temp
  '?': 'text-gray-500',  // Unknown
};

const DATA_QUALITY_DISPLAY = {
  GOLD: { emoji: '🥇', color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  SILVER: { emoji: '🥈', color: 'text-gray-400', bg: 'bg-gray-400/10' },
  BRONZE: { emoji: '🥉', color: 'text-orange-600', bg: 'bg-orange-600/10' },
  INSUFFICIENT: { emoji: '❓', color: 'text-gray-500', bg: 'bg-gray-500/10' },
};
```

### Compact Display Format (for inline/hover)

```
┌────────────────────────────────────────────────────┐
│ [WalletBadge existing content]                     │
│ abc123...xyz789  [copy] [solscan] [profile]       │
├────────────────────────────────────────────────────┤
│ HUD OVERLAY (on hover/expand):                     │
│ 🥇 M  +1.2K / 890  68% WR  12.5 T/D  🤖           │
└────────────────────────────────────────────────────┘

Breakdown:
🥇       = Data quality (GOLD)
M        = Behavior (Momentum trader)
+1.2K    = Trimmed mean PNL (formatted with K/M suffixes)
890      = Median P/L per token (raw SOL amount)
68% WR   = Win rate
12.5 T/D = Avg trades per day
🤖       = Bot badge (conditional, only if detected)
```

---

## API Design

### New Endpoint: `GET /wallets/:address/hud`

**Response Structure:**

```typescript
interface WalletHudDto {
  walletAddress: string;
  signalType: string;

  // Core metrics
  trimmedMeanPnl: number;           // SOL amount
  medianPnlPerToken: number;        // SOL amount
  behaviorCategory: string;         // e.g., "MOMENTUM_TRADER"
  behaviorCode: string;             // Single letter: "M"
  avgTradesPerDay: number;          // Calculated
  winRate: number;                  // 0-1 decimal (0.68 = 68%)
  dataQualityTier: DataQualityTier; // GOLD/SILVER/BRONZE/INSUFFICIENT

  // Conditional badges
  isBot: boolean;                   // uniqueTokensPerDay > 60
  isWhale: boolean;                 // holdings > threshold

  // Supporting data
  uniqueTokensPerDay: number;       // For bot detection
  currentHoldingsSol: number;       // For whale detection
  currentHoldingsUsd: number;       // For whale detection

  // Metadata
  calculatedAt: Date;
  provenance?: {
    provider: string;
    nodeId?: string;
    schemaVersion: string;
    generatedAt: string;
    dataRange?: {
      from: string;
      to: string;
    };
    source?: 'onchain' | 'indexed_db' | 'hybrid';
  };
}
```

**Example Response:**

```json
{
  "walletAddress": "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  "signalType": "wallet_behavior_v1",
  "trimmedMeanPnl": 1234.56,
  "medianPnlPerToken": 890.12,
  "behaviorCategory": "MOMENTUM_TRADER",
  "behaviorCode": "M",
  "avgTradesPerDay": 12.5,
  "winRate": 0.68,
  "dataQualityTier": "GOLD",
  "isBot": true,
  "isWhale": false,
  "uniqueTokensPerDay": 65.2,
  "currentHoldingsSol": 45.67,
  "currentHoldingsUsd": 8200.50,
  "calculatedAt": "2026-02-02T10:30:00.000Z",
  "provenance": {
    "provider": "alpha-node",
    "schemaVersion": "1.0.0",
    "generatedAt": "2026-02-02T10:30:00.000Z",
    "dataRange": {
      "from": "2025-10-01T00:00:00.000Z",
      "to": "2026-02-02T10:30:00.000Z"
    },
    "source": "indexed_db"
  }
}
```

### Batch Endpoint: `POST /wallets/hud/batch`

**Critical for multi-wallet views (trackers, discovery, holder analysis)**

**Request:**

```json
{
  "walletAddresses": [
    "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    "8xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"
  ]
}
```

**Response:**

```json
{
  "huds": {
    "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin": {
      "trimmedMeanPnl": 1234.56,
      "medianPnlPerToken": 890.12,
      // ... rest of HUD data
    },
    "8xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin": {
      // ... HUD data
    }
  },
  "notFound": [],
  "calculatedAt": "2026-02-02T10:30:00.000Z"
}
```

**Note**: Response is a **map/record** indexed by wallet address for O(1) lookup.

---

## Backend Implementation

### Service: `WalletHudService`

**Location**: `src/services/wallet-hud.service.ts`

**Key Methods:**

```typescript
class WalletHudService {
  // Single wallet HUD
  async getHud(walletAddress: string): Promise<WalletHudDto>

  // Batch HUD (optimized with single query)
  async getHudBatch(walletAddresses: string[]): Promise<Record<string, WalletHudDto>>

  // Internal calculation
  private calculateHud(data: WalletData): WalletHudDto

  // Data quality tier calculation
  private calculateDataQualityTier(wallet: WalletData): DataQualityTier
}
```

**Optimized Query Strategy:**

```typescript
// Single efficient query joining all required tables
const walletData = await prisma.wallet.findUnique({
  where: { address: walletAddress },
  include: {
    pnlSummary: {
      include: {
        advancedStats: true
      }
    },
    behaviorProfile: true
  }
});

// Calculate derived metrics
const daysActive = calculateDaysActive(
  walletData.behaviorProfile.firstTransactionTimestamp,
  walletData.behaviorProfile.lastTransactionTimestamp
);

const avgTradesPerDay = walletData.behaviorProfile.totalTradeCount / daysActive;
const uniqueTokensPerDay = walletData.behaviorProfile.uniqueTokensTraded / daysActive;

// Conditional badges
const isBot = uniqueTokensPerDay > 60;
const isWhale =
  walletData.pnlSummary.currentSolBalance > 200 ||
  (walletData.pnlSummary.currentSolBalance * solPrice) > 20000;
```

**Data Quality Tier Logic:**

```typescript
function calculateDataQualityTier(wallet: WalletData): DataQualityTier {
  const hasAdvancedStats = Boolean(wallet.pnlSummary?.advancedStats);
  const hasBehaviorProfile = Boolean(wallet.behaviorProfile);
  const totalTrades = wallet.behaviorProfile?.totalTradeCount ?? 0;
  const daysActive = calculateDaysActive(
    wallet.behaviorProfile?.firstTransactionTimestamp,
    wallet.behaviorProfile?.lastTransactionTimestamp
  );

  // GOLD: Complete data, significant activity
  if (hasAdvancedStats && hasBehaviorProfile && totalTrades >= 50 && daysActive >= 7) {
    return 'GOLD';
  }

  // SILVER: Good data, moderate activity
  if (hasAdvancedStats && hasBehaviorProfile && totalTrades >= 20 && daysActive >= 3) {
    return 'SILVER';
  }

  // BRONZE: Basic data, some activity
  if ((hasAdvancedStats || hasBehaviorProfile) && totalTrades >= 5) {
    return 'BRONZE';
  }

  // INSUFFICIENT: Too little data
  return 'INSUFFICIENT';
}
```

**Caching Strategy:**

```typescript
// 60-second TTL cache
@CacheDecorator('wallet-hud', 60)
async getHud(walletAddress: string): Promise<WalletHudDto> {
  // Implementation
}

// Invalidate cache on wallet analysis completion
@OnEvent('wallet.analysis.completed')
async handleWalletAnalysisCompleted(event: WalletAnalysisCompletedEvent) {
  await this.cacheManager.del(`wallet-hud:${event.walletAddress}`);
}
```

---

## Frontend Implementation

### Component Hierarchy

```
<WalletBadge>                      (existing component)
  ├─ [existing badge content]
  └─ <WalletHudOverlay>            (NEW - conditional render)
       └─ Compact metrics display
```

### New Component: `WalletHudOverlay`

**Location**: `dashboard/src/components/shared/WalletHudOverlay.tsx`

**Props:**

```typescript
interface WalletHudOverlayProps {
  walletAddress: string;
  display?: 'inline' | 'tooltip' | 'expanded';
  className?: string;
}
```

**Usage in WalletBadge:**

```tsx
// In WalletBadge.tsx - add to "inline" variant
{showHud && (
  <WalletHudOverlay
    walletAddress={address}
    display="inline"
  />
)}

// Controlled by new prop
interface WalletBadgeProps {
  // ... existing props
  showHud?: boolean;  // NEW - default false for backward compatibility
}
```

**Display Variants:**

```tsx
// INLINE (below existing metrics)
<div className="flex items-center gap-2 text-xs mt-1">
  <span className={qualityColor}>{qualityEmoji}</span>
  <span className={behaviorColor}>{behaviorCode}</span>
  <span className={pnlColor}>{formatPnl(trimmedMeanPnl)}</span>
  <span className="text-muted-foreground">/</span>
  <span>{formatNumber(medianPnlPerToken)}</span>
  <span>{formatPercent(winRate)} WR</span>
  <span className="text-muted-foreground">{avgTradesPerDay.toFixed(1)} T/D</span>
  {isBot && <span>🤖</span>}
  {isWhale && <span>🐋</span>}
</div>

// TOOLTIP (on hover - using Tooltip component)
<Tooltip>
  <TooltipTrigger>
    {/* Existing badge */}
  </TooltipTrigger>
  <TooltipContent>
    <div className="text-xs space-y-1">
      <div className="flex items-center gap-2">
        <span className={qualityColor}>{qualityEmoji} {dataQualityTier}</span>
        <span className={behaviorColor}>{behaviorCategory}</span>
      </div>
      <div>Trimmed PNL: {formatPnl(trimmedMeanPnl)} SOL</div>
      <div>Median P/L: {formatNumber(medianPnlPerToken)} SOL</div>
      <div>Win Rate: {formatPercent(winRate)}</div>
      <div>Trades/Day: {avgTradesPerDay.toFixed(1)}</div>
      {isBot && <div className="text-orange-500">⚠️ Bot detected</div>}
      {isWhale && <div className="text-blue-500">🐋 Whale wallet</div>}
    </div>
  </TooltipContent>
</Tooltip>

// EXPANDED (profile page hero)
<div className="grid grid-cols-3 gap-4 p-4 border rounded-lg">
  <div className="text-center">
    <div className={qualityColor}>{qualityEmoji}</div>
    <div className="text-xs text-muted-foreground">{dataQualityTier}</div>
  </div>
  <div className="text-center">
    <div className={behaviorColor} className="text-lg font-bold">{behaviorCode}</div>
    <div className="text-xs text-muted-foreground">{behaviorCategory}</div>
  </div>
  <div className="text-center">
    <div className="text-lg font-bold">{formatPnl(trimmedMeanPnl)}</div>
    <div className="text-xs text-muted-foreground">Trimmed Mean PNL</div>
  </div>
  {/* ... more metrics in grid */}
</div>
```

### SWR Hook: `useWalletHud`

**Location**: `dashboard/src/hooks/useWalletHud.ts`

```typescript
import useSWR from 'swr';
import { WalletHudDto } from '@/types/api';

export function useWalletHud(walletAddress: string | null) {
  return useSWR<WalletHudDto>(
    walletAddress ? `/api/wallets/${walletAddress}/hud` : null,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,  // 60s deduplication
      refreshInterval: 60000,   // Auto-refresh every 60s
    }
  );
}

// Batch hook for multiple wallets
export function useWalletHudBatch(walletAddresses: string[]) {
  return useSWR<Record<string, WalletHudDto>>(
    walletAddresses.length > 0
      ? `/api/wallets/hud/batch:${walletAddresses.join(',')}`
      : null,
    async () => {
      const response = await fetch('/api/wallets/hud/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddresses }),
      });
      const data = await response.json();
      return data.huds;
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );
}
```

---

## Integration Points

### 1. Trackers Page (`/trackers`)

**Implementation:**

```tsx
// In TrackerPage table
const walletAddresses = favorites.map(f => f.walletAddress);
const { data: hudBatch } = useWalletHudBatch(walletAddresses);

// In table row
<WalletBadge
  address={wallet.walletAddress}
  showHud={true}  // Enable HUD overlay
  metrics={...}
/>

// OR with tooltip on hover
<Tooltip>
  <TooltipTrigger>
    <WalletBadge address={wallet.walletAddress} />
  </TooltipTrigger>
  <TooltipContent>
    <WalletHudOverlay address={wallet.walletAddress} display="tooltip" />
  </TooltipContent>
</Tooltip>
```

### 2. Wallet Profile Page (`/wallets/[address]`)

**Hero Section:**

```tsx
<div className="mb-6">
  <WalletBadge
    address={walletAddress}
    size="xl"
    variant="card"
  />

  <WalletHudOverlay
    address={walletAddress}
    display="expanded"
    className="mt-4"
  />
</div>
```

### 3. Search Results

**Inline compact display:**

```tsx
{searchResults.map(wallet => (
  <div key={wallet.address}>
    <WalletBadge
      address={wallet.address}
      size="m"
      showHud={true}
    />
  </div>
))}
```

### 4. Holder Analysis Tools

**Badge in lists:**

```tsx
<WalletBadge
  address={holder.address}
  size="s"
  variant="minimal"
  showHud={true}
/>
```

### 5. Discovery Page

**Card preview:**

```tsx
<div className="wallet-card">
  <WalletBadge address={wallet.address} showHud={true} />
</div>
```

---

## Number Formatting Utilities

```typescript
// Format SOL amounts with K/M suffixes
export function formatPnl(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toFixed(0);
}

// Format numbers with commas
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0
  }).format(value);
}

// Format percentages
export function formatPercent(decimal: number): string {
  return `${Math.round(decimal * 100)}%`;
}
```

---

## Implementation Checklist

### Phase 1: Backend (Priority 1)

- [ ] Create `wallet-hud.dto.ts` with `WalletHudDto` interface
- [ ] Implement `WalletHudService`:
  - [ ] `getHud(address)` method with optimized query
  - [ ] `getHudBatch(addresses[])` method
  - [ ] `calculateDataQualityTier()` logic
  - [ ] Bot detection (uniqueTokensPerDay > 60)
  - [ ] Whale detection (holdings > thresholds)
- [ ] Add controller endpoints:
  - [ ] `GET /wallets/:address/hud`
  - [ ] `POST /wallets/hud/batch`
- [ ] Add caching layer (60s TTL)
- [ ] Add cache invalidation on analysis completion
- [ ] Write unit tests for:
  - [ ] Data quality tier calculation
  - [ ] Bot detection logic
  - [ ] Whale detection logic
- [ ] Write integration tests for endpoints

### Phase 2: Frontend (Priority 1)

- [ ] Create `WalletHudOverlay.tsx` component
- [ ] Implement 3 display variants (inline, tooltip, expanded)
- [ ] Create `useWalletHud()` hook
- [ ] Create `useWalletHudBatch()` hook
- [ ] Add number formatting utilities
- [ ] Add behavior code mapping
- [ ] Add color coding system
- [ ] Add `showHud` prop to `WalletBadge`
- [ ] Write component tests (Storybook)

### Phase 3: Integration (Priority 2)

- [ ] Integrate in Trackers page
  - [ ] Batch fetch for all visible wallets
  - [ ] Tooltip on hover OR inline display
- [ ] Integrate in Wallet profile hero section (expanded view)
- [ ] Integrate in Search results (inline compact)
- [ ] Integrate in Holder analysis tools (badge)
- [ ] Integrate in Discovery page (card preview)

### Phase 4: Optimization & Polish (Priority 3)

- [ ] Performance testing with 100+ wallets
- [ ] Cache tuning based on real usage
- [ ] Add loading skeletons
- [ ] Add error states
- [ ] Add API documentation
- [ ] Add user documentation

---

## Performance Targets

| Metric | Target | Current (estimated) |
|--------|--------|---------------------|
| Single HUD API call | <100ms | N/A |
| Batch HUD (10 wallets) | <150ms | N/A |
| Batch HUD (100 wallets) | <500ms | N/A |
| Cache hit rate | >90% | N/A |
| Frontend render time | <50ms | N/A |

---

## Open Questions & Decisions Needed

1. **Behavior code mapping**: Approve the letter mapping (M/F/H/A/I/S/?)
2. **Data quality thresholds**: Are the trade count thresholds correct? (50/20/5)
3. **Bot threshold**: Is 60 tokens/day the right threshold?
4. **Whale threshold**: Confirm 200 SOL or $20k USD
5. **Default visibility**: Should HUD be visible by default or opt-in per context?
6. **Tooltip vs. inline**: Which contexts use tooltip vs. always visible?
7. **Cache invalidation**: Should we invalidate on ANY wallet update or only full analysis?

---

## Example Visual Mockups

### Inline (below WalletBadge metrics)

```
┌────────────────────────────────────────────────────┐
│ [👤] abc123...xyz789  [📋] [🔗] [👤]              │
│ 150↑ / 120↓ • 68% WR • 2h                         │
│ 🥇 M  +1.2K / 890  68% WR  12.5 T/D  🤖           │
└────────────────────────────────────────────────────┘
```

### Tooltip (on hover)

```
                    ┌──────────────────────────┐
                    │ 🥇 GOLD • M MOMENTUM     │
                    │ Trimmed PNL: +1.2K SOL   │
                    │ Median P/L: 890 SOL      │
                    │ Win Rate: 68%            │
                    │ Trades/Day: 12.5         │
                    │ ⚠️ Bot detected          │
                    └──────────────────────────┘
[👤] abc123...xyz  [hover area]
150↑ / 120↓ • 68%
```

### Expanded (profile hero)

```
┌──────────────────────────────────────────────────┐
│                 WALLET HUD                       │
├──────────┬──────────┬──────────┬─────────────────┤
│    🥇    │    M     │  +1.2K   │      890        │
│   GOLD   │ MOMENTUM │ Trimmed  │  Median P/L     │
├──────────┼──────────┼──────────┼─────────────────┤
│   68%    │   12.5   │   3.2    │   🤖 BOT       │
│ Win Rate │ Trades/D │ Tokens/D │   DETECTED      │
└──────────┴──────────┴──────────┴─────────────────┘
```

---

**END OF DOCUMENT**
