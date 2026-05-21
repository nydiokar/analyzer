# EVM Port — Known Limitations

**Last updated:** 2026-05-22

---

## In scope (working)

- ERC-20 token transfers and swaps on Ethereum, Arbitrum, Base
- Swap classification via DEX event topic0 matching (Uniswap V2/V3, Sushi, Curve, Balancer, 0x, 1inch, Aerodrome)
- ETH value extraction: WETH direct transfer → WETH Withdrawal/Deposit → UniswapV2/V3 Swap legs → tx.value
- Token decimals: resolved from Alchemy metadata, static cache, or eth_call fallback
- PnL, behavior, and similarity analysis — unchanged, chain-agnostic
- Incremental sync via `lastSyncedBlock` (per-chain guarded)
- Up to 5000 transfers per sync (paginated via Alchemy pageKey)

---

## Known limitations

### Bridge tokens not supported
Cross-chain bridge transactions (e.g. Arbitrum Bridge, Hop, Stargate) appear as plain
ERC-20 transfers and are classified as `TRANSFER`, not `SWAP`. The native value associated
with them will be 0. No fix planned — bridges are cross-chain state and can't be resolved
from single-chain RPC.

### Complex DeFi treated as transfers
Staking deposits/withdrawals, liquidity provision (mint/burn LP tokens), lending (Aave,
Compound supply/borrow), and flash loans all produce ERC-20 transfers but are classified
as `TRANSFER` rather than their semantic type. Amounts and directions are still correct;
only the `interactionType` label is imprecise. Adding per-protocol classifiers is future work.

### Gas fee handling simplified
`feeAmount` is `gasUsed × gasPrice` in ETH. This is the initiator's gas cost only —
it does not account for gas refunds, EIP-1559 base fee burns, or protocol fees embedded
in swap slippage. It is tracked separately and does not affect `associatedSolValue` (ETH
trade value).

### ETH value = 0 for token↔stablecoin swaps
When a wallet swaps a token for USDC/USDT/DAI with no WETH leg, `associatedSolValue`
is 0. This is correct — there is no ETH flow to extract. The stablecoin side is
tagged as `SWAP_STABLE` and its amount is correctly tracked via 6-decimal parsing.

### Historical balance may be incomplete
`alchemy_getAssetTransfers` returns at most 1000 results per page. With `hardLimit=5000`
(5 pages), wallets with >5000 transfers will have their oldest history truncated. The
`hardLimit` is configurable per-call; raise it for deep-history syncs at the cost of
more RPC calls and longer runtime.

### Schema field names are Solana-flavoured
`SwapAnalysisInput.signature` stores the EVM tx hash; `.mint` stores the ERC-20 contract
address; `.associatedSolValue` stores the ETH amount. The field names were kept as-is to
avoid breaking the Solana path — they are semantically correct for EVM usage despite the
naming.

### Single-address perspective only
The mapper processes transfers from the wallet's perspective only. Internal DEX pool
accounting (LP fee collection, protocol revenue) is not tracked. Multi-wallet portfolio
aggregation is not supported — each wallet is analysed independently.

### Native ETH transfers not tracked
Only ERC-20 transfers are fetched via `alchemy_getAssetTransfers`. Plain ETH sends
(category=`external`) are excluded. A wallet that receives ETH directly (not via WETH
unwrap) will have that inflow missing from its records.
