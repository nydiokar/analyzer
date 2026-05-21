# EVM Port — Implementation Progress

**Branch:** `feature/evm-ingestion`  
**Last updated:** 2026-05-21

---

## Status: Phase 3 in progress — pipeline wired, DB live, validation next

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

### Token decimals — hardcoded for known tokens
Unknown ERC-20 tokens default to 18 decimals. For accurate amounts on tokens with non-18 decimals
(e.g. USDC=6, USDT=6 already handled), need `eth_call` to `decimals()` for unknowns.

### Multi-chain not yet validated
Arbitrum and Base code paths are wired but untested end-to-end.

### Phase 3 next steps
- Validate with a known two-sided trader (someone who buys AND sells tokens for ETH)
- Validate Arbitrum/Base chains end-to-end
- Run `EvmSyncService.syncWalletData()` against a real wallet with DB save (use the new endpoint)
- Run PnL/Behavior analysis on the saved EVM SwapAnalysisInput records

---

## Key decisions made

- **Data source:** Alchemy API (free tier) — `alchemy_getAssetTransfers` as primary
- **Primary chain:** Ethereum
- **Classifier strategy:** SWAP_TOPICS set (swap event topic0 anywhere in logs) takes priority over tx.to DEX check — catches aggregator-routed swaps (1inch, 0x, CoW, Paraswap)
- **Value extraction priority:** WETH direct transfer → WETH Withdrawal event → WETH Deposit event → UniswapV2 Swap leg → UniswapV3 Swap leg → tx.value
- **No schema rename** (`signature`/`mint` kept as-is) — field names are EVM-compatible as-is
- **No breaking changes** to existing Solana path
