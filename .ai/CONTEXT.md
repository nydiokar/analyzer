# Current State

Project: Sova Intel - Wallet Analysis System
Branch: discover-analytics-ux
Last Updated: 2026-01-07

## Focus
FIFO PnL correctness when history is partial and when transfers/order ops appear.

## Key Changes (2026-01-07)
- SwapAnalyzer now passes ALL SPL transfers to FIFO (no pre-filter).
- FIFO uses mapper value only; non-economic is value==0 (no type-based logic).
- FIFO now returns partial realized PnL even when history is incomplete (no nulls).
- FIFO proceeds are counted only for matched lots (unmatched sells do not inflate realized).
- Wallet-level PnL includes partials (still flagged by hasIncompleteHistory).
- Token performance no longer nullifies realized/total just because incomplete.
- Token performance excludes stablecoins and noise tokens with zero activity or <0.01 SOL holdings.
- Mapper fixes:
  - ignore self-transfers (fromUserTA && toUserTA) to avoid inventory distortion
  - CREATE_ORDER / CANCEL_ORDER are forced to zero value
- SwapAnalyzer debug logs gated by env var PNL_DEBUG_LOGS=true.

## Reprocessing Required After Mapper Changes
Mapper changes do not backfill existing SwapAnalysisInput rows. To see fixes:
1) Clear SwapAnalysisInput for the wallet
2) Re-sync wallet (mapping)
3) Re-run PnL analysis

## Debug Scripts
- .ai/context/FIFO_debug/validate-fifo-inputs.ts <WALLET> [MINTS]
  Uses real SwapAnalyzer output; shows per-mint in/out, values, signatures.
- .ai/context/FIFO_debug/inspect-analysis-result.ts <WALLET> <MINT>
  Dumps AnalysisResult row for a wallet+mint.

## Notes
- Partial history is now surfaced as partial realized PnL with hasIncompleteHistory=true.
- Frontend should display realized/total from DB (no nulls) and can badge incomplete.
