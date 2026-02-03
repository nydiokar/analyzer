# 🎯 HUD Integration - Quick Summary

**Full Plan:** See `.ai/HUD_INTEGRATION_PLAN.md` (comprehensive 700+ line document)

---

## ✅ What We're Building

**Goal:** Integrate HUD performance metrics into WalletBadge component using a "layer overlay" pattern.

**Core Principle:** HUD is NOT a replacement - it's a **supplementary layer** that appears on-demand to complete the badge with additional data.

---

## 🎨 Three Display Modes (Context-Adaptive)

### **1. Inline Expandable Row** (Tables)
- **Use:** Holder Profiles, Similarity pairs, Tracked wallets, Token holders
- **Trigger:** Table-level "Show HUD" toggle button
- **Format:** Compact single line below each wallet row
- **Example:** `🥇 M7.2h  +2.1 / -0  33% WR  40.1 T/D  🐋`
- **Features:** Batch fetch all HUD data, per-row expand/collapse, smooth animations

### **2. Delayed Hover Tooltip** (Lists/Cards)
- **Use:** Similarity pair cards, Top holders panel, Compact lists
- **Trigger:** Hover 800ms (intentional hover detection)
- **Format:** Multi-line detailed tooltip
- **Why 800ms?** Prevents "tooltip spam" from accidental mouse movement
- **Mobile:** Tap to show (no delay)

### **3. Expanded Grid** (Profile Pages)
- **Use:** Wallet profile page hero section
- **Trigger:** Always visible
- **Format:** Full 2-3 column grid with large metrics
- **Reuses:** Existing `WalletHudOverlay` component

---

## 🏗️ New Components

1. **`WalletHudInline.tsx`** - Compact single-line HUD variant
2. **`useBatchWalletHud.ts`** - Batch fetch hook (1 API call for 50+ wallets)
3. **`useTableHudToggle.ts`** - Table state management (toggle, expand/collapse)

---

## 🔧 WalletBadge Changes

**New Props (all optional, backward compatible):**
```typescript
interface WalletBadgeProps {
  // ... all existing props unchanged

  showHud?: boolean;                // Enable HUD (default: false)
  hudDisplay?: 'inline' | 'tooltip' | 'expanded' | 'none';
  hudData?: WalletHudDto | null;    // Pre-fetched from batch
  hudDelayMs?: number;              // Tooltip delay (default: 800ms)
}
```

**Integration Pattern:**
- Badge UI remains **100% unchanged** when `showHud={false}`
- HUD wraps or extends badge based on `hudDisplay` mode
- Batch-provided `hudData` takes precedence (performance optimization)
- Fallback to individual fetch if `hudData` not provided

---

## 📊 Rollout Plan

### **Phase 1: Foundation** (4-6 hours)
- Create `WalletHudInline.tsx`
- Create `useBatchWalletHud.ts`
- Create `useTableHudToggle.ts`

### **Phase 2: WalletBadge Integration** (3-4 hours)
- Add HUD props to WalletBadge
- Implement 3 display modes (switch statement)
- Add fallback fetching

### **Phase 3: Tables** (4-5 hours)
- MinimalHoldersTable.tsx ✅ (test case)
- EnhancedKeyInsights.tsx (similarity pairs)
- trackers/page.tsx (tracked wallets)
- TokenHolderPicker.tsx (token holders)

### **Phase 4: Tooltips** (2-3 hours)
- GlobalMetricsCard.tsx (top pairs)
- TopHoldersPanel.tsx (top holders)
- MostCommonTokens.tsx (token cards)

### **Phase 5: Profile** (1 hour)
- WalletProfileLayout.tsx (wallet profile)

**Total:** 14-20 hours (2-3 days)

---

## 🎯 Key Design Decisions

### **Why Three Modes?**
Different contexts have different constraints:
- **Tables:** Limited space, many wallets, need comparison → Expandable rows
- **Lists:** Compact, hover-friendly → Delayed tooltip
- **Profiles:** Plenty of space, single focus → Expanded grid

### **Why 800ms Tooltip Delay?**
- <800ms: Mouse passing through (ignore)
- ≥800ms: Intentional hover (show tooltip)
- Prevents "tooltip spam" while still being responsive

### **Why Batch Fetching?**
- **Bad:** 50 wallets = 50 API calls ❌
- **Good:** 50 wallets = 1 API call ✅
- Fetch at component level, pass down as props

### **Why Layer Overlay Pattern?**
- Keeps WalletBadge clean and recognizable
- Zero clutter by default
- HUD is additive, not transformative
- Backward compatible (all existing usages work unchanged)

---

## ⚠️ Critical Rules for Implementation

### **DO:**
✅ Keep WalletBadge UI unchanged when `showHud={false}`
✅ Always batch fetch (never in loops)
✅ Use 800ms delay for tooltips (prevent hover spam)
✅ Make all new props optional (backward compatibility)
✅ Handle loading/error states gracefully

### **DON'T:**
❌ Modify WalletBadge when HUD disabled
❌ Fetch HUD per-wallet in loops
❌ Use instant tooltips (creates clutter)
❌ Make HUD required or always-on
❌ Break existing WalletBadge usages

---

## 🧪 Validation Criteria

**Functionality:**
- ✅ All 3 modes work in their contexts
- ✅ No regressions in existing WalletBadge usages
- ✅ Batch fetch works for 1-200 wallets

**Performance:**
- ✅ Batch fetch 100 wallets <500ms
- ✅ Table toggle <100ms
- ✅ No tooltip flicker

**UX:**
- ✅ No tooltip spam (800ms works)
- ✅ Table toggle is discoverable
- ✅ HUD is scannable at-a-glance

---

## 📁 Files to Create/Modify

**New Files (3):**
- `dashboard/src/components/shared/WalletHudInline.tsx`
- `dashboard/src/hooks/useBatchWalletHud.ts`
- `dashboard/src/hooks/useTableHudToggle.ts`

**Modified Files (9):**
- `dashboard/src/components/shared/WalletBadge.tsx` (+80-120 lines)
- 4 table components (+40-60 lines each)
- 3 list/card components (+15-30 lines each)
- 1 profile component (+10-15 lines)

**Total LOC:** ~700-1000 lines

---

## 🚀 Next Steps

1. Review full plan in `.ai/HUD_INTEGRATION_PLAN.md`
2. Confirm design decisions (3 modes, 800ms delay, etc.)
3. Start with Phase 1 (foundation components)
4. Test in MinimalHoldersTable (best test case)
5. Roll out to remaining contexts
6. Iterate based on user feedback

---

**Status:** 📝 Ready for Implementation
**Priority:** P1 - High Value UX Enhancement
**Effort:** 2-3 days (14-20 hours)
