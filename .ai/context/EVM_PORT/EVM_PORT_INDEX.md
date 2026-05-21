# EVM Port — Document Index

**Last updated:** 2026-05-22  
**Branch:** `feature/evm-ingestion` (pending merge to main)  
**Status:** Ingestion + analysis pipeline complete. Chain-agnostic refactor identified as next work.

---

## Active documents (read these)

| Document | Purpose | When to read |
|---|---|---|
| **`EVM_PORT_PROGRESS.md`** | Ground truth — what was built, phase by phase, validated run results | Starting any EVM session |
| **`EVM_CHAIN_AGNOSTIC_REFACTOR.md`** | Next engineering task — `NativeBalanceFetcher` interface, field renames, `EthPriceService`, sync service decision | Before touching any EVM analysis code |
| **`EVM_PORT_KNOWN_LIMITATIONS.md`** | What the current implementation does and does not handle | Before claiming EVM feature is complete |
| **`EVM_PORT_ARCHITECTURE.md`** | Layer 1/2/3 diagram, data flow, code organization | Getting oriented on system structure |

---

## Archive (do not use to guide work)

These documents were written pre-implementation and are kept as decision-history artifacts only. They assume Liquify API as the data source — the implementation used Alchemy instead.

| Document | Why archived |
|---|---|
| `archive/EVM_PORT_EXECUTIVE_SUMMARY.md` | Liquify-first assumptions, superseded by PROGRESS.md |
| `archive/EVM_PORT_BLOCKERS.md` | Blocker solutions describe Liquify path; actual solutions differ |
| `archive/FEASIBILITY_ASSESSMENT_EVM_PORT.md` | Largely correct analysis but one key miss on balance fetcher coupling; Liquify-specific recommendations dead |

The implementation checklist was deleted — it was never used as a live tracker and the Liquify assumptions made it misleading.

---

## What was built (summary)

**Ingestion (Layer 1) — complete:**
- `EvmApiClient` — Alchemy `alchemy_getAssetTransfers` + selective receipt enrichment
- `EvmTransactionMapper` — net token flows → `SwapAnalysisInput[]`
- `EvmTransactionClassifier` — `SWAP_TOPICS` set (event topic0 in logs) — catches aggregator-routed swaps
- `EvmValueExtractor` — 6-priority WETH chain: WETH direct → Withdrawal → Deposit → V2 Swap → V3 Swap → tx.value
- `EvmSyncService` — fetch → map → save → **Step 7: full analysis pipeline** (PnL → behavior → HUD)
- Pagination via Alchemy `pageKey`, incremental sync via `lastSyncedBlock`
- Chains validated: Ethereum, Arbitrum, Base

**Analysis pipeline wired (Layer 2) — working but bypassed:**
- `PnlAnalysisService.analyzeWalletPnl()` called with `skipBalanceFetch: true` — EVM unrealized PnL is always 0
- `BehaviorService` and `WalletHudService` — work correctly for EVM
- `WalletSummaryResponse` — includes `chain` and `nativeToken` from DB

**What is NOT done (tracked as `EVM-1`):**
- `NativeBalanceFetcher` interface — `PnlAnalysisService` still injects `HeliusApiClient` directly
- `EvmBalanceFetcher` — no ETH balance fetch exists
- `getEthPrice()` on `DexscreenerService` — no ETH price exists
- EVM token metadata enrichment — `marketCapUsd`, `tokenPriceUsd` always null for EVM tokens
- Field renames — `totalSolSpent`, `associatedSolValue`, etc. still Solana-named

---

## How to continue EVM work

1. Read `CONTEXT.md` → find `EVM-1`
2. Read `EVM_CHAIN_AGNOSTIC_REFACTOR.md` top-to-bottom — **especially the "Reading This in a Future Session" section at the bottom**
3. Follow the 9-step implementation order in that document
4. Steps 1–7 are one PR. Steps 8 and 9 are separate PRs.
