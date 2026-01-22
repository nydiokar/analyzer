# Sova Intel - Project Context

**Branch:** `discover-analytics-ux` • **Last Updated:** 2026-01-17 • **Status:** 🟢 Active Development

---

## 🎯 Current Focus

**System wallet detection wiring** - Ensuring holder profiles/similarity skip system wallets early and persist LP/Protocol tagging.

---

## 📋 Active Work

| Status | Task | Scope | Notes |
|:------:|:-----|:-----:|:------|
| 🔄 | Math error fixes & API reliability tuning | 🔸 | Testing and debugging through dashboard |
| 🔄 | Summary card skeleton regression | 🔸 | Summary card in wallet profile turns into skeleton after some time - investigate state/cache issue |
| 📝 | Holder Profiles bucket alignment (WR/ROI + token lists) | 🔸 | Single source of truth: analyzer outputs stats + tokenMap together; cache must persist both; drilldown endpoint reads same cache with pagination; UI hides WR/ROI if bucket has 0 tokens or token list unavailable |
| 📝 | Similarity Lab bug fixes | 🔸 | Ready to start | - PARTIALLY REFACTORED; NEED MORE WORK: make Most Common Tokens less fat and give more space to Historical vs Live Holdings Analysis; Strongest Convergences is awful with white background and white wallet 


<details>
<summary><b>Legend</b></summary>

**Status:** 🔄 In Progress • ⏸️ Blocked • 📝 Ready • ✅ Testing
**Scope:** 🔹 Small (<50 lines, <1hr) • 🔸 Medium (2-5 files, <4hrs) • 🔶 Large (5+ files, multi-day)

</details>

---

## 📅 Recent Activity

### January 22, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 22.1 | 🔧 | Error logging cleanup & circular reference fix | 🔸 | Logger crash prevention + clean error messages in user-facing flows |

**Summary:**

**22.1:** Fixed cascading logger failures caused by circular references in error objects. Added `safeStringify()` to logger and auto-sanitization of error metadata. Created `error-utils.ts` for clean error messages. Automated cleanup of 88 error logs across 15 critical user-facing files (similarity, PnL, holder profiles, API controllers, queue processors). Logs reduced from 50+ lines per error to single actionable lines. Added whale wallet protection in enrichment processor: 5k token hard cap, 0.01 minimum balance threshold, balance-sorted prioritization to prevent system overload from wallets with 20k+ dust tokens.

### January 17, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 17.1 | ✅ | Wallet type taxonomy simplification | 🔹 | Protocol wallet types (ORCA/JUPITER/RAYDIUM/METEORA) merged into unified PROTOCOL type with distinct labels |
| 17.2 | ✅ | Holder Profiles v2 final review | 🔹 | Complete UX polish and validation of holder profiles feature |
| 17.3 | ✅| Wallet refresh completion handling | ?? | `dashboard/src/components/layout/WalletProfileLayout.tsx`, `src/api/controllers/analyses.controller.ts`, `src/core/services/database-service.ts`, `dashboard/src/hooks/useTokenMetadata.ts` |
| 17.4 | 🔧 | System wallet detection wiring + holder profiles filtering | 🔸 | `src/queues/processors/analysis-operations.processor.ts`, `src/api/services/system-wallet-detection.service.ts`, `src/core/services/helius-api-client.ts` |

**Summary:**

**17.1:** Simplified wallet classification taxonomy by merging specialized DEX protocol types (ORCA, JUPITER, RAYDIUM, METEORA) into a single PROTOCOL wallet type. Each maintains distinct labels for identification while reducing type proliferation in the system.

**17.2:** Completed final review and validation of Holder Profiles v2 feature. All UX refinements, tooltip improvements, and bucket alignment work verified and ready for production use.

**17.4:** Wired dynamic system wallet detection into holder profile wallet-mode entry, filtered all holders before queueing jobs, and persisted LP/Protocol tags from top holders into DB/Redis so similarity can skip them consistently. Added thin count-only helper in Helius API client for early-exit detection and documented its use in system wallet detection.

### January 16, 2026

| ID | T | Title | Scope | Components |
|:--:|:-:|:------|:-----:|:-----------|
| 16.1 | ✅ | Wallet classification system: Defense-in-depth architecture | 🔶 | `constants.ts`, `system-wallet-detection.service.ts`, `helius-sync-service.ts`, `analysis-operations.processor.ts`, `pnl-analysis-service.ts`, `behavior.service.ts`, `WALLET_CLASSIFICATION_SYSTEM.md` |
| 16.2 | ✅ | Wallet registry integration & token price refresh | 🔶 | `known-wallets.ts`, `analysis-operations.processor.ts`, `token-info.service.ts`, `similarity.service.ts` |

**Summary:**

**16.1:** Completed full defense-in-depth architecture for wallet detection. Removed shouldBlock/isSystemWallet/isLargeWallet boolean flags. Removed WALLET_CLASSIFICATIONS.INVALID and .JUPITER. Implemented three-layer protection: (1) Entry points do early RPC detection before queueing expensive jobs (dashboard, analyze-pnl, analyze-behavior processors); (2) Sync service checks DB knownType and skips; (3) PnL/Behavior services check registry + DB knownType as safety net. 70k+ tokens auto-tagged with knownType='SYSTEM' during CURRENT run via RPC call. LARGE (15k-70k) uses isLarge flag, analyzed normally. All layers use SKIP_* exclusion sets for consistency. Registry + dynamic detection unified - same treatment whether wallet is in static registry or detected via RPC. DB query optimization: behavior service now fetches wallet once and reuses for both knownType and staleness checks (50% reduction). Comprehensive documentation with flow diagrams added.

**16.2:** Registry now lives in src/config/known-wallets.ts and drives central wallet-type filtering for PnL, similarity, and holder profiles. Holder profiles and similarity now pull fresh token prices during analysis and recompute holding values. Known wallet labels flow through backend analysis and are surfaced in holder profile results.

<details>
<summary><b>Icon Legend</b></summary>

**Type:**
✅ Completed • 🔧 Fix/Refactor • 📊 Metrics/Monitoring • 📝 Documentation • ⚖️ Decision • 🔴 Bug • 🔵 Feature

</details>


## ⚠️ Known Issues

| Severity | Issue | Impact | Location | Status |
|:--------:|:------|:-------|:---------|:------:|
| 🔴 | Database Deadlock in Token Metadata Upserts | Intermittent enrichment failures | `dexscreener.service.ts:upsertManyTokenInfo` | Open |

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

**Last Updated:** 2026-01-17 • **Branch:** `discover-analytics-ux`

