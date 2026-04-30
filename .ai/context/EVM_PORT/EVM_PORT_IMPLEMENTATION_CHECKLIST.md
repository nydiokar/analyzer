# EVM Port — Implementation Checklist

Quick reference for the implementation phases. Use this to track progress during development.

---

## PRE-IMPLEMENTATION (Before Day 1)

- [ ] **Liquify API Investigation** (2 hours)
  - [ ] Review Liquify documentation (does it provide `swapValue`?)
  - [ ] Test API with sample Ethereum wallet
  - [ ] Verify response format and fields
  - [ ] Confirm rate limits and pricing
  - **Outcome:** Decision tree: "Use Liquify directly" OR "Fall back to event parsing"

- [ ] **Chain Selection** (30 min)
  - [ ] Primary chain: Ethereum or Arbitrum?
  - [ ] Secondary (nice-to-have): Other chain?
  - [ ] Document stablecoin addresses for each

- [ ] **Setup & Dependencies**
  - [ ] Create feature branch: `feature/evm-ingestion`
  - [ ] Add npm packages (if needed): `ethers`, `@liquify/sdk`, etc.
  - [ ] Update .env with EVM settings (Liquify key, chain RPC endpoint)

---

## PHASE 1: Foundation (Days 1-2)

### Day 1 Morning: Schema & Setup

- [ ] **Schema Refactoring** (1.5 hours)
  - [ ] Rename in `prisma/schema.prisma`:
    - [ ] `signature` → `txHash`
    - [ ] `mint` → `tokenAddress`
    - [ ] `associatedSolValue` → `associatedNativeValue`
  - [ ] Run `npx prisma generate` to update client
  - [ ] Commit: "refactor: generalize SwapAnalysisInput schema for multi-chain"

- [ ] **Grep & Replace** (1 hour)
  - [ ] Update all references to old field names:
    ```bash
    grep -r "\.signature" src/ --include="*.ts"
    grep -r "\.mint" src/ --include="*.ts"
    grep -r "\.associatedSolValue" src/ --include="*.ts"
    ```
  - [ ] Replace in code (especially: helius-transaction-mapper.ts, analyzer.ts)
  - [ ] Run tests to catch any missed references
  - [ ] Commit: "refactor: update field names to support multi-chain"

- [ ] **Stablecoin Registry** (1 hour)
  - [ ] Create `src/config/evm-stablecoins.ts`
  - [ ] Add stablecoin addresses for Ethereum + Arbitrum
  - [ ] Create utility function: `isStablecoin(mint, chain): boolean`
  - [ ] Update `src/core/analysis/swap/analyzer.ts` to accept `chain` parameter
  - [ ] Commit: "feat: parameterize stablecoins by chain"

### Day 1 Afternoon: EVM Infrastructure

- [ ] **EvmApiClient** (2-3 hours)
  - [ ] Create `src/core/services/evm-api-client.ts`
  - [ ] Implement: `getTransactionsForAddress(wallet, chain, options)`
  - [ ] Implement: `getTransactionDetails(txHash, chain)`
  - [ ] Add error handling & retry logic
  - [ ] Log all API calls (for debugging)
  - [ ] Tests: unit tests for client methods
  - [ ] Commit: "feat: implement EVM API client (Liquify/RPC)"

- [ ] **DEX Registry** (30 min)
  - [ ] Create `src/config/evm-dex-programs.ts`
  - [ ] Add known DEX routers for Ethereum + Arbitrum:
    - [ ] Uniswap V2/V3
    - [ ] SushiSwap
    - [ ] Curve
    - [ ] Other common DEXes
  - [ ] Create utility: `isDexProgram(contractAddress, chain): boolean`
  - [ ] Commit: "feat: add EVM DEX router registry"

- [ ] **EVM Types** (30 min)
  - [ ] Create `src/types/evm-api.ts`
  - [ ] Define: `EvmTransaction`, `TransferLog`, `SwapEvent`
  - [ ] Match structure to RPC response or Liquify API
  - [ ] Commit: "feat: add EVM API type definitions"

### Day 1 End: Integration Points

- [ ] **NestJS Module** (1 hour)
  - [ ] Create `src/api/integrations/evm.module.ts`
  - [ ] Provide: `EvmApiClient`, `EvmSyncService`
  - [ ] Make it injectable alongside HeliusModule
  - [ ] Commit: "feat: add EVM integration module (NestJS)"

**End of Day 1 Status:**
- [x] Schema refactored
- [x] EVM infrastructure in place
- [x] Can fetch raw EVM transaction data
- [ ] Cannot yet map to SwapAnalysisInput

---

## PHASE 2: Core Mapper (Days 2-4)

### Day 2: Transaction Decoding

- [ ] **TransactionClassifier** (3 hours)
  - [ ] Create `src/core/services/evm-transaction-classifier.ts`
  - [ ] Implement: `classifyTransaction(tx, logs, wallet): "SWAP" | "TRANSFER" | "UNKNOWN"`
  - [ ] Sub-function: `isDexProgram(tx.to)` (use registry)
  - [ ] Sub-function: `hasMultiLegSwap(logs, wallet)` (count distinct tokens)
  - [ ] Unit tests: test 5-10 known transactions
  - [ ] Commit: "feat: implement EVM transaction classifier"

- [ ] **EventParser** (2 hours)
  - [ ] Create `src/core/services/evm-event-parser.ts`
  - [ ] Implement: `parseTransferLogs(logs): TransferLog[]`
    - [ ] Decode ERC20 Transfer event signature
    - [ ] Extract: from, to, amount, token contract
  - [ ] Implement: `parseSwapLogs(logs): SwapLog[]` (for each DEX type)
    - [ ] Uniswap V3: Swap event
    - [ ] Curve: TokenExchange event
    - [ ] SushiSwap: Swap event (Uniswap V2 compatible)
  - [ ] Tests: test with real transaction logs
  - [ ] Commit: "feat: implement EVM event parsing"

### Day 3: Value Extraction

- [ ] **ValueExtractor** (4-6 hours)
  - [ ] Create `src/core/services/evm-value-extractor.ts`
  - [ ] **If Liquify available:**
    - [ ] Implement: `extractValueFromLiquify(tx): { amountIn, amountOut, nativeValue }`
    - [ ] Return directly (no heuristics needed)
    - [ ] Effort: 1-2 hours
  - [ ] **If Liquify unavailable:**
    - [ ] Implement: `extractValueFromDexLogs(logs): number`
    - [ ] Handle per-DEX event parsing (Uni V3, Curve, SushiSwap)
    - [ ] Aggregate multi-leg swaps
    - [ ] Effort: 4-6 hours
  - [ ] Tests: validate output against known swaps
  - [ ] Commit: "feat: implement value extraction from EVM swaps"

- [ ] **FeeExtractor** (2 hours)
  - [ ] Create `src/core/services/evm-fee-extractor.ts`
  - [ ] Implement: `extractFee(tx, nativePrice): number`
    - [ ] Option A: Use transaction `gasUsed * gasPrice` (in native token)
    - [ ] Option B: Use Liquify's fee field (if available)
  - [ ] Decision: Include fee in cost basis, or track separately?
    - [ ] Document decision in code comment
  - [ ] Tests: test with transactions of varying gas usage
  - [ ] Commit: "feat: implement fee extraction"

### Day 4: Full Mapper

- [ ] **EvmTransactionMapper** (6 hours)
  - [ ] Create `src/core/services/evm-transaction-mapper.ts`
  - [ ] Implement: `mapTransaction(tx, logs, wallet, chain): SwapAnalysisInput[]`
    - [ ] Use classifier → get type ("SWAP", "TRANSFER", "UNKNOWN")
    - [ ] Use parser → get transfer logs
    - [ ] Use value extractor → get amounts
    - [ ] Use fee extractor → get fee
    - [ ] Validate stablecoin (use registry)
    - [ ] Create SwapAnalysisInput record(s)
  - [ ] Handle edge cases:
    - [ ] Failed transactions (skip)
    - [ ] Partial fills (aggregate)
    - [ ] Bridge transfers (document as unsupported)
    - [ ] Complex DeFi (classify as UNKNOWN, don't break)
  - [ ] Error handling: log issues, don't crash
  - [ ] Tests: comprehensive unit tests
  - [ ] Commit: "feat: implement full EVM transaction mapper"

- [ ] **EvmSyncService** (3 hours)
  - [ ] Create `src/core/services/evm-sync-service.ts` (or extend HeliusSyncService)
  - [ ] Implement: `syncWalletData(wallet, chain, options)`
    - [ ] Fetch all transactions for wallet using EvmApiClient
    - [ ] Map each transaction using EvmTransactionMapper
    - [ ] Save SwapAnalysisInput records to database
    - [ ] Update Wallet.lastSuccessfulFetchTimestamp
  - [ ] Paginate large result sets (batches of 100)
  - [ ] Tests: test sync for sample wallet
  - [ ] Commit: "feat: implement EVM sync service"

**End of Day 4 Status:**
- [x] Can ingest EVM wallet transactions
- [x] Can classify swaps vs. transfers
- [x] Can extract values (Liquify or events)
- [x] Can generate SwapAnalysisInput records
- [ ] Not yet validated against real data

---

## PHASE 3: Validation & Testing (Days 5-6)

### Day 5 Morning: Unit & Integration Tests

- [ ] **Mapper Unit Tests** (2 hours)
  - [ ] Test classifier with 10 known transactions:
    - [ ] 3 simple swaps (Uniswap V3, Curve, SushiSwap)
    - [ ] 2 complex routes (multi-hop)
    - [ ] 2 simple transfers
    - [ ] 2 unknown/edge cases
    - [ ] 1 failed transaction
  - [ ] Verify output: correct classification, correct values
  - [ ] Commit: "test: add EVM mapper unit tests"

- [ ] **Event Parsing Tests** (1 hour)
  - [ ] Test with real transaction logs (from Etherscan)
  - [ ] Verify Transfer events parsed correctly
  - [ ] Verify Swap events decoded properly
  - [ ] Commit: "test: add EVM event parsing tests"

- [ ] **Integration Test: Real Wallet** (2 hours)
  - [ ] Pick a known Ethereum trader (e.g., public address with documented trades)
  - [ ] Run sync: `await evmSyncService.syncWalletData(address, 'ethereum')`
  - [ ] Verify:
    - [ ] SwapAnalysisInput records created
    - [ ] All fields non-null (except optional ones)
    - [ ] Amounts are positive
    - [ ] Timestamps are in reasonable range
    - [ ] Swap/Transfer classification looks correct
  - [ ] Commit: "test: validate real Ethereum wallet ingestion"

### Day 5 Afternoon: Intelligence Layer Validation

- [ ] **PnL Analysis Test** (2 hours)
  - [ ] Create test data: a few SwapAnalysisInput records
  - [ ] Run: `pnlService.analyzeWalletPnl(testWallet)`
  - [ ] Verify:
    - [ ] PnL calculations complete without error
    - [ ] Output schema matches expected (SwapAnalysisSummary)
    - [ ] PnL values are reasonable (not NaN, not infinite)
  - [ ] Compare against manual calculation (sanity check)
  - [ ] Commit: "test: validate PnL analysis with EVM data"

- [ ] **Behavior Analysis Test** (1.5 hours)
  - [ ] Run: `behaviorService.getWalletBehavior(testWallet, config)`
  - [ ] Verify:
    - [ ] Completes without error
    - [ ] speedCategory is valid (SCALPER, SWING_TRADER, etc.)
    - [ ] Hold times are reasonable
  - [ ] Commit: "test: validate behavior analysis with EVM data"

### Day 6: Real-World Validation

- [ ] **Test Against Multiple Wallets** (4 hours)
  - [ ] Pick 3-5 known EVM traders (different profiles):
    - [ ] 1 scalper (many small trades)
    - [ ] 1 swing trader (medium hold times)
    - [ ] 1 holder (few large positions)
    - [ ] 1 bot-like (very high frequency)
    - [ ] 1 edge case (failed txns, bridges, etc.)
  - [ ] Ingest each wallet: `syncWalletData(address, 'ethereum')`
  - [ ] Verify no crashes, reasonable data
  - [ ] Check PnL output against known performance (if available)
  - [ ] Commit: "test: validate multiple real EVM wallets"

- [ ] **Stablecoin Handling Test** (1 hour)
  - [ ] Test with wallet containing USDC ↔ USDT swaps
  - [ ] Verify stablecoin flows tracked correctly
  - [ ] Check that stablecoins aren't treated as risky trades
  - [ ] Commit: "test: validate stablecoin handling"

- [ ] **Comparison: Solana vs. EVM** (2 hours)
  - [ ] If available: take a Solana wallet, port data to EVM format
  - [ ] Run both through intelligence layer
  - [ ] Compare output: structure should be identical
  - [ ] Document any differences
  - [ ] Commit: "test: cross-chain parity validation"

**End of Day 6 Status:**
- [x] Code is well-tested
- [x] Real wallets ingest correctly
- [x] PnL/Behavior/Similarity work with EVM data
- [x] Known issues documented
- [ ] Not yet production-ready

---

## PHASE 4: Polish & Demo (Day 7)

### Morning: Code Quality

- [ ] **Code Review** (1 hour)
  - [ ] Review all new EVM code for:
    - [ ] Error handling (no unhandled promises)
    - [ ] Logging (important decisions logged)
    - [ ] Performance (no N+1 queries, reasonable complexity)
  - [ ] Refactor any obviously slow sections
  - [ ] Commit: "refactor: code quality improvements"

- [ ] **Documentation** (2 hours)
  - [ ] Add JSDoc comments to all public methods
  - [ ] Create `src/core/services/README_EVM_MAPPER.md`:
    - [ ] What the mapper does
    - [ ] Supported chains and DEXes
    - [ ] Known limitations
    - [ ] How to add a new chain
  - [ ] Update root README with EVM support mention
  - [ ] Commit: "docs: add EVM mapper documentation"

- [ ] **Performance Check** (1 hour)
  - [ ] Measure time to ingest a 1000-transaction wallet
  - [ ] If >30 seconds, identify bottleneck:
    - [ ] API calls? → add caching
    - [ ] Parser? → optimize regex/loops
    - [ ] Database? → batch inserts
  - [ ] Commit: "perf: optimize EVM ingestion"

### Afternoon: Demo & Final Touches

- [ ] **Demo Setup** (1.5 hours)
  - [ ] Create a demo script: `scripts/demo-evm-wallet.ts`
    ```bash
    $ npx ts-node scripts/demo-evm-wallet.ts 0x1234...
    ```
  - [ ] Output:
    - [ ] Transactions ingested
    - [ ] PnL summary
    - [ ] Behavior profile
    - [ ] Sample output
  - [ ] Commit: "feat: add EVM demo script"

- [ ] **Known Limitations Doc** (30 min)
  - [ ] Create `.ai/EVM_PORT_KNOWN_LIMITATIONS.md`:
    - [ ] Bridge tokens not supported
    - [ ] Complex DeFi treated as transfers
    - [ ] Historical balance may be incomplete
    - [ ] Gas fee handling (what decision was made?)
    - [ ] Multi-chain portfolio (per-chain only)
  - [ ] Commit: "docs: document EVM port limitations"

- [ ] **Final Test Run** (30 min)
  - [ ] Run full test suite: `npm test`
  - [ ] Fix any newly-introduced failures
  - [ ] Commit: "test: ensure all tests pass with EVM changes"

- [ ] **Prepare for Merge** (1 hour)
  - [ ] Verify branch is up-to-date with `main`
  - [ ] Resolve any merge conflicts
  - [ ] Do a final code review of the PR
  - [ ] Squash commits if needed (or keep if good history)
  - [ ] Write comprehensive PR description:
    ```markdown
    # EVM Ingestion Layer (Liquify Hackathon)
    
    ## Summary
    Adds support for EVM-compatible chains (Ethereum, Arbitrum) to Sova Intel.
    
    ## Changes
    - New: EvmApiClient, EvmTransactionMapper, EvmSyncService
    - Refactored: Schema fields (signature→txHash, mint→tokenAddress)
    - Updated: Stablecoin registry (parameterized by chain)
    
    ## Testing
    - Unit tests for mapper, classifier, event parser
    - Integration tests with 5 real Ethereum wallets
    - Parity validation (EVM vs. Solana schema)
    
    ## Known Limitations
    - Bridge tokens excluded
    - Complex DeFi treated as transfers
    - See EVM_PORT_KNOWN_LIMITATIONS.md
    ```

---

## DEPLOYMENT & VALIDATION

- [ ] **Staging Environment** (if available)
  - [ ] Deploy to staging
  - [ ] Run ingestion for known wallet
  - [ ] Verify API endpoints return correct data

- [ ] **Rollback Plan** (document, don't need to test)
  - [ ] How to revert schema changes if needed
  - [ ] How to disable EVM ingestion in emergency

---

## Final Checklist: Hackathon Submission

- [ ] **Code**
  - [x] EVM ingestion layer complete
  - [x] All unit tests passing
  - [x] Real-wallet integration tests passing
  - [x] No console.log spam in production paths

- [ ] **Documentation**
  - [x] README updated with EVM support
  - [x] Architecture diagram (Layer 1/2/3)
  - [x] Known limitations documented
  - [x] JSDoc on all public methods

- [ ] **Demo**
  - [x] Demo script works: `npm run demo:evm-wallet`
  - [x] Output is clean and informative
  - [x] Sample wallet ingests and analyzes successfully

- [ ] **Submission**
  - [ ] Branch merged to main
  - [ ] Tag released (e.g., `v0.2.0-evm`)
  - [ ] PR closed with good description
  - [ ] Git history is clean

---

## Risk Checkpoints

**If at any point you hit these, escalate:**

- [ ] **Liquify API unavailable or undocumented** → Pivot to event parsing (6h cost)
- [ ] **DEX event parsing failing for >20% of swaps** → Add more DEX types or fall back to oracle
- [ ] **PnL values off by >10% vs. manual calculation** → Review value extraction logic
- [ ] **Performance >60 seconds for 1000-txn wallet** → Profile and optimize
- [ ] **Memory usage spike during large ingests** → Batch processing or stream

---

## Time Budget Summary

```
PHASE 1 (Foundation):   8-10 hours
PHASE 2 (Core Mapper):  15-20 hours
PHASE 3 (Testing):      12-15 hours
PHASE 4 (Polish):       6-8 hours
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL:                  41-53 hours = 5-7 dev days
```

**Buffer:** 20-30% for unknown issues and iteration.

---

