# EVM Port — Implementation Progress

**Branch:** `feature/evm-ingestion`  
**Last updated:** 2026-05-01

---

## Status: Phase 2 complete, debugging classification

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
| `src/core/services/evm-transaction-classifier.ts` | ✅ Done — DEX registry + multi-leg heuristics |
| `src/core/services/evm-value-extractor.ts` | ✅ Done — WETH transfer, V3 Swap, V2 Swap, tx.value |
| `src/core/services/evm-transaction-mapper.ts` | ✅ Done — EvmTransaction[] → SwapAnalysisInput[] |
| `src/core/services/evm-api-client.ts` | ✅ Done — Alchemy RPC (alchemy_getAssetTransfers + eth_getTransactionReceipt) |
| `src/core/services/evm-sync-service.ts` | ✅ Done — fetch → map → save pipeline |

### Tests ✅
- 12 unit tests passing (`pnpm test:evm`)
- Zero TypeScript errors

### Scripts
- `pnpm demo:evm-wallet <address> [chain]` — end-to-end demo
- `pnpm debug:evm-tx <txHash> [chain] [walletAddress]` — inspect single tx

---

## First real run — results & findings

**Wallet tested:** `0x19b644f7f3e34330f20d03df3611778e697e61c4` on Ethereum  
**Data fetched:** 400 transfer events, 398 unique txs, 122 fetched (rate limited at concurrency=5)

**Problem 1: Everything classified as TRANSFER**
- Root cause: most swaps on Ethereum go through aggregators (1inch, 0x, Paraswap, CoW)
  whose `tx.to` is NOT in our DEX registry — the DEX routers appear in logs, not as `tx.to`
- The classifier does check logs for DEX addresses — but logs may not be populated correctly
- **Fix needed:** debug one real tx with `pnpm debug:evm-tx <hash>` to see what logs look like

**Problem 2: ETH value = 0 everywhere**
- Follows from Problem 1 — value extractor only runs on SWAP records
- Also: WETH transfer detection may need tuning

**Problem 3: Only 122/398 txs fetched**
- Was concurrency=5 with 3 RPC calls per tx (tx + receipt + block) = 15 calls/batch
- Fixed: now 2 calls per tx (tx + receipt parallel, block by number), concurrency=10

---

## Next steps

1. **Run `pnpm debug:evm-tx <hash>` on a known swap** to see raw log data
   - Pick a hash from Etherscan for this wallet where you know it was a Uniswap swap
   - Verify: are logs present? Is tx.to in our DEX registry or an aggregator?

2. **Expand DEX registry if needed** — add aggregator contracts (1inch, 0x, Paraswap, CoW)
   that appear as `tx.to` rather than in logs

3. **Validate WETH detection** — check if WETH address is correct and transfer parsing works

4. **Run Prisma migration** for the `chain` field:
   ```bash
   npx prisma migrate dev --name add_wallet_chain_field
   ```

5. **Wire EvmModule into app.module.ts** so EvmSyncService is injectable at runtime

---

## Key decisions made

- **Data source:** Alchemy API (free tier, no credit card) — not Liquify
- **Primary chain:** Ethereum
- **Value extraction strategy:** WETH transfer → UniswapV3 Swap event → UniswapV2 Swap event → tx.value (fallback)
- **No schema rename** (signature/mint kept as-is) — too risky to rename across 2000-line mapper
- **No breaking changes** to existing Solana path

---

## Known limitations (first version)

- Bridge tokens excluded
- Complex DeFi (staking, liquidations) classified as UNKNOWN and skipped
- Gas fee tracking simplified (gasUsed × effectiveGasPrice)
- Historical balance incomplete on light archive RPC
- Multi-chain portfolio not yet supported (per-chain only)
