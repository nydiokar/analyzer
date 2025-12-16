# Layout Restructure Plan

**Date:** 2025-12-16
**Branch:** `pretty`
**Status:** Planning Complete - Ready for Execution

---

## Overview

Complete overhaul of the layout system to match modern web app patterns (inspired by Axiom, Linear, etc.).

**Key Changes:**
- ❌ Kill collapsible sidebar (outdated pattern, broken on mobile)
- ✅ Two distinct layouts: Landing (hero page) + App (top bar)
- ✅ Top bar navigation (horizontal, clean)
- ✅ No redundant "tool hub" page

---

## The Two-Layout System

### Layout 1: LandingShell (Unauthenticated Only)

**Purpose:** Onboarding + Call to Action

**File:** `dashboard/src/components/layout/LandingShell.tsx`

**Structure:**
```
┌─────────────────────────────────────────────┐
│ [Logo]                    [Login] [Sign Up] │ ← Minimal header (no main nav)
├─────────────────────────────────────────────┤
│                                             │
│             [Big Logo/Icon]                 │
│                                             │
│         "Strong Statement Here"             │ ← Tagline (TBD)
│                                             │
│    "Sova Intel is the professional          │
│     wallet analysis platform for Solana"    │ ← What we are
│                                             │
│          [Start Analyzing]                  │ ← Primary CTA
│                                             │
│         (subtle animation)                  │
└─────────────────────────────────────────────┘
```

**Features:**
- Clean hero page (like Axiom's landing)
- Logo top-left
- Login/Sign Up buttons top-right
- Center: Logo + strong statement + CTA
- Subtle animation (no animated orbs, keep it clean)
- No top bar navigation
- No sidebar

**Used By:**
- `/` (root) only

---

### Layout 2: AppShell (Authenticated - Main App)

**Purpose:** Main application experience (the "soul" of the app)

**File:** `dashboard/src/components/layout/AppShell.tsx`

**Structure:**
```
┌──────────────────────────────────────────────────────────────────────┐
│ [Logo+Name] [Nav Items...]         [Search] [⭐] [Profile ▼]        │ ← Top bar
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│                         Page Content                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Top Bar Breakdown (Left → Right):**

**LEFT SIDE:**
- Logo + "Sova Intel" → `/discover` (default home)
- Discover → `/discover` (placeholder, featured wallets)
- My Wallets → `/trackers` (user's tracked wallets)
- Similarity Lab → `/similarity-lab`
- Holder Profiles → `/holder-profiles`
- Top Holders → `/top-holders`

**RIGHT SIDE:**
- Search bar (middle-ish, more to the right)
- ⭐ Favorites button (token favorites - placeholder, other branch)
- Profile dropdown (Settings, Security, Logout, Admin if admin)

**Features:**
- Fixed top bar (always visible)
- Horizontal navigation (no sidebar)
- Mobile: Hamburger menu for nav items (low priority)
- Profile dropdown contains:
  - Settings
  - Security
  - Admin Panel (if `user.isAdmin === true`)
  - Logout

**Used By:**
- `/discover` (featured wallets - placeholder)
- `/trackers` (user's tracked wallets - placeholder)
- `/similarity-lab` (existing tool)
- `/holder-profiles` (existing tool)
- `/top-holders` (existing tool)
- `/wallets/[address]` (existing wallet detail)
- `/settings` (existing settings page)

**NOT Used By:**
- `/admin/*` (keeps its own layout, user-maintained)

---

## Page Structure

| Route | Layout | Purpose | Build Status |
|-------|--------|---------|--------------|
| `/` | LandingShell | Hero + CTA | Build now |
| `/discover` | AppShell | Featured wallets | Placeholder now, build later |
| `/trackers` | AppShell | User's tracked wallets | Placeholder now, build later |
| `/similarity-lab` | AppShell | Existing tool | Wire to AppShell |
| `/holder-profiles` | AppShell | Existing tool | Wire to AppShell |
| `/top-holders` | AppShell | Existing tool | Wire to AppShell |
| `/wallets/[address]` | AppShell | Wallet detail | Wire to AppShell |
| `/settings` | AppShell | User settings | Wire to AppShell |
| `/admin/*` | (Current) | Admin panel | Keep as-is |

---

## What Gets Built Now

### Phase 1: Core Layouts (~4 hours)

1. **LandingShell.tsx** (1.5h)
   - ThemeProvider wrapper
   - Minimal header (logo left, auth buttons right)
   - Clean layout, no nav

2. **AppShell.tsx** (2h)
   - Top bar component
   - Left: Logo + tool navigation links
   - Right: Search + Favorites + Profile dropdown
   - EmailVerificationBanner integration
   - Theme provider

3. **Update root layout** (0.5h)
   - Remove LayoutClientShell
   - Let pages choose their shell

### Phase 2: Landing Page (~2 hours)

1. **`/app/page.tsx`** (2h)
   - Use LandingShell
   - Hero section with logo
   - Strong statement (draft copy)
   - CTA button → Sign Up modal
   - Subtle animation
   - AuthModal integration

### Phase 3: Wire Existing Pages (~2 hours)

1. **Wrap pages in AppShell** (1.5h)
   - `/discover/page.tsx` (create placeholder)
   - `/trackers/page.tsx` (create placeholder)
   - `/similarity-lab/page.tsx` (wrap existing)
   - `/holder-profiles/page.tsx` (wrap existing)
   - `/top-holders/page.tsx` (wrap existing)
   - `/wallets/[address]/page.tsx` (wrap existing)
   - `/settings/page.tsx` (wrap existing)

2. **Profile dropdown** (0.5h)
   - Update UserMenu component
   - Add Settings, Security links
   - Conditional Admin Panel link
   - Logout action

### Phase 4: Placeholders (~1 hour)

1. **`/discover/page.tsx`** (0.5h)
   - Simple placeholder: "Discover Featured Wallets - Coming Soon"
   - Maybe show 2-3 sample wallet cards
   - Clean, minimal

2. **`/trackers/page.tsx`** (0.5h)
   - Simple placeholder: "My Tracked Wallets - Coming Soon"
   - Explain what it will be
   - Clean, minimal

### Phase 5: Polish (~1 hour)

1. **Testing** (0.5h)
   - Verify navigation works
   - Test auth flow (landing → sign up → discover)
   - Check dark mode

2. **Cleanup** (0.5h)
   - Remove old LayoutClientShell
   - Remove MarketingShell/ToolHubShell (if created)
   - Update CONTEXT.md

**Total Estimated Time:** ~10 hours

---

## What Gets Built Later

### Future Work (Not Now):

- ⏳ `/discover` full build (featured wallets, token search, explore UI)
- ⏳ `/trackers` full build (user's tracked wallets with stats, add/remove)
- ⏳ Token favorites (⭐ button functionality) - separate branch
- ⏳ Search improvements
- ⏳ Mobile responsive polish (low priority)
- ⏳ Color scheme overhaul (if needed - current shadcn defaults are fine for now)

---

## Design Decisions

### Why No Sidebar?
- Collapsible sidebar = outdated pattern
- Wastes horizontal space
- Broken UX on mobile
- Modern apps use top bars (GitHub, Notion, Linear, Axiom, etc.)

### Why Two Layouts?
- Landing needs to be clean, marketing-focused (no app nav)
- App needs persistent navigation (top bar)
- Clear separation of concerns

### Why "My Wallets" Not "Trackers"?
- "Trackers" doesn't speak to users
- "My Wallets" is clear and self-explanatory
- Industry standard naming

### Why `/discover` as Default?
- Public-friendly default landing after login
- Featured wallets = immediate value
- Can build out later with explore/search features

### Color Scheme?
- Keep current shadcn defaults for now
- AI-generated feel acknowledged, but not a blocker
- Easy to change later (CSS variables in `globals.css`)
- Focus on structure first, polish later

### Mobile?
- Low priority (wallet analysis not ideal on mobile)
- Needs dedicated app for good UX
- Desktop-first approach is acceptable

---

## Key Files to Create

```
dashboard/src/components/layout/
├── LandingShell.tsx          (new)
├── AppShell.tsx              (new)
└── TopBar.tsx                (new - or part of AppShell)

dashboard/src/app/
├── page.tsx                  (rewrite - landing hero)
├── discover/page.tsx         (new - placeholder)
└── trackers/page.tsx         (new - placeholder)
```

## Key Files to Update

```
dashboard/src/app/
├── layout.tsx                (remove wrapper)
├── similarity-lab/page.tsx   (wrap in AppShell)
├── holder-profiles/page.tsx  (wrap in AppShell)
├── top-holders/page.tsx      (wrap in AppShell)
├── wallets/[address]/page.tsx (wrap in AppShell)
└── settings/page.tsx         (wrap in AppShell)

dashboard/src/components/auth/
└── UserMenu.tsx              (add Settings/Security/Admin links)
```

## Key Files to Delete

```
dashboard/src/components/layout/
├── LayoutClientShell.tsx     (delete - replaced by AppShell)
├── MarketingShell.tsx        (delete if exists)
└── ToolHubShell.tsx          (delete if exists)
```

---

## Success Criteria

### Before:
- ❌ Collapsible sidebar (confusing, broken on mobile)
- ❌ No clear landing page
- ❌ Favorites buried in sidebar
- ❌ No default "home" after login

### After:
- ✅ Clean landing page (hero + CTA)
- ✅ Top bar navigation (modern, clean)
- ✅ Clear default home (`/discover`)
- ✅ Placeholders for future features (My Wallets, Favorites)
- ✅ Profile dropdown with all settings
- ✅ No sidebar collapse/expand complexity

---

## Boss Approval Checklist

- ✅ Industry-standard pattern (top bar, not sidebar)
- ✅ Clean landing page (like Axiom, Linear)
- ✅ No redundant "tool hub" page
- ✅ Placeholders for features (ship structure first)
- ✅ Mobile is low-priority (desktop-first is fine)
- ✅ Color polish deferred (structure first)
- ✅ Clear execution plan (~10 hours)

**Verdict:** Ship it. 🚀

---

## Notes

- Admin panel (`/admin/*`) stays untouched (user-maintained)
- Token favorites (⭐) is placeholder - functionality exists on another branch
- Copy for landing hero is TBD (draft something strong, not copied from Axiom)
- Search placement: middle-ish, more to the right
- Dark mode should work across both layouts (ThemeProvider in both shells)

---

**Last Updated:** 2025-12-16
**Ready for Execution:** ✅ YES
