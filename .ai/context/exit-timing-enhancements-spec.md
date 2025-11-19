# Exit Timing Enhancements - Technical Specification (SIMPLIFIED)

**Status**: 🔄 PLANNING
**Priority**: HIGH
**Estimated Duration**: 5-6 days (simplified scope)
**Created**: 2025-11-20
**Updated**: 2025-11-20 (scope reduction)

---

## Overview (SIMPLIFIED)

Enhance the Exit Timing chart in Wallet Baseball Card with:
1. **Win Rate & ROI Metrics per Cohort**: Show aggregate trading performance for each time bucket
2. **Simple Token List Modal**: Click to see which tokens make up each cohort (just badges, no detailed metrics)

### Scope Reduction (What Changed):

**Original Plan**:
- WR/ROI per time bucket ✅ (KEEPING)
- Drilldown with full token details (market cap, individual PnL, buy/sell counts, hold time) ❌ (REMOVED)

**Simplified Plan**:
- WR/ROI per time bucket ✅ (SAME - cohort level metrics)
- Drilldown with just token badges ✅ (SIMPLIFIED - just show which tokens, no detailed metrics)

**Why This is Better**:
- **Faster to build**: 5-6 days vs 8-11 days
- **Simpler UX**: Cohort-level metrics answer "Is this time range profitable?", token list answers "What tokens are in this cohort?"
- **Reuses existing**: TokenBadge component already fetches and displays token metadata
- **Less complexity**: No need to stitch individual PnL, market cap, buy/sell counts per token
- **Still valuable**: Users see performance per time bucket AND can see token composition

---

## Current System Analysis

### Data Flow (As-Is):
```
SwapAnalysisInput (DB)
  ↓
BehaviorAnalyzer.buildTokenLifecycles()
  ↓
TokenPositionLifecycle[] (in-memory)
  ↓
BehaviorAnalyzer.calculateHistoricalPattern()
  ↓
WalletHistoricalPattern.holdTimeDistribution
  { instant: 2, ultraFast: 366, fast: 167, ... }
  ↓
Frontend: ExitTimingBreakdown displays bar chart
```

### Existing Data Structures:
```typescript
// Current (counts only)
holdTimeDistribution: {
  instant: number;      // Count of trades <0.36s
  ultraFast: number;    // Count <1min
  fast: number;         // Count 1-5min
  momentum: number;     // Count 5-30min
  intraday: number;     // Count 30min-4h
  day: number;          // Count 4-24h
  swing: number;        // Count 1-7d
  position: number;     // Count 7+d
}

// Available PnL data
SwapAnalysisInput: {
  mint: string;
  direction: 'BUY' | 'SELL';
  amount: number;
  associatedSolValue: number;  // ← SOL amount for this trade
}

AnalysisResult: {
  tokenAddress: string;
  walletAddress: string;
  netSolProfitLoss: number;    // ← Total PnL for this token
  totalSolSpent: number;
  totalSolReceived: number;
}
```

---

## Feature 1: Win Rate & ROI Per Time Bucket

### Requirements:
- For each time bucket, show:
  - **Win Rate**: `(profitable trades / total trades) * 100`
  - **ROI**: `(total profit / total capital invested) * 100`
  - OR **Avg PnL**: Total PnL / count
- Display format: `<1m 366 (5% WR, -40% ROI)`
- Color code: Green (positive), Red (negative), Gray (neutral)

### Data Architecture:

#### New Interface:
```typescript
export interface EnrichedHoldTimeBucket {
  count: number;              // Total trades in this bucket
  winRate: number;            // 0-100, % of profitable trades
  totalPnlSol: number;        // Sum of all PnL in this bucket
  avgPnlSol: number;          // totalPnlSol / count
  roiPercent: number;         // (totalPnlSol / totalCapitalInvested) * 100
  totalCapitalSol: number;    // Sum of all SOL spent (for ROI calculation)
}

export interface EnrichedHoldTimeDistribution {
  instant: EnrichedHoldTimeBucket;
  ultraFast: EnrichedHoldTimeBucket;
  fast: EnrichedHoldTimeBucket;
  momentum: EnrichedHoldTimeBucket;
  intraday: EnrichedHoldTimeBucket;
  day: EnrichedHoldTimeBucket;
  swing: EnrichedHoldTimeBucket;
  position: EnrichedHoldTimeBucket;
}
```

#### Extend Existing Types:
```typescript
// src/types/behavior.ts
export interface WalletHistoricalPattern {
  // ... existing fields ...
  holdTimeDistribution?: EnrichedHoldTimeDistribution;  // ← Replace number with EnrichedHoldTimeBucket
}

// src/queues/jobs/types/index.ts
export interface HolderProfile {
  // ... existing fields ...
  holdTimeDistribution?: EnrichedHoldTimeDistribution;
}
```

### Calculation Logic:

**Where**: `src/core/analysis/behavior/analyzer.ts` → `calculateHistoricalPattern()`

**Algorithm**:
```typescript
// Pseudocode
for each completedLifecycle in tokenLifecycles:
  // 1. Calculate hold time → determine bucket
  holdTimeHours = lifecycle.weightedHoldingTimeHours;
  bucket = classifyIntoBucket(holdTimeHours);  // instant, ultraFast, etc.

  // 2. Calculate PnL for this lifecycle
  pnl = calculateLifecyclePnL(lifecycle, swapRecords);
  capitalInvested = calculateCapitalInvested(lifecycle, swapRecords);

  // 3. Accumulate into bucket
  buckets[bucket].count++;
  buckets[bucket].totalPnlSol += pnl;
  buckets[bucket].totalCapitalSol += capitalInvested;
  if (pnl > 0) {
    buckets[bucket].winCount++;
  }

// 4. Calculate derived metrics
for each bucket:
  bucket.winRate = (bucket.winCount / bucket.count) * 100;
  bucket.avgPnlSol = bucket.totalPnlSol / bucket.count;
  bucket.roiPercent = (bucket.totalPnlSol / bucket.totalCapitalSol) * 100;
```

**PnL Calculation Per Lifecycle**:
```typescript
function calculateLifecyclePnL(
  lifecycle: TokenPositionLifecycle,
  swapRecords: SwapAnalysisInput[]
): number {
  const tokenRecords = swapRecords.filter(r => r.mint === lifecycle.mint);

  let totalSpent = 0;
  let totalReceived = 0;

  for (const record of tokenRecords) {
    if (record.direction === 'BUY') {
      totalSpent += record.associatedSolValue;
    } else if (record.direction === 'SELL') {
      totalReceived += record.associatedSolValue;
    }
  }

  return totalReceived - totalSpent;
}
```

**Capital Calculation**:
```typescript
function calculateCapitalInvested(
  lifecycle: TokenPositionLifecycle,
  swapRecords: SwapAnalysisInput[]
): number {
  const tokenRecords = swapRecords.filter(r => r.mint === lifecycle.mint);

  return tokenRecords
    .filter(r => r.direction === 'BUY')
    .reduce((sum, r) => sum + r.associatedSolValue, 0);
}
```

### Edge Cases to Handle:
1. **Zero trades in bucket**: Return `{ count: 0, winRate: 0, totalPnlSol: 0, avgPnlSol: 0, roiPercent: 0, totalCapitalSol: 0 }`
2. **All losses**: winRate = 0, negative ROI
3. **Missing PnL data**: Skip that token, log warning
4. **Division by zero**: If totalCapitalSol === 0, set roiPercent = 0

### Integration Points:
1. **Backend**: `analysis-operations.processor.ts` → `processAnalyzeHolderProfiles()` already calls `calculateHistoricalPattern()`, no changes needed
2. **Frontend**: `WalletBaseballCard.tsx` already receives `holdTimeDistribution`, just need to handle enriched format
3. **Cache**: Holder profiles cache will store enriched distribution (slightly larger, but acceptable)

---

## Feature 2: Simple Token List Modal (SIMPLIFIED)

### Requirements:
- Click on any time bucket → modal opens
- Show simple grid of token badges for all tokens in that cohort
- Display: Just TokenBadge components (symbol, name, image)
- Show total count: "23 tokens in this cohort"
- No individual metrics per token (no PnL, market cap, buy/sell counts)
- Simple grid layout, mobile responsive

### Data Architecture (SIMPLIFIED):

#### New Endpoint:
```typescript
POST /api/v1/analyses/wallet-exit-timing-tokens

Request: {
  walletAddress: string;
  timeBucket: 'instant' | 'ultraFast' | 'fast' | 'momentum' | 'intraday' | 'day' | 'swing' | 'position';
}

Response: {
  walletAddress: string;
  timeBucket: string;
  tokens: string[];  // Just array of mint addresses!
  count: number;
}

// That's it! TokenBadge component on frontend handles fetching metadata for each mint
```

#### Backend Implementation:

**New File**: `src/api/controllers/wallet-exit-timing.controller.ts` (or extend `analyses.controller.ts`)

```typescript
@Controller('api/v1/analyses')
export class AnalysesController {

  @Post('wallet-exit-timing-details')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get detailed token list for specific exit timing bucket' })
  async getWalletExitTimingDetails(
    @Body() dto: WalletExitTimingDetailsDto
  ): Promise<WalletExitTimingDetailsResponse> {

    // 1. Fetch wallet swap records
    const swapRecords = await this.databaseService.getSwapAnalysisInputsBatch([dto.walletAddress]);

    // 2. Rebuild lifecycles using BehaviorAnalyzer
    const analyzer = new BehaviorAnalyzer(this.config);
    const sequences = analyzer['buildTokenSequences'](swapRecords);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const lifecycles = analyzer['buildTokenLifecycles'](sequences, currentTimestamp);

    // 3. Filter to completed lifecycles in this time bucket
    const completedInBucket = lifecycles.filter(lc => {
      if (lc.positionStatus !== 'EXITED') return false;
      const bucket = classifyHoldTime(lc.weightedHoldingTimeHours);
      return bucket === dto.timeBucket;
    });

    // 4. Calculate PnL per token
    const tokensWithPnl = await Promise.all(
      completedInBucket.map(async (lc) => {
        const pnl = this.calculateLifecyclePnL(lc, swapRecords);
        const tokenRecords = swapRecords.filter(r => r.mint === lc.mint);

        // 5. Fetch token metadata
        const tokenInfo = await this.tokenInfoService.getTokenInfo(lc.mint);

        return {
          mint: lc.mint,
          symbol: tokenInfo?.symbol || null,
          name: tokenInfo?.name || null,
          imageUrl: tokenInfo?.imageUrl || null,
          marketCapUsd: tokenInfo?.marketCap || null,
          buyCount: lc.buyCount,
          sellCount: lc.sellCount,
          totalPnlSol: pnl,
          holdingTimeHours: lc.weightedHoldingTimeHours,
          entryTimestamp: lc.entryTimestamp,
          exitTimestamp: lc.exitTimestamp!,
        };
      })
    );

    // 6. Pagination
    const page = dto.page || 1;
    const pageSize = dto.pageSize || 50;
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const paginatedTokens = tokensWithPnl.slice(startIdx, endIdx);

    return {
      walletAddress: dto.walletAddress,
      timeBucket: dto.timeBucket,
      tokens: paginatedTokens,
      pagination: {
        total: tokensWithPnl.length,
        page,
        pageSize,
        totalPages: Math.ceil(tokensWithPnl.length / pageSize),
      },
    };
  }
}
```

**Helper Function** (shared with Phase 1):
```typescript
function classifyHoldTime(hours: number): TimeBucket {
  if (hours < 0.0001) return 'instant';
  if (hours < 1/60) return 'ultraFast';
  if (hours < 5/60) return 'fast';
  if (hours < 0.5) return 'momentum';
  if (hours < 4) return 'intraday';
  if (hours < 24) return 'day';
  if (hours < 24 * 7) return 'swing';
  return 'position';
}
```

### Caching Strategy:
- **Cache Key**: `exit-timing-drilldown:{walletAddress}:{timeBucket}`
- **TTL**: 5 minutes (short, since this is on-demand)
- **Invalidation**: On wallet sync (same as holder profiles)
- **Size**: Each response ~10KB for 50 tokens → acceptable

### Performance Considerations:
1. **Token metadata fetching**: Batch requests to TokenInfoService (currently fetches individually - might need optimization)
2. **Lifecycle rebuild**: For large wallets (1000+ tokens), this could take 1-2s → acceptable for on-demand
3. **Database query**: Single batch query for swap records → fast
4. **Parallelization**: Use `Promise.all()` for token metadata enrichment

---

## Frontend Implementation

### Phase 3: Display WR & ROI

**File**: `dashboard/src/components/holder-profiles/v2/WalletBaseballCard.tsx` → `ExitTimingBreakdown` component

**Changes**:
```typescript
function ExitTimingBreakdown({ distribution }: { distribution: EnrichedHoldTimeDistribution }) {
  const buckets = [
    { label: '<1s', data: distribution.instant },
    { label: '<1m', data: distribution.ultraFast },
    { label: '1-5m', data: distribution.fast },
    { label: '5-30m', data: distribution.momentum },
    { label: '30m-4h', data: distribution.intraday },
    { label: '4-24h', data: distribution.day },
    { label: '1-7d', data: distribution.swing },
    { label: '7+d', data: distribution.position },
  ];

  return (
    <div className="space-y-1.5">
      {buckets.map((bucket) => (
        <div key={bucket.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-10 text-muted-foreground">{bucket.label}</span>

          {/* Visual bar */}
          <div className="flex-1 h-3 bg-muted/20 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400/70 via-teal-400/70 to-sky-500/80"
              style={{ width: `${widthPercent}%`, opacity: 0.35 + relativeValue * 0.65 }}
            />
          </div>

          {/* Count */}
          <span className="w-9 text-right font-mono text-muted-foreground">
            {bucket.data.count}
          </span>

          {/* NEW: WR & ROI */}
          <span className={`w-24 text-right text-xs ${
            bucket.data.roiPercent > 0 ? 'text-green-500' :
            bucket.data.roiPercent < 0 ? 'text-red-500' :
            'text-gray-500'
          }`}>
            {bucket.data.winRate.toFixed(0)}% WR, {bucket.data.roiPercent.toFixed(0)}% ROI
          </span>
        </div>
      ))}
    </div>
  );
}
```

### Phase 4: Drilldown Modal

**New File**: `dashboard/src/components/holder-profiles/v2/ExitTimingDrilldownModal.tsx`

```typescript
interface Props {
  walletAddress: string;
  timeBucket: TimeBucket;
  bucketLabel: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ExitTimingDrilldownModal({ walletAddress, timeBucket, bucketLabel, isOpen, onClose }: Props) {
  const [tokens, setTokens] = useState<ExitTimingToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && walletAddress && timeBucket) {
      fetchTokens();
    }
  }, [isOpen, walletAddress, timeBucket]);

  const fetchTokens = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetcher('/analyses/wallet-exit-timing-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, timeBucket }),
      });
      setTokens(response.tokens);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Exit Timing: {bucketLabel}</DialogTitle>
          <DialogDescription>
            Tokens exited by {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)} in {bucketLabel} time range
          </DialogDescription>
        </DialogHeader>

        {loading && <div>Loading tokens...</div>}
        {error && <div className="text-red-500">Error: {error}</div>}

        {!loading && !error && tokens.length === 0 && (
          <div className="text-muted-foreground">No tokens found in this time range</div>
        )}

        {!loading && !error && tokens.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Token</th>
                <th className="text-right p-2">Market Cap</th>
                <th className="text-right p-2">Buy/Sell</th>
                <th className="text-right p-2">PnL (SOL)</th>
                <th className="text-right p-2">Hold Time</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map(token => (
                <tr key={token.mint} className="border-b hover:bg-muted/20">
                  <td className="p-2">
                    <TokenBadge
                      mint={token.mint}
                      symbol={token.symbol}
                      name={token.name}
                      imageUrl={token.imageUrl}
                    />
                  </td>
                  <td className="text-right p-2">
                    {token.marketCapUsd ? `$${(token.marketCapUsd / 1000000).toFixed(2)}M` : 'N/A'}
                  </td>
                  <td className="text-right p-2 font-mono text-xs">
                    {token.buyCount}/{token.sellCount}
                  </td>
                  <td className={`text-right p-2 font-mono ${
                    token.totalPnlSol > 0 ? 'text-green-500' :
                    token.totalPnlSol < 0 ? 'text-red-500' :
                    'text-gray-500'
                  }`}>
                    {token.totalPnlSol > 0 ? '+' : ''}{token.totalPnlSol.toFixed(4)}
                  </td>
                  <td className="text-right p-2 text-xs text-muted-foreground">
                    {formatHoldTime(token.holdingTimeHours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Click Handler in ExitTimingBreakdown**:
```typescript
const [drilldownOpen, setDrilldownOpen] = useState(false);
const [selectedBucket, setSelectedBucket] = useState<TimeBucket | null>(null);

const handleBarClick = (bucket: TimeBucket, label: string) => {
  setSelectedBucket({ bucket, label });
  setDrilldownOpen(true);
};

// In JSX:
<div
  onClick={() => handleBarClick('ultraFast', '<1m')}
  className="cursor-pointer hover:opacity-80 transition-opacity"
>
  {/* existing bar */}
</div>

{drilldownOpen && selectedBucket && (
  <ExitTimingDrilldownModal
    walletAddress={walletAddress}
    timeBucket={selectedBucket.bucket}
    bucketLabel={selectedBucket.label}
    isOpen={drilldownOpen}
    onClose={() => setDrilldownOpen(false)}
  />
)}
```

---

## Testing Strategy

### Backend Tests:
1. **Unit Tests** (`src/core/analysis/behavior/analyzer.spec.ts`):
   - Test `calculateLifecyclePnL()` with various scenarios
   - Test enriched distribution calculation
   - Test edge cases (zero trades, all losses, missing data)

2. **Integration Tests**:
   - Test holder profiles endpoint returns enriched distribution
   - Test drilldown endpoint with real wallet data
   - Test pagination logic

### Frontend Tests:
1. **Component Tests**:
   - Test WR & ROI display formatting
   - Test color coding logic
   - Test modal open/close behavior

2. **E2E Tests**:
   - Click on time bucket → modal opens
   - Modal displays correct tokens
   - Pagination works correctly

---

## Performance Benchmarks

### Phase 1 (Enriched Distribution):
- **Added computation time**: ~100-200ms per wallet (PnL calculation for 50-100 tokens)
- **Response size increase**: ~2KB per wallet (8 buckets × ~250 bytes each)
- **Target**: No noticeable impact on holder profiles load time (<500ms total)

### Phase 2 (Drilldown):
- **Endpoint response time**: <2s for typical wallet (100 tokens, 50 displayed)
- **Token metadata fetching**: Batch optimization needed (max 10 concurrent requests)
- **Target**: Modal opens and displays data within 2 seconds

---

## Rollout Plan

1. **Phase 1**: Backend enriched distribution → deploy, validate via API
2. **Phase 2**: Drilldown endpoint → deploy, test with Postman
3. **Phase 3**: Frontend WR & ROI display → deploy to staging
4. **Phase 4**: Frontend drilldown modal → full rollout

---

## Open Questions

1. **ROI vs Avg PnL**: Which is more useful for users? (Recommendation: Show both)
2. **Market cap data freshness**: Use current or historical? (Recommendation: Current from cache, fallback to historical)
3. **Drilldown sorting default**: Sort by PnL descending? (Recommendation: Yes, with UI controls to change)
4. **Mobile UX**: How to handle modal on small screens? (Recommendation: Full-screen modal on mobile)

---

## Success Criteria

- [ ] Win rate & ROI displayed for all 8 time buckets
- [ ] Drilldown modal loads <2s with 50+ tokens
- [ ] No performance regression on holder profiles page
- [ ] Mobile-friendly drilldown modal
- [ ] Accurate PnL calculations (validated against token performance tab)
