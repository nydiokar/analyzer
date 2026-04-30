# EVM Port — Architecture Overview

Visual and conceptual breakdown of the system layers.

---

## Current Architecture (Solana-only)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       Layer 3: Output & API                              │
│                                                                           │
│  /wallet-hud        /wallet-pnl         /wallet-behavior  /similarity    │
│   (HUD Service)  (PnL Overview Service) (Behavior Service) (Similarity)   │
│                                                                           │
│        All consume: WalletPnlSummary, WalletBehaviorProfile              │
└─────────────────────────────────────────────────────────────────────────→┘
                                  ↑
┌─────────────────────────────────────────────────────────────────────────┐
│              Layer 2: Intelligence (Chain-Agnostic)                      │
│                                                                          │
│  ┌──────────────┐   ┌──────────────────┐   ┌──────────────────────┐    │
│  │ PnL Analysis │   │  Behavior Anal.  │   │ Similarity Engine    │    │
│  │              │   │                  │   │                      │    │
│  │ SwapAnalyzer │   │ BehaviorService  │   │ SimilarityService    │    │
│  │ + FIFO Lots  │   │ (speed, pattern) │   │ (binary & capital)   │    │
│  │              │   │                  │   │                      │    │
│  │ Input:       │   │ Input:           │   │ Input:               │    │
│  │ Swap records │   │ Swap records +   │   │ Analysis records +   │    │
│  │              │   │ PnL metrics      │   │ token balances       │    │
│  │ Output:      │   │                  │   │                      │    │
│  │ Per-token    │   │ Output:          │   │ Output:              │    │
│  │ PnL, fees    │   │ Behavior profile │   │ Similarity scores    │    │
│  └──────────────┘   └──────────────────┘   └──────────────────────┘    │
│                                                                          │
│  ℹ️  All logic is 100% chain-agnostic. Uses only:                       │
│      - Token mint IDs (any blockchain)                                   │
│      - Amounts and timestamps (universal)                                │
│      - Direction: in/out (universal)                                     │
└─────────────────────────────────────────────────────────────────────────→┘
                                  ↑
┌─────────────────────────────────────────────────────────────────────────┐
│         Layer 1: Ingestion (SOLANA-SPECIFIC = REPLACE FOR EVM)           │
│                                                                          │
│      Helius API                                                          │
│           ↓                                                              │
│    HeliusApiClient ──→ HeliusTransactionMapper ──→ SwapAnalysisInput    │
│    (Helius-specific)   (Solana logic, ~2000 lines)  (normalized schema) │
│           ↓                                              ↓               │
│    - Instruction decode         - Fee extraction      Database          │
│    - Token program parsing      - SOL balance calc.   │                │
│    - WSOL/bridge handling       - Rent reclaim        └─→ AnalysisResult│
│    - Swap heuristics            - Routing inference      (aggregated)   │
│                                                                          │
│  Exit point: SwapAnalysisInput records (Prisma)                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ id | wallet | signature | mint | amount | direction | solValue │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Post-EVM Architecture (Multi-Chain)

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Layer 3: Output & API (Unchanged)                   │
│                    (All endpoints work for any chain)                  │
└────────────────────────────────────────────────────────────────────────┘
                                  ↑
┌────────────────────────────────────────────────────────────────────────┐
│            Layer 2: Intelligence (Unchanged, Chain-Agnostic)           │
│                    (All analysis works for any chain)                  │
└────────────────────────────────────────────────────────────────────────┘
                                  ↑
┌────────────────────────────────────────────────────────────────────────┐
│   Layer 1: Ingestion (Per-Chain Implementation, Same Output Schema)    │
│                                                                        │
│  ┌──────────────────────┐        ┌──────────────────────┐            │
│  │   SOLANA Path        │        │    EVM Path          │            │
│  │  (Existing)          │        │  (New for hackathon) │            │
│  │                      │        │                      │            │
│  │ Helius API           │        │ Liquify API / RPC    │            │
│  │      ↓               │        │      ↓               │            │
│  │ HeliusApiClient      │        │ EvmApiClient (NEW)   │            │
│  │      ↓               │        │      ↓               │            │
│  │ HeliusMapper         │        │ EvmMapper (NEW)      │            │
│  │ (Solana heuristics)  │        │ (EVM heuristics)     │            │
│  │      ↓               │        │      ↓               │            │
│  └──────────────────────┘        └──────────────────────┘            │
│         ↓                               ↓                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │        SwapAnalysisInput (Identical Schema, Any Chain)       │   │
│  │  { txHash, mint, amount, direction, nativeValue, timestamp } │   │
│  └──────────────────────────────────────────────────────────────┘   │
│         ↓                                                             │
│      Database                                                        │
│      │                                                               │
│      └────→ AnalysisResult (per-token aggregates, any chain)        │
└────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Single Transaction → Full Analysis

### Example: Wallet swaps 100 USDC for 0.05 ETH on Ethereum

```
LAYER 1: INGESTION
═══════════════════════════════════════════════════════════════════

Raw EVM Data:
  Transaction 0x123abc...
    ├─ "to": 0xe592427a0aece92de3edee1f18e0157c05861564 (Uniswap V3 Router)
    ├─ Logs:
    │   ├─ Transfer: USDC 0xwalletA → 0xrouter, amount: 100000000 (100 USDC)
    │   ├─ Transfer: WETH 0xrouter → 0xwalletA, amount: 50000000000000000 (0.05 WETH)
    │   └─ Swap: ...
    └─ timestamp: 1702000000

        ↓
        
EvmTransactionMapper (NEW):
  1. Detect DEX: 0xe592427a... = Uniswap V3 ✓
  2. Parse logs: 2 transfers, 2 distinct tokens → SWAP ✓
  3. Extract value: Liquify API says 0.05 ETH ✓
  4. Create records:
     - Mint: USDC, Amount: 100, Direction: out, NativeValue: 0.05
     - Mint: WETH, Amount: 0.05, Direction: in, NativeValue: -0.05

        ↓
        
Database Insert:
  SwapAnalysisInput {
    walletAddress: "0xwalletA"
    signature: "0x123abc..."
    timestamp: 1702000000
    mint: "0xa0b86991..." (USDC)
    amount: 100
    direction: "out"
    associatedNativeValue: 0.05
    interactionType: "SWAP"
  }


LAYER 2: INTELLIGENCE
═════════════════════════════════════════════════════════════════════

SwapAnalyzer.analyze([records...], walletAddress):
  1. Group by mint:
     - USDC: [100 out @ 0.05 eth, 50 out @ 0.025 eth, ...]
     - WETH: [0.05 in @ -0.05 eth, 0.025 in @ -0.025 eth, ...]
  2. Aggregate:
     - USDC: totalOut: 150, totalSolSpent: 0.075 ETH
     - WETH: totalIn: 0.075, totalSolReceived: -0.075 ETH
  3. Pass to FIFO lot tracker:
     - USDC: 150 tokens bought @ 0.075 ETH = 0.0005 ETH/token cost basis

        ↓

BehaviorService.analyzeWalletBehavior([records...]):
  1. Calculate timing:
     - Hold duration: 5 days (from timestamps)
     - Trade frequency: 2 swaps/day average
  2. Classify:
     - speedCategory: "SWING_TRADER" (hold < 1 week)
     - exitPattern: "GRADUAL" (small sells, not all-at-once)
  3. Store: WalletBehaviorProfile { speedCategory, medianHoldTime, ... }

        ↓

SimilarityService.calculateSimilarity([wallet1, wallet2]):
  1. Fetch AnalysisResult for both wallets
  2. Compare token sets:
     - Both hold: [USDC, USDT, DAI] → overlap = 3
     - Binary similarity score: 0.75 (shared 3 of 4 unique tokens)
  3. Compare capital deployed:
     - Wallet1 USDC allocation: 40% of volume
     - Wallet2 USDC allocation: 38% of volume
     - Capital similarity: 0.95 (very similar allocation)


LAYER 3: OUTPUT
════════════════════════════════════════════════════════════════════

API /wallet-pnl/:address
  {
    "realizedPnl": 2.5,
    "unrealizedPnl": 0.8,
    "netPnl": 3.3,
    "totalVolume": 150,
    "profitableTokensCount": 3,
    ...
  }

API /wallet-behavior/:address
  {
    "behaviorType": "SWING_TRADER",
    "medianHoldTimeHours": 120,
    "flipperScore": 0.68,
    "speedCategory": "MEDIUM",
    ...
  }

API /wallet-similarity
  {
    "wallets": ["0xwalletA", "0xwalletB"],
    "binarySimilarity": 0.75,
    "capitalSimilarity": 0.95,
    ...
  }
```

---

## Key Separation Points

### The Bridge: SwapAnalysisInput Schema

```
SOLANA → Helius → HeliusMapper → SwapAnalysisInput
EVM    → Liquify/RPC → EvmMapper → SwapAnalysisInput (same schema)
```

**This is the ONLY contract between layers.**

**If SwapAnalysisInput is correct, everything downstream works.**

---

### Database Queries (Chain-Agnostic)

All downstream queries work on the normalized schema:

```sql
-- PnL Analysis
SELECT * FROM SwapAnalysisInput 
WHERE walletAddress = '0x...' AND timestamp BETWEEN ? AND ?
ORDER BY timestamp;

-- Behavior Analysis
SELECT SUM(amount), direction, timestamp
FROM SwapAnalysisInput
WHERE walletAddress = '0x...'
GROUP BY EXTRACT(DAY FROM timestamp);

-- Similarity
SELECT DISTINCT mint FROM SwapAnalysisInput WHERE walletAddress = ?
INTERSECT
SELECT DISTINCT mint FROM SwapAnalysisInput WHERE walletAddress = ?;
```

**No chain-specific SQL.** ✅

---

## Code Organization (After Port)

```
src/
├── api/
│   ├── integrations/
│   │   ├── helius.module.ts       (Solana)
│   │   ├── evm.module.ts          (EVM) ← NEW
│   │   └── ingestion-selector.ts  (NEW, routes to correct mapper)
│   ├── services/
│   │   └── (all chain-agnostic)
│   └── controllers/
│       └── (all chain-agnostic)
│
├── core/
│   ├── services/
│   │   ├── helius-sync-service.ts
│   │   ├── helius-transaction-mapper.ts
│   │   ├── evm-sync-service.ts      (NEW)
│   │   ├── evm-transaction-mapper.ts (NEW) ← CRITICAL
│   │   ├── evm-api-client.ts        (NEW)
│   │   └── pnl-analysis-service.ts  (UNCHANGED)
│   │
│   ├── analysis/
│   │   ├── swap/analyzer.ts         (UNCHANGED, parameterized stablecoins)
│   │   ├── behavior/                (UNCHANGED)
│   │   └── similarity/              (UNCHANGED)
│   │
│   └── utils/
│       └── (chain-agnostic)
│
├── config/
│   ├── constants.ts                 (update: add chain selector)
│   ├── evm-stablecoins.ts          (NEW)
│   └── evm-dex-programs.ts         (NEW)
│
├── types/
│   ├── helius-api.ts               (Solana-specific)
│   ├── evm-api.ts                  (NEW, EVM-specific)
│   └── wallet.ts                   (UNCHANGED, chain-agnostic)
│
└── prisma/
    └── schema.prisma               (rename fields: signature→txHash, etc.)
```

---

## Testing Strategy (By Layer)

### Layer 1 (Ingestion) — Unit + Integration

```typescript
// EvmTransactionMapper.spec.ts
describe('EVM Transaction Mapper', () => {
  
  // Unit tests: isolated
  it('should classify Uniswap swap correctly', () => { ... });
  it('should extract value from multi-hop route', () => { ... });
  it('should detect stablecoins by chain', () => { ... });
  
  // Integration test: real Liquify API
  it('should ingest real Ethereum wallet and produce valid SwapAnalysisInput', async () => {
    const realWallet = '0x...';
    const inputs = await mapper.mapWallet(realWallet, 'ethereum');
    expect(inputs.length).toBeGreaterThan(0);
    inputs.forEach(input => {
      expect(input.mint).toBeDefined();
      expect(input.amount).toBeGreaterThan(0);
      expect(input.associatedNativeValue).toBeDefined();
    });
  });
});
```

### Layer 2 (Intelligence) — Regression

```typescript
// Compare EVM PnL vs. known Solana baseline
it('should compute identical PnL structure for EVM and Solana', async () => {
  const solanaInputs = await fetchSolanaTestData();
  const evmInputs = await fetchEvmTestData();
  
  const solanaResult = analyzer.analyze(solanaInputs);
  const evmResult = analyzer.analyze(evmInputs);
  
  // Structure should be identical
  expect(Object.keys(solanaResult)).toEqual(Object.keys(evmResult));
  expect(typeof solanaResult.netPnl).toBe('number');
  expect(typeof evmResult.netPnl).toBe('number');
});
```

### End-to-End — Real Wallets

```typescript
// Integration test using known EVM traders
it('should produce reasonable PnL for known EVM trader', async () => {
  const wallet = '0x... (known profitable trader)';
  const pnl = await pnlService.analyzeWalletPnl(wallet);
  
  expect(pnl.netPnl).toBeGreaterThan(0);
  expect(pnl.profitableTokensCount).toBeGreaterThan(0);
  expect(pnl.realizedPnl).toBeLessThanOrEqual(pnl.netPnl);
});
```

---

## Configuration & Routing

### Feature Flag (Environment Variable)

```bash
# .env
BLOCKCHAIN_INGESTION=evm        # "solana" | "evm" | "multi"
EVM_CHAIN=ethereum              # "ethereum" | "arbitrum"
LIQUIFY_API_KEY=...
```

### Runtime Selector

```typescript
// src/api/integrations/ingestion-selector.ts
export function getIngestingService(chain: string) {
  if (chain === 'solana') {
    return heliusSyncService;
  } else if (chain === 'ethereum' || chain === 'arbitrum') {
    return evmSyncService;
  } else {
    throw new Error(`Unsupported chain: ${chain}`);
  }
}
```

---

## Backward Compatibility

### No Breaking Changes to Public API

All existing endpoints (/wallet-hud, /wallet-pnl, etc.) continue working without modification.

**New field in Wallet model (optional):**
```prisma
model Wallet {
  address String @id
  chain   String @default("solana")  // "solana" | "ethereum" | "arbitrum"
  ...
}
```

Allows storing EVM wallets alongside Solana wallets in the same system.

---

## Performance Considerations

### Ingestion (Layer 1)

**Solana:** Helius is fast (1000 txns in ~2 seconds)  
**EVM:** RPC or Liquify API? 
- Liquify: Unknown (need to test)
- Ethers.js + RPC: ~100 txns per second (depends on RPC rate limits)

**Mitigation:** Cache aggressively; batch requests; consider indexer (The Graph) for historical data.

### Intelligence (Layer 2)

**No change.** FIFO lot tracking and PnL calculation are CPU-bound, not I/O-bound.  
Expected: Same performance as Solana version.

### Database Queries (Layer 3)

**No change.** Queries are schema-identical; performance depends on indexes.  
**Ensure indexes exist:**
```sql
CREATE INDEX idx_wallet_timestamp ON SwapAnalysisInput(walletAddress, timestamp);
CREATE INDEX idx_mint ON SwapAnalysisInput(mint);
```

---

