# Current State

**Project**: Sova Intel - Wallet Analysis System
**Branch**: `pretty` (design system implementation)
**Goal**: Apply modern, professional design system to the dashboard while preserving functionality
**Status**: Ready to Start
**Last Updated:** 2025-12-09

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
- [ ] Update `dashboard/tailwind.config.ts` with shadow tokens
  - Add `shadow-base`, `shadow-hover`, `shadow-active`
  - Add border-radius overrides (`xl: 1rem`, `2xl: 1.5rem`)
- [ ] Create `dashboard/src/components/ui/metric.tsx`
  - Custom Metric component (replaces Tremor Metric)
  - Variants: default, success, error, warning, info
  - Sizes: sm, md, lg, xl
  - Props: prefix, suffix
- [ ] Create `dashboard/src/components/ui/stat-card.tsx`
  - Standardized secondary metrics card
  - Variants: default, success, error, warning
  - Props: label, value, subValue, icon
- [ ] Build test page `dashboard/src/app/test-components/page.tsx`
  - Show all Metric variants and sizes
  - Show all StatCard variants
  - Test dark mode
  - Mobile responsive check

#### **Phase 1.2: Dashboard Component Migration** (Days 2-4, 24h)
- [ ] Migrate `AccountSummaryCard.tsx` (4h)
  - Replace Tremor Card/Metric with shadcn + custom components
  - Change padding: `p-3` → `p-6`
  - Add shadow: `shadow-base hover:shadow-hover`
  - Primary metric: large, bold, clear hierarchy
  - Secondary metrics: StatCard grid (2 columns)
  - Test all states: loading, error, success, empty
  - Verify dark mode, mobile responsive
- [ ] Migrate `TokenPerformanceTab.tsx` (2h)
  - Replace Tremor Card wrapper with shadcn Card
  - Add `rounded-xl shadow-base`
  - Keep table logic unchanged
  - Test filters, pagination, sorting
- [ ] Migrate `BehavioralPatternsTab.tsx` (3h)
  - Replace Tremor Card wrappers
  - Migrate metric displays to custom Metric component
  - **Keep Tremor charts unchanged** (AreaChart, BarChart, etc.)
  - Test chart rendering, metric displays
- [ ] Migrate `AccountStatsPnlTab.tsx` (4h)
  - Replace Tremor Card/Metric/Text
  - Use StatCard for metrics grid
  - Keep accordion logic, tooltip structure
  - Test all three modes (Period, All-Time, Both)
- [ ] Polish shared components (2h)
  - `TokenBadge.tsx`: Add `rounded-lg`, `hover:shadow-hover`
  - `WalletBadge.tsx`: Add `rounded-lg`, `hover:shadow-hover`
  - `Sidebar.tsx`: Update nav items to `rounded-lg`, faster transitions (200ms)

#### **Phase 1.3: Testing & Validation** (Day 5, 8h)
- [ ] Regression testing
  - Test `/wallets/[address]` with all tabs
  - Test all wallet states (analyzed, unanalyzed, error)
  - Test loading skeletons
  - Verify dark mode consistency
  - Mobile responsive check (375px, 768px, 1024px)
- [ ] Performance audit
  - Run Lighthouse on wallet page
  - Check bundle size increase (<100KB target)
  - Verify no layout shifts
- [ ] Fix any issues found

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
