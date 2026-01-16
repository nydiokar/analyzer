# Sova Intel - Project Context

**Branch:** `discover-analytics-ux` • **Last Updated:** 2026-01-16 • **Status:** 🟢 Active Development

---

## 🎯 Current Focus

**Token price freshness & wallet identity hygiene** - Ensure holder profiles and similarity jobs always rehydrate prices/labels with the registry-backed wallet badge logic while keeping dashboard components in sync.

---

## 📋 Active Work

Check this token + wallet - we showed no buy and sell amounts but "fixed" the swap analyzer, verify kapD6ok2UTZsCLeqvuykmN7UE6wWBsLEfct9861esrh 2TsmuYUrsctE57VLckZBYEEzdokUF8j8e1GavekWBAGS 


| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
| 🔄 | Wallet classification system cleanup | 🔸 | Remove shouldBlock/INVALID redundancy, unify on knownType + dynamic tagging (70k+ tokens auto-tagged as SYSTEM) |
| 🔄 | Math error fixes & API reliability tuning | 🔸 | Testing and debugging through dashboard |
| 📝 | Holder Profiles bucket alignment (WR/ROI + token lists) | 🔸 | Single source of truth: analyzer outputs stats + tokenMap together; cache must persist both; drilldown endpoint reads same cache with pagination; UI hides WR/ROI if bucket has 0 tokens or token list unavailable |
| ✅ | Introduce wallet registry for better management of types of wallets | 🔶 | Registry now lives in src/config/known-wallets.ts and drives the central wallet-type plumbing so PnL, similarity, and holder profiles respect known wallets while still surfacing labels. |
| 📝 | Holder Profiles final review | 🔹 | One more pass before complete |
| 📝 | Similarity Lab bug fixes | 🔸 | Ready to start after Holder Profiles |
| 🔄 | Token price refresh + wallet labels unification | 🔸 | Holder profiles and similarity now pull fresh token prices, recompute holdings, and route registry labels through wallet badges |

<details>
<summary><b>Legend</b></summary>

**Status:** 🔄 In Progress • ⏸️ Blocked • 📝 Ready • ✅ Testing
**Scope:** 🔹 Small (<50 lines, <1hr) • 🔸 Medium (2-5 files, <4hrs) • 🔶 Large (5+ files, multi-day)

</details>

---

## 📅 Recent Activity

### January 16, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 16.1 | 🔧 | Wallet classification system unification | 🔸 | `constants.ts`, `system-wallet-detection.service.ts`, `helius-sync-service.ts`, processors |

**Summary:** Removing shouldBlock/isSystemWallet/isLargeWallet flags in favor of unified knownType-based filtering. 70k+ token wallets now auto-tagged with knownType='SYSTEM' for consistent treatment with registry wallets. LARGE (15k-70k) remains classification-only for monitoring.

### January 15, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 15.1 | 🔄 | Holder Profiles & Similarity: fresh prices + wallet labels | 🔸 | `analysis-operations.processor.ts`, `token-info.service.ts`, `similarity.service.ts`, `dashboard/src/components/shared/WalletBadge.tsx`, `dashboard/src/hooks/useTokenMetadata.ts` |
| 15.2 | 🔄 | Wallet registry rollout | 🔸 | `src/config/known-wallets.ts`, `core/services/pnl-analysis-service.ts`, `queues/processors/similarity-operations.processor.ts`, `dashboard/src/components/shared/WalletBadge.tsx` |

**Summary:** Holder profiles now rehydrate token prices and recompute holding values during analysis, known wallets reuse the registry labels in every flow, similarity frontend cards display the updated wallet badges, and the registry now drives PnL/similarity exclusions as intended.


### January 13, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 13.9 | ?o. | Holder Profiles: Tooltip overhaul | dY"1 | `holder-profiles/v2` tooltips, copy cleanup, redundancy removal |
| 13.8 | dY"' | Holder Profiles: Bucket drilldown alignment plan | dY", | Align bucket stats + token lists; TokenPerformanceTab-style lazy loading & pagination |
| 13.7 | ✅ | Mapper: Stable USD value attribution & USD1 integration | 🔶", | `helius-transaction-mapper.ts`, `swap/analyzer.ts`, `token-metadata.ts`, `behavior/analyzer.ts`, `helius-transaction-mapper.test.ts` |
| 13.1 | 🔧 | Queue Stability: Orphaned Lock Cleanup on Startup | 🔶 | `queue.module.ts`, `redis-lock.service.ts` |
| 13.2 | 🔧 | Queue Stability: Fail-Fast Lock Acquisition | 🔶 | `*-operations.processor.ts` |
| 13.3 | 📊 | Lock Contention & Concurrent Analysis Metrics | 🔸 | `metrics.service.ts` |
| 13.4 | ✅ | Holder Profiles: Weighted Outcome Calculation | 🔸 | `holder-profiles/v2/utils/outcome-logic.ts` |
| 13.5 | ✅ | Holder Profiles: Visual Refinements | 🔹 | `TraderDistributionBar.tsx`, `CognitiveMetricCard.tsx` |
| 13.6 | ✅ | Holder Profiles: Approaching Hold Time Panel | 🔸 | `ApproachingHoldTimePanel.tsx` |

**Summary:** Queue stability architecture complete. Holder Profiles v2 UX refinements complete (pending final review). Mapper now treats stable USD (USDC/USDT/USD1) as a single value source to avoid double counting; USD1 fully integrated. Added fixture regression coverage for real txs.


### January 12, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 12.1 | ✅ | Discover Page: Layout & Filter Refactor | 🔶 | `discover/page.tsx`, `discover.service.ts` |
| 12.2 | ✅ | Discover Page: Column Reorganization & Interactions | 🔸 | `discover/page.tsx` |
| 12.3 | ✅ | Tracked Wallets: Layout & Columns Refactor | 🔶 | `trackers/page.tsx`, `user-favorites.service.ts` |

**Summary:** Discover and Tracked Wallets pages complete.

### January 7, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 7.1 | 🔧 | FIFO PnL: Pass ALL SPL Transfers | 🔶 | `swap/analyzer.ts`, `fifo-lot-tracker.ts` |
| 7.2 | 🔧 | FIFO PnL: Partial Realized PnL Support | 🔸 | `fifo-lot-tracker.ts` |
| 7.3 | 🔧 | Transaction Mapper: Self-Transfer & Order Op Fixes | 🔹 | `helius-transaction-mapper.ts` |

**Summary:** FIFO PnL correctness improvements. Partial history now surfaced with `hasIncompleteHistory=true`.

<details>
<summary><b>Icon Legend</b></summary>

**Type:**
✅ Completed • 🔧 Fix/Refactor • 📊 Metrics/Monitoring • 📝 Documentation • ⚖️ Decision • 🔴 Bug • 🔵 Feature

</details>

---

## 🗄️ Archive

<details>
<summary><b>December 2025 & Earlier</b></summary>

Major milestones moved here after completion. Keep Recent Activity focused on current work.

### Phase Completions
- **Phase 5:** FIFO PnL correctness improvements
- **Phase 4:** Similarity engine foundation
- **Phase 3:** Dashboard analytics v1

</details>

---

## ⚠️ Known Issues

| Severity | Issue | Impact | Location | Status |
|:--------:|:------|:-------|:---------|:------:|
| 🔴 | Database Deadlock in Token Metadata Upserts | Intermittent enrichment failures | `dexscreener.service.ts:upsertManyTokenInfo` | Open |
| 🟡 | Missing USD1 Denomination Support | Incomplete token value tracking | Multiple services | Resolved |

<details>
<summary><b>Details: Database Deadlock</b></summary>

**Error:** `PostgresError { code: "40P01", message: "deadlock detected" }`

**Cause:** Multiple parallel requests upserting same tokens during similarity/holder-profiles analysis.

**Potential Fixes:**
1. Retry logic with exponential backoff
2. Prisma `$transaction` with `Serializable` isolation
3. Sequential processing instead of parallel batches
4. Row-level locking or improved `ON CONFLICT` handling

</details>

<details>
<summary><b>Details: USD1 Support</b></summary>

Stable USD value attribution now supports USDC/USDT/USD1 with single-mint selection to avoid double counting. `associatedUsdcValue` is treated as generic stable USD value.

</details>

---

## 🏗️ Architecture Decisions

### Lock Scope Independence
*Decided: 2026-01-13*

Each analysis type uses isolated lock keys:

```
Dashboard:       lock:wallet:dashboard-analysis:{address}
PnL:             lock:wallet:pnl:{address}
Behavior:        lock:wallet:behavior:{address}
Sync:            lock:wallet:sync:{address}
Similarity:      lock:similarity:{requestId}
Holder Profiles: NO LOCK (relies on service idempotency)
```

**Rationale:** Services are idempotent. Database caching allows safe concurrent execution. Metrics track if contention becomes problematic.

---

### Queue Priority System
*Last Updated: 2026-01-13*

| Priority | Level | Use Case |
|:--------:|:-----:|:---------|
| 10 | CRITICAL | User dashboard requests (interactive) |
| 7 | HIGH | Similarity analysis |
| 5 | NORMAL | Regular analysis |
| 3 | LOW | Background enrichment |
| 1 | MAINTENANCE | Cleanup jobs |

**Fail-fast behavior:** Lock failures throw `UnrecoverableError` → immediate failure, no retry, worker freed. Prevents retry storms and priority inversion.

---

### FIFO PnL Logic
*Implemented: 2026-01-07*

**Key Changes:**
- SwapAnalyzer passes ALL SPL transfers to FIFO (no pre-filter)
- FIFO uses mapper value only; non-economic = `value==0`
- Partial realized PnL returned even with incomplete history
- Proceeds counted only for matched lots
- Token performance excludes stablecoins and noise tokens

**Reprocessing Required:** Mapper changes don't backfill. To apply fixes:
1. Clear `SwapAnalysisInput` for wallet
2. Re-sync wallet (mapping)
3. Re-run PnL analysis

**Debug Tools:**
```bash
.ai/context/FIFO_debug/validate-fifo-inputs.ts <WALLET> [MINTS]
.ai/context/FIFO_debug/inspect-analysis-result.ts <WALLET> <MINT>
```

---

## 📚 Quick Reference

### Key Code Locations

| Area | Path | Notes |
|:-----|:-----|:------|
| **Dashboard Components** | `dashboard/src/components/` | Primary work area |
| Discover Page | `dashboard/src/app/discover/` | ✅ Complete |
| Tracked Wallets | `dashboard/src/app/trackers/` | ✅ Complete |
| Holder Profiles v2 | `dashboard/src/components/holder-profiles/v2/` | 🔄 Final review |
| Similarity Lab | `dashboard/src/app/similarity-lab/` | 📝 Bug fixes pending |
| Analysis API | `src/api/controllers/analyses.controller.ts` | Backend endpoints |
| Queue System | `src/queues/processors/` | Job processing |
| Core Analysis | `src/core/analysis/` | Math & logic |

### Documentation Files

| File | Purpose |
|:-----|:--------|
| `CONTEXT.md` | Timeline, active tasks, decisions (this file) |
| `GUIDE.md` | Implementation roadmap, build instructions |
| `RULES.md` | AI agent execution contract |
| `HANDOFF.md` | Session start/end protocol |

---

## 💡 Usage Guide

### When to Update

✅ After completing tasks → Add to Recent Activity
✅ Starting new work → Add to Active Work
✅ Architectural decisions → Add to Architecture Decisions
✅ Discovering bugs → Add to Known Issues
✅ End of session → Update Current Focus, timestamp, and CHANGELOG.md for user-facing changes

### Entry Format

Recent Activity entries use: `DD.N` numbering (e.g., `13.1`, `13.2` for Jan 13)

```
| ID | Icon | Clear title | Scope | Key components/files |
```

- **ID:** Day.Sequence (13.1, 13.2, ...)
- **Icon:** Type indicator (✅ 🔧 📊 📝 ⚖️ 🔴 🔵)
- **Title:** What was accomplished
- **Scope:** 🔹 Small, 🔸 Medium, 🔶 Large
- **Components:** Shortened paths to key files

---

**Last Updated:** 2026-01-13 • **Branch:** `discover-analytics-ux`

