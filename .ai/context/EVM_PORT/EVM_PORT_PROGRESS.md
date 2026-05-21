# EVM Port — Implementation Progress

**Branch:** `feature/evm-ingestion`  
**Last updated:** 2026-05-22

---

## Status: Phase 5 complete — all spec gaps closed, branch is merge-ready

---

## What's built

### Phase 1 — Foundation ✅
| File | Status |
|---|---|
| `src/types/evm-api.ts` | ✅ Done |
| `src/config/evm-stablecoins.ts` | ✅ Done — Ethereum/Arbitrum/Base |
| `src/config/evm-dex-programs.ts` | ✅ Done — Uniswap V2/V3/V4, Sushi, Curve, Balancer, 0x, 1inch, Aerodrome |
| `prisma/schema.prisma` | ✅ `chain` field added to Wallet model (default "solana") |
| `src/api/integrations/evm.module.ts` | ✅ Done |
| `src/api/integrations/ingestion-selector.ts` | ✅ Done |

### Phase 2 — Core Mapper ✅
| File | Status |
|---|---|
| `src/core/services/evm-event-parser.ts` | ✅ Done — ERC-20 Transfer, UniswapV2/V3 Swap decoders |
| `src/core/services/evm-transaction-classifier.ts` | ✅ Done — SWAP_TOPICS set + DEX registry + multi-leg heuristics |
| `src/core/services/evm-value-extractor.ts` | ✅ Done — WETH direct > WETH withdrawal > WETH deposit > V2 Swap > V3 Swap > tx.value |
| `src/core/services/evm-transaction-mapper.ts` | ✅ Done — EvmTransaction[] → SwapAnalysisInput[] |
| `src/core/services/evm-api-client.ts` | ✅ Done — canonical 2-call approach (alchemy_getAssetTransfers + selective receipt enrichment) |
| `src/core/services/evm-sync-service.ts` | ✅ Done — fetch → map → save pipeline |

### Tests ✅
- 12 unit tests passing (`pnpm test:evm`)
- Zero TypeScript errors

### Scripts
- `pnpm demo:evm-wallet <address> [chain] [enrichLimit=20]` — end-to-end demo
- `pnpm debug:evm-tx <txHash> [chain] [walletAddress]` — inspect single tx

---

## Validated run results (2026-05-01)

**Wallet tested:** `0x19b644f7f3e34330f20d03df3611778e697e61c4` on Ethereum  
**Approach:** canonical `alchemy_getAssetTransfers` (2 RPC calls total) + selective receipt enrichment

```
transfers:    400 events → 198 unique txs
processed:    104 transactions (94 unknown/failed skipped)
swaps:        14 detected ✅
transfers:    90
records:      204 SwapAnalysisInput records generated
ETH received: 2.277 ETH (from 20 enriched txs)
ETH spent:    0.000 (enriched txs happened to be all incoming — see known limitation below)
```

**Classification is working** — 14 swaps correctly detected via SWAP_TOPICS (swap event topic0 in logs),
compared to 0 swaps when we only checked tx.to against DEX registry.

---

## Architecture — canonical EVM approach

The implementation follows the standard EVM indexer pattern (same as Etherscan/Zapper/DeBank):

```
Step 1: alchemy_getAssetTransfers (2 RPC calls — toAddress + fromAddress)
        → all ERC-20 transfer events, no per-tx calls
Step 2: buildTransactionsFromTransfers()
        → synthesise EvmTransaction objects from transfer metadata, zero RPC
Step 3: enrichWithReceipts() — limited to N txs (default 20), 250ms delay
        → fetch full logs for DEX event parsing and gas data
Step 4: mapEvmTransactionsToSwapInputs()
        → net token flows per wallet → SwapAnalysisInput[]
```

Rate limiting: exponential backoff on 429 (1s / 2s / 4s), 250ms between receipt fetches.

---

## What changed since Phase 2

### Completed 2026-05-21
- ✅ **Classifier test fixed** — "DEX-in-logs" rule returns `confidence: 'high'` (was failing with 'medium')
- ✅ **Sync service rewritten** — canonical pipeline: `getTransfersForAddress` → `buildTransactionsFromTransfers` → smart `enrichWithReceipts` → `mapEvmTransactionsToSwapInputs`
- ✅ **Smart enrichment ordering** — `selectTransactionsForEnrichment()` prioritises outgoing swaps (score=2) over incoming (score=1) so cost-basis / ETH-spent is populated first
- ✅ **EvmModule wired** into `AppModule` — `EvmSyncService` available app-wide
- ✅ **API endpoint live** — `POST /jobs/wallets/evm-sync` (admin-only, body: `{ walletAddress, chain, maxTransactions, enrichLimit, skipSave }`)
- ✅ **Prisma migration applied** — `chain` column on Wallet, all existing rows default to `"solana"`
- ✅ **Schema drift fixed** — `WalletDailyPnl` re-added to `schema.prisma` (existed in DB/migrations but was accidentally removed)
- ✅ **Demo script updated** — uses smart enrichment ordering, higher default enrichLimit (50)

### Validated 2026-05-21 (test wallet 0x19b644f7f3e34330f20d03df3611778e697e61c4)
```
transfers:    1000 events → 977 unique txs
swaps:        43 detected ✅
transfers:    934
records:      978 SwapAnalysisInput records generated
ETH received: 11.83 ETH
ETH spent:    0 (confirmed correct — wallet is mostly a token receiver, no ETH→token sells)
```

## Known limitations / next steps

### Phase 5 cont. — spec gap closure (2026-05-22)
- ✅ **Pagination** — `getTransfersForAddress` now loops on Alchemy `pageKey`; `hardLimit` (default 5000) caps total; logs warn when hit. Validated: 5000-transfer wallets fetch correctly.
- ✅ **Multi-wallet validation** — 4 distinct Ethereum wallets tested end-to-end:
  - `0x19b644...` — original test wallet (ETH swaps, ETH value extraction working)
  - `0xab5801...` — high-volume wallet (4601 records, 57 ETH volume, 1543 tokens, pagination triggered)
  - `0x267be1...` — balanced trader (1800 records, 5.1 ETH volume)
  - `0x3ddfa8...` — active trader (2341 records, 12.4 ETH volume, 17 swaps)
- ✅ **Stablecoin handling validated** — USDT records correctly tagged `SWAP_STABLE`, 6-decimal amounts correct (249.4 USDT not 249426579)
- ✅ **ETH value = 0 on token↔stablecoin confirmed correct** — no WETH leg → 0 is right
- ✅ **`EVM_PORT_KNOWN_LIMITATIONS.md`** created
- ✅ **19/19 tests pass** (2 new pagination tests added)
- ✅ **Zero TS errors**

### Remaining
- Open PR to main

### Phase 3 next steps
- ✅ Validate ETH spent is populated — confirmed working with Uniswap Universal Router (1.80 ETH spent)
- ✅ SwapAnalyzer stablecoins extended for EVM (USDC/USDT/DAI on ETH/ARB/Base)
- ✅ Behavior analyzer exclusion list extended for EVM (WETH + stablecoins)
- ✅ Arbitrum: end-to-end validated — 9 transfers, 3 swaps, DB save, PnL, behavior all pass
- ✅ Base: end-to-end validated — 18 transfers, 5 swaps, DB save clean
- ✅ eth_call decimals fallback validated live: 1 unknown token on Arbitrum, 2 on Base resolved via eth_call
- ✅ DB save validated: 396 rows saved, wallet row created with chain='ethereum'
- ✅ PnL analysis validated: 396 txs → 6 tokens, 0.15 SOL net PnL, 102ms, no errors
- ✅ Behavior analysis validated: runs without errors, speedCategory/holdTime/uniqueTokens populated

### Phase 5 — token decimals + incremental sync (2026-05-22)
- ✅ **Token decimals resolved from Alchemy metadata** — `rawContract.decimal` parsed in `extractDecimalsFromTransfers()` (zero extra RPC calls for Alchemy-annotated tokens)
- ✅ **eth_call decimals() fallback** — `fetchTokenDecimals()` on `EvmApiClient` with in-memory cache; called only for tokens Alchemy didn't annotate
- ✅ **`resolveTokenDecimals()`** — combined pipeline: Alchemy metadata → static cache → eth_call; called in `syncWalletData` before mapping
- ✅ **WBTC added to static cache** (8 decimals)
- ✅ **`tokenDecimalsMap` threaded through** `mapEvmTransactionsToSwapInputs` → `buildRecords` → `getDecimals`
- ✅ **Incremental sync** — `lastSyncedBlock Int?` added to `Wallet` model; `syncWalletData` reads `lastSyncedBlock+1` from DB as `fromBlock` when no override provided; after save, writes new `lastSyncedBlock` to wallet row
- ✅ **Prisma migration applied** — `20260521211048_add_wallet_last_synced_block`
- ✅ **`updateWallet` extended** to handle `lastSyncedBlock`
- ✅ **Incremental sync cross-chain bug fixed** — `lastSyncedBlock` only used when `wallet.chain === chain`; prevents Arbitrum block numbers leaking into a Base sync
- ✅ **17/17 tests pass** (5 new `evm-api-client.spec.ts` tests added for decimal extraction)
- ✅ **Zero TS errors**

### Phase 4 — code review fixes + docs (2026-05-22)
- ✅ `buildTransactionsFromTransfers` chain hardcode fixed — now takes `chain` param, no more `.map` workaround
- ✅ `weiToEth` precision fixed — `Number(wei / 10n**9n) / 1e9` prevents float truncation on large amounts
- ✅ `rpcCall` retry loop fixed — `while(true)` + `attempt < retries` guard ensures all 3 retry slots are used
- ✅ JSDoc added to `getReceiptsForHashes` and `extractTxHashes`
- ✅ `README_EVM_MAPPER.md` written — architecture, files, chains, design decisions, scripts

---

## Key decisions made

- **Data source:** Alchemy API (free tier) — `alchemy_getAssetTransfers` as primary
- **Primary chain:** Ethereum
- **Classifier strategy:** SWAP_TOPICS set (swap event topic0 anywhere in logs) takes priority over tx.to DEX check — catches aggregator-routed swaps (1inch, 0x, CoW, Paraswap)
- **Value extraction priority:** WETH direct transfer → WETH Withdrawal event → WETH Deposit event → UniswapV2 Swap leg → UniswapV3 Swap leg → tx.value
- **No schema rename** (`signature`/`mint` kept as-is) — field names are EVM-compatible as-is
- **No breaking changes** to existing Solana path
