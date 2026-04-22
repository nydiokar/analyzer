# Token Detail Sidebar — Implementation Plan
**Date:** 2026-04-22  
**Status:** Ready to implement  
**Scope:** Full-stack feature — 1 new backend endpoint, 1 new frontend component, 2 modified files

---

## 1. What This Builds

When a user clicks any row in the Token Performance table (`TokenPerformanceTab`), a right-side drawer opens showing:
- Token header (image, name, symbol, risk badge)
- Aggregated stats: total P&L, realized, unrealized, balance, holding duration, cost basis, avg entry/exit MCAP
- Full chronological buy/sell/transfer history for that wallet × token pair

The reference UI is a Cielo-style trade drawer (see screenshot in task context).

---

## 2. Ground Truth — Verified Schema Fields

### `SwapAnalysisInput` — per-transaction records
```
walletAddress   String
signature       String         — Solana tx signature (use for Solscan link)
timestamp       Int            — Unix seconds
mint            String         — token mint address
amount          Float          — token units traded
direction       String         — "buy" | "sell" | "transfer"
associatedSolValue Float       — SOL in or out
associatedUsdcValue Float?
interactionType String
feeAmount       Float?
feePercentage   Float?
solPriceUsd     Float?         — SOL/USD at trade time (NULLABLE — enrichment may not have run)
usdValue        Float?         — total USD value (NULLABLE)
tokenPriceUsd   Float?         — per-token USD price (NULLABLE)
marketCapUsd    Float?         — fully diluted mcap at trade time (NULLABLE)
mcapBucket      String?        — "nano"|"ultra-micro"|"micro"|"small"|"mid"|"large"|"mega" (NULLABLE)
enrichedAt      DateTime?      — null means row has NOT been enriched yet
```

**CRITICAL:** `marketCapUsd`, `tokenPriceUsd`, `solPriceUsd` are ALL nullable. Enrichment is async and may never complete for older transactions. The UI must handle this without crashing or showing broken values.

**CRITICAL:** `SwapAnalysisInput` has NO `tokenAddress` field — the token is identified by `mint`. When querying by token, filter on `mint`, not `tokenAddress`.

**Unique constraint:** `(signature, mint, direction, amount)` — a single signature can produce multiple rows (e.g., a swap that touches multiple mints).

### `AnalysisResult` — pre-aggregated per wallet × token
These fields are all present and reliably populated (not nullable except where noted):
```
walletAddress               String
tokenAddress                String         — token mint
totalAmountIn               Float
totalAmountOut              Float
netAmountChange             Float
totalSolSpent               Float
totalSolReceived            Float
totalFeesPaidInSol          Float?
transferCountIn             Int            — number of buys/receives
transferCountOut            Int            — number of sells/sends
firstTransferTimestamp      Int?           — Unix seconds, nullable
lastTransferTimestamp       Int?           — Unix seconds, nullable
currentUiBalance            Float?         — current token balance (nullable)
currentHoldingsCostBasisSol Float?         — FIFO cost basis of remaining holdings
currentHoldingsValueSol     Float?         — computed from live price
currentHoldingsValueUsd     Float?
realizedPnlSol              Float?
unrealizedPnlSol            Float?
totalPnlSol                 Float?
avgEntryMcap                Float?         — volume-weighted avg mcap at entry
avgEntryMcapBucket          String?
typicalEntryMcapUsd         Float?
entryMcapP25Usd             Float?
entryMcapP75Usd             Float?
avgExitMcap                 Float?         — volume-weighted avg mcap at exit
avgExitMcapBucket           String?
typicalExitMcapUsd          Float?
exitMcapP25Usd              Float?
exitMcapP75Usd              Float?
hasIncompleteHistory        Boolean?
```

**IMPORTANT:** `avgEntryMcap` and `avgExitMcap` are NOT currently exposed in `TokenPerformanceDataDto` (backend DTO) or `TokenPerformanceDataDto` (frontend types). They exist in the DB but are NOT returned by the existing token-performance endpoint. The new endpoint must return them, OR the sidebar fetches them separately. See Section 4.

---

## 3. What Data the Sidebar Will Show and Where It Comes From

| UI Element | Data Field | Source |
|---|---|---|
| Token image | `onchainImageUrl` → `imageUrl` fallback | Already in `TokenPerformanceDataDto` |
| Token name | `onchainName` → `name` fallback | Already in `TokenPerformanceDataDto` |
| Token symbol | `onchainSymbol` → `symbol` fallback | Already in `TokenPerformanceDataDto` |
| Risk badge | `spamRiskLevel` | Already in `TokenPerformanceDataDto` |
| Total Profit (SOL) | `totalPnlSol` | Already in `TokenPerformanceDataDto` |
| Realized PnL | `realizedPnlSol` | Already in `TokenPerformanceDataDto` |
| Unrealized PnL | `unrealizedPnlSol` | Already in `TokenPerformanceDataDto` |
| ROI % | compute: `totalPnlSol / totalSolSpent * 100` | From `TokenPerformanceDataDto` fields |
| Balance | `currentUiBalance` | Already in `TokenPerformanceDataDto` |
| Current Value (SOL) | `currentHoldingsValueSol` | Already in `TokenPerformanceDataDto` |
| Cost Basis | `currentHoldingsCostBasisSol` | Already in `TokenPerformanceDataDto` |
| Holding Duration | compute: `lastTransferTimestamp - firstTransferTimestamp` | Both in `TokenPerformanceDataDto` |
| Buy count | `transferCountIn` | Already in `TokenPerformanceDataDto` |
| Sell count | `transferCountOut` | Already in `TokenPerformanceDataDto` |
| Total SOL spent | `totalSolSpent` | Already in `TokenPerformanceDataDto` |
| Total SOL received | `totalSolReceived` | Already in `TokenPerformanceDataDto` |
| Avg Entry MCAP | `avgEntryMcap` | **NOT in current DTO** — new endpoint returns it |
| Avg Exit MCAP | `avgExitMcap` | **NOT in current DTO** — new endpoint returns it |
| Entry MCAP P25/P75 | `entryMcapP25Usd`, `entryMcapP75Usd` | **NOT in current DTO** — new endpoint |
| Per-tx: direction | `direction` | New endpoint from `SwapAnalysisInput` |
| Per-tx: token amount | `amount` | New endpoint from `SwapAnalysisInput` |
| Per-tx: SOL value | `associatedSolValue` | New endpoint from `SwapAnalysisInput` |
| Per-tx: MCAP | `marketCapUsd` | New endpoint (nullable — show "—" if null) |
| Per-tx: token price | `tokenPriceUsd` | New endpoint (nullable) |
| Per-tx: timestamp | `timestamp` | New endpoint |
| Per-tx: Solscan link | `signature` | New endpoint |

---

## 4. API Design

### New Endpoint: GET `/api/v1/wallets/:walletAddress/token-trades/:tokenAddress`

**Location to add:** `src/api/controllers/wallets.controller.ts`

**Response type** (new DTO — create `src/api/shared/dto/token-trade-history.dto.ts`):

```typescript
export class TokenTradeItemDto {
  signature: string;
  timestamp: number;          // Unix seconds
  direction: string;          // "buy" | "sell" | "transfer"
  amount: number;             // token units
  associatedSolValue: number; // SOL in/out
  tokenPriceUsd: number | null;
  marketCapUsd: number | null;
  mcapBucket: string | null;
  feeAmount: number | null;
  enrichedAt: string | null;  // ISO string, null = not enriched
}

export class TokenTradeHistoryDto {
  walletAddress: string;
  tokenAddress: string;
  trades: TokenTradeItemDto[];
  // Aggregates NOT in current TokenPerformanceDataDto:
  avgEntryMcap: number | null;
  avgExitMcap: number | null;
  typicalEntryMcapUsd: number | null;
  entryMcapP25Usd: number | null;
  entryMcapP75Usd: number | null;
  typicalExitMcapUsd: number | null;
  exitMcapP25Usd: number | null;
  exitMcapP75Usd: number | null;
}
```

**Why bundle mcap aggregates here:** The `AnalysisResult` query for a single token is cheap (indexed on `walletAddress + tokenAddress`). Bundling avoids a second round-trip from the frontend and keeps the sidebar to one fetch after the initial data pass-through.

**Controller handler pattern** (follow the exact pattern from other handlers in `wallets.controller.ts`):

```typescript
@Get(':walletAddress/token-trades/:tokenAddress')
@ApiOperation({ summary: 'Get full trade history for a wallet × token pair' })
async getTokenTradeHistory(
  @Param('walletAddress') walletAddress: string,
  @Param('tokenAddress') tokenAddress: string,
  @Req() req: Request & { user?: any }
): Promise<TokenTradeHistoryDto> {
  // 1. Query SwapAnalysisInput WHERE walletAddress = ? AND mint = ? ORDER BY timestamp ASC
  // 2. Query AnalysisResult WHERE walletAddress = ? AND tokenAddress = ? (for mcap aggregates)
  // 3. Map to TokenTradeHistoryDto
}
```

**DatabaseService:** Add this method (do NOT modify `getSwapAnalysisInputs` — add new):
```typescript
async getSwapAnalysisInputsForToken(
  walletAddress: string,
  mint: string
): Promise<SwapAnalysisInput[]> {
  return this.prismaClient.swapAnalysisInput.findMany({
    where: { walletAddress, mint },
    orderBy: { timestamp: 'asc' },
  });
}
```

**Note on `DatabaseService` injection in controller:** `DatabaseService` is already injected into `WalletsController` (see constructor — line 24 import, line 54 DI). No module changes needed for DB access. The `WalletsModule` already imports `DatabaseModule`.

---

## 5. Frontend Design

### 5a. No Sheet component — use Dialog with custom positioning

`Sheet` does NOT exist in `dashboard/src/components/ui/`. Available drawer-like components:
- `dialog.tsx` — Radix Dialog. **Use this, but NOT the `DialogContent` wrapper directly.**
- There is NO `sheet.tsx` or `drawer.tsx`.

**Do NOT use `<DialogContent>` from `dialog.tsx`** — it has `left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%]` baked into its `cn()` base classes. Tailwind overrides alone cannot reliably beat those specificity-equal classes in the same `cn()` call. It also auto-injects a close `<X>` button via `DialogPrimitive.Close` which will duplicate our custom header close button.

**Instead, compose from primitives directly:**

```typescript
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
} from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';

// Inside JSX:
<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex flex-col w-[520px] max-w-full",
        "bg-background border-l border-border shadow-xl",
        "data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
        "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
        "duration-200 focus:outline-none"
      )}
    >
      {/* your content — no auto-injected close button */}
    </DialogPrimitive.Content>
  </DialogPortal>
</Dialog>
```

`DialogPortal` and `DialogOverlay` from `dialog.tsx` are safe to reuse — they render correctly. Only `DialogContent` is the problem.

### 5b. New component: `TokenDetailSidebar.tsx`

**File:** `dashboard/src/components/dashboard/TokenDetailSidebar.tsx`

**Props:**
```typescript
interface TokenDetailSidebarProps {
  open: boolean;
  onClose: () => void;
  tokenData: TokenPerformanceDataDto | null;  // row data already fetched — no second call needed for summary
  walletAddress: string;
}
```

**Data fetching inside component:**
- Summary stats: use `tokenData` prop directly (already fetched by the table). No re-fetch.
- Trade history + mcap aggregates: SWR call to `/api/v1/wallets/{walletAddress}/token-trades/{tokenAddress}` — only when `open === true` AND `tokenData !== null`.

**SWR key pattern** (consistent with existing hooks):
```typescript
const swrKey = open && tokenData
  ? `/api/v1/wallets/${walletAddress}/token-trades/${tokenData.tokenAddress}`
  : null;
const { data, isLoading } = useSWR<TokenTradeHistoryDto>(swrKey, fetcher);
```

**Layout structure:**
```
<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
  <DialogContent className="fixed inset-y-0 right-0 left-auto translate-x-0 translate-y-0 
                             max-h-screen w-[520px] flex flex-col rounded-none border-l 
                             border-border bg-background p-0">
    
    {/* Header — token identity */}
    <div className="flex items-center gap-3 p-4 border-b">
      <TokenBadge mint={tokenData.tokenAddress} metadata={...} variant="inline" size="m" />
      <RiskBadge level={tokenData.spamRiskLevel} />
      <Button variant="ghost" size="icon" onClick={onClose}><X /></Button>
    </div>

    {/* Scrollable body */}
    <ScrollArea className="flex-1">
      
      {/* Summary cards — 2×2 grid */}
      <div className="grid grid-cols-2 gap-3 p-4">
        <StatCard label="Total P&L" value={totalPnlSol} suffix="SOL" subValue={roi + "%"} />
        <StatCard label="Realized" value={realizedPnlSol} suffix="SOL" />
        <StatCard label="Unrealized" value={unrealizedPnlSol} suffix="SOL" />
        <StatCard label="Current Value" value={currentHoldingsValueSol} suffix="SOL" />
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-2 px-4 pb-4">
        <MetricItem label="Balance" value={currentUiBalance} />
        <MetricItem label="Cost Basis" value={currentHoldingsCostBasisSol} suffix="SOL" />
        <MetricItem label="Holding" value={holdingDurationFormatted} />
        <MetricItem label="Buys" value={transferCountIn} />
        <MetricItem label="Sells" value={transferCountOut} />
        <MetricItem label="SOL In/Out" value={`${totalSolSpent} / ${totalSolReceived}`} />
        <MetricItem label="Avg Entry MC" value={avgEntryMcap} format="mcap" />
        <MetricItem label="Avg Exit MC" value={avgExitMcap} format="mcap" />
        <MetricItem label="MC Range" value={`${entryMcapP25Usd} – ${entryMcapP75Usd}`} format="mcap" />
      </div>

      {/* Trade history table */}
      <div className="px-4 pb-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Trade History</h3>
        {isLoading ? <Skeleton rows={5} /> : <TradeHistoryTable trades={data?.trades} />}
      </div>

    </ScrollArea>
  </DialogContent>
</Dialog>
```

**TradeHistoryTable columns:**
| Column | Field | Notes |
|---|---|---|
| Type | `direction` | Badge: green "Buy", red "Sell", gray "Transfer" |
| MCAP | `marketCapUsd` | Show "—" if null. Format: "$37.2K" |
| Amount | `amount` | Compact: "25.6M", "335.2K" |
| SOL | `associatedSolValue` | prefix "◎" |
| Time | `timestamp` | Relative: "14h ago", "3d ago" |
| Link | `signature` | External icon → `https://solscan.io/tx/{signature}` |

**Holding duration computation:**
```typescript
function computeHoldingDuration(
  firstTs: number | null | undefined,
  lastTs: number | null | undefined,
  hasBalance: boolean
): string {
  if (!firstTs) return '—';
  const endTs = hasBalance ? Math.floor(Date.now() / 1000) : (lastTs ?? firstTs);
  const seconds = endTs - firstTs;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
```

**IMPORTANT:** If `currentUiBalance > 0`, use `Date.now()` as the end for holding duration — the position is still open. If balance is 0, use `lastTransferTimestamp`.

### 5c. Wire into TokenPerformanceTab

**File:** `dashboard/src/components/dashboard/TokenPerformanceTab.tsx`

Add to component state:
```typescript
const [selectedToken, setSelectedToken] = useState<TokenPerformanceDataDto | null>(null);
const [sidebarOpen, setSidebarOpen] = useState(false);
```

Modify the `<TableRow>` (line ~819):
```typescript
<TableRow
  key={row.id}
  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50 cursor-pointer"
  onClick={() => {
    setSelectedToken(row.original);
    setSidebarOpen(true);
  }}
>
```

Add at the bottom of the component's JSX (after `</Card>`):
```typescript
<TokenDetailSidebar
  open={sidebarOpen}
  onClose={() => setSidebarOpen(false)}
  tokenData={selectedToken}
  walletAddress={walletAddress}
/>
```

Add import at top:
```typescript
import { TokenDetailSidebar } from './TokenDetailSidebar';
```

---

## 6. Frontend Types to Add

In `dashboard/src/types/api.ts`, add after the existing types:

```typescript
export interface TokenTradeItemDto {
  signature: string;
  timestamp: number;
  direction: string;
  amount: number;
  associatedSolValue: number;
  tokenPriceUsd: number | null;
  marketCapUsd: number | null;
  mcapBucket: string | null;
  feeAmount: number | null;
  enrichedAt: string | null;
}

export interface TokenTradeHistoryDto {
  walletAddress: string;
  tokenAddress: string;
  trades: TokenTradeItemDto[];
  avgEntryMcap: number | null;
  avgExitMcap: number | null;
  typicalEntryMcapUsd: number | null;
  entryMcapP25Usd: number | null;
  entryMcapP75Usd: number | null;
  typicalExitMcapUsd: number | null;
  exitMcapP25Usd: number | null;
  exitMcapP75Usd: number | null;
}
```

---

## 7. Files to Create / Modify

| Action | File | What Changes |
|---|---|---|
| CREATE | `src/api/shared/dto/token-trade-history.dto.ts` | New DTO classes `TokenTradeItemDto`, `TokenTradeHistoryDto` |
| MODIFY | `src/core/services/database-service.ts` | Add `getSwapAnalysisInputsForToken(walletAddress, mint)` |
| MODIFY | `src/api/controllers/wallets.controller.ts` | Add `GET :walletAddress/token-trades/:tokenAddress` handler |
| CREATE | `dashboard/src/components/dashboard/TokenDetailSidebar.tsx` | New sidebar component |
| MODIFY | `dashboard/src/components/dashboard/TokenPerformanceTab.tsx` | Add click handler on rows, state, import sidebar |
| MODIFY | `dashboard/src/types/api.ts` | Add `TokenTradeItemDto`, `TokenTradeHistoryDto` interfaces |

---

## 8. Known Pitfalls & Pre-empted Mistakes

### P1 — `mint` not `tokenAddress` in SwapAnalysisInput
`SwapAnalysisInput` uses the field name `mint` for the token address. `AnalysisResult` uses `tokenAddress`. These refer to the same value but have different field names. The Prisma query MUST use `mint` when filtering `swapAnalysisInput`, and `tokenAddress` when filtering `analysisResult`. Confusing them causes zero results with no error.

### P2 — Enrichment nulls will be common
A significant portion of `SwapAnalysisInput` rows will have `null` for `marketCapUsd`, `tokenPriceUsd`, and `solPriceUsd`. This is not a bug — enrichment runs async and may not cover all historical data. Every UI cell showing these values MUST have a null guard showing "—". Do NOT attempt to compute fallback values client-side from other fields (risk of silent incorrect math).

### P3 — `DialogContent` cannot be repositioned with Tailwind overrides
There is no `sheet.tsx`. Do not use the project's `<DialogContent>` wrapper — it has center-screen positioning (`left-[50%] translate-x-[-50%]`) baked into `cn()` base classes at the same specificity as any className you pass, making overrides unreliable. It also auto-injects a close button. Use `DialogPrimitive.Content` directly from `@radix-ui/react-dialog` (already a project dep) with explicit right-drawer Tailwind classes. Reuse `DialogPortal` and `DialogOverlay` from `dialog.tsx` for the backdrop — those are clean.

### P4 — `avgEntryMcap` / `avgExitMcap` not in existing DTO
These fields exist in `AnalysisResult` in the DB but are NOT mapped in `TokenPerformanceDataDto` (backend) or its frontend interface. They cannot be read from the `tokenData` prop passed to the sidebar. They MUST come from the new `/token-trades/:tokenAddress` endpoint response.

### P5 — Row click vs cell click conflict
The `TokenBadge` in the first column has internal buttons (copy, links). If `onClick` is on the `<TableRow>`, clicking those buttons will also trigger the sidebar. Fix: add `e.stopPropagation()` on click handlers inside the `TokenBadge` cell renderer, OR scope the `onClick` to only fire when the event target is the row/cell itself (check `e.target === e.currentTarget` or use a dedicated click area).

### P6 — Holding duration for open positions
`lastTransferTimestamp` is the time of the last trade, not the current time. For tokens where `currentUiBalance > 0`, the position is still open — holding duration must use `Date.now()` as the end, not `lastTransferTimestamp`. Using `lastTransferTimestamp` for open positions would display wrong/stale duration.

### P7 — `transferCountIn` counts transfers, not buys
`transferCountIn` counts all inbound transfers including airdrops and wallet-to-wallet receives. It is not purely "buys". Display it as "In Transfers" or "Receives" — not "Buys". Similarly `transferCountOut` is not purely "sells". The actual direction breakdown is only in `SwapAnalysisInput.direction`. If you want a pure buy count, count rows in the trade history where `direction === "buy"`.

### P8 — Token performance endpoint does NOT filter by single token efficiently for sidebar
Using `GET /token-performance?tokenAddresses=MINT&pageSize=1` works but goes through the full query pipeline (spam filtering, sorting, enrichment). For the sidebar, the row data is already in memory (it came from the table render). Pass the row's `TokenPerformanceDataDto` object directly as the `tokenData` prop. Do NOT re-fetch the summary from the API.

### P9 — Dialog z-index vs table sticky columns
`TokenPerformanceTab` uses `sticky left-0 z-10` on the first column. The Dialog portal renders into `document.body` via Radix and will be above the table. No fix needed — just be aware that if the Dialog is nested inside the table DOM (incorrect), it will be clipped. Always verify the Dialog portal renders in `<body>`.

### P10 — NestJS controller guard / auth
All existing wallet endpoints in `WalletsController` use `@Req() req: Request & { user?: any }` and log activity via `databaseService.logActivity`. The new endpoint is inside the same controller and will inherit any guards applied at the controller level. Check if `@UseGuards(...)` exists at the class level — if so, the endpoint is automatically protected. Do NOT add auth logic that differs from the existing pattern.

### P11 — Amount formatting for token units
Token amounts can be enormous (e.g., "25.6M", "388.8K") or tiny (meme coins with 9 decimals). Use a compact formatter:
```typescript
function formatTokenAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 0.0001) return n.toExponential(2);
  return n.toFixed(4);
}
```

### P12 — Performance: do not render TradeHistoryTable on every open
SWR will cache the trade history after first load. But if `tokenData` changes without closing, the SWR key changes and refetches. This is correct behavior. However: do NOT put heavy computation (like sort, map) inside the render function without `useMemo`. The trade list can be 100+ rows.

---

## 9. Build Order (Sequence Matters)

1. **Backend first:**
   - Add `getSwapAnalysisInputsForToken` to `database-service.ts`
   - Create `token-trade-history.dto.ts`
   - Add handler to `wallets.controller.ts`
   - Test: `curl /api/v1/wallets/{wallet}/token-trades/{mint}` returns data

2. **Frontend types:**
   - Add `TokenTradeItemDto`, `TokenTradeHistoryDto` to `dashboard/src/types/api.ts`

3. **Sidebar component:**
   - Create `TokenDetailSidebar.tsx`
   - Test in isolation with hardcoded mock `tokenData` prop

4. **Wire into table:**
   - Modify `TokenPerformanceTab.tsx`
   - Test click → sidebar open flow

---

## 10. What Is Explicitly Out of Scope

- No candlestick chart (no OHLC data stored)
- No "Copy Swap" button (requires chain simulation, out of scope)
- No "Sell All" button (wallet signing, out of scope)
- No real-time price updates inside the sidebar (static snapshot is fine)
- No pagination of trade history (load all rows — wallet × token pairs are bounded in size)
- No URL state for sidebar open/closed (state is ephemeral, no need for deep-linking)
