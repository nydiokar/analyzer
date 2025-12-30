# Parallel Development Plan

**Date**: 2025-12-30
**Status**: Ready to Execute
**Base Branch**: `discover`

---

## Overview

Two LLMs working in parallel on separate branches to implement 7 UX/analytics/data-fix tasks.

---

## Branch 1: `discover-analytics-ux`

**LLM**: Agent 1
**Context File**: `.ai/context/BRANCH_analytics-ux.md`

### Tasks (4):
1. ✨ **Polish & UX Improvements** - Loading skeletons, error messages, empty states
2. 📊 **Collection-Based Analytics** - Performance metrics per collection in Trackers sidebar
3. 📈 **Speed/Flow Analytics** - Distribution visualizations in Discover sidebar
4. 🎭 **Exit Timing Drilldown Redesign** - Fix awful drilldown panel + hold metrics confusion

### Estimated Time: 12-16 hours

### Key Files:
- `dashboard/src/app/trackers/page.tsx`
- `dashboard/src/app/discover/page.tsx`
- Various component files for polish

### Risk Level: LOW
- All additive features
- No backend changes
- Different pages = minimal conflicts

---

## Branch 2: `discover-token-performance`

**LLM**: Agent 2
**Context File**: `.ai/context/BRANCH_token-performance.md`

### Tasks (3):
4. 🐛 **ROI Calculation Fix** - Handle dust trades causing -300% ROI
5. 🔧 **Time Filter Detachment** - Show holdings even when no trades in period
6. ♾️ **Infinite Scroll Pagination** - Replace horizontal pagination with vertical scroll

### Estimated Time: 7-10 hours

### Key Files:
- `src/core/services/pnl-analysis-service.ts` (backend)
- `src/api/services/token-performance.service.ts` (backend)
- `dashboard/src/components/dashboard/AccountStatsPnlTab.tsx` (frontend)

### Risk Level: MEDIUM
- Critical bug fixes (tasks 4-5)
- Backend + frontend changes
- Same component = potential conflicts (but sequential work reduces risk)

---

## Conflict Analysis

### Minimal Conflicts Expected:
- **Branch 1** touches: Trackers page sidebar, Discover page sidebar
- **Branch 2** touches: Token Performance tab only
- **No overlap** in primary work areas

### Potential Conflict:
- Both branches may touch `AccountStatsPnlTab.tsx`:
  - Branch 1: Loading skeletons, error handling (Task 1)
  - Branch 2: ROI display, time filter, pagination (Tasks 4-6)
- **Mitigation**: Task 1 in Branch 1 is minor changes (loading states), shouldn't conflict significantly

---

## Merge Strategy

### Step 1: Complete Work
- Agent 1 completes Tasks 1-3 on `discover-analytics-ux`
- Agent 2 completes Tasks 4-6 on `discover-token-performance`

### Step 2: Sequential Merge
```bash
# Option A: Merge both to discover
git checkout discover
git merge discover-analytics-ux  # Merge first branch
git merge discover-token-performance  # Merge second branch
# Resolve any conflicts

# Option B: Merge one, then rebase other
git checkout discover
git merge discover-analytics-ux
git checkout discover-token-performance
git rebase discover  # Rebase on updated discover
git checkout discover
git merge discover-token-performance
```

### Step 3: Test Integration
- Run both frontends
- Test all 6 features work together
- No broken functionality
- No console errors

### Step 4: Deploy
- When ready, merge `discover` → `main`
- Deploy backend first (no migrations needed for these tasks)
- Then merge triggers Vercel deploy

---

## Communication Protocol

### For Each Agent:
1. Read your branch context file (`.ai/context/BRANCH_*.md`)
2. Checkout your branch
3. Complete tasks in recommended order
4. Test incrementally
5. Commit after each task completion
6. Report completion with summary

### Completion Report Format:
```
Branch: discover-analytics-ux
Status: Complete

Tasks:
- [x] Task 1: Polish & UX Improvements
- [x] Task 2: Collection-Based Analytics
- [x] Task 3: Speed/Flow Analytics

Commits: 8 commits
Tests: All passing
Issues: None

Ready for merge.
```

---

## Success Criteria

### Branch 1:
- [ ] Loading skeletons on all tables
- [ ] Consistent error messages
- [ ] Collection analytics card with metrics
- [ ] Speed/Flow distribution cards in Discover
- [ ] Exit timing drilldown panel redesigned and usable
- [ ] Hold metrics structure clarified
- [ ] No TypeScript errors
- [ ] Lint passes

### Branch 2:
- [ ] ROI fixed for dust trades
- [ ] Time filter doesn't hide holdings
- [ ] Infinite scroll works smoothly
- [ ] All backend tests pass
- [ ] No TypeScript errors
- [ ] Lint passes

### Integration:
- [ ] Both branches merge cleanly
- [ ] All 6 features work together
- [ ] No regressions in existing features
- [ ] Performance is acceptable

---

## Rollback Plan

If issues arise:
```bash
# Rollback individual branch
git checkout discover
git reset --hard origin/discover

# Delete problematic branch
git branch -D discover-analytics-ux
# or
git branch -D discover-token-performance

# Start over on that branch only
```

---

## Timeline

**Estimated Total Time**: 15-21 hours of work (7.5-10.5 hours per agent)

**Realistic Timeline**:
- Day 1: Complete 60-70% of tasks
- Day 2: Finish remaining tasks + testing
- Day 3: Merge + integration testing

**Fast Timeline** (if both agents work full time):
- Day 1: Complete all tasks
- Day 2: Merge + integration + deploy

---

## Notes

- Both branches based on current `discover` (tracker page complete)
- No new migrations needed
- Mostly frontend work (Branch 1 100% frontend, Branch 2 60% backend)
- Low risk of breaking existing features (additive changes)
- Easy to test individually before merge
- Can deploy incrementally (Branch 1 first, then Branch 2)

---

## Reference

- **Main Context**: `.ai/CONTEXT.md`
- **Branch 1 Context**: `.ai/context/BRANCH_analytics-ux.md`
- **Branch 2 Context**: `.ai/context/BRANCH_token-performance.md`
- **Current State**: `.ai/CURRENT_STATE.md` (memory leak fixes, DB optimization)
