# Market Context Orchestration Gap

Date: 2026-03-31

## Summary

The market-context feature was implemented in schema and services, but the canonical wallet-analysis pipeline did not consistently enforce `sync -> enrich SwapAnalysisInput -> analyze`.

As a result, some live wallet analyses persisted:
- `WalletPnlSummary.totalVolumeUsd/realizedPnlUsd/unrealizedPnlUsd/netPnlUsd = NULL`
- `AnalysisResult.avgEntryMcap/avgExitMcap = NULL`
- `TokenLot.entryMcapUsd/costBasisUsd = NULL`
- `WalletBehaviorProfile.avgEntryMcap/preferredMcapBucket = NULL`

even though the wallet had just been analyzed successfully.

## Root Cause

`syncWalletData()` persists raw `SwapAnalysisInput` rows only.

Market-context enrichment is a separate concern in `MarketContextService.enrichWallet()`.

PnL and behavior analysis read directly from `SwapAnalysisInput`, so correctness depends on orchestration order in each caller.

The dashboard path had been running:

`syncWalletData() -> analyzeWalletPnl() -> getWalletBehavior()`

without first running market-context enrichment.

Additionally, the async `process-market-context` queue job only enriched `SwapAnalysisInput`; it did not rebuild downstream canonical tables afterward.

## Verified Production Symptoms

Wallet checked:
- `DqzMjNjGPmzi8ZTkAevSotFUor1D79ZFDD8eXDuP8AGR`

Observed on prod DB:
- wallet was analyzed on `2026-03-31 16:41:26`
- `377` `SwapAnalysisInput` rows existed
- `0/377` had `usdValue`, `marketCapUsd`, or `enrichedAt`
- downstream mcap/USD fields were all null

System-wide snapshot at time of investigation:
- `SwapAnalysisInput`: partial enrichment exists globally
- downstream canonical fields across `WalletPnlSummary`, `AnalysisResult`, and `TokenLot` were still effectively unpopulated

## Minimal Fix Applied

1. Dashboard wallet analysis now runs market-context enrichment before PnL/behavior.
2. Standalone wallet sync continues to queue `process-market-context`, but now marks those jobs to rebuild downstream canonical state after enrichment.
3. Bulk backfill script remains enrichment-only on purpose (`rebuildDownstream: false`) to avoid unexpectedly re-analyzing all wallets while a long-running tmux process is active.

## Remaining Minimal Fix Required

Other live sync+analyze orchestrators must also enforce:

`sync -> enrich wallet swap rows -> canonical analysis`

Known paths to patch:
- similarity deep sync
- holder-profile wallet mode

## Correct Long-Term Design

Do not keep orchestration rules duplicated across processors forever.

Introduce a shared service, e.g. `WalletPreparationService`, responsible for:
- checking sync freshness / syncing if needed
- enriching pending `SwapAnalysisInput` rows for the wallet
- returning only once wallet data is ready for canonical analysis

Canonical writers (`PnlAnalysisService`, behavior persistence) should only run after this preparation step for full-wallet analyses.

## Performance Guidance

Do not move full market-context enrichment into the raw row insert path.

Why:
- would couple ingestion latency to SOL price lookup and token supply cache/RPC misses
- would make sync slower and more failure-prone
- would increase blast radius of transient RPC issues

Preferred approach:
- keep raw ingestion fast
- do wallet-scoped enrichment immediately before canonical analysis
- enrich only rows with `enrichedAt IS NULL`
- bulk-read cached supply, use RPC only for misses

This preserves fast ingestion while making canonical analysis correct.

