# Helius Mapper Classification-First Refactor Plan

**Date:** 2026-03-20  
**Status:** Planning / pre-branch spec  
**Primary area:** [`src/core/services/helius-transaction-mapper.ts`](/C:/Users/Cicada38/Projects/analyzer/src/core/services/helius-transaction-mapper.ts)

## 1. Problem Statement

The current Helius transaction mapper is doing value attribution too early and with the wrong abstraction.

Today the mapper:
- reads Helius-parsed `tokenTransfers`, `nativeTransfers`, `accountData`, `instructions`, and `events`
- tries to infer economic meaning directly from those flattened structures
- applies multiple fallback heuristics to assign `associatedSolValue` / `associatedUsdcValue`

This produces recurring failures:
- liquidity receipts/withdrawals misclassified as trades
- routed swaps overcounted by gross WSOL movement
- temp WSOL ATA setup/close mechanics treated as economic legs
- Helius `type` unreliability forcing scattered special cases
- every new edge case requiring another patch on top of old patches

This is not primarily a "bad data" problem. The raw transaction data exists. The problem is that the mapper is mixing:
- observation
- classification
- settlement derivation
- row emission

inside one large heuristic flow.

## 2. Goal

Refactor the mapper so transaction **classification happens before value attribution**.

Target outcome:
- identify what transaction pattern the wallet participated in
- identify the wallet's actual economic settlement
- assign value only from that settlement
- keep inventory/history rows separate from PnL semantics

This should reduce repeated heuristic churn and make new cases additive instead of destabilizing.

## 3. Non-Goals

Not in scope for the first refactor:
- full protocol-specific decoding for every AMM/router
- replacing Helius as data source
- redesigning downstream PnL/FIFO analyzers
- rewriting the entire mapper in one step
- changing DB schema unless absolutely necessary

The first refactor must be incremental and compatible with the current pipeline.

## 4. Current Root Cause

Observed from code and recent fixtures:

1. Helius `type` is unreliable
- real swaps can be marked `TRANSFER`
- non-trade flows can be marked `SWAP`

2. `tokenTransfers` is not an economic ledger
- it includes intermediary router hops
- it includes WSOL temp account churn
- it includes fee/tip transfers
- it includes LP mechanics

3. Current fallback order is structurally risky
- gross WSOL movement
- stable movement
- net native SOL change
- gross native SOL outflow

These are treated as competing proxies before the mapper has established which transfers are economic settlement versus plumbing.

4. The mapper currently has no durable internal transaction model
- no "observed facts" layer
- no explicit classification stage
- no separation between economic settlement and emitted rows

## 5. Design Principles

The refactor must follow these rules:

1. Classification first
- value attribution must depend on internal transaction classification, not directly on Helius `type`

2. Observations before interpretations
- derive normalized facts from raw tx data first
- do not assign value while extracting facts

3. Preserve existing pipeline shape
- keep public mapper entrypoint stable if possible
- keep downstream consumers unchanged during first phases

4. Inventory and economics are separate concerns
- a row may be valid for inventory history but invalid for PnL value attribution

5. Fixture-driven safety
- every discovered real-world pattern becomes a regression fixture

6. Narrow rollout
- migrate one pattern at a time
- leave old path in place for unclassified/unknown cases

## 6. Target Architecture

### 6.1 Stage A: Observed Facts Extraction

Add a read-only internal layer that derives normalized facts from raw Helius tx data.

Proposed internal shape:

```ts
type ObservedTransactionFacts = {
  signature: string;
  heliusType: string;
  source: string | null;
  hasSwapEvent: boolean;
  programsTouched: Set<string>;
  hasLiquidityProgram: boolean;
  hasTemporaryWsolLifecycle: boolean;

  nativeSol: {
    grossIn: number;
    grossOut: number;
    net: number;
  };

  wsol: {
    grossIn: number;
    grossOut: number;
    net: number;
    counterpartiesIn: Set<string>;
    counterpartiesOut: Set<string>;
  };

  stables: {
    grossInByMint: Map<string, number>;
    grossOutByMint: Map<string, number>;
    netByMint: Map<string, number>;
  };

  nonValueMints: {
    inByMint: Map<string, number>;
    outByMint: Map<string, number>;
    netByMint: Map<string, number>;
  };

  tokenDirections: {
    nonValueInCount: number;
    nonValueOutCount: number;
    hasOneDirectionNonValueFlow: boolean;
  };

  tempAccounts: {
    candidateWsolAccounts: Set<string>;
  };

  transferFeatures: {
    hasFeeLikeWsolOut: boolean;
    hasMultipleWsolSources: boolean;
    hasMeaningfulStableSettlement: boolean;
    hasMeaningfulNativeSettlement: boolean;
  };
};
```

Notes:
- this does **not** decide whether something is a trade
- this does **not** assign values
- this stage is pure derivation and must be easy to test

### 6.2 Stage B: Internal Classification

Add a small internal classifier:

```ts
type InternalTxClassification =
  | 'simple_swap'
  | 'routed_swap_settled_to_native'
  | 'routed_swap_settled_to_wsol'
  | 'spl_to_spl_swap'
  | 'liquidity_receipt'
  | 'liquidity_deposit'
  | 'plain_transfer'
  | 'airdrop'
  | 'burn'
  | 'create_pool'
  | 'unknown';
```

Classifier must use observed facts, not Helius `type` as truth.

Helius `type` remains an input signal only.

### 6.3 Stage C: Settlement Derivation

For a classified transaction, derive one settlement model:

```ts
type EconomicSettlement = {
  solValue: number;
  usdcValue: number;
  source:
    | 'event'
    | 'native-net'
    | 'wsol-net'
    | 'wsol-gross'
    | 'stable-net'
    | 'stable-gross'
    | 'spl-intermediary'
    | 'none';
  isEconomic: boolean;
};
```

Examples:
- `liquidity_receipt` -> `isEconomic: false`, zero value
- `routed_swap_settled_to_native` -> value from final settled native SOL, not gross WSOL churn
- `simple_swap` -> direct WSOL/stable leg
- `plain_transfer` -> zero attributed value unless explicit direct-value transfer rules exist

### 6.4 Stage D: Row Emission

Emission step uses:
- observed facts
- classification
- settlement

Rules:
- inventory rows can still be emitted
- SOL churn rows can be filtered for economic-only routed settlement cases
- attributed values come only from settlement stage
- proportional split stays, but only after settlement total is correct

## 7. Regression Strategy

This refactor must be guarded by a **fixture corpus**, not only synthetic unit tests.

### 7.1 Fixture Categories

Build and maintain a real-world corpus covering:

1. direct token buy with WSOL
2. direct token sell with WSOL
3. routed swap with temp WSOL unwrap to native SOL
4. routed swap with WSOL retained
5. SPL-to-SPL swap via WSOL
6. liquidity receipt
7. liquidity withdrawal
8. transfer-labeled real swap
9. swap-labeled non-trade
10. plain transfer
11. airdrop
12. burn
13. create-pool / LP bootstrap
14. fee-payer-only edge case
15. stable-routed swap

### 7.2 What to Assert Per Fixture

Do **not** rely only on full row snapshots.

For each fixture assert:
- internal classification
- row count by mint/direction where relevant
- total `associatedSolValue`
- total `associatedUsdcValue`
- whether SOL churn rows are present/absent
- whether economic attribution is zero/non-zero

Optional snapshotting is fine as secondary protection, not primary truth.

### 7.3 Golden Validation Set

Before broad rollout, create a golden set of approximately 30-50 signatures:
- 10 known-good ordinary swaps
- 10 routed weird swaps
- 5 liquidity receipts/withdrawals
- 5 transfer-labeled real swaps
- 5 ugly edge cases

For each:
- expected classification
- expected total value
- expected presence/absence of SOL churn rows

This becomes the release gate for mapper refactors.

## 8. Phased Implementation Plan

## Phase 0 - Planning and Safety Baseline

Deliverables:
- this spec document
- named fixture list
- explicit acceptance criteria

Exit criteria:
- no code behavior changed yet

## Phase 1 - Extract Observed Facts Layer

Change scope:
- add pure helper(s) inside mapper module or adjacent internal module
- no behavior change

Tasks:
1. extract program-touch detection
2. extract temp WSOL lifecycle detection
3. extract normalized per-mint user flows
4. extract gross/net native and WSOL facts
5. extract simple structural feature flags

Tests:
- helper-focused unit tests on representative synthetic txs
- fixture-backed tests for a few known weird signatures

Exit criteria:
- mapper output unchanged on current regression suite
- observed facts helpers stable and covered

## Phase 2 - Introduce Internal Classifier Without Routing Behavior Through It

Change scope:
- add `classifyTransactionPattern(facts, tx)`
- log/debug only in tests if needed
- no mapper output change yet

Tasks:
1. define internal classification enum/type
2. implement first-pass classifier
3. map current fixtures to expected classifications

Tests:
- classification assertions for real fixtures

Exit criteria:
- current fixtures classify consistently
- no behavior change in emitted rows

## Phase 3 - Migrate One Pattern: Liquidity Receipt / Withdrawal

Why first:
- highest confidence
- already partly implemented
- clear economic rule: inventory yes, value no

Change scope:
- route only `liquidity_receipt` / `liquidity_deposit` through classifier-based logic
- remove ad hoc duplicated guards only after equivalence is proven

Tests:
- current DLMM receipt fixtures
- at least one counterexample AMM transfer-labeled real swap

Exit criteria:
- same outputs as current patched behavior
- old special-case helper can be simplified or aliased to classifier result

## Phase 4 - Migrate One Pattern: Routed Swap Settled To Native

Why second:
- current pain point
- high downstream PnL impact

Change scope:
- route only `routed_swap_settled_to_native` through classifier-based settlement
- prefer final settled native value over gross WSOL churn

Tests:
- current `yMQ...`, `3jbe...`, `2b7W...` fixtures
- at least one counterexample routed swap where gross WSOL should still matter

Exit criteria:
- routed sell fixtures no longer need ratio-based branch selection as primary logic
- economic value comes from explicit settlement derivation

## Phase 5 - Migrate Remaining Core Patterns

Patterns:
- `simple_swap`
- `routed_swap_settled_to_wsol`
- `spl_to_spl_swap`
- `plain_transfer`
- `airdrop`
- `burn`

Rule:
- move one pattern at a time
- do not migrate multiple ambiguous patterns in one PR unless coverage is complete

## Phase 6 - Remove Dead Heuristics

Only after phases above are stable:
- identify unreachable or redundant fallback branches
- delete them with fixture proof

Candidates likely to shrink:
- ratio-based routed WSOL fallback
- duplicated liquidity-style checks
- some gross-native heuristics
- overuse of Helius `type`

## 9. Acceptance Criteria

The refactor is successful only if all are true:

1. Existing known-good fixtures keep expected results
2. Known-bad fixtures are corrected
3. Every corrected edge case is represented by a regression test
4. New logic depends more on internal classification and less on raw `tx.type`
5. Number of "fallback-only" value paths is reduced
6. No broad change is merged without fixture evidence

## 10. Rollout and Risk Control

### 10.1 Implementation Boundaries

Keep first refactor inside:
- [`src/core/services/helius-transaction-mapper.ts`](/C:/Users/Cicada38/Projects/analyzer/src/core/services/helius-transaction-mapper.ts)
- optionally adjacent internal helper module if extraction materially improves clarity
- [`src/core/services/helius-transaction-mapper.test.ts`](/C:/Users/Cicada38/Projects/analyzer/src/core/services/helius-transaction-mapper.test.ts)

Avoid changing:
- DB schema
- sync orchestration
- analyzer pipeline
- downstream service contracts

### 10.2 Release Gate

Before merging any phase:
- run mapper test suite
- run fixture regression subset
- compare outputs on golden validation set

If a phase changes any known-good swap unexpectedly:
- stop
- add fixture
- adjust classification rule before merge

### 10.3 Repair Strategy For Existing Server Data

Because bad rows may already be persisted:
- server repair must work by candidate signature detection + Helius refetch + remap
- DB-only repair is insufficient for exact reclassification

This is a separate follow-up task and should not block mapper refactor.

## 11. Recommended Branch / PR Breakdown

Recommended sequence:

1. `feat/mapper-observed-facts-layer`
- no behavior change

2. `feat/mapper-internal-classifier`
- classification tests only

3. `fix/mapper-liquidity-classification`
- first behavior migration

4. `fix/mapper-routed-native-settlement`
- second behavior migration

5. `refactor/mapper-remove-dead-heuristics`
- cleanup only after proof

This split keeps each PR reviewable and rollbackable.

## 12. Immediate Next Tasks

When work starts on the new branch, do this in order:

1. Create a fixture index section in tests listing all known real signatures by category
2. Extract `ObservedTransactionFacts` helpers with no behavior change
3. Add classification tests for:
- `zmJh...`
- `5fnp...`
- `yMQ...`
- `3jbe...`
- `2b7W...`
4. Add internal classifier type and first-pass implementation
5. Route liquidity receipt path through classifier
6. Route routed-native-sell path through classifier

## 13. Open Questions

These should be answered during implementation, not guessed now:

1. Should classifier live in the same file initially or move to `src/core/services/helius-transaction-classifier.ts` immediately?
2. Do we need a debug output mode that prints observed facts + classification for a signature?
3. Are there current fixtures where gross WSOL is genuinely the right answer for a one-sided sell with temp WSOL lifecycle?
4. Should `interactionType` remain raw Helius type, or gain an internal classification field later?

## 14. Guiding Rule

If a future fix requires adding another heuristic branch directly into value attribution before classification exists, stop and classify the pattern first.

That is the boundary that prevents repeating the same failure mode next month.

## 15. Wallet-Level Interpretation Layer (Bot / Volume / LP Detection)

The mapper refactor alone is not enough for wallet interpretation.

There is a separate downstream problem:
- some wallets may execute a small real market buy
- then repeatedly receive token inventory from LP/fee/arbitrage mechanics
- then dump that inventory into another venue
- naive PnL tools can misread this as "highly successful trading"

This creates false positives for "top trader" identification.

### 15.1 Key Principle

Do **not** infer trader quality directly from aggregated buy/sell totals unless transaction classes are separated first.

Wallet-level evaluation should distinguish:
- real acquisition trades
- real disposal trades
- LP receipts / fee claims
- recycled inventory flows
- cross-pool routing / venue shuttling

### 15.2 New Transaction Classes Needed For This

The current plan should explicitly distinguish:

- `market_buy`
- `market_sell`
- `liquidity_receipt`
- `fee_claim_receipt`
- `liquidity_withdrawal`
- `cross_pool_inventory_recycle`
- `unknown`

Important rule:
- `liquidity_receipt` and `fee_claim_receipt` are **not** buys
- later dumps of that received inventory are sells, but should not be interpreted as evidence of trading skill without inventory-origin context

### 15.3 Wallet-Level Signals For Likely Bots / LP / Volume Wallets

After mapper classification is available, add a wallet-level flagging pass using aggregated features.

Strong signals:

1. High ratio of non-buy inventory inflows
- large fraction of token inflow volume comes from `liquidity_receipt` / `fee_claim_receipt`
- low fraction comes from `market_buy`

2. Venue cycling
- repeated pattern:
  - receive token from venue A / LP program
  - dispose to venue B shortly after
- especially if this repeats many times for same mint

3. Very short hold durations
- seconds-level hold time repeatedly
- especially when paired with receipt-driven inflows rather than market buys

4. Low realized profit relative to gross sold
- large gross sold notionals
- very small net profit
- indicates recycling / volume shaping / arbitrage spread capture rather than directional trading

5. Split-origin inventory
- only a small fraction of sold inventory can be traced to `market_buy`
- rest originates from non-buy receipt classes

6. Repeated same-mint high-frequency flow
- many txs on same mint
- alternating receipt/sell patterns
- often across multiple pools/programs

7. Program concentration
- repeated use of LP / AMM / router programs
- low diversity of discretionary-style behavior

### 15.4 Proposed Wallet-Level Flags

Introduce downstream wallet interpretation flags such as:

- `likely_discretionary_trader`
- `likely_lp_fee_harvester`
- `likely_cross_pool_arb_bot`
- `likely_volume_bot`
- `mixed_behavior`
- `unclassified`

These should be probabilistic / heuristic labels, not hard truth.

### 15.5 Minimal First Version

Do not build a full bot classifier immediately.

First version should compute simple wallet-level metrics:

- `marketBuySolTotal`
- `marketSellSolTotal`
- `receiptInflowTokenCount`
- `receiptInflowTokenAmount`
- `receiptToSellCycleCount`
- `medianReceiptToSellDelaySeconds`
- `grossSoldFromReceiptOrigin`
- `grossSoldFromMarketBuyOrigin`
- `netProfitVsGrossSoldRatio`

Then derive flags conservatively.

Example candidate rule for "likely volume / recycle bot":
- significant same-mint receipt inflows
- repeated sell after receipt within short delay
- gross sold greatly exceeds market-buy notional
- net profit is tiny relative to gross sold

### 15.6 Why This Matters

Without this layer, products may incorrectly rank:
- LP fee harvesters
- venue-cycling bots
- cross-pool arbitrage bots

as "best traders".

That is analytically wrong even if their gross sold and apparent ROI look impressive in naive summaries.
