# Feasibility Assessment: Sova Intel → EVM Port
## Liquify Hackathon Viability Study

**Assessment Date:** 2026-04-12  
**Status:** REVERSE ENGINEERING & COMPATIBILITY VALIDATION  
**Scope:** Layer separation analysis, not implementation planning

---

## Executive Summary

### Go / No-Go Decision: **CONDITIONAL GO**

**Hypothesis Verdict:** ✅ **CONFIRMED** — Ingestion layer IS separable from intelligence layer.

The system exhibits **clean architectural boundaries**:
- **Layer 1 (Ingestion):** Solana-specific, replaceable
- **Layer 2 (Intelligence):** Chain-agnostic, stable
- **Layer 3 (Output):** Format-agnostic, reusable

**BUT** — Success depends on **normalized schema fidelity**. EVM data must be mapped to the exact same `SwapAnalysisInput` record shape, or intelligence downstream breaks.

---

## 1. SEPARATION MAP

### Layer 1: Ingestion (REPLACE)

**Current Solana Flow:**
```
Helius API → HeliusApiClient → HeliusTransactionMapper → SwapAnalysisInput (normalized)
```

**What exists:**
- `HeliusApiClient` (src/core/services/helius-api-client.ts) — API wrapper for Helius
- `HeliusTransaction` type (src/types/helius-api.ts) — raw API response shape
- `HeliusTransactionMapper` (src/core/services/helius-transaction-mapper.ts) — ~2000 lines, maps raw txns to normalized records
- `HeliusSyncService` (src/core/services/helius-sync-service.ts) — orchestrates fetching & saving

**Solana-specific dependencies in this layer:**
- Instruction parsing (SPL Token Program, DeFi aggregators)
- SOL balance tracking (native account lamports)
- Stablecoin identification (USDC, USDT, USD1 mints hardcoded)
- Transaction type inference from Helius `type` field (SWAP, TRANSFER, CREATE_POOL, etc.)
- Rent reclaim heuristics (SOL returned after token burns)
- WSOL/bridge token handling
- Transaction signature validation (base58)

**Entry point:** `HeliusSyncService.syncWalletData(walletAddress, options)` → saves `SwapAnalysisInput` rows to DB

**Exit point:** `SwapAnalysisInput` Prisma model (schema.prisma:84-108)

---

### Layer 2: Intelligence (KEEP UNCHANGED)

**PnL Analysis Pipeline:**
```
SwapAnalysisInput records (DB) → SwapAnalyzer.analyze() → OnChainAnalysisResult[]
                                                          ↓
                              WalletPnlSummary + AdvancedTradeStats
```

**Core components:**
- `SwapAnalyzer` (src/core/analysis/swap/analyzer.ts) — pure aggregation logic
  - Groups by token mint
  - Calculates in/out volumes
  - Tracks fees
  - Hands off to FIFO lot tracker
- `FifoLotTracker` (src/core/analysis/swap/fifo-lot-tracker.ts) — cost-basis tracking
- `AdvancedStatsAnalyzer` (src/core/analysis/stats/analyzer.ts) — win rate, median PnL, etc.

**Behavior Analysis Pipeline:**
```
SwapAnalysisInput records + AnalysisResult records → BehaviorService.analyzeWalletBehavior()
                                                     ↓
                              WalletBehaviorProfile (speed, hold times, patterns)
```

**Core components:**
- `BehaviorService` (src/api/services/behavior.service.ts) — orchestrator
- Original `BehaviorService` (src/core/analysis/behavior/behavior-service.ts) — computation

**Similarity Analysis Pipeline:**
```
AnalysisResult records (by wallet) → SimilarityService.calculateWalletSimilarityFromTransactions()
                                     ↓
                              CombinedSimilarityResult (binary & capital similarity)
```

**All intelligence depends ONLY on:**
- Normalized `SwapAnalysisInput` schema (signature, mint, amount, direction, associatedSolValue, timestamp)
- Normalized `AnalysisResult` schema (per-token aggregates)
- Token balance snapshots (mint, amount, decimals)

**Zero Solana-specific logic** downstream.

---

### Layer 3: Output (REUSE)

**API endpoints/DTOs:**
- `/api/wallet-hud/:address` (src/api/controllers) — uses `WalletHudService`
- `/api/wallet-behavior/:address` — uses `BehaviorService`
- `/api/wallet-similarity` — uses `SimilarityApiService`
- `/api/wallet-pnl/:address` — uses `PnlAnalysisService`

All consume normalized outputs from Layer 2. **No changes needed.**

---

## 2. VALIDATE SCHEMA STABILITY

### SwapAnalysisInput — The Bridge Model

**Current Prisma schema (schema.prisma:84-108):**

```prisma
model SwapAnalysisInput {
  id                  Int       @id @default(autoincrement())
  walletAddress       String
  signature           String
  timestamp           Int
  mint                String
  amount              Float
  direction           String    // "in" | "out"
  associatedSolValue  Float
  associatedUsdcValue Float?
  interactionType     String    // "SWAP" | "TRANSFER" | "UNKNOWN" | etc.
  feeAmount           Float?
  feePercentage       Float?
  solPriceUsd         Float?    // enrichment: SOL/USD at time of tx
  usdValue            Float?    // enrichment: amount * (associatedSolValue or USDC) * solPriceUsd
  tokenPriceUsd       Float?    // enrichment: usdValue / amount
  marketCapUsd        Float?    // enrichment: market cap at time of tx
  mcapBucket          String?   // enrichment: "nano" | "micro" | etc.
  enrichedAt          DateTime?
  
  @@unique([signature, mint, direction, amount], name: "signature_mint_direction_amount")
  @@index([walletAddress, timestamp])
  @@index([mint])
}
```

**Is this schema chain-agnostic?**

✅ **YES** — The schema itself is purely **economic**, not chain-specific:
- `mint` → any token address (SPL → ERC-20)
- `amount` → normalized (decimals applied downstream)
- `associatedSolValue` → MISNAMED but could be "associatedNativeValue" (ETH, AVAX, etc.)
- `direction` → universal (in/out)
- `timestamp` → Unix seconds (chain-independent)
- `signature` → transaction ID (chain-independent if renamed)

⚠️ **BUT** — Field names are Solana-centric:
- `signature` → should be `txHash` or `transactionId` (EVM uses 0x-prefixed hex)
- `associatedSolValue` → assumes SOL is the native chain token
- `mint` → SPL terminology (ERC-20 uses `tokenAddress`)

**Downstream impact of field mismatch:**

The schema is **not immutable**. Code using these fields:

**SwapAnalyzer.analyze() (src/core/analysis/swap/analyzer.ts:36):**
```typescript
// This is all that touches SwapAnalysisInput fields:
for (const input of swapInputs) {
  const splMint = input.mint;                    // ← only needs token ID
  const solValueToConsider = input.associatedSolValue;  // ← only needs value
  const tokenAmount = Math.abs(input.amount);   // ← only needs amount
  const timestamp = input.timestamp;             // ← only needs time
  const direction = input.direction;             // ← only needs "in" | "out"
}
```

**Verdict:** The intelligence layer is **functionally chain-agnostic**. Field names don't matter, only semantics. Renaming is a **clean refactor** (10-20 mins search/replace).

---

## 3. TRACE INTELLIGENCE DEPENDENCIES

### PnL Analysis — Dependency Audit

**SwapAnalyzer inputs (src/core/analysis/swap/analyzer.ts:36):**
- `swapInputs: SwapAnalysisInput[]`
- `walletAddress: string`
- `solPriceUsd?: number` (optional, for USDC→SOL conversion)

**Assumptions checked:**
- ✅ No Solana RPC calls
- ✅ No instruction decoding
- ✅ No SPL Token Program knowledge
- ✅ No SOL balance special handling
- ❌ **HARDCODED stablecoins:** Lines 10-14
  ```typescript
  const stablecoins = new Map<string, { name: string, decimals: number }>([
    ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { name: 'USDC', decimals: 6 }],
    ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { name: 'USDT', decimals: 6 }],
    ['USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB', { name: 'USD1', decimals: 6 }],
  ]);
  ```
  **EVM impact:** Ethereum USDC, USDT are different addresses. Must parameterize this.

**FifoLotTracker inputs (src/core/analysis/swap/fifo-lot-tracker.ts):**
- Token amounts, timestamps, direction
- ✅ Zero blockchain assumptions

**AdvancedStatsAnalyzer inputs (src/core/analysis/stats/analyzer.ts):**
- PnL values, trade counts, timestamps
- ✅ Zero blockchain assumptions

---

### Behavior Analysis — Dependency Audit

**BehaviorService.analyzeWalletBehavior() (src/api/services/behavior.service.ts:22):**

Requires:
- `swapInputs: SwapAnalysisInput[]` (same schema)
- `pnlMap?: Map<string, { pnl: number; capital: number }>` (derived from PnL analysis)

**Hardcoded chain assumptions:**
- ✅ None found in behavior logic
- ✅ Only uses timing + volume metrics

**Trading style classification (src/core/analysis/behavior/behavior-service.ts):**
- HODLER, MOMENTUM, SCALPER, DAY_TRADER, SWING_TRADER, SNIPER, etc.
- ✅ Based only on hold times + trade frequency
- ✅ Zero blockchain specificity

---

### Similarity Analysis — Dependency Audit

**SimilarityService.calculateWalletSimilarityFromTransactions() (src/api/services/similarity.service.ts:24):**

Requires:
- Transaction data (tokens held in common, volumes)
- Balance snapshots

**Hardcoded chain assumptions:**
- ✅ None. Compares mint→mint overlap (any chain)

---

### Wallet Balance Fetching — Dependency Audit

**WalletBalanceService (src/core/services/wallet-balance-service.ts):**
- Calls `HeliusApiClient.getTokenAccountsByOwnerV2()` (Helius-specific)
- Returns `WalletBalance` (token mint + amount + decimals)

**Usage downstream:**
- `PnlAnalysisService.analyzeWalletPnl()` optionally fetches live balances
- `SimilarityService` uses balances for portfolio overlap

**EVM impact:**
- Balance fetching is **modular**. Can be swapped for EVM provider (Liquify or Ethers.js)
- Return type `WalletBalance` is chain-agnostic (just mint, amount, decimals)

---

## 4. DEFINE EVM MAPPING REQUIREMENTS

### What Must Be Reconstructed from EVM Data

**Source:** Liquify API or standard EVM RPC (eth_getLogs, eth_getTransactionByHash)

**Target:** `SwapAnalysisInput` record

| **Field** | **Current (Solana)** | **EVM Equivalent** | **Mapping Complexity** |
|-----------|----------------------|-------------------|----------------------|
| `signature` | Base58 tx hash | 0x hex transaction hash | ✅ LOW — direct rename |
| `timestamp` | Helius provides | Block timestamp from RPC | ✅ LOW — RPC call |
| `mint` | SPL token address | ERC-20 contract address | ✅ LOW — direct |
| `amount` | Token amount (adjusted for decimals) | ERC-20 transfer `amount` (raw) | ✅ LOW — call `decimals()` if needed |
| `direction` | "in" \| "out" per wallet | ERC-20 Transfer event: src == wallet → "in", dst == wallet → "out" | ✅ LOW — log direction detection |
| `associatedSolValue` | Derived from swap routing heuristics | ✅ **BLOCKER** — see below | ⚠️ MEDIUM/HIGH |
| `associatedUsdcValue` | Optional USDC leg | Price oracle lookup or Liquify's `swapValue` field | ⚠️ MEDIUM |
| `interactionType` | "SWAP", "TRANSFER", "CREATE_POOL", etc. | ❌ **BLOCKER** — see below | ⚠️ MEDIUM/HIGH |
| `feeAmount` | Extracted from fee fields | Transaction gas cost in native token | ⚠️ MEDIUM |

---

### **BLOCKER 1: Determining "Swap" vs "Transfer"**

**Current approach (Helius):**
- Helius provides `type` field: "SWAP", "TRANSFER", "CREATE_POOL", etc.
- Mapper uses this to classify heuristics

**EVM approach:**
- **No native classification.** Must infer from:
  1. **Multi-leg transfers** → likely a swap
     - Token A → AMM → Token B (3 legs minimum)
  2. **DEX program interaction** → swap
     - Uniswap, SushiSwap, Curve, etc. (check `to` address)
  3. **Single token transfer** → transfer
  4. **Complex DeFi** → ambiguous (bridges, staking, liquidations)

**Liquify advantage:** If Liquify returns a `swapValue` field, this is solved. If not, **manual classification logic required** (~200 lines of event parsing).

---

### **BLOCKER 2: Computing "associatedSolValue" (Native Token Value)**

**Current Solana heuristics (helius-transaction-mapper.ts:150+):**

The mapper applies ~1000 lines of logic to infer "how much SOL was paid for this token?" across:
- **Simple swaps:** Token ↔ WSOL/SOL (direct)
- **Routed swaps:** Token → Intermediary → SOL (multi-hop)
- **Stablecoin routing:** Token → USDC → SOL (identify stable legs)
- **WSOL unwraps:** WSOL → SOL (rent reclaim)
- **Edge cases:** Burns, airdrops, complex DeFi

**EVM equivalent challenge:**

EVM offers:
1. **DEX primitives:** Uniswap V3 swaps log `amount0`, `amount1`, fees
2. **Liquify API:** If available, provides value in native token or USD
3. **Oracle fallback:** Coingecko, on-chain (Chainlink), DEX spot price

**Mapping strategy:**
```
EVM Transaction
  ├─ If Liquify provides value → use directly ✅ EASY
  ├─ If DEX swap logs present → aggregate leg values ✅ MEDIUM
  └─ Else fall back to price oracle ⚠️ MEDIUM (risk: stale prices)
```

**Critical difference from Solana:**
- Solana: Transaction mapper does the math (heuristics are free, Helius gives raw data)
- EVM: Must either trust Liquify's pre-computed value OR call external price oracles

---

### **BLOCKER 3: Stablecoin Identification (Hardcoded Mints)**

**Current code (analyzer.ts:10):**
```typescript
const stablecoins = new Map<string, { name: string, decimals: number }>([
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { name: 'USDC', decimals: 6 }],
  ...
]);
```

**EVM impact:**
- Ethereum USDC ≠ Solana USDC (different addresses, deployments)
- Must parameterize by chain
- Solution: **Create stablecoin registry per chain**
  ```typescript
  const stablecoinsByChain = {
    solana: { ...existing... },
    ethereum: {
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USDC', decimals: 6 },
      ...
    },
  };
  ```

**Effort:** 10 mins (add 3-4 EVM stablecoin addresses)

---

## 5. IDENTIFY BREAKPOINTS

### Critical Mismatch Points

| **Layer** | **Component** | **Issue** | **Severity** | **Resolution** |
|-----------|---------------|----------|--------------|----------------|
| **Layer 1** | HeliusApiClient | Solana-specific RPC wrapper | 🔴 HIGH | Replace with Liquify or Web3 provider |
| **Layer 1** | HeliusTransactionMapper | 2000 lines of Solana heuristics | 🟠 MEDIUM-HIGH | Rewrite for EVM logs + Liquify value |
| **Layer 1** | Swap detection logic | No native "swap" classification on EVM | 🟠 MEDIUM | Heuristics: multi-leg detection, DEX detection |
| **Layer 1** | associatedSolValue derivation | Complex multi-hop routing heuristics | 🟠 MEDIUM | Rely on Liquify or use oracle fallback |
| **Layer 1** | Stablecoin mints | Hardcoded Solana addresses | 🟢 LOW | Parameterize by chain |
| **Layer 1** | Fee extraction | Helius provides fee fields explicitly | 🟡 LOW-MEDIUM | Use gas cost from transaction or Liquify |
| **Layer 1** | Rent reclaim logic | Solana-specific (system SOL returns) | 🟢 LOW | Not applicable to EVM (no rent) — simplify |
| **Layer 2+** | SwapAnalysisInput schema | Field names hardcoded (mint, signature) | 🟡 LOW | Search-replace refactor (NOT breaking) |
| **Layer 2+** | Stablecoin registry | Hardcoded in analyzer.ts | 🟢 LOW | Parameterize by chain |
| **Layer 3** | API output | All DTOs are chain-agnostic | ✅ NONE | No changes needed |

---

## 6. EFFORT ESTIMATE

### A. Schema Refactor (Foundation)

**Goal:** Make `SwapAnalysisInput` generic (support both Solana and EVM)

| **Task** | **Effort** | **Risk** |
|----------|-----------|---------|
| Rename `signature` → `txHash` | 20 min | 🟢 LOW — grep + replace |
| Rename `mint` → `tokenAddress` | 30 min | 🟢 LOW — grep + replace |
| Rename `associatedSolValue` → `associatedNativeValue` | 30 min | 🟢 LOW — grep + replace |
| Update Prisma schema + generate client | 10 min | 🟡 MEDIUM — migrations required |
| **Subtotal** | **1.5 hours** | |

---

### B. Layer 1: Ingestion Replacement (NEW)

**Goal:** Ingest EVM data and produce identical `SwapAnalysisInput` records

| **Task** | **Effort** | **Approach** | **Risk** |
|----------|-----------|-------------|---------|
| **EVM data fetching** | 4-6 hours | Create `EvmApiClient` (Liquify or ethers.js) | 🟠 MEDIUM |
| **Transaction decoding** | 6-8 hours | Parse logs → `Transfer` events | 🟡 MEDIUM-HIGH |
| **Swap classification** | 4-6 hours | Heuristics: multi-leg, DEX detection | 🟠 HIGH |
| **Value computation** | 6-10 hours | Liquify field OR multi-oracle fallback | 🟠 HIGH |
| **Fee extraction** | 2-3 hours | Use tx gas cost or Liquify field | 🟢 LOW-MEDIUM |
| **Stablecoin registry** | 1 hour | Parameterize by chain | 🟢 LOW |
| **Integration into HeliusSyncService** | 3-4 hours | Inject EVM mapper as alternative | 🟡 MEDIUM |
| **Testing + edge cases** | 8-12 hours | Unit tests, integration tests, real wallet data | 🟠 HIGH |
| **Subtotal** | **34-50 hours** | | |

---

### C. Layer 2: Intelligence Layer (NO CHANGES)

**Goal:** Verify existing logic works with EVM-normalized data

| **Task** | **Effort** | **Notes** |
|----------|-----------|----------|
| Code review + stablecoin parameterization | 2 hours | Mostly grep + parameterize |
| Integration testing (PnL, behavior, similarity) | 4 hours | Ensure no hardcoded assumptions |
| **Subtotal** | **6 hours** | Minimal risk |

---

### D. Layer 3: Output (NO CHANGES)

**Goal:** Verify API endpoints work unchanged

| **Task** | **Effort** |
|----------|-----------|
| No code changes required | 0 hours |
| Integration test (hit endpoints with EVM data) | 2 hours |

---

### **TOTAL EFFORT ESTIMATE**

```
Schema refactor:        1.5 hours
Layer 1 (new ingestion): 34-50 hours
Layer 2 (validation):    6 hours
Layer 3 (testing):       2 hours
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL:                 43.5-59.5 hours

= 5-7 dev days (assuming 8h/day focus)
```

---

### **Effort Breakdown by Category**

| **Category** | **Effort** | **Priority** |
|--------------|-----------|--------------|
| **Foundation (Blockers)** | ~25-35 hours | 🔴 CRITICAL |
| • Swap detection heuristics | 4-6 hours | |
| • Value computation (Liquify/Oracle) | 6-10 hours | |
| • Transaction decoding + event parsing | 6-8 hours | |
| • Integration + error handling | 3-5 hours | |
| | | |
| **Extensions (Quality)** | ~8-12 hours | 🟡 IMPORTANT |
| • Comprehensive testing | 8-12 hours | |
| | | |
| **Cleanup (Polish)** | ~10-12 hours | 🟢 NICE-TO-HAVE |
| • Schema refactor + search-replace | 1.5 hours | |
| • Documentation | 3 hours | |
| • Optimization + caching | 5-7 hours | |

---

## 7. RISK LIST

### Critical Risks

| **Risk** | **Impact** | **Mitigation** |
|----------|-----------|----------------|
| **Value computation inaccuracy** | PnL metrics off by 5-20% | Validate against Liquify + multiple oracles; test real wallets |
| **Swap vs Transfer classification failure** | Silent data loss (treats swaps as transfers) | Start conservative (require DEX program detection); add anomaly alerts |
| **Multi-chain bridge handling** | Double-counting tokens across chains | Exclude bridge tokens in first version; document limitation |
| **Gas fee treatment** | PnL inflated/deflated | Decide: include gas in cost basis? Update docs upfront |
| **Historical balance unavailable** | Unrealized PnL unreliable | Warn users; skip balance enrichment if unavailable |

### Medium Risks

| **Risk** | **Impact** | **Mitigation** |
|----------|-----------|----------------|
| **Liquify API reliability** | Service outage → no ingestion | Build fallback (ethers.js + oracle); implement circuit breaker |
| **Oracle price staleness** | 1-5% PnL error during volatile markets | Use time-weighted averages; cap staleness (>2h = skip) |
| **Stablecoin mint parity issues** | USDC.e vs USDC detected separately | Normalize before storage; add stablecoin hierarchy |
| **Gas tracking complexity** | Unmaintainable heuristics | Document decision (include/exclude gas); keep simple |

### Low Risks

| **Risk** | **Impact** | **Mitigation** |
|----------|-----------|----------------|
| Schema field renames | Code breaks (grep fixes) | Rename carefully; run full test suite after |
| Behavior analysis edge cases | Minor metrics drift | Run side-by-side comparison (EVM vs cached Solana data) |
| New wallet balance API latency | Slightly slower UI | Cache aggressively; prefetch |

---

## 8. GO / NO-GO DECISION

### Viability Matrix

| **Aspect** | **Status** | **Rationale** |
|-----------|-----------|--------------|
| **Layer separation** | ✅ CLEAN | Ingestion perfectly isolated; intelligence untouched |
| **Schema compatibility** | ✅ YES | Minor renames, functionally equivalent |
| **Intelligence portability** | ✅ YES | Zero blockchain assumptions downstream |
| **EVM data availability** | 🟡 DEPENDS | Liquify API? Or fall back to RPC logs + oracle? |
| **Swap classification** | 🟡 DOABLE | Heuristics exist, not trivial but solvable |
| **Value computation** | 🟡 DEPENDS | Liquify's `swapValue` makes it easy; oracle fallback is backup |
| **Testing strategy** | ✅ YES | Can validate against real EVM wallets |
| **Timeline (hackathon)** | 🟡 TIGHT | 5-7 days is tight but achievable with focus on core path |

### **Final Verdict**

**✅ GO** — Port is **structurally viable**.

**Conditions for success:**
1. ✅ **Liquify API** provides swap value (most likely) → value computation is easy
2. ✅ **Clear scope boundaries** → focus on swap detection + value mapping, not perfection
3. ✅ **Real wallet testing** → validate against known EVM traders early
4. ⚠️ **Accept limitations** → first version won't match Solana's sophistication; document trade-offs

**If Liquify is unavailable:**
- Fallback strategy: Use Uniswap V3 event decoding + CoinGecko oracle
- Effort increases to **60-70 hours** (decode complex swap routes)
- Still achievable but riskier

---

## 9. IMPLEMENTATION ROADMAP (If Proceeding)

### **Phase 1: Foundation (Days 1-2, ~12 hours)**

1. **Liquify API exploration** (2h)
   - Does Liquify provide pre-computed swap values?
   - Which EVM chain priority? (Ethereum? Arbitrum?)

2. **Schema refactor** (1.5h)
   - Rename fields in schema.prisma
   - Generate Prisma client
   - Run search-replace across codebase

3. **EvmApiClient skeleton** (4h)
   - Interface to Liquify or ethers.js
   - Get transactions for a wallet
   - Return raw event data

4. **Stablecoin registry** (1h)
   - Parameterize by chain
   - Add Ethereum USDC, USDT

5. **Integration hooks** (3.5h)
   - Modify HeliusSyncService to accept EVM mapper
   - Create feature flag (INGESTION_TYPE=solana|evm)

---

### **Phase 2: Core Mapper (Days 2-4, ~25 hours)**

1. **EVM Transaction Mapper** (6h)
   - Parse Transfer event logs
   - Infer direction (to, from wallet)
   - Group multi-leg swaps

2. **Swap detection heuristics** (5h)
   - Identify DEX programs
   - Multi-leg pattern matching
   - Transfer vs. swap classification

3. **Value computation** (8h)
   - If Liquify: extract and normalize
   - If fallback: aggregate DEX logs + price lookups
   - Handle multiple stablecoin legs

4. **Fee extraction** (3h)
   - Gas cost in native token
   - Or Liquify-provided fee field
   - Normalize to SwapAnalysisInput

5. **Error handling + edge cases** (3h)
   - Failed transactions
   - Partial fills
   - Bridge transfers

---

### **Phase 3: Validation + Testing (Days 4-6, ~15 hours)**

1. **Unit tests** (4h)
   - Mapper logic in isolation
   - Known test cases (simple swap, complex route, transfer)

2. **Integration testing** (6h)
   - End-to-end: EVM wallet → SwapAnalysisInput → PnL analysis
   - Run against known EVM traders
   - Compare output shape vs. Solana data

3. **Stablecoin/oracle validation** (3h)
   - Verify price lookups
   - Test stablecoin pair handling

4. **Documentation** (2h)
   - EVM mapper limitations
   - Supported chains, unsupported patterns

---

### **Phase 4: Polish (Days 6-7, ~10 hours)**

1. Optimization (gas lookups, caching)
2. Code cleanup
3. Final integration test
4. Presentation

---

## 10. KEY UNKNOWNS (To Resolve Before Starting)

| **Question** | **Impact** | **How to resolve** |
|--------------|-----------|-------------------|
| Does Liquify provide `swapValue` in USD or native token? | 🔴 CRITICAL | Check Liquify docs or test API |
| Which EVM chain(s) for hackathon? | 🟡 IMPORTANT | Clarify scope; may affect priority |
| Gas fee treatment policy? | 🟡 IMPORTANT | Decide: include in cost basis, or separate? |
| Fallback if Liquify unavailable? | 🟡 IMPORTANT | Plan B: ethers.js + Coingecko? |
| Do we need multi-chain support day 1? | 🟡 IMPORTANT | Start with 1 chain; generalize later? |

---

## 11. COMPARISON: Current State vs. EVM State

### Database Schema Evolution

| **Model** | **Current (Solana)** | **EVM Era** | **Breaking?** |
|-----------|----------------------|------------|--------------|
| SwapAnalysisInput | `signature` (base58) | `txHash` (0x hex) | No (rename only) |
| SwapAnalysisInput | `mint` (SPL) | `tokenAddress` (ERC-20) | No (rename only) |
| HeliusTransactionCache | Cache by signature | Cache by txHash | No (conditional) |
| Wallet | `classification` (Solana) | Extend with `chain` field | No (additive) |

### Service Architecture

```
Current (Solana):
  HeliusSyncService
    ├─ HeliusApiClient (Helius-specific)
    ├─ HeliusTransactionMapper (Solana logic)
    └─ DatabaseService (writes SwapAnalysisInput)

EVM Era (Multi-Chain):
  SyncService (polymorphic)
    ├─ EvmApiClient / HeliusApiClient (chain selector)
    ├─ EvmTransactionMapper / HeliusTransactionMapper (chain selector)
    └─ DatabaseService (same writes)
```

---

## Conclusion

**The Sova Intel system is architecturally sound for EVM porting.** The boundary between chain-specific ingestion and chain-agnostic intelligence is **clean and well-defined**. 

**Success depends on:**
1. ✅ Tight integration with Liquify API (or similar data source)
2. ✅ Pragmatic approach to swap detection (good enough, not perfect)
3. ✅ Clear acceptance of first-version limitations
4. ⚠️ Early real-wallet validation

**Effort is realistic for a hackathon: 5-7 focused dev days**, provided Liquify delivers on value computation and clear scope boundaries are maintained.

---

## Appendix A: Files to Modify

### Core refactors:

1. **prisma/schema.prisma** — Rename fields (10 min)
2. **src/core/services/helius-sync-service.ts** — Add EVM mapper selector (2h)
3. **src/core/services/helius-transaction-mapper.ts** → **src/core/services/evm-transaction-mapper.ts** (NEW, 20-30h)
4. **src/core/analysis/swap/analyzer.ts** — Parameterize stablecoins (30 min)
5. **src/api/integrations/helius.module.ts** — Add EvmModule conditional (1h)

### New files:

1. **src/api/integrations/evm.module.ts** — NestJS module for EVM
2. **src/core/services/evm-api-client.ts** — Liquify/RPC wrapper
3. **src/types/evm-api.ts** — EVM type definitions
4. **src/config/evm-constants.ts** — Chain-specific configs

### Testing:

1. **src/core/services/evm-transaction-mapper.spec.ts** (NEW)
2. **src/core/analysis/swap/analyzer.spec.ts** — Update for parameterized stablecoins
3. Integration tests (NEW)

---

## Appendix B: Known Limitations (First Version)

1. **Bridge tokens:** Not supported (would require cross-chain tracking)
2. **Complex DeFi:** Liquidations, staking, yield strategies treated as transfers
3. **MEV sandwich attacks:** Not distinguishable from normal swaps
4. **Historical balance unavailable:** If chain doesn't support archive RPC, unrealized PnL may be inaccurate
5. **Multi-chain portfolio:** Assumes single chain; similarity analysis per-chain only
6. **Gas fee attribution:** Simplified (all gas to initiating transaction, not per-leg)

---

## Appendix C: Success Metrics (Hackathon Submission)

**Minimal viability:**
- ✅ Ingest 1 EVM wallet (Ethereum or Arbitrum)
- ✅ Compute PnL identical to Solana flow
- ✅ Display on dashboard without errors

**Nice-to-have:**
- ✅ Multi-chain support (Ethereum + Arbitrum)
- ✅ Behavior analysis running cleanly
- ✅ Side-by-side comparison UI (Solana vs. EVM)

**Documentation:**
- ✅ Limitations clearly stated
- ✅ Architecture diagram (Layer 1/2/3)
- ✅ Setup guide (how to run against EVM)

