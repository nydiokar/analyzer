# EVM Port — Detailed Blocker Analysis

> **ARCHIVED — 2026-05-22.** All three blockers were resolved during implementation. Blocker 1 (classification) was solved via `SWAP_TOPICS` set (swap event topic0 in logs) — more robust than the DEX registry approach described here. Blocker 2 (value computation) used a 6-priority WETH extraction chain, not Liquify. Blocker 3 (stablecoins) was implemented exactly as described. Kept for historical reference only. See `EVM_PORT_PROGRESS.md` for what was actually built.

This document breaks down the 3 critical blockers in detail, with concrete solutions and implementation strategies.

---

## BLOCKER 1: Transaction Classification (Swap vs. Transfer)

### The Problem

**Solana:**
```
Helius API returns tx.type = "SWAP" | "TRANSFER" | "CREATE_POOL" | ...
```
Helius does the classification for us. We trust it (mostly).

**EVM:**
```
RPC / Liquify returns:
  - Transaction hash
  - "to" address (contract address)
  - Input data (calldata)
  - Transfer events (logs)
  
No native "type" field.
```

We must **infer** whether this is a swap or transfer.

---

### Why It Matters

**If we misclassify:**
- **Swap as Transfer:** Token's PnL becomes silent (shows 0 cost basis)
- **Transfer as Swap:** Creates phantom cost basis from a non-economic movement
- **Both break downstream:** Behavior analysis, similarity, all depend on accurate swap/transfer split

---

### Solution: Heuristic Classification

```typescript
function classifyEvmTransaction(tx, logs): "SWAP" | "TRANSFER" | "UNKNOWN" {
  
  // 1. DEX Detection (highest confidence)
  if (isKnownDexProgram(tx.to)) {
    // Uniswap V2/V3, SushiSwap, Curve, etc.
    return "SWAP";
  }
  
  // 2. Multi-leg Transfer Pattern (high confidence)
  const transfers = parseTransferLogs(logs);
  if (transfers.length >= 2) {
    const distinctTokens = new Set(transfers.map(t => t.token)).size;
    if (distinctTokens >= 2) {
      // Token A → Token B (possible swap)
      return "SWAP";
    }
  }
  
  // 3. Single Transfer (low confidence, but safe)
  if (transfers.length === 1) {
    return "TRANSFER";
  }
  
  // Fallback: ambiguous
  return "UNKNOWN";
}
```

---

### Implementation Steps

#### **Step 1: DEX Registry (1 hour)**

Create a whitelist of known DEX router contracts:

```typescript
// src/config/evm-dex-programs.ts
export const DEX_PROGRAMS_BY_CHAIN = {
  ethereum: {
    // Uniswap
    '0xe592427a0aece92de3edee1f18e0157c05861564': { name: 'UniswapV3Router', fee: 0.01 },
    '0x68b3465833fb72B5A828cCEBEA90d26F202D94C2': { name: 'UniswapV3SwapRouter02', fee: 0.01 },
    
    // SushiSwap
    '0xd9e1ce17f2641f24ae83637ab915310313d6f82d': { name: 'SushiSwapRouter', fee: 0.003 },
    
    // Curve
    '0x445FE580eF8d70FF569aB36e80c647af338db351': { name: 'CurveRouter', fee: 0.01 },
    
    // 0x Protocol
    '0xDef1C0ded9bAcC59751b9Ec6c1DCf37075A2C9B6': { name: '0xExchangeV4', fee: 0 },
  },
  arbitrum: {
    // Similar for Arbitrum...
  },
};

export function isDexProgram(address: string, chain: string): boolean {
  const normalized = address.toLowerCase();
  return !!DEX_PROGRAMS_BY_CHAIN[chain]?.[normalized];
}
```

**Effort:** 30 mins for each chain

---

#### **Step 2: Multi-leg Pattern Detection (2 hours)**

```typescript
// src/core/services/evm-transaction-classifier.ts
interface TransferLog {
  from: string;
  to: string;
  token: string;
  amount: string;
}

function hasMultiLegSwap(logs: TransferLog[], wallet: string): boolean {
  // Filter logs involving the wallet
  const relevantLogs = logs.filter(log => 
    log.from === wallet || log.to === wallet
  );
  
  // Count distinct tokens
  const tokens = new Set(relevantLogs.map(l => l.token));
  
  // If at least 2 distinct tokens, likely a swap
  return tokens.size >= 2;
}

function classifyTransaction(
  tx: { to: string; data: string },
  logs: TransferLog[],
  walletAddress: string,
  chain: string
): "SWAP" | "TRANSFER" | "UNKNOWN" {
  
  // High confidence: DEX program
  if (isDexProgram(tx.to, chain)) {
    return "SWAP";
  }
  
  // Medium confidence: multi-leg transfer
  if (hasMultiLegSwap(logs, walletAddress)) {
    return "SWAP";
  }
  
  // Single transfer
  if (logs.length === 1) {
    return "TRANSFER";
  }
  
  // Ambiguous
  return "UNKNOWN";
}
```

**Effort:** 1.5 hours

---

#### **Step 3: Validation (1 hour)**

Test against known EVM wallets:
- Simple swap (USDC → DAI): expect `"SWAP"`
- Token send (ETH → friend): expect `"TRANSFER"`
- Complex route (DAI → WETH → USDC): expect `"SWAP"`

```typescript
// src/core/services/evm-transaction-classifier.spec.ts
describe('EVM Transaction Classification', () => {
  it('should classify simple Uniswap swap as SWAP', () => {
    const result = classifyTransaction(
      uniswapSwapTx,
      uniswapSwapLogs,
      myWallet,
      'ethereum'
    );
    expect(result).toBe('SWAP');
  });
  
  it('should classify simple ERC20 transfer as TRANSFER', () => {
    const result = classifyTransaction(
      simpleTransferTx,
      simpleTransferLogs,
      myWallet,
      'ethereum'
    );
    expect(result).toBe('TRANSFER');
  });
});
```

---

### Risks & Mitigations

| **Risk** | **Likelihood** | **Mitigation** |
|----------|---|---|
| DEX program added after blacklist updated | Low | Monitor top 10 DEXes; quarterly updates |
| Multi-leg non-swap (e.g., airdrop + swap) | Medium | Add heuristic: check for economic value matching |
| Complex contract call not in DEX list | Medium | Fall back to "UNKNOWN" → flag for manual review |

**Recommendation:** Start conservative (only classify high-confidence DEX swaps as SWAP; rest as UNKNOWN). Expand heuristics iteratively.

---

## BLOCKER 2: Computing "associatedNativeValue" (ETH/AVAX Spent)

### The Problem

**Goal:** For each token transfer, determine "how much native currency was paid?"

**Example:**
```
Wallet swaps 100 USDC for 0.05 ETH
  → Token: USDC, Amount: -100, AssociatedNativeValue: 0.05
  → Token: ETH (implicit), Amount: +0.05, AssociatedNativeValue: -0.05 (inverse)
```

**Challenge:** EVM transactions are **multi-leg**. You need to:
1. Identify which legs are "value in" and "value out"
2. Match them (which USDC out matches the ETH in?)
3. Extract the rate

---

### Why It Matters

**Downstream impact:**
- PnL calculation: `netSolProfitLoss = totalSolReceived - totalSolSpent - fees`
- All metrics cascade from this single field

**If wrong:**
- "Swaps" have no cost basis → PnL = 0
- Behavior analysis can't compute win rate
- Similarity matches fail

---

### Solution Strategy (3 Approaches, Pick One)

#### **Approach A: Trust Liquify (Best, if available)**

**Liquify API response example:**
```json
{
  "signature": "0xabc123...",
  "transfers": [
    { "token": "0xusdc...", "amount": "100", "direction": "out", "valueInNative": 0.05 },
    { "token": "0xweth...", "amount": "0.05", "direction": "in", "valueInNative": -0.05 }
  ]
}
```

**If Liquify provides `valueInNative`:**
```typescript
// Direct extraction, no heuristics needed
const nativeValue = liquidifyResponse.transfers
  .find(t => t.token === tokenMint)?.valueInNative || 0;
```

**Effort:** ~2 hours (just parse Liquify response)  
**Risk:** Low (if Liquify is reliable)

---

#### **Approach B: DEX Event Decoding (Medium, if no Liquify)**

Parse Uniswap / SushiSwap event logs to extract amounts:

```typescript
// src/core/services/evm-value-extractor.ts
function extractValueFromUniswapV3Swap(log: Log): { amountIn: string; amountOut: string } {
  // UniswapV3 Swap event:
  // Swap(sender, amount0, amount1, sqrtPriceX96, liquidity, tick)
  
  const decoded = parseUniswapV3SwapEvent(log);
  return {
    amountIn: decoded.amount0,   // e.g., "1000000" (USDC)
    amountOut: decoded.amount1,  // e.g., "50000000000000000" (WETH, 0.05)
  };
}

function computeNativeValueFromDexLogs(
  logs: Log[],
  wallet: string,
  tokenAddress: string,
  chain: string
): number {
  const relevantLogs = logs.filter(l => isRelevantDexEvent(l, wallet, chain));
  
  let nativeValueTotal = 0;
  for (const log of relevantLogs) {
    const dexType = identifyDex(log.address);
    
    if (dexType === 'uniswap-v3') {
      const { amountIn, amountOut } = extractValueFromUniswapV3Swap(log);
      // Determine which leg is the target token
      // and sum the other leg
      nativeValueTotal += calculateNativeValue(amountIn, amountOut, tokenAddress);
    } else if (dexType === 'curve') {
      // Different event parsing for Curve
      nativeValueTotal += extractValueFromCurveSwap(log);
    } else if (dexType === 'sushiswap') {
      // SushiSwap uses Uniswap V2 events
      nativeValueTotal += extractValueFromUniswapV2Swap(log);
    }
  }
  
  return nativeValueTotal;
}
```

**Effort:** 6-8 hours  
**Risk:** Medium-High
- Different DEXes use different event signatures
- Multi-hop swaps (e.g., USDC → WETH → DAI) require aggregation
- Requires testing with real swap transactions

---

#### **Approach C: Oracle Fallback (Worst Case, Backup Only)**

If Liquify unavailable and can't parse DEX logs:

```typescript
// Fallback: Use token price at transaction time
async function computeNativeValueFromOracle(
  tokenAddress: string,
  amount: number,
  timestamp: number,
  nativeToken: string,
  chain: string
): Promise<number> {
  // Fetch historical price from Coingecko / Chainlink
  const tokenPrice = await priceOracle.getHistoricalPrice(tokenAddress, timestamp);
  const nativePrice = await priceOracle.getHistoricalPrice(nativeToken, timestamp);
  
  const usdValue = amount * tokenPrice;
  const nativeValue = usdValue / nativePrice;
  
  return nativeValue;
}
```

**Effort:** 2-3 hours  
**Risk:** High
- Stale price data (price may have moved between blocks)
- No account for actual swap execution rate
- Can be 5-20% off from reality

---

### Recommendation

**Priority order:**
1. **First choice:** Liquify API with `valueInNative` → **2 hours, low risk**
2. **If Liquify limited:** DEX event parsing for Uniswap V3 + Curve → **8 hours, medium risk**
3. **Last resort:** Oracle fallback → **3 hours, high risk, use only for non-critical paths**

**Start with Approach A (Liquify). If Liquify doesn't provide the field, spike Approach B immediately.**

---

## BLOCKER 3: Stablecoin Registry (Hardcoded Mints)

### The Problem

**Solana (current):**
```typescript
const stablecoins = new Map<string, { name: string, decimals: number }>([
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { name: 'USDC', decimals: 6 }],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { name: 'USDT', decimals: 6 }],
  ['USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', { name: 'USD1', decimals: 6 }],
]);
```

**EVM problem:**
- Ethereum USDC ≠ Solana USDC (different contract address, different deployments)
- Must handle per-chain stablecoin mappings

**Examples:**
```
Ethereum:
  USDC: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  USDT: 0xdAC17F958D2ee523a2206206994597C13D831ec7
  DAI:  0x6B175474E89094C44Da98b954EedeAC495271d0F
  
Arbitrum:
  USDC:     0xFF970A61A04b1cA14834A43f5dE4533eBDDB5F86
  USDT:     0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9
  USDC.e:   0xA7D30AA099Bb7463087CE306d4e53Dba66EB19d8 (⚠️ bridged)
  DAI:      0xDA10009CBD5D07dd0CeCc66161FC93D7c9000da1
```

---

### Why It Matters

**SwapAnalyzer logic (analyzer.ts:79-90):**
```typescript
for (const input of swapInputs) {
  const isStablecoin = stablecoins.has(input.mint);
  
  if (isStablecoin) {
    // Special handling: track SOL flows in/out of stable positions
    const flow = stablecoinFlows.get(input.mint)!;
    flow.totalSolSpent += solValue;  // etc.
  }
}
```

**If we don't identify stablecoins correctly:**
- USDC/USDT swaps treated like risky token swaps
- "Stable flows" metric becomes wrong
- Wallet behavior (profit consistency) miscalculated

---

### Solution: Parameterize by Chain

**Single fix: ~30 minutes**

```typescript
// src/config/evm-stablecoins.ts
export const STABLECOINS_BY_CHAIN = {
  solana: {
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { name: 'USDC', decimals: 6 },
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { name: 'USDT', decimals: 6 },
    'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB': { name: 'USD1', decimals: 6 },
  },
  ethereum: {
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USDC', decimals: 6 },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { name: 'USDT', decimals: 6 },
    '0x6b175474e89094c44da98b954eedeac495271d0f': { name: 'DAI', decimals: 18 },
  },
  arbitrum: {
    '0xff970a61a04b1ca14834a43f5de4533ebddb5f86': { name: 'USDC', decimals: 6 },
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': { name: 'USDT', decimals: 6 },
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': { name: 'DAI', decimals: 18 },
  },
};

export function isStablecoin(mint: string, chain: string): boolean {
  const normalized = mint.toLowerCase();
  return !!STABLECOINS_BY_CHAIN[chain]?.[normalized];
}
```

**Update analyzer to use it:**
```typescript
// src/core/analysis/swap/analyzer.ts
import { isStablecoin, STABLECOINS_BY_CHAIN } from '@/config/evm-stablecoins';

export class SwapAnalyzer {
  constructor(private chain: string) {}
  
  analyze(swapInputs: SwapAnalysisInput[], walletAddress: string): ... {
    for (const input of swapInputs) {
      const isStable = isStablecoin(input.mint, this.chain);
      // ... rest of logic
    }
  }
}
```

**Effort:** 30 mins  
**Risk:** Low (straightforward refactor)

---

### Nice-to-Have: Stablecoin Hierarchy

If supporting bridged / wrapped stablecoins (USDC.e on Arbitrum):

```typescript
// Group USDC variants as "equivalent"
export const STABLECOIN_GROUPS = {
  usdc: [
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // Ethereum USDC
    '0xff970a61a04b1ca14834a43f5de4533ebddb5f86', // Arbitrum USDC
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Solana USDC (if wrapped)
  ],
  usdc_e: [
    '0xA7D30AA099Bb7463087CE306d4e53Dba66EB19d8', // Arbitrum USDC.e
  ],
};
```

**Not needed for MVP.** Can add later if bridge tokens become a problem.

---

## Summary: Blocker Resolution Path

| **Blocker** | **Best Solution** | **Effort** | **Risk** | **Start Day** |
|-------------|-------------------|-----------|---------|---------------|
| **Classification** | DEX + multi-leg heuristics | 4-6h | Medium | Day 2 |
| **Value Computation** | Liquify API (or DEX logs fallback) | 2-8h | Low-High | Day 2 |
| **Stablecoins** | Parameterize by chain | 30min | Low | Day 1 |

**Parallel work possible:** Classification + Stablecoins on Day 1 while awaiting Liquify API response.

---

## Validation Checklist

Before declaring "blockers resolved," test against these real wallets:

```
Ethereum:
  - 0x1234... (known swing trader): multiple swaps, different tokens
  - 0x5678... (known holder): mostly buys, no complex DeFi
  
Arbitrum:
  - 0x9abc... (bot-like activity): many small swaps
  
Expected: PnL matches exchange API or known ground truth
```

**Timeline:** By end of Day 4, should have 3-5 real wallets validated.

