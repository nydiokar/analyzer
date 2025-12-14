# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `pretty` (design system implementation)
**Goal**: Apply modern, professional design system to the dashboard while preserving functionality
**Status**: Phase 1.2 COMPLETE ✅ - Ready for Week 2
**Last Updated:** 2025-12-09

**What's Done (Phase 1.2):**
- ✅ All dashboard components migrated to shadcn + custom design system
- ✅ Made fully responsive with proper overflow scrolling (works on laptop screens)
- ✅ Reduced font sizes for compact, readable display
- ✅ Fixed TypeScript errors in tab components
- ✅ Polished all shared components (TokenBadge, WalletBadge, Sidebar) with rounded corners and hover effects
- ✅ **Removed Overview tab** (AI overview feature postponed)
- ✅ AccountSummaryCard made more compact with smaller metrics

**Performance Note:**
- Dev mode Lighthouse shows low scores (expected - unoptimized dev build)
- Production build will be much faster (minified, optimized)
- Not critical for internal tool

### Latest Summary (2025‑12‑10)
- **Email verification with React Email** ✅ Complete: Professional email templates via React Email, clickable verification URLs (no copy-paste), Resend integration, route protection via middleware + client guards, verification page handles logged-in/out users.
- Admin flag now lives entirely on the controller layer so auth responses expose `isAdmin`, restoring the Admin Panel entry in the UI; fetcher now surfaces structured error codes for better UX.

### Next Tasks

#### **PRIORITY: UX & Design Improvements (New - 2025-12-12)**
1. **Holder Profile Color Scheme** – Improve trader category colors for better visual hierarchy and intuition. Current colors aren't eye-friendly or intuitive for different trader categories. Research industry-standard color schemes for trader classifications (e.g., Fast Exit, Diamond Hands, etc.).

2. **TokenBadge Redesign** – Transform into an always-visible, resizable profile component:
   - ✅ **Implemented**: Always-visible inline badge with s/m/l/xl (sm/md/lg aliases) showing name→Solscan, copyable symbol, market-cap chip, gmgn + socials inline.
   - ✅ Merges provided metadata with fetched batch data so partial callers still get enrichment.
   - ✅ Small size shows full icon row; price/volume/liquidity dropped—only market cap shown from market data.
   - **Next**: Swap truncated token address on Holder Profiles token-mode view for the TokenBadge component.

3. **Comprehensive Tooltips** – Add tooltips everywhere to explain concepts in practice:
   - **Trader Categories**: Hover over classification to see what it means (e.g., "Fast Exit: Traders who typically sell within 1 hour of purchase")
   - **Median vs Average**: Explain the difference in simple, user-friendly terms
   - **Exit Timing Metrics**: What does "Fast Exit (median 23m)" mean in practice? Why is it useful?
   - **Hold Times**: Clarify what each metric represents and how to interpret it
   - **All Dashboard Metrics**: User-friendly explanations for every data point - assume non-technical users

4. **Fast Exit Metric Clarification** – In aggregated data fields (holder profile cards):
   - **Current Issue**: Shows "Fast Exit (median 23m)" then repeats "(median 23m)" - redundant
   - **Fix**: Show both meaningful metrics: "Fast Exit (median: 23m, avg: 45m)" or similar
   - **Add Tooltip**: Explain median vs average for this specific context - keep it super short (1-2 sentences max)
   - Make it immediately clear which number is which

5. **Time Unit Disambiguation** – Fix ambiguous time format display:
   - **Current Issue**: Both minutes and months show as "35m" and "7m" - impossible to tell which is which
   - **Verify First**: Check if this ambiguity actually exists in the UI
   - **Fix Options**: Use clear formats like "35 min" vs "7 mo" OR "35m" vs "7M" (capital M for months)
   - **Research**: Follow industry best practices for time duration display
   - **Ensure Consistency**: Apply same format across all components (holder profiles, exit timing, hold duration, etc.)

#### **PRIORITY: Critical Bugs to Investigate (New - 2025-12-12)**
6. **JWT Session Expiration Bug** – Sessions clearing after ~20 minutes unexpectedly:
   - **Current Behavior**: Users being logged out after approximately 20 minutes
   - **Expected**: JWT_EXPIRES_IN=7d in .env.example suggests 7-day sessions
   - **Investigate**:
     - Frontend token storage mechanism (localStorage vs memory vs cookies)
     - Backend JWT expiration configuration
     - Refresh token logic (if implemented)
     - Browser/network interceptors that might be clearing tokens
   - **Research**: Industry standard session duration (7 days vs 14 days vs 30 days for "remember me")
   - **Goal**: Determine if 20-minute logout is a bug or misconfiguration, fix to match expected 7-day duration

7. **Holder Profile Classification Bug** – "Unclassified" showing incorrectly:
   - **Scenario**: Wallets with no exited tokens (only holding) show as "Unclassified"
   - **Expected**: Should have appropriate classification based on holding behavior patterns
   - **Examples**: Long-term holder, accumulator, etc. - even without exits
   - **Action**:
     - Debug wallet classification logic in holder profile analyzer
     - Review classification criteria - why does it require exit data?
     - Consider separate classification for "holders only" vs "traders"
   - **Question**: Is "Unclassified" the intended behavior or a gap in the classification system?

#### **Original Planned Tasks**
8. ~~**Resend integration**~~ ✅ DONE – React Email templates + Resend configured with verify@sova-intel.com sender.
9. **Landing page removal** – Remove the standalone landing page at `/` (and any references) so we don't maintain unused marketing content.
10. **Route reshuffle** – Make `/home` the default route and update the sidebar logo to link there.
11. **Home redesign plan** – Outline/plan a modern single-page scrolling "tool showcase" for Home that highlights each module before we rebuild it.
12. **Layout separation** – Design a layout split so Home uses a dedicated shell (no sidebar), while the sidebar remains in the tool hub only; document the approach before coding.
13. **Reset-password UX** – Hook up the dashboard reset-password flow (request + token-based reset) to the existing backend endpoints so users can trigger the journey end-to-end.
14. **Global theme toggle** – Extend the existing dark/light theme controls from the dashboard shell to the entire app (landing + home + tool hub), so users set their preference once and it applies everywhere.
15. **User analysis timeline** – Add a simple timeline/history page that surfaces a user's recent jobs (submitted, running, completed) with status and timestamps, so they can track work without digging through logs. What Is the way to actually implement this with hyperlinks or some sort of navigation, if you did analysis of a token or a wallets, and you refresh you need to find them once more, but we need to be able to re-run jobs with ease - just one click in the history.
16. **First-run onboarding flow** – Replace the post-registration drop-off with a guided checklist (verify email → sync wallet → explore tool hub). Ties into the new layout split so unauthenticated vs. tool hub experiences feel purpose-built.
17. **Fix favorites API spam** – useFavorites hook calls /users/me/favorites before email verification, causing throttling errors. Add emailVerified check.
18. **Search on sidebar** – Currently using only API key auth, not the new JWT system. Update to support JWT authentication. 

---

## Architecture Context

**Authentication System (Incoming from `feature/user-jwt-auth` branch):**
- JWT-based user authentication (email/password)
- Email verification required for analysis
- Admin panel for API key management
- Dual auth: JWT (users) + API keys (services)
- 7 auth components built (AuthModal, SignInModal, SignUpModal, UserMenu, etc.)

**Current Frontend Stack:**
- Next.js 14 (App Router)
- Tremor.dev (charts/metrics) - Will keep charts, migrate layout components
- shadcn/ui (base components)
- Tailwind CSS

---

## Next Tasks (Roadmap)

### **Week 1: Foundation + Dashboard Components** (~40 hours)

#### **Phase 1.1: Design Tokens** (Day 1, 8h)
- [x] Update `dashboard/tailwind.config.ts` with shadow tokens
  - Add `shadow-base`, `shadow-hover`, `shadow-active`
  - Add border-radius overrides (`xl: 1rem`, `2xl: 1.5rem`)
- [x] Create `dashboard/src/components/ui/metric.tsx`
  - Custom Metric component (replaces Tremor Metric)
  - Variants: default, success, error, warning, info
  - Sizes: sm, md, lg, xl
  - Props: prefix, suffix
- [x] Create `dashboard/src/components/ui/stat-card.tsx`
  - Standardized secondary metrics card
  - Variants: default, success, error, warning
  - Props: label, value, subValue, icon
- [x] Build test page `dashboard/src/app/test-components/page.tsx`
  - Show all Metric variants and sizes
  - Show all StatCard variants
  - Test dark mode
  - Mobile responsive check

#### **Phase 1.2: Dashboard Component Migration** (Days 2-4, 24h)
- [x] Migrate `AccountSummaryCard.tsx` (4h)
  - Replace Tremor Card/Metric with shadcn + custom components
  - Change padding: `p-3` → `p-6`
  - Add shadow: `shadow-base hover:shadow-hover`
  - Primary metric: large, bold, clear hierarchy
  - Secondary metrics: StatCard grid (2 columns)
  - Test all states: loading, error, success, empty
  - Verify dark mode, mobile responsive
- [x] Migrate `TokenPerformanceTab.tsx` (2h)
  - Replace Tremor Card wrapper with shadcn Card
  - Add `rounded-xl shadow-base`
  - Keep table logic unchanged
  - Test filters, pagination, sorting
- [x] Migrate `BehavioralPatternsTab.tsx` (3h)
  - Replaced Tremor Card wrappers with shadcn + local helpers
  - Migrated to Title/Text/Flex helpers, kept Metric display logic
  - **Tremor charts kept unchanged** (AreaChart, BarChart, etc.)
- [x] Migrate `AccountStatsPnlTab.tsx` (4h)
  - Replaced Tremor primitives with shadcn + local helpers (Title/Text/Flex/Grid/TabGroup)
  - Made fully responsive with proper overflow scrolling
  - Reduced font sizes for compact display on laptops
  - Fixed TypeScript errors in Tab components
  - Tested all three modes (Period, All-Time, Both)
- [x] Polish `AccountSummaryCard.tsx`
  - Made more compact with smaller fonts (text-sm for metrics, text-[10px] for labels)
  - Fixed skeleton to match actual rectangular layout
  - Reduced padding and spacing throughout
- [x] Polish shared components (2h)
  - `TokenBadge.tsx`: Added `rounded-lg`, `hover:shadow-hover`, `hover:bg-accent/50`
  - `WalletBadge.tsx`: Added `rounded-lg`, `hover:shadow-hover`, `hover:bg-accent/50`
  - `Sidebar.tsx`: Updated nav items to `rounded-lg`, faster transitions (200ms)

#### **Phase 1.3: Testing & Validation** (Day 5, 8h)
- [ ] Manual regression testing
  - Test `/wallets/[address]` with all tabs (Token Performance, Account Stats, Behavioral Patterns, Notes)
  - Test all wallet states (analyzed, unanalyzed, error)
  - Test loading skeletons
  - Verify dark mode consistency
  - Mobile responsive check (375px, 768px, 1024px)
- [ ] Performance check (optional)
  - Run Lighthouse in Chrome DevTools (just a sanity check - scores 0-100 for performance/accessibility)
  - Check bundle size didn't explode
  - Verify no layout shifts
- [ ] Fix any issues found

**Note:** Lighthouse = browser tool in Chrome DevTools for checking performance/accessibility scores. Not critical, just nice to verify nothing broke.

## Recently Completed (Last 3-4 Days)

- **Email Verification with React Email** ✅ (2025-12-10)
  - [x] **Backend**: React Email templates + Resend integration
    - Installed @react-email/components and @react-email/render
    - Created VerificationEmail.tsx template (professional design with button + fallback URL)
    - Updated EmailService to render React Email templates
    - Configured TypeScript for JSX support in backend (tsconfig.json)
    - Email sender format: "Sova Intel <verify@sova-intel.com>"
  - [x] **Frontend**: Verification flow with route protection
    - Created /verify page to handle verification links (logged-in/out users)
    - Added Next.js middleware for route protection (/wallets, /home, /tools require auth)
    - Created RequireVerifiedEmail wrapper component for email verification gates
    - Protected pages: /wallets/[address], /home with verification requirement
    - Handles verify-token URL parameter for logged-out users clicking email links
  - [x] **UI Updates**:
    - Removed manual token copy-paste flow from EmailVerificationBanner
    - Simplified banner to show "Resend verification email" button only
    - Updated AuthModal success message
    - Verify page redirects to /home after successful verification
  - **Known UX issues** (defer to layout refactor):
    - Favorites API called before email verification (causes throttling)
    - verify-token parameter persists after logout
    - Double verification attempt (verify page + home page)
  - **Status**: ✅ Core functionality complete, UX polish deferred to layout refactor

- **Admin Panel for API Key Management** ✅ (2025-12-04)
  - [x] **Backend**: Admin REST API endpoints for API key CRUD operations
    - `GET /admin/api-keys` - List all API keys with user info
    - `POST /admin/api-keys` - Create new API key (returns plain key once)
    - `PATCH /admin/api-keys/:keyId/revoke` - Revoke API key
    - `PATCH /admin/api-keys/:keyId` - Update API key metadata
    - `DELETE /admin/api-keys/:keyId` - Delete API key permanently
    - Created `AdminController` (`src/api/controllers/admin.controller.ts`)
    - Created `AdminModule` (`src/api/modules/admin.module.ts`)
    - All endpoints protected with `@AdminOnly()` decorator
  - [x] **Frontend**: Invisible admin panel (100% hidden from non-admins)
    - Created `/admin/api-keys` page (`dashboard/src/app/admin/api-keys/page.tsx`)
    - Silent redirect to home if user is not admin (no error, no toast, no 403 page)
    - Admin link in sidebar only visible when `user?.isAdmin === true`
    - Full CRUD UI: create with scopes selection, list with status badges, revoke/delete actions
    - One-time API key display after creation with copy-to-clipboard
  - [x] **Auth Flow Updates**:
    - Added `isAdmin: boolean` to `User` interface in auth store
    - Updated `/auth/me` endpoint to return `isAdmin` flag (checks `AdminGuard.isUserAdmin()`)
    - Updated login/register flows to include `isAdmin` in user data
  - **Key Implementation Details**:
    - Admin check: `AdminGuard.isUserAdmin()` checks `ADMIN_USER_IDS` and `ADMIN_EMAILS` env vars
    - Completely invisible UX: Non-admins never see link, never see 403, silently redirected
    - No flash of content: Returns `null` immediately if not admin
  - **Files Created**:
    - `src/api/controllers/admin.controller.ts` (AdminController with DTOs)
    - `src/api/modules/admin.module.ts` (AdminModule)
    - `dashboard/src/app/admin/api-keys/page.tsx` (Admin panel UI)
  - **Files Modified**:
    - `src/api/controllers/auth.controller.ts` (added `isAdmin` to `/auth/me`)
    - `src/api/shared/guards/admin.guard.ts` (added `isUserAdmin()` helper)
    - `src/api.module.ts` (registered AdminModule)
    - `dashboard/src/store/auth-store.ts` (added `isAdmin` to User interface)
    - `dashboard/src/hooks/useAuth.ts` (updated login/register to include isAdmin)
    - `dashboard/src/components/layout/Sidebar.tsx` (conditional admin link with Shield icon)
  - **Status**: ✅ Backend builds, frontend builds with warnings only, ready for testing

- **JWT Authentication System Merge & Security Hardening** ✅ (2025-12-03)
  - [x] Merged `feature/user-jwt-auth` branch into `main` (11 conflicting files resolved)
  - [x] Dual authentication: JWT (new users) + API Keys (legacy/services)
  - [x] Security architecture finalized: AdminGuard for sensitive endpoints
  - [x] Health monitoring secured: all `/health/*` endpoints require admin privileges
  - [x] Prometheus metrics endpoint: `/health/metrics` with proper admin-only protection
  - [x] Documentation: `docs/monitoring/PROMETHEUS_SETUP.md` created
  - **Key Architectural Decisions**:
    - JWT for human users (identity-based, checks `ADMIN_USER_IDS`/`ADMIN_EMAILS`)
    - API keys for services (permission-based with scopes: `read`, `report`, `analysis`, `admin`, `full`)
    - No scopes in JWT (intentional) - admin checks via environment variables for instant revocation
    - CompositeAuthGuard: tries JWT first, falls back to API key authentication
    - Health endpoints protected from infrastructure enumeration attacks
  - **Files Modified**:
    - `package.json`, `prisma/schema.prisma` (merged auth + main features)
    - All controllers: auth imports added, decorators preserved
    - `health.controller.ts`: `@AdminOnly()` on `/detailed`, `/queues`, `/cache-metrics`, `/metrics`
    - Frontend layouts: merged auth UI with main's optimizations
  - **Status**: ✅ Builds successfully, ready for deployment

- **Exit Timing Token Drilldown** ✅ (2025-11-20) - See "Completed" section below for full details
- **Dashboard Components Documentation** ✅ (2025-11-20) - Comprehensive `dashboard/docs/components-overview.md` update

---

### **Week 2: Layout Architecture + Home Redesign** (~40 hours)

#### **Phase 2.1: Dual Shell System** (Days 1-2, 16h)
- [ ] Create `dashboard/src/components/layout/MarketingShell.tsx` (2h)
  - No sidebar, just ThemeProvider + ThemeToggle
  - Clean wrapper for landing page
  - Test in isolation
- [ ] Create `dashboard/src/components/layout/ToolHubShell.tsx` (2h)
  - With sidebar, EmailVerificationBanner
  - SWR config, cache provider
  - Copy logic from existing LayoutClientShell
  - Test sidebar collapse/expand
- [ ] Update `dashboard/src/app/layout.tsx` (1h)
  - Remove LayoutClientShell wrapper
  - Pages now choose their own shell
- [ ] Update existing pages to use shells (3h)
  - Landing (`/page.tsx`): Wrap in MarketingShell
  - `/wallets/[address]/page.tsx`: Wrap in ToolHubShell
  - `/similarity-lab/page.tsx`: Wrap in ToolHubShell
  - `/tools/*/page.tsx`: Wrap in ToolHubShell
  - `/settings/page.tsx`: Wrap in ToolHubShell
- [ ] Test shell system (2h)
  - Verify sidebar shows on tool pages
  - Verify sidebar hidden on landing
  - Test navigation between pages
  - Check theme persistence
- [ ] Update Sidebar logo link (0.5h)
  - Change from `/` to `/home`
- [ ] Documentation (0.5h)
  - Update component-overview.md with shell info

#### **Phase 2.2: Landing Page Polish** (Day 2, 4h)
- [ ] Update `dashboard/src/app/page.tsx`
  - Remove animated gradient orbs (performance)
  - Keep static gradient background
  - Keep auth CTAs (Sign In, Sign Up)
  - Keep featured wallets section
  - Clean, minimal design

#### **Phase 2.3: Home Page Redesign** (Days 3-4, 16h)
- [ ] Create ToolCard component (2h)
  - Props: title, description, icon, href, features[]
  - Card with hover effect (shadow-hover)
  - Feature list with checkmarks
  - Group hover for title color
- [ ] Create QuickActionCard component (1h)
  - Smaller variant for quick actions
  - Icon + title only
- [ ] Redesign `dashboard/src/app/home/page.tsx` (10h)
  - Hero section: Welcome message, personalized greeting
  - Tool cards grid (4 cards):
    - Wallet Analysis
    - Similarity Lab
    - Holder Profiles
    - Top Holders Explorer
  - Quick Actions section (3 cards)
  - Remove animated orbs, clean background
  - Mobile responsive grid
- [ ] Test home page (2h)
  - Test authenticated vs unauthenticated state
  - Verify all links work
  - Mobile responsive check
- [ ] Polish (1h)
  - Adjust spacing, colors
  - Dark mode verification

#### **Phase 2.4: Reserved for Future** (Day 5, 4h)
- [ ] **SKIP ON PRETTY BRANCH** - Auth components don't exist yet
  - Auth components will come from auth branch merge
  - Will align them AFTER auth branch merges
  - See notes below for alignment plan

**Note:** Auth component alignment (AuthModal, SignInModal, etc.) will happen AFTER auth branch merges. For now, use this time for:
- [ ] Extra polish on landing/home pages
- [ ] Additional testing
- [ ] Documentation updates

---

### **Week 3: New Features + Polish** (~20 hours)

#### **Phase 3.1: User Timeline** (Days 1-2, 12h)
- [ ] Backend: Create `GET /api/v1/users/me/jobs` endpoint
  - Return user's analysis job history
  - Schema: `{ id, type, status, createdAt, completedAt, metadata, result }`
  - Pagination: `?limit=50&offset=0`
  - Filtering: `?status=completed`
- [ ] Create JobCard component (2h)
  - Props: job (UserJob object)
  - Display: status badge, timestamp, description
  - Action: link to results (if completed)
  - Status colors: queued (amber), running (blue), completed (green), failed (red)
- [ ] Create `dashboard/src/app/timeline/page.tsx` (4h)
  - Use ToolHubShell
  - Fetch jobs via SWR
  - Display JobCard list
  - Loading state, error state, empty state
  - Pagination controls
- [ ] Test timeline (1h)
  - Test with mock data
  - Test with real jobs (if available)
  - Mobile responsive

#### **Phase 3.2: Onboarding Checklist** (Day 2, 4h)
- [ ] Create `dashboard/src/components/onboarding/OnboardingChecklist.tsx`
  - Check: Email verified (via `useAuth().user.emailVerified`)
  - Check: Tool explored (via localStorage)
  - Display as card with checkboxes
  - Hide when all completed
- [ ] Add to `/home/page.tsx`
  - Show at top if incomplete
  - Track tool exploration (set localStorage on first tool visit)
- [ ] Test onboarding flow
  - New user: see checklist
  - Complete steps: checklist disappears

#### **Phase 3.3: Final Polish** (Day 3, 4h)
- [ ] Accessibility audit
  - Tab through entire app with keyboard
  - Check focus indicators on all interactive elements
  - Verify `aria-label` on icon-only buttons
  - Test with screen reader (NVDA or VoiceOver)
  - Run axe DevTools
  - Check color contrast (WCAG AA: 4.5:1)
- [ ] Performance audit
  - Run Lighthouse on all pages
  - Performance >90 (mobile)
  - Accessibility >95
  - Best Practices >90
  - Check bundle size (should be <100KB added)
- [ ] Mobile responsive final check
  - Test on iPhone SE (375px)
  - Test on iPad (768px)
  - Test on desktop (1920px)
  - Fix any overflow, layout issues
- [ ] Fix remaining issues
  - Address any bugs found
  - Polish edge cases

---

## Current Blockers

**None** - Ready to start Week 1, Phase 1.1 (Design Tokens)

---

## After This (Future Work)

**When auth branch merges:**
- Apply design system to incoming auth components (already planned in Week 2, Phase 2.4)
- Integrate timeline with real backend endpoint
- Test full user flow (landing → sign up → verify → home → tools)

**Future enhancements (not in scope):**
- Admin panel redesign (user maintains, no changes planned)
- Additional animations (keep CSS-only, 200ms transitions)
- Custom theme builder (use Tailwind defaults for now)

---

## Notes

- **Tremor charts**: Keep unchanged (AreaChart, BarChart, etc.) - they're excellent
- **Admin panel**: No changes (user-maintained)
- **API key store**: Deprecated for users (auth branch brings JWT)
- **Demo mode**: Deprecated (auth branch brings user accounts)
- **Bundle size**: Target <100KB added for all design changes
- **Performance**: Lighthouse >90 mobile
- **Accessibility**: WCAG AA compliant
