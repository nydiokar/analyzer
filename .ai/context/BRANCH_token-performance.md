# Branch: discover-token-performance

**LLM**: Agent 2
**Focus**: Token Performance Fixes & Enhancements
**Base Branch**: `discover`
**Target**: Merge back to `discover` when complete

---

## Tasks Overview

### 🐛 Task 4: ROI Calculation Fix
**Priority**: CRITICAL
**Estimated Effort**: 2-3 hours

#### Problem Statement:
Token performance shows ROI of -300% when it should be ~0% or "N/A". This happens because:
1. Wallet buys very small amount (0.001 SOL)
2. Transaction fees are larger than buy amount (0.002-0.003 SOL)
3. Current ROI formula: `(received - spent) / spent * 100`
4. Result: `(0 - 0.001) / 0.001 = -100%` but with fees it's worse

**Example Scenario:**
```
Buy: 0.001 SOL
Fees: 0.002 SOL
Total Spent: 0.003 SOL (stored in totalSolSpent)
Sell: 0.0005 SOL
ROI: (0.0005 - 0.003) / 0.003 * 100 = -83%

But user only "invested" 0.001 SOL, so actual loss is -50%, not -83%
?
```

#### Root Cause:
- `totalSolSpent` includes fees/taxes
- ROI denominator uses total spent (including fees)
- For tiny trades, fees dominate the calculation

#### Solution Options:

**Option A: Mark as Dust Trade (Recommended)**
```typescript
// In pnl-analysis-service.ts or token-performance.service.ts
const DUST_THRESHOLD = 0.01; // 0.01 SOL minimum investment

if (totalSolSpent < DUST_THRESHOLD) {
  realizedPnlPercentage = null; // Show as "—" or "N/A"
  unrealizedPnlPercentage = null;
}
```

**Option B: Calculate ROI Excluding Fees**
```typescript
// Separate fees from investment
const totalFees = totalSolSpent - totalSolReceived; // Approximate fees
const actualInvestment = totalSolSpent - totalFees;

if (actualInvestment > 0) {
  realizedPnlPercentage = (netSolProfitLoss / actualInvestment) * 100;
} else {
  realizedPnlPercentage = null;
}
```

**Option C: Show Warning for Skewed Data**
```typescript
// If fees > 50% of spent amount, flag it
if (totalSolSpent > 0 && (totalFees / totalSolSpent) > 0.5) {
  // Add flag: isSkewed: true
  // Frontend shows tooltip: "ROI may be inaccurate due to high fee ratio"
}
```

#### Files to Modify:
- **Backend**: `src/core/services/pnl-analysis-service.ts` - Main ROI calculation
- **Backend**: `src/api/services/token-performance.service.ts` - Token performance API
- **Frontend**: `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx` - Display logic

#### Implementation Steps:
1. Add dust trade detection to backend
2. Update DTO to include `isDustTrade` flag
3. Frontend displays "Dust Trade" or "—" instead of -300%
4. Add tooltip explaining why ROI is N/A

#### Testing:
- Test wallet: Find one with -300% ROI
- Verify new calculation shows "N/A" or reasonable number
- Test normal trades still show correct ROI
- Check edge cases: 0 spent, 0 received, negative values

---

### 🔧 Task 5: Time Filter Detachment
**Priority**: HIGH
**Estimated Effort**: 3-4 hours

#### Problem Statement:
When user selects time filter (e.g., "Last 30 days"), Token Performance tab shows:
- ❌ NO tokens if wallet didn't trade in that period
- ❌ Even though wallet HOLDS tokens currently
- ❌ User thinks wallet has no tokens at all

**Expected Behavior:**
- ✅ Always show current holdings
- ✅ Filter only affects PnL calculations and transaction counts
- ✅ Show context: "Holding 5 tokens (2 traded in last 30d, 3 held only)"

#### Current Implementation:
```typescript
// token-performance.service.ts
// Filters transactions by time range first
// Then calculates tokens based on filtered transactions
// Result: Tokens with no trades in range are excluded
```

#### Solution:

**Backend Changes:**
1. Always fetch current token holdings (regardless of time filter)
2. Fetch transaction history (with time filter)
3. Calculate PnL only for filtered transactions
4. Mark tokens as "traded" or "held only" in period

```typescript
// New approach:
async getTokenPerformance(walletAddress: string, timeFilter?: TimeFilter) {
  // 1. Get current holdings (no time filter)
  const currentHoldings = await this.getCurrentHoldings(walletAddress);

  // 2. Get transaction history (with time filter)
  const transactions = await this.getTransactions(walletAddress, timeFilter);

  // 3. Merge data
  const tokensWithPnl = currentHoldings.map(holding => {
    const txs = transactions.filter(tx => tx.tokenAddress === holding.tokenAddress);
    const hasActivity = txs.length > 0;

    return {
      ...holding,
      hasActivityInPeriod: hasActivity,
      transactionCount: txs.length,
      pnl: hasActivity ? calculatePnl(txs) : null,
      // ... other fields
    };
  });

  return tokensWithPnl;
}
```

**Frontend Changes:**
```tsx
// AccountStatsPnlTab.tsx
<TableRow>
  <TableCell>{token.name}</TableCell>
  <TableCell>
    {token.hasActivityInPeriod ? (
      `${token.transactionCount} trades`
    ) : (
      <Badge variant="outline">Held Only</Badge>
    )}
  </TableCell>
  <TableCell>
    {token.pnl !== null ? formatPnl(token.pnl) : "—"}
  </TableCell>
</TableRow>
```

#### Files to Modify:
- **Backend**: `src/api/services/token-performance.service.ts`
- **Backend**: `src/api/shared/dto/token-performance-data.dto.ts` (add `hasActivityInPeriod` field)
- **Frontend**: `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx`
- **Frontend**: `dashboard/src/types/api.ts` (update TokenPerformanceDataDto)

#### Testing:
1. Test wallet with holdings but no recent trades
2. Verify tokens still show up
3. Verify PnL shows "—" for held-only tokens
4. Verify transaction count is correct
5. Test "All Time" vs "Last 30d" filters

---

### ♾️ Task 6: Infinite Scroll Pagination
**Priority**: MEDIUM
**Estimated Effort**: 2-3 hours

#### Goal:
Replace horizontal pagination (1, 2, 3...) with vertical infinite scroll

#### Current Implementation:
```tsx
// AccountStatsPnlTab.tsx
<Pagination>
  <PaginationPrevious />
  <PaginationItem>1</PaginationItem>
  <PaginationItem>2</PaginationItem>
  <PaginationNext />
</Pagination>
```

#### New Implementation:

**Option A: Using react-intersection-observer**
```bash
npm install react-intersection-observer --prefix dashboard
```

```tsx
import { useInView } from 'react-intersection-observer';

function AccountStatsPnlTab() {
  const [displayedTokens, setDisplayedTokens] = useState<TokenPerformanceDataDto[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const { ref, inView } = useInView();

  useEffect(() => {
    if (inView && hasMore) {
      loadMoreTokens();
    }
  }, [inView, hasMore]);

  const loadMoreTokens = () => {
    const nextBatch = allTokens.slice(displayedTokens.length, displayedTokens.length + 20);
    setDisplayedTokens([...displayedTokens, ...nextBatch]);
    if (displayedTokens.length + nextBatch.length >= allTokens.length) {
      setHasMore(false);
    }
  };

  return (
    <Table>
      <TableBody>
        {displayedTokens.map(token => <TokenRow key={token.tokenAddress} token={token} />)}
      </TableBody>
    </Table>
    {hasMore && (
      <div ref={ref} className="py-4 text-center">
        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
      </div>
    )}
  );
}
```

**Option B: Using react-infinite-scroll-component**
```bash
npm install react-infinite-scroll-component --prefix dashboard
```

```tsx
import InfiniteScroll from 'react-infinite-scroll-component';

<InfiniteScroll
  dataLength={displayedTokens.length}
  next={loadMoreTokens}
  hasMore={hasMore}
  loader={<Loader2 className="h-6 w-6 animate-spin" />}
  endMessage={<p>No more tokens</p>}
>
  <Table>
    <TableBody>
      {displayedTokens.map(token => <TokenRow />)}
    </TableBody>
  </Table>
</InfiniteScroll>
```

#### Implementation Notes:
- Initial load: 20 tokens
- Load more: 20 tokens per scroll
- Keep existing filters/sorting working
- Show loading indicator at bottom while loading
- Show "No more tokens" when all loaded
- Preserve scroll position when filters change

#### Files to Modify:
- `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx`

#### Testing:
- Test with < 20 tokens (no scroll)
- Test with 100+ tokens (multiple scrolls)
- Test scroll performance (should be smooth)
- Test filter changes (resets scroll)
- Test sort changes (resets scroll)

---

## Task Execution Order

**Recommended:**
1. Task 4 (ROI Fix) - Critical data bug
2. Task 5 (Time Filter) - Critical UX bug
3. Task 6 (Infinite Scroll) - Enhancement

**Reasoning:**
- Tasks 4 and 5 fix bugs, Task 6 is enhancement
- Task 4 is quickest to implement
- Task 5 requires backend + frontend changes
- Task 6 can be done independently after 4 and 5

---

## Success Criteria

### Task 4:
- [ ] Wallets with dust trades show "N/A" or reasonable ROI
- [ ] Normal trades still show correct ROI
- [ ] No negative hundreds percent (-300%) in production
- [ ] Tooltip explains why ROI is N/A

### Task 5:
- [ ] All current holdings always visible
- [ ] Time filter only affects PnL calculations
- [ ] "Held Only" badge shows for tokens with no activity
- [ ] Transaction counts respect time filter
- [ ] UI clearly indicates which tokens traded in period

### Task 6:
- [ ] Pagination removed
- [ ] Infinite scroll loads smoothly
- [ ] Loading indicator appears during load
- [ ] No performance issues with 200+ tokens
- [ ] Filters/sorts reset scroll position

---

## Testing Checklist

- [ ] Test wallet with normal trades (ROI should be correct)
- [ ] Test wallet with dust trades (ROI should be N/A or reasonable)
- [ ] Test wallet with holdings but no recent trades (should show tokens)
- [ ] Test wallet with 0 holdings (should show empty state)
- [ ] Test infinite scroll with 100+ tokens
- [ ] Test filter changes
- [ ] No TypeScript errors
- [ ] `npm run lint --prefix dashboard` passes
- [ ] Backend tests pass (if any)

---

## Dependencies & Libraries

**Existing:**
- NestJS, Prisma ORM
- React, Next.js 14
- shadcn/ui components

**New:**
- `react-intersection-observer` OR `react-infinite-scroll-component`

---

## Notes for LLM

- **Task 4 & 5 are critical bugs** - These affect data accuracy and user trust
- **Task 6 is enhancement** - Nice to have but not blocking
- **Follow existing patterns** - Look at how other calculations are done
- **Add proper error handling** - Especially for edge cases (0 values, null values)
- **Update TypeScript types** - Don't use `any`, add proper interfaces
- **Test with real data** - Use actual wallet addresses from production
- **Consider performance** - Don't make queries slower
- **Document changes** - Add comments for complex logic
