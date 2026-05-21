# EVM Ingestion Layer

Ingests EVM wallet activity (Ethereum, Arbitrum, Base) and converts it into
`SwapAnalysisInput` records compatible with the existing Solana PnL and behavior
analysis pipeline.

---

## Architecture

```
alchemy_getAssetTransfers (2 RPC calls — toAddress + fromAddress)
        ↓
buildTransactionsFromTransfers()
  — group transfers by tx hash, synthesise ERC-20 Transfer logs
  — zero extra RPC calls
        ↓
selectTransactionsForEnrichment()
  — pre-classify using synthesised logs
  — score: outgoing swap=2 > incoming swap=1 > other=0
  — prioritise outgoing so ETH-spent (cost basis) is populated first
        ↓
enrichWithReceipts()
  — fetch eth_getTransactionReceipt for top-N txs (default 50)
  — 250 ms delay between calls (Alchemy free-tier safe)
  — replaces synthesised logs with real DEX event logs
        ↓
mapEvmTransactionsToSwapInputs()
  — net token flows per wallet address
  — classify: SWAP / SWAP_STABLE / TRANSFER
  — extract ETH value (WETH direct > WETH event > V2/V3 Swap > tx.value)
        ↓
SwapAnalysisInput[] (stored in DB, consumed by PnlAnalysisService + BehaviorService)
```

---

## Files

| File | Responsibility |
|---|---|
| `evm-api-client.ts` | RPC calls — `alchemy_getAssetTransfers`, receipts, transaction building |
| `evm-event-parser.ts` | ABI-level decoders — ERC-20 Transfer, UniswapV2 Swap, UniswapV3 Swap |
| `evm-transaction-classifier.ts` | SWAP / TRANSFER / UNKNOWN classification using SWAP_TOPICS set |
| `evm-value-extractor.ts` | ETH value extraction from WETH transfers and DEX swap events |
| `evm-transaction-mapper.ts` | Orchestrates mapper: net flows → `SwapAnalysisInput[]` |
| `evm-sync-service.ts` | NestJS service — full pipeline + DB save |

---

## Chains

| Chain | Status |
|---|---|
| Ethereum | ✅ Validated |
| Arbitrum | ⚠️ Code ready — Alchemy key needs Arbitrum enabled in dashboard |
| Base | ⚠️ Code ready — Alchemy key needs Base enabled in dashboard |

---

## Key design decisions

- **Transfer-first**: `alchemy_getAssetTransfers` gives token, amount, from/to — enough for
  classification without per-tx receipt calls. Receipts only fetched for enrichment of top-N swap txs.
- **Classifier strategy**: SWAP_TOPICS set (swap event topic0 in logs) beats tx.to DEX registry
  check — catches aggregator-routed swaps (1inch, 0x, CoW, Paraswap).
- **ETH value extraction priority**: WETH direct transfer → WETH Withdrawal → WETH Deposit →
  UniswapV2 Swap leg → UniswapV3 Swap leg → tx.value.
- **No schema changes**: `signature` field stores tx hash, `mint` stores ERC-20 contract address.
  Field names happen to be EVM-compatible as-is.
- **No breaking changes**: Solana ingestion path untouched. Chain defaults to `"solana"` everywhere
  existing code creates wallet rows.

---

## Scripts

```bash
# End-to-end demo (no DB write)
pnpm demo:evm-wallet <0x...> [ethereum|arbitrum|base] [enrichLimit=50]

# Save to DB and validate
pnpm ts-node -r tsconfig-paths/register src/scripts/evm-save-wallet.ts <0x...>

# Validate PnL analysis on saved records
pnpm ts-node -r tsconfig-paths/register src/scripts/evm-validate-pnl.ts <0x...>

# Validate behavior analysis on saved records
pnpm ts-node -r tsconfig-paths/register src/scripts/evm-validate-behavior.ts <0x...>

# Inspect a single transaction
pnpm debug:evm-tx <txHash> [chain] [walletAddress]
```

---

## Known limitations

- **Token decimals**: unknown ERC-20s default to 18 decimals. USDC (6) and USDT (6) are
  handled explicitly. Other non-18-decimal tokens need an `eth_call decimals()` lookup.
- **Multi-chain**: Arbitrum and Base paths are wired but untested end-to-end — needs
  Alchemy API key upgraded to include those networks.
