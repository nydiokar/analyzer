# Implementation Prompt — Token Detail Sidebar (TDS Milestone)

> Copy everything below this line and paste it as your opening message to the LLM.

---

## Your Role and Mandate

You are the lead engineer taking full ownership of the **Token Detail Sidebar** milestone on the Sova Intel analyzer project. This is a full-stack feature spanning a NestJS backend and a Next.js 14 dashboard. You are not a code monkey executing instructions — you are an engineer who understands the system, thinks before typing, verifies before assuming, and owns the outcome end to end.

You will implement this milestone in strict task order: **TDS-1 → TDS-2 → TDS-3 → TDS-4 → TDS-5 → TDS-6**. Complete and verify each task before starting the next. Do not batch work across tasks.

---

## Non-Negotiable Behaviors

These apply for the entire session. Internalize them, do not just acknowledge them.

**Before writing any code:**
- Read the file you are about to modify. Understand its structure, imports, patterns, and conventions. Do not write code that conflicts with what is already there.
- If a plan says a file/field/method exists, verify it exists before relying on it. Plans can be wrong. Code is truth.
- If you are unsure about something, read the relevant source file. Do not guess. Do not invent.

**While writing code:**
- Match the exact code style of the file you are editing — indentation, quote style, import ordering, decorator patterns, naming conventions. Do not introduce a different style.
- Keep changes minimal and focused. Do not refactor surrounding code. Do not clean up unrelated things. Do not add features beyond what the task specifies.
- Do not add comments that explain what the code does. The code explains itself. Only comment WHY if it is genuinely non-obvious.
- Do not add error handling for scenarios that cannot happen. Trust internal guarantees.

**After writing code:**
- Read back what you wrote. Verify field names match the schema. Verify imports resolve. Verify the logic is correct for null inputs.
- If the task involves a backend change, mentally trace the request path end to end before declaring it done.
- If the task involves a frontend component, mentally trace every data dependency and confirm each field is sourced from the right place.

**At every task boundary:**
- Update `.ai/CONTEXT.md`: mark the completed task, note what was done, note any deviation from the plan and why.
- State clearly what you verified and how.
- State clearly what the next task is before starting it.

---

## Session Start Protocol

Run these before touching any code:

```bash
git status
git log --oneline -5
```

Then read these files in order:
1. `.ai/CONTEXT.md` — active tasks, recent decisions
2. `.ai/RULES.md` — execution contract (follow it)
3. `.ai/context/TOKEN_DETAIL_SIDEBAR_PLAN_2026-04-22.md` — the full spec (your primary reference)

Do not proceed until you have read all three.

---

## What You Are Building

When a user clicks a row in the Token Performance table, a right-side drawer opens showing:
- The full buy/sell/transfer history for that wallet × token pair (from `SwapAnalysisInput`)
- Aggregated stats: total P&L, realized, unrealized, balance, holding duration, cost basis, avg entry/exit market cap

The full specification, data sourcing table, pitfall list, and build order are in:
**`.ai/context/TOKEN_DETAIL_SIDEBAR_PLAN_2026-04-22.md`**

Read that document fully. Everything you need is in it. What follows here is a task-by-task execution guide that references it.

---

## Task Execution Guide

### TDS-1 — Add `getSwapAnalysisInputsForToken` to DatabaseService

**File:** `src/core/services/database-service.ts`

**What to do:**
Read the existing `getSwapAnalysisInputs` method (around line 2106) to understand the established pattern for querying this table. Add a new method immediately after it — do NOT modify the existing one.

The new method:
```typescript
async getSwapAnalysisInputsForToken(
  walletAddress: string,
  mint: string
): Promise<SwapAnalysisInput[]>
```

Query: `WHERE walletAddress = walletAddress AND mint = mint ORDER BY timestamp ASC`

Use `this.prismaClient` (not a raw import). Use `this.executeWithRetry` if that wrapper is used by nearby methods — check the pattern in the file.

**Critical:** The field name in `SwapAnalysisInput` is `mint`, not `tokenAddress`. Confirm this by reading the schema at `prisma/schema.prisma` lines 86–110 before writing the query.

**Verify:** After writing, re-read the method. Confirm the `where` clause uses `mint`, not `tokenAddress`. Confirm return type matches the existing `SwapAnalysisInput` Prisma type.

**Done when:** Method is written, compiles (run `npx tsc --noEmit` from project root), and follows the exact same structural pattern as `getSwapAnalysisInputs`.

---

### TDS-2 — Create the backend DTO file

**File to create:** `src/api/shared/dto/token-trade-history.dto.ts`

**What to do:**
Read two existing DTO files first to understand the exact decorator and class pattern used:
- `src/api/shared/dto/token-performance-data.dto.ts` — field decorator pattern
- Any nearby simple DTO — to confirm `@ApiProperty` usage style

Then create the new file with two classes:

**`TokenTradeItemDto`** — one record from `SwapAnalysisInput`:
- `signature: string`
- `timestamp: number` (Unix seconds)
- `direction: string` — "buy" | "sell" | "transfer"
- `amount: number` — token units
- `associatedSolValue: number` — SOL in/out
- `tokenPriceUsd: number | null`
- `marketCapUsd: number | null`
- `mcapBucket: string | null`
- `feeAmount: number | null`
- `enrichedAt: string | null` — ISO string

**`TokenTradeHistoryDto`** — the full response:
- `walletAddress: string`
- `tokenAddress: string`
- `trades: TokenTradeItemDto[]`
- `avgEntryMcap: number | null`
- `avgExitMcap: number | null`
- `typicalEntryMcapUsd: number | null`
- `entryMcapP25Usd: number | null`
- `entryMcapP75Usd: number | null`
- `typicalExitMcapUsd: number | null`
- `exitMcapP25Usd: number | null`
- `exitMcapP75Usd: number | null`

Every field gets an `@ApiProperty` decorator. Nullable fields get `{ type: Number, nullable: true, required: false }` (or String — match the type). Use the exact same decorator style as `token-performance-data.dto.ts`.

**Verify:** Run `npx tsc --noEmit`. Zero errors.

---

### TDS-3 — Add the backend endpoint to WalletsController

**File:** `src/api/controllers/wallets.controller.ts`

**What to do:**
Read the full controller file. Understand:
1. The pattern for route params (`@Param`)
2. Whether `@UseGuards` is on the class — if so, the new endpoint inherits it automatically, add nothing extra
3. How activity logging works — look at any existing handler. If all handlers log via `databaseService.logActivity`, follow the same pattern. If it would add significant boilerplate for no operational gain at this stage, it is acceptable to omit it — but note this explicitly in your CONTEXT update
4. The imports already at the top — add only what is missing, do not duplicate

Add the handler:
```
GET :walletAddress/token-trades/:tokenAddress
```

The handler must:
1. Call `this.databaseService.getSwapAnalysisInputsForToken(walletAddress, tokenAddress)` — note: `tokenAddress` param becomes the `mint` argument
2. Call `this.databaseService.prismaClient.analysisResult.findUnique({ where: { walletAddress_tokenAddress: { walletAddress, tokenAddress } } })` — or whatever the existing `DatabaseService` method is for fetching a single `AnalysisResult`. **Read `database-service.ts` to find the right method** — do not invent one.
3. Map both results to `TokenTradeHistoryDto`
4. Return the DTO

Add `@ApiOperation`, `@ApiParam` for both params, `@ApiResponse` — match the decorator style of adjacent handlers exactly.

Add the import for `TokenTradeHistoryDto` at the top of the controller.

**Do not** add the DTO to any module — DTOs are plain classes, no DI registration needed.

**Verify:**
- `npx tsc --noEmit` — zero errors
- Start the backend: `npm run start:dev` (or whichever dev command is in `package.json`)
- Hit the endpoint manually: `curl -H "Authorization: Bearer <token>" http://localhost:3001/api/v1/wallets/<WALLET>/token-trades/<MINT>`
- Confirm you get a JSON response with `trades` array and mcap aggregate fields
- Confirm that for a token with no `SwapAnalysisInput` records, `trades` is `[]` (not an error)
- Confirm that for a token with unenriched records, `marketCapUsd` is `null` (not crashing)

**Done when:** Endpoint returns correct data for at least one real wallet+token pair.

---

### TDS-4 — Add frontend TypeScript types

**File:** `dashboard/src/types/api.ts`

**What to do:**
Read the end of the file to find the last exported interface. Add two new interfaces after it, mirroring the backend DTOs exactly:

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

**Verify:** `npx tsc --noEmit` from inside `dashboard/`. Zero errors.

---

### TDS-5 — Create the TokenDetailSidebar component

**File to create:** `dashboard/src/components/dashboard/TokenDetailSidebar.tsx`

This is the most complex task. Read the following before writing a single line:
- `dashboard/src/components/ui/dialog.tsx` — understand the exported primitives and what `DialogContent` actually does (it has center-screen positioning baked in and auto-injects a close button — do NOT use it)
- `dashboard/src/components/ui/scroll-area.tsx` — confirm the export name
- `dashboard/src/components/ui/badge.tsx` — for direction badges
- `dashboard/src/components/shared/TokenBadge.tsx` — for the header, understand its props
- `dashboard/src/lib/fetcher.ts` — confirm the `fetcher` export signature for SWR
- One existing component that uses SWR — confirm the `useSWR` pattern in this codebase

**Architecture decisions (non-negotiable):**

**Drawer mechanism:** Use `DialogPrimitive.Content` directly from `@radix-ui/react-dialog` (already a project dependency — do not install anything). Reuse `Dialog`, `DialogPortal`, and `DialogOverlay` from `@/components/ui/dialog`. Do NOT use the project's `DialogContent` wrapper — it positions center-screen and injects a duplicate close button.

```typescript
import { Dialog, DialogPortal, DialogOverlay } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
```

The drawer content element:
```typescript
<DialogPrimitive.Content
  className={cn(
    "fixed inset-y-0 right-0 z-50 flex flex-col w-[520px] max-w-full",
    "bg-background border-l border-border shadow-xl",
    "data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
    "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
    "duration-200 focus:outline-none"
  )}
>
```

**Data sourcing:**
- Summary stats (P&L, balance, timestamps, counts): come from the `tokenData` prop — this is the `TokenPerformanceDataDto` from the already-rendered table row. Do NOT make an API call for this.
- Trade history + mcap aggregates: SWR call, activated only when `open === true` and `tokenData !== null`:
  ```typescript
  const swrKey = open && tokenData
    ? `/api/v1/wallets/${walletAddress}/token-trades/${tokenData.tokenAddress}`
    : null;
  const { data: tradeHistory, isLoading } = useSWR<TokenTradeHistoryDto>(swrKey, fetcher);
  ```

**Props:**
```typescript
interface TokenDetailSidebarProps {
  open: boolean;
  onClose: () => void;
  tokenData: TokenPerformanceDataDto | null;
  walletAddress: string;
}
```

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

Use `currentUiBalance > 0` to determine `hasBalance`. For open positions, end = now. For closed positions, end = `lastTransferTimestamp`.

**Token amount formatter:**
```typescript
function formatTokenAmount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 0.0001) return n.toExponential(2);
  return n.toFixed(4);
}
```

**MCAP formatter:**
```typescript
function formatMcap(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
```

**`transferCountIn`/`transferCountOut` labeling:** Label as "Receives" and "Sends" — NOT "Buys" and "Sells". These counts include airdrops and wallet transfers, not just swap directions. The actual buy/sell split is in the trade history `direction` field.

**Trade history table columns (in order):**
1. Type — Badge: "buy" → green, "sell" → red, "transfer" → muted gray
2. MCAP — `formatMcap(trade.marketCapUsd)` — show "—" if null
3. Amount — `formatTokenAmount(trade.amount)`
4. SOL — `◎ ${trade.associatedSolValue.toFixed(3)}`
5. Time — relative time from `trade.timestamp * 1000`
6. Solscan — external link icon → `https://solscan.io/tx/${trade.signature}` (open in new tab)

Wrap trade rows in `useMemo` — do not recompute on every render.

**Null safety everywhere:** Every field from `tokenData` that is nullable must be guarded. Use `?? '—'` or `?? null` consistently. The component must not crash on a token with zero enriched trades or missing mcap data.

**Layout structure (in order inside the drawer):**
1. Header row: `TokenBadge` (reuse from `@/components/shared/TokenBadge`, `variant="inline"`, `size="m"`) + risk badge + close button (right-aligned)
2. Separator
3. 2×2 summary grid: Total P&L | Realized | Unrealized | Current Value (all SOL)
4. 3-column metrics grid: Balance | Cost Basis | Holding | Receives | Sends | SOL In/Out | Avg Entry MC | Avg Exit MC | MC Range (P25–P75)
5. Separator
6. "Trade History" section label
7. Trade history table — skeleton while `isLoading`, empty state if `tradeHistory?.trades?.length === 0`

**Verify:**
- `npx tsc --noEmit` from `dashboard/` — zero errors
- Import the component in `TokenPerformanceTab.tsx` temporarily with hardcoded `open={true}` and a mock `tokenData` object — confirm it renders without crashing
- Check: null `marketCapUsd` shows "—", not "null" or crash
- Check: the drawer appears on the right, not centered on screen
- Check: no duplicate close buttons
- Check: scroll works inside the drawer when trade history is long

---

### TDS-6 — Wire the sidebar into TokenPerformanceTab

**File:** `dashboard/src/components/dashboard/TokenPerformanceTab.tsx`

**What to do:**
Read the component first. Understand the existing state variables and the exact location of the `<TableRow>` render (around line 819).

Add state at the top of the component function body (after existing state declarations):
```typescript
const [selectedToken, setSelectedToken] = useState<TokenPerformanceDataDto | null>(null);
const [sidebarOpen, setSidebarOpen] = useState(false);
```

Modify the `<TableRow>` to be clickable:
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

**Cell click conflict:** The first column (`TokenBadge`) has internal action buttons. To prevent those clicks from triggering the row click, add `onClick={(e) => e.stopPropagation()}` to the `<TableCell>` that wraps the `TokenBadge` column. Read the `createColumns` function to locate this cell definition — it is the one with `accessorKey: 'tokenAddress'`.

Add the sidebar at the bottom of the component return, **outside** the `<Card>`:
```typescript
<TokenDetailSidebar
  open={sidebarOpen}
  onClose={() => setSidebarOpen(false)}
  tokenData={selectedToken}
  walletAddress={walletAddress}
/>
```

Add the import at the top:
```typescript
import { TokenDetailSidebar } from './TokenDetailSidebar';
```

**Verify:**
- `npx tsc --noEmit` — zero errors
- Start the dashboard dev server: `cd dashboard && npm run dev`
- Navigate to a wallet with token performance data
- Click a token row — drawer opens with correct token name and data
- Click the TokenBadge copy/link buttons — drawer does NOT open
- Click a different row while drawer is open — drawer updates to new token
- Click the close button or press Escape — drawer closes
- Click a row, wait for trade history to load, confirm transactions appear
- Confirm a token with zero enriched trades shows an appropriate empty state (no crash)
- Confirm holding duration shows correctly for both open and closed positions

---

## Completion Protocol

After TDS-6 is verified:

1. Update `.ai/CONTEXT.md`:
   - Move all TDS tasks from Active Work to the April 22 Recent Activity entry
   - Add a summary row in the Recent Activity table: what shipped, what files changed
   - Note any deviations from the plan and why

2. Commit:
   ```bash
   git add src/core/services/database-service.ts \
           src/api/shared/dto/token-trade-history.dto.ts \
           src/api/controllers/wallets.controller.ts \
           dashboard/src/types/api.ts \
           dashboard/src/components/dashboard/TokenDetailSidebar.tsx \
           dashboard/src/components/dashboard/TokenPerformanceTab.tsx \
           .ai/CONTEXT.md
   git commit -m "feat(dashboard): token detail sidebar with trade history drawer"
   ```

3. State clearly:
   - What was built and what files were changed
   - Anything that deviated from the plan (and why)
   - Any known issues or follow-up items

---

## Reference Locations

| What | Where |
|---|---|
| Full feature spec + pitfalls | `.ai/context/TOKEN_DETAIL_SIDEBAR_PLAN_2026-04-22.md` |
| Execution rules | `.ai/RULES.md` |
| Active task list | `.ai/CONTEXT.md` |
| DB schema | `prisma/schema.prisma` |
| DatabaseService | `src/core/services/database-service.ts` |
| WalletsController | `src/api/controllers/wallets.controller.ts` |
| Backend DTO example | `src/api/shared/dto/token-performance-data.dto.ts` |
| TokenPerformanceTab | `dashboard/src/components/dashboard/TokenPerformanceTab.tsx` |
| Frontend types | `dashboard/src/types/api.ts` |
| Fetcher (SWR) | `dashboard/src/lib/fetcher.ts` |
| Dialog primitives | `dashboard/src/components/ui/dialog.tsx` |
| TokenBadge | `dashboard/src/components/shared/TokenBadge.tsx` |
| ScrollArea | `dashboard/src/components/ui/scroll-area.tsx` |

---

## The Standard You Are Held To

You are not done when the code compiles. You are done when:
- The feature works correctly for the happy path
- It does not crash on any nullable field
- It does not fight the existing codebase style
- The next engineer who opens these files will find them coherent

If something in the plan contradicts what you find in the actual code, **trust the code**. Update the plan note in your CONTEXT entry. Do not silently implement something wrong because a document said so.
