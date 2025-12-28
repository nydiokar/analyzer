# Component Impact Map - Classification Refactor

**Generated**: 2025-12-25 | **Source**: `analyze-classification-usage.ts` scan
**Total Impact**: 67 files, 863 usages

---

## Blast Radius Visual

```
┌─────────────────────────────────────────────────────────────────┐
│  LOW LEVEL (Data & Computation)          88 + 68 + 41 = 197    │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐           │
│  │ analyzer.ts  │  │ constants.ts │  │ behavior.ts │           │
│  │  88 usages   │  │  68 usages   │  │ 41 usages   │           │
│  └──────────────┘  └──────────────┘  └─────────────┘           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  MID LEVEL (Transport & API)              29 + 27 = 56          │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐ │
│  │ discover.svc.ts │  │ behavior.svc.ts  │  │ analyses.ctrl  │ │
│  │   29 usages     │  │   27 usages      │  │  14 usages     │ │
│  └─────────────────┘  └──────────────────┘  └────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  HIGH LEVEL (Frontend)                    55 + 43 + 33 = 131    │
│  ┌─────────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │ BaseballCard.tsx│  │ discover.tsx  │  │ BehavioralTab.tsx│  │
│  │   55 usages     │  │  43 usages    │  │   33 usages      │  │
│  └─────────────────┘  └───────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

Total Critical Files: 36 (files with 5+ usages)
```

---

## Top 10 Critical Files (Ranked by Impact)

| Rank | File | Usages | Layer | Change Type |
|------|------|--------|-------|-------------|
| 1 | `analyzer.ts` | 88 | LOW | **MAJOR** - Add new fields, holder bypass |
| 2 | `constants.ts` | 68 | LOW | **MEDIUM** - Rename types, add thresholds |
| 3 | `WalletBaseballCard.tsx` | 55 | HIGH | **MINOR** - Use strategyType in fallback |
| 4 | `discover/page.tsx` | 43 | HIGH | **MINOR** - Display new labels |
| 5 | `behavior.ts` (types) | 41 | LOW | **MAJOR** - Add 3 new types |
| 6 | `analysis-ops.processor.ts` | 40 | MID | **VALIDATION** - Verify no breaks |
| 7 | `BehavioralPatternsTab.tsx` | 33 | HIGH | **MINOR** - Use speedCategory |
| 8 | `discover.service.ts` | 29 | MID | **MAJOR** - Add enum filters |
| 9 | `behavior.service.ts` | 27 | MID | **CRITICAL** - Fix broken cache bug |
| 10 | `api.ts` (types) | 27 | HIGH | **MEDIUM** - Add frontend types |

---

## Field Usage Breakdown

| Field | Usages | Files | Status | Action |
|-------|--------|-------|--------|--------|
| `behaviorType` | 143 | 23 | ✅ EXISTS | Read from DB (was: parsed from string) |
| `tradingStyle` | 88 | 19 | ⚠️ DEPRECATED | Rename → `tradingStyleLabel` |
| `HOLDER` keyword | 63 | 18 | 🔴 COLLISION | Rename in flow pattern → `BUY_ONLY` |
| `flipperScore` | 44 | 12 | ⚠️ DEPRECATED | Rename → `velocityScore` |
| `speedCategory` | 0 | 0 | 🆕 NEW | Add to DB + types |
| `flowPattern` | 0 | 0 | 🆕 NEW | Add to DB + types |
| `strategyType` | 0 | 0 | 🆕 NEW | Add to DB + types |

---

## Change Impact by Layer

### LOW LEVEL (6 files, ~200 usages)

| File | LOC Impact | Effort | Risk |
|------|-----------|--------|------|
| `analyzer.ts` | +150 lines | 2 days | 🟡 Medium |
| `constants.ts` | +50 lines | 0.5 day | 🟢 Low |
| `behavior.ts` | +80 lines | 0.5 day | 🟢 Low |
| `behavior-service.ts` | +30 lines | 0.5 day | 🟢 Low |
| `schema.prisma` | +10 lines | 0.25 day | 🟢 Low |
| `bot-detector.ts` | +10 lines | 0.25 day | 🟢 Low |

**Total Low Level**: ~330 lines, 4 days

---

### MID LEVEL (8 files, ~120 usages)

| File | LOC Impact | Effort | Risk |
|------|-----------|--------|------|
| `behavior.service.ts` | +50, -30 (fix bug) | 0.5 day | 🔴 High (broken) |
| `discover.service.ts` | +40 lines | 1 day | 🟢 Low |
| `behavior-response.dto.ts` | +30 lines | 0.25 day | 🟢 Low |
| `discover-wallet.dto.ts` | +20 lines | 0.25 day | 🟢 Low |
| `wallets.controller.ts` | +15 lines | 0.25 day | 🟢 Low |
| `analyses.controller.ts` | +10 lines | 0.25 day | 🟢 Low |
| `holder-profiles-cache.service.ts` | +20 lines | 0.5 day | 🟡 Medium |
| `analysis-ops.processor.ts` | 0 (validation only) | 0.25 day | 🟢 Low |

**Total Mid Level**: ~185 lines, 3.25 days

---

### HIGH LEVEL (7 files, ~160 usages)

| File | LOC Impact | Effort | Risk |
|------|-----------|--------|------|
| `api.ts` (frontend types) | +60 lines | 0.5 day | 🟢 Low |
| `discover.tsx` | +20 lines | 0.5 day | 🟢 Low |
| `WalletBaseballCard.tsx` | +5 lines | 0.25 day | 🟢 Low |
| `BehavioralPatternsTab.tsx` | +10 lines | 0.25 day | 🟢 Low |
| `ExitTimingDrilldownPanel.tsx` | +5 lines | 0.25 day | 🟢 Low |
| `MinimalHoldersTable.tsx` | +5 lines | 0.25 day | 🟢 Low |
| `WalletProfileLayout.tsx` | +5 lines | 0.25 day | 🟢 Low |

**Total High Level**: ~110 lines, 2.25 days

---

### SCRIPTS (14 files, ~140 usages)

| File | LOC Impact | Effort | Risk |
|------|-----------|--------|------|
| `validate-holder-risk.ts` | +15 lines | 0.25 day | 🟢 Low |
| `validate-behavior-metrics.ts` | +15 lines | 0.25 day | 🟢 Low |
| `generate-holder-analysis.ts` | +10 lines | 0.25 day | 🟢 Low |
| `generate-prediction-report.ts` | +10 lines | 0.25 day | 🟢 Low |
| 10 other scripts | +5 each | 1 day total | 🟢 Low |

**Total Scripts**: ~100 lines, 2 days

---

## TOTAL REFACTOR EFFORT

| Layer | Files | Lines | Days | Risk |
|-------|-------|-------|------|------|
| Low (Core) | 6 | ~330 | 4.0 | 🟡 Medium |
| Mid (API) | 8 | ~185 | 3.25 | 🔴 High (cache bug) |
| High (UI) | 7 | ~110 | 2.25 | 🟢 Low |
| Scripts | 14 | ~100 | 2.0 | 🟢 Low |
| Testing | - | ~400 | 2.0 | - |
| **TOTAL** | **35** | **~1,125** | **13.5** | **🟡 Medium** |

**Realistic estimate**: 8-10 days (with parallelization)

---

## Critical Path

```
Day 1:  Schema + Types (blocking)
        ↓
Day 2-3: Analyzer (blocking)
        ↓
Day 4:  Persistence + Cache Fix (blocking)
        ↓
Day 5:  API Layer (blocking for frontend)
        ↓
Day 6:  Frontend (parallel with scripts)
Day 6:  Scripts (parallel with frontend)
        ↓
Day 7-8: Testing + Backfill
        ↓
Day 9-10: Buffer + Documentation
```

---

## Risk Hotspots

| Component | Issue | Impact | Mitigation |
|-----------|-------|--------|------------|
| `behavior.service.ts:143` | **BROKEN** - `extractBehaviorType()` never works | 🔴 High | Delete method, read from DB |
| `analyzer.ts:1552` | Pure holders excluded by gate | 🔴 High | Add holder bypass |
| `discover.service.ts:99` | ILIKE substring matching | 🟡 Medium | Add enum filters |
| All 14 scripts | String parsing (fragile) | 🟡 Medium | Use explicit fields |
| Baseball card fallback | Already handles holders! | 🟢 Low | Minor tweak only |

---

## Backward Compatibility

**v1 (current)**:
- `tradingStyle` (composite string)
- `flipperScore` (0-100)
- `behaviorType` (optional, from historicalPattern)

**v2 (new)**:
- `speedCategory`, `flowPattern`, `strategyType` (explicit enums)
- `velocityScore` (professional term)
- `tradingStyleLabel` (display only)

**Strategy**: Dual support for 6+ months (keep deprecated fields)

---

## Data Migration

**Existing wallets**: ~10,000 (estimate)
**Backfill time**: 5-6 hours (background job)
**Strategy**: BullMQ queue with low priority

---

**Related**:
- Full Plan: `.ai/context/discover_classification_refactor_plan.md`
- Taxonomy: `.ai/context/classification_taxonomy_map.md`
- Raw Data: `.ai/context/classification_usage_report.json`
