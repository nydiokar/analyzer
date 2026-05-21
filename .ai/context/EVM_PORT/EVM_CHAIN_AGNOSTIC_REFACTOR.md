# EVM Chain-Agnostic Refactor — Architecture Specification

**Status:** REQUIRED — current EVM implementation is a bypass, not an abstraction  
**Priority:** Next major engineering task after `feature/evm-ingestion` merges  
**Branch target:** `refactor/chain-agnostic-pipeline`

---

## Why This Document Exists

The Phase 5 EVM implementation works end-to-end, but it relies on two workarounds that reveal structural debt:

1. **`skipBalanceFetch: true`** — passed to `PnlAnalysisService.analyzeWalletPnl()` for EVM wallets because `PnlAnalysisService` calls `HeliusApiClient` directly to fetch SOL balance. Without this flag, the service would attempt to query Helius for an EVM address, which fails or returns nonsense.

2. **Solana-named fields** — `totalSolSpent`, `totalSolReceived`, `realizedPnlSol`, `associatedSolValue`, `currentSolBalance` exist across `OnChainAnalysisResult`, `SwapAnalysisSummary`, and `WalletSummaryResponse`. For EVM wallets these fields hold ETH values — the naming is a lie.

**The test:** If you wanted to add BSC support today, you would have to touch `PnlAnalysisService`, `WalletBalanceService`, the analysis types, and the API response DTOs. That's wrong. Adding a new chain should mean: create one new `<Chain>BalanceFetcher`, one new ingestion client, wire into the selector — done.

---

## Current Coupling Map (What Needs to Break)

```
PnlAnalysisService
  └── HeliusApiClient (injected directly — Solana RPC)
       └── used for: fetchCurrentSolBalance(walletAddress)
            └── called in: analyzeWalletPnl() unless skipBalanceFetch=true

WalletBalanceService
  └── HeliusApiClient (injected directly)
       └── no EVM equivalent exists

src/types/helius-api.ts
  └── OnChainAnalysisResult { totalSolSpent, totalSolReceived, netSolProfitLoss, ... }
  └── SwapAnalysisSummary { realizedPnlSol, unrealizedPnlSol, ... }
  └── file name implies Solana ownership — should be analysis-types.ts

WalletSummaryResponse (API DTO)
  └── currentSolBalance, currentSolBalanceUsd — Solana field names on a multi-chain DTO

EvmSyncService (current state)
  └── calls: pnlAnalysisService.analyzeWalletPnl(walletAddress, undefined, { skipBalanceFetch: true })
  └── result: unrealizedPnl for EVM is always 0 (balance never fetched)
```

---

## Target Architecture

### 1. `NativeBalanceFetcher` Interface

Create `src/core/interfaces/native-balance-fetcher.interface.ts`:

```typescript
export interface NativeTokenBalance {
  amount: number;        // in native units (SOL or ETH, not lamports/wei)
  amountUsd: number | null;
}

export interface NativeBalanceFetcher {
  fetchBalance(walletAddress: string): Promise<NativeTokenBalance | null>;
  readonly chain: 'solana' | 'ethereum' | 'arbitrum' | 'base' | string;
}
```

### 2. `SolanaBalanceFetcher` (wraps existing Helius path)

Create `src/core/services/solana-balance-fetcher.ts`:

```typescript
@Injectable()
export class SolanaBalanceFetcher implements NativeBalanceFetcher {
  readonly chain = 'solana';

  constructor(
    private readonly heliusApiClient: HeliusApiClient,
    private readonly solPriceService: SolPriceService,
  ) {}

  async fetchBalance(walletAddress: string): Promise<NativeTokenBalance | null> {
    const lamports = await this.heliusApiClient.getCurrentSolBalance(walletAddress);
    if (lamports === null) return null;
    const sol = lamports / 1e9;
    const solPriceUsd = await this.solPriceService.getCurrentPrice();
    return {
      amount: sol,
      amountUsd: solPriceUsd !== null ? sol * solPriceUsd : null,
    };
  }
}
```

### 3. `EvmBalanceFetcher`

Create `src/core/services/evm-balance-fetcher.ts`:

```typescript
@Injectable()
export class EvmBalanceFetcher implements NativeBalanceFetcher {
  constructor(
    private readonly evmApiClient: EvmApiClient,
    private readonly chain: 'ethereum' | 'arbitrum' | 'base',
    private readonly ethPriceService: EthPriceService, // to be created or reuse MarketContextService
  ) {}

  async fetchBalance(walletAddress: string): Promise<NativeTokenBalance | null> {
    // eth_getBalance via Alchemy JSON-RPC
    const weiHex = await this.evmApiClient.rpcCall<string>(
      'eth_getBalance',
      [walletAddress, 'latest'],
      this.chain,
    );
    if (!weiHex) return null;
    const wei = BigInt(weiHex);
    const eth = Number(wei) / 1e18;
    const ethPriceUsd = await this.ethPriceService.getCurrentPrice();
    return {
      amount: eth,
      amountUsd: ethPriceUsd !== null ? eth * ethPriceUsd : null,
    };
  }
}
```

### 4. `PnlAnalysisService` — Constructor Change

Current signature (simplified):
```typescript
constructor(
  private readonly databaseService: DatabaseService,
  private readonly heliusApiClient: HeliusApiClient,  // ← must go
  ...
)
```

Target signature:
```typescript
constructor(
  private readonly databaseService: DatabaseService,
  private readonly nativeBalanceFetcher: NativeBalanceFetcher,  // ← injected per-chain
  ...
)
```

The `skipBalanceFetch` option is then removed entirely. When `nativeBalanceFetcher.fetchBalance()` returns `null` or throws, the service gracefully omits `unrealizedPnl` from the result without needing a bypass flag.

**Module wiring:** `PnlAnalysisModule` is imported by both Solana and EVM contexts. The correct fetcher is provided via `useClass` or a factory in the parent module:

```typescript
// In HeliusModule / Solana path
{ provide: 'NativeBalanceFetcher', useClass: SolanaBalanceFetcher }

// In EvmModule
{ provide: 'NativeBalanceFetcher', useClass: EvmBalanceFetcher }
```

Or alternatively — `EvmSyncService` constructs and passes the fetcher as a runtime dependency, keeping `PnlAnalysisModule` truly chain-agnostic without provider juggling.

---

## Field Rename Plan

### `src/types/helius-api.ts` → rename to `src/types/analysis-types.ts`

All analysis result types live here. Field renames (full list):

| Current name | Target name | Scope |
|---|---|---|
| `totalSolSpent` | `totalNativeSpent` | `OnChainAnalysisResult` |
| `totalSolReceived` | `totalNativeReceived` | `OnChainAnalysisResult` |
| `netSolProfitLoss` | `netNativeProfitLoss` | `OnChainAnalysisResult` |
| `realizedPnlSol` | `realizedPnlNative` | `SwapAnalysisSummary`, `WalletPnlSummary` |
| `unrealizedPnlSol` | `unrealizedPnlNative` | same |
| `associatedSolValue` | `associatedNativeValue` | `SwapAnalysisInput` (Prisma field) |
| `currentSolBalance` | `currentNativeBalance` | `WalletSummaryResponse`, DB model |
| `currentSolBalanceUsd` | `currentNativeBalanceUsd` | same |

**Migration risk:** `associatedSolValue` is a Prisma column on `SwapAnalysisInput` — renaming requires a DB migration plus updating every query reference. Do this in a single PR with a migration file and a grep-sweep for all usages.

**API DTO field names:** `currentSolBalance` and `currentSolBalanceUsd` appear in `WalletSummaryResponse`. These are public API surface. Options:
- Rename + add deprecated aliases (`@deprecated` in Swagger) for one release cycle
- Keep API names as-is, rename internal types only, map at the controller layer

Recommended: rename internal types, keep API names stable for one release, map at controller.

---

## EVM `WalletPreparationService` Equivalent

Solana has `WalletPreparationService` which enforces `sync → enrich → analyze`. EVM currently runs sync + analyze as one atomic step in `EvmSyncService.syncWalletData()` Step 7. This is sufficient for now but means there's no reusable orchestration layer for:

- Re-running analysis only (without re-sync)
- Triggering EVM analysis from a queue job
- User-facing "analyze my EVM wallet" trigger path

**Target:** Create `EvmWalletPreparationService` (or extend `WalletPreparationService` to be chain-aware):

```typescript
async prepareEvmWallet(walletAddress: string, chain: EvmChain, options?: SyncOptions): Promise<void> {
  // Step 1: Sync (idempotent, incremental via lastSyncedBlock)
  await this.evmSyncService.syncWalletData(walletAddress, chain, options);
  // Step 2: No Helius enrichment — EVM has no token metadata enrichment path yet
  // Step 3: Analysis pipeline already runs inside syncWalletData Step 7
  //         Future: extract Step 7 to here for clean separation
}
```

---

## EVM Token Metadata Enrichment (Broken Path)

The Solana analysis pipeline includes a `process-market-context` queue step that fetches token prices and market caps via Helius + CoinGecko, then writes `marketCapUsd`, `tokenPriceUsd`, `solPriceUsd` to `SwapAnalysisInput` rows. This enrichment is **not wired for EVM** and will never run for EVM mints.

**Impact:**
- `AnalysisResult.avgEntryMcap`, `avgExitMcap`, `dominantEntryMcapBucket` — always null for EVM tokens
- `TokenLot.entryPriceUsd`, `costBasisUsd` — always null for EVM tokens
- USD PnL figures — 0 or null (no price data)

**Correct path for EVM token metadata:**
1. Alchemy `alchemy_getTokenMetadata` — returns `name`, `symbol`, `decimals`, `logo` for ERC-20 tokens
2. CoinGecko or DeFiLlama — historical price lookup by contract address + chain (e.g. `coingecko.com/api/v3/coins/ethereum/contract/{address}/market_chart`)
3. New `EvmMarketContextService` that mirrors `MarketContextService` but calls Alchemy + CoinGecko instead of Helius

Until this is built, EVM wallets will have:
- Correct native-token (ETH) PnL values ✅
- Missing USD values (null) for all EVM token stats ❌
- Missing mcap context ❌

---

## What "Adding BSC" Looks Like With This Architecture

With the refactor complete, adding BSC requires:

1. **New `BscApiClient`** (wraps BSC RPC or Moralis/Alchemy BSC endpoint) — mirrors `EvmApiClient`
2. **New `BscBalanceFetcher`** implements `NativeBalanceFetcher` — calls `eth_getBalance` on BSC RPC, returns BNB amount
3. **Extend `evm-stablecoins.ts`** — add BSC USDT/USDC/BUSD contract addresses
4. **Extend `evm-dex-programs.ts`** — add PancakeSwap V2/V3 swap event topic0
5. **Extend `WalletChain` type** — add `'bsc'`
6. Wire `BscBalanceFetcher` in the BSC module

**No changes to:**
- `PnlAnalysisService` ✅
- `BehaviorService` ✅
- `WalletHudService` ✅
- `SimilarityService` ✅
- Any API controller ✅
- Any DB schema ✅

That's the test of whether the abstraction is correct.

---

## What Remains Broken Until This Refactor Ships

| Issue | Impact | Workaround |
|---|---|---|
| `skipBalanceFetch: true` flag | Unrealized PnL is always 0 for EVM wallets | None — EVM wallet holders see 0 unrealized PnL |
| Solana-named fields | Confusing codebase, misleading metrics for EVM | Internal-only, no user-facing confusion |
| No EVM token metadata enrichment | USD PnL null, mcap context null for EVM | EVM wallets show ETH PnL but no USD figures |
| No EVM analysis queue job | EVM analysis only runs during sync, no retry path | Admin must re-trigger sync to re-run analysis |
| `WalletBalanceService` Solana-only | No EVM equivalent for balance checks in other flows | EVM wallets skip balance-dependent features |
| `helius-api.ts` file name | Code reader confusion | Rename is safe and non-breaking |

---

## Implementation Order (Recommended)

1. **Rename `src/types/helius-api.ts` → `src/types/analysis-types.ts`** and rename internal fields (`totalSolSpent` → `totalNativeSpent` etc.) — no DB migration needed for in-memory types, only for `associatedSolValue` Prisma column
2. **Rename `associatedSolValue` Prisma column** — write migration, grep all usages, update in one commit
3. **Create `NativeBalanceFetcher` interface** — pure TypeScript, no runtime impact
4. **Create `SolanaBalanceFetcher`** — wraps existing Helius path, drop-in replacement
5. **Create `EvmBalanceFetcher`** — calls `eth_getBalance` via `EvmApiClient.rpcCall()`
6. **Refactor `PnlAnalysisService`** constructor — inject `NativeBalanceFetcher`, remove `HeliusApiClient`, remove `skipBalanceFetch` option
7. **Wire fetchers in modules** — `SolanaBalanceFetcher` in Helius path, `EvmBalanceFetcher` in EVM module
8. **Create `EvmMarketContextService`** — Alchemy metadata + price lookup, feeds `marketCapUsd` to EVM `SwapAnalysisInput` rows
9. **Rename API DTO fields** (`currentSolBalance` → `currentNativeBalance`) with controller-level mapping for backwards compat

Steps 1–7 can ship together. Step 8 is a separate feature. Step 9 is a breaking API change — coordinate with SDK consumers.

---

## Files to Create / Modify

| Action | File |
|---|---|
| CREATE | `src/core/interfaces/native-balance-fetcher.interface.ts` |
| CREATE | `src/core/services/solana-balance-fetcher.ts` |
| CREATE | `src/core/services/evm-balance-fetcher.ts` |
| CREATE | `src/core/services/evm-market-context.service.ts` |
| RENAME | `src/types/helius-api.ts` → `src/types/analysis-types.ts` |
| MODIFY | `src/core/services/pnl-analysis-service.ts` — inject interface, remove skipBalanceFetch |
| MODIFY | `src/api/services/wallet-balance.service.ts` — inject via interface |
| MODIFY | `src/api/integrations/evm.module.ts` — provide EvmBalanceFetcher |
| MODIFY | `src/api/integrations/helius.module.ts` — provide SolanaBalanceFetcher |
| MODIFY | `src/core/services/evm-sync-service.ts` — remove skipBalanceFetch flag |
| DB MIGRATION | Rename `associatedSolValue` → `associatedNativeValue` on `SwapAnalysisInput` |
| DB MIGRATION | Rename `currentSolBalance` → `currentNativeBalance` on `WalletPnlSummary` (if stored) |

---

## Reading This in a Future Session

If you are an LLM starting a new session to continue this work:

1. Read `.ai/CONTEXT.md` — check active task `EVM-1` status
2. Read this file top-to-bottom — understand what the bypass looks like vs. what the abstraction requires
3. Read `src/core/services/pnl-analysis-service.ts` — find `skipBalanceFetch` usages
4. Read `src/types/helius-api.ts` — see all Solana-named fields that need renaming
5. Start with Step 1 of the implementation order above
6. Do NOT proceed with any EVM-related features (EVM market context, BSC support, user-facing sync trigger) until Steps 1–7 are complete — they build on the abstraction

The current code on `main` (after `feature/evm-ingestion` merges) passes all tests and works end-to-end for EVM wallets. But it is not the correct architecture. It is a working bypass. This document specifies the correct architecture.
