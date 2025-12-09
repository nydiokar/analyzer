# Design System & Modernization Guide
**The Real-World Edition: What Actually Works**

> **Critical Assessment:** The previous design docs had ~47 different visual enhancements, animations, and effects. That's amateur hour. This guide focuses on **the 5 things that matter** and eliminates the fluff that looks good in Figma but fails in production.

---

## EXECUTIVE SUMMARY: THE HARD TRUTHS

### What's Wrong With Current Design
1. **Square borders** - Makes it feel like 2015
2. **Heavy border usage** - Creates visual clutter
3. **Inconsistent spacing** - Some cards have p-4, others p-6, no system
4. **No elevation system** - Everything is flat
5. **Weak typography hierarchy** - Metrics don't stand out

### What We're NOT Doing (And Why)
❌ **Backdrop blur everywhere** - Kills performance on 70% of Android devices
❌ **Gradient orbs floating around** - Visual noise, DOM bloat, zero functional value
❌ **Animations on everything** - Makes it feel like a 2016 landing page builder
❌ **Glass-morphism on every card** - Reduces readability, accessibility nightmare
❌ **Framer Motion for basic fades** - Use CSS, save 40KB bundle size
❌ **Shimmer on every loading state** - Distracting and annoying
❌ **3rem border radius** - That's a fishbowl, not a data table
❌ **Gradient text for body content** - Accessibility fail, low contrast

### What We ARE Doing (The 5 Core Changes)
✅ **1. Refined spacing system** - 4/8/12/16/24/32px scale, no exceptions
✅ **2. Subtle elevation** - 3-tier shadow system (base, hover, active)
✅ **3. Larger border radius** - 12px default, 16px for cards (not 24px)
✅ **4. Single accent gradient** - Blue-to-indigo, used ONLY on primary CTAs
✅ **5. Better typography scale** - Clear hierarchy for metrics vs labels

**That's it. Master these 5, ship it, iterate.**

---

## DESIGN TOKENS (The Foundation)

### Spacing Scale (Tailwind Extension)
```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      spacing: {
        // Use ONLY these values. No more random padding.
        '4.5': '1.125rem',  // 18px (rare, use sparingly)
      }
    }
  }
}

// In practice: p-2, p-3, p-4, p-6, p-8, p-12
// Default: Cards use p-6, Buttons use px-4 py-2, Sections use p-8
```

### Border Radius (Realistic)
```js
borderRadius: {
  'lg': '0.75rem',   // 12px - default for buttons, inputs
  'xl': '1rem',      // 16px - default for cards
  '2xl': '1.5rem',   // 24px - ONLY for large hero cards
  // NO 3xl - it looks ridiculous on tables
}
```

### Shadows (3-Tier System)
```js
boxShadow: {
  // Tier 1: Resting state (subtle)
  'base': '0 1px 3px 0 rgb(0 0 0 / 0.1)',

  // Tier 2: Hover state (medium)
  'hover': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',

  // Tier 3: Active/Focus state (strong)
  'active': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',

  // Colored shadows ONLY for primary CTAs (use sparingly)
  'primary': '0 4px 14px 0 rgba(59, 130, 246, 0.25)',
}
```

### Typography Scale
```js
fontSize: {
  // Metrics (large numbers)
  'metric-sm': ['1.5rem', { lineHeight: '2rem', fontWeight: '700' }],    // 24px
  'metric-md': ['2.25rem', { lineHeight: '2.5rem', fontWeight: '700' }], // 36px
  'metric-lg': ['3rem', { lineHeight: '1', fontWeight: '700' }],         // 48px

  // NO 5xl, 6xl, 7xl, 8xl - you're not Apple, you don't need 96px text
}
```

### Color System
```js
colors: {
  // Primary: Blue-to-indigo gradient (ONLY for primary CTAs)
  primary: {
    from: '#3b82f6',  // blue-500
    to: '#6366f1',    // indigo-500
  },

  // NO additional gradient colors - keep it simple
  // Use Tailwind defaults for everything else
}
```

---

## COMPONENT PATTERNS (What Actually Ships)

## 1. SIDEBAR

**Changes:**
- Increase border-radius on nav items: `rounded-md` → `rounded-lg`
- Add subtle hover effect: `hover:bg-slate-100 dark:hover:bg-slate-800`
- Faster collapse: `transition-all duration-200` (NOT 500ms)
- Active state: Simple `bg-slate-100` (NO gradient bars, NO pseudo-elements)

```tsx
<aside className={cn(
  "fixed left-0 top-0 h-screen transition-all duration-200 ease-out",
  "bg-white dark:bg-slate-900",
  "border-r border-slate-200 dark:border-slate-800",
  isCollapsed ? "w-20" : "w-64"
)}>
  <nav className="p-4 space-y-2">
    {navItems.map(item => (
      <button
        key={item.id}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg",
          "text-sm font-medium transition-colors",
          isActive
            ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white"
            : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50"
        )}
      >
        <item.icon className="w-5 h-5 shrink-0" />
        {!isCollapsed && <span>{item.label}</span>}
      </button>
    ))}
  </nav>
</aside>
```

**What we REMOVED:**
- Gradient background (unnecessary)
- 500ms animation (too slow)
- Gradient accent bar on hover (visual clutter)
- Icon scale on hover (gimmicky)
- Ping animation (distracting)
- Backdrop blur (performance killer)

---

## 2. BADGES (Token & Wallet)

**Changes:**
- Increase border-radius: `rounded-2xl` → `rounded-xl`
- Add subtle shadow on hover: `hover:shadow-hover`
- Remove excessive gradients (keep it clean)

```tsx
<button className={cn(
  "inline-flex items-center gap-2 px-3 py-1.5 rounded-xl",
  "bg-white dark:bg-slate-800",
  "border border-slate-200 dark:border-slate-700",
  "hover:shadow-hover hover:border-slate-300 dark:hover:border-slate-600",
  "transition-all duration-200"
)}>
  <img src={imageUrl} className="w-5 h-5 rounded-full" alt="" />
  <span className="text-sm font-medium text-slate-900 dark:text-white">
    {symbol}
  </span>
</button>

{/* Popover - CLEAN, no backdrop blur */}
<PopoverContent className={cn(
  "w-80 p-4 rounded-xl",
  "bg-white dark:bg-slate-900",
  "border border-slate-200 dark:border-slate-800",
  "shadow-active"
)}>
  {/* Clean content, no gradient headers, no shine effects */}
</PopoverContent>
```

**What we REMOVED:**
- Gradient background (makes badges inconsistent)
- Shimmer loading state (CSS spinner is fine)
- Image scale on hover (unnecessary)
- Colored shadow on hover (visual noise)
- Backdrop blur on popover (performance)
- Gradient icons in action buttons (overkill)
- Shine animation (dated)

---

## 3. CARDS (Account Summary, PNL, etc.)

**The Universal Card Pattern:**

```tsx
<div className={cn(
  "p-6 rounded-xl",                                    // Spacing + radius
  "bg-white dark:bg-slate-900",                        // Background
  "border border-slate-200 dark:border-slate-800",    // Border
  "shadow-base hover:shadow-hover",                   // Elevation
  "transition-shadow duration-200"                     // Smooth
)}>
  {/* Content */}
</div>
```

**For Primary Metric Cards (Account Summary):**
```tsx
<div className="p-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-base">
  {/* Header */}
  <div className="flex items-center justify-between mb-6">
    <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
      Account Summary
    </h2>
    <span className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
      <span className="w-2 h-2 rounded-full bg-green-500" />
      Live
    </span>
  </div>

  {/* Primary Metric - Big, Bold, Clear */}
  <div className="mb-8">
    <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">
      Current Balance
    </p>
    <p className="text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
      {balance.toFixed(4)} <span className="text-2xl text-slate-400">SOL</span>
    </p>
  </div>

  {/* Secondary Metrics - Grid */}
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
    {metrics.map(metric => (
      <div key={metric.id} className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/50">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
          {metric.label}
        </p>
        <p className="text-xl font-bold text-slate-900 dark:text-white">
          {metric.value}
        </p>
      </div>
    ))}
  </div>
</div>
```

**What we REMOVED:**
- Gradient background (cluttered)
- Decorative gradient orbs (DOM bloat)
- Hover effect that lifts card (causes layout shift)
- Gradient text for balance (readability)
- Glass-morphism on metric cards (reduces contrast)
- Staggered animations on grid (unnecessary)
- Floating animation on metrics (distracting)

**What we KEPT:**
- Clean hierarchy (primary metric → secondary grid)
- Live indicator (functional)
- Generous spacing (p-8 for primary cards)
- Clear typography scale

---

## 4. TABLES (Token Performance)

**Filter Bar:**
```tsx
<div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
  {/* Search */}
  <div className="relative flex-1">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
    <input
      type="text"
      placeholder="Search tokens..."
      className={cn(
        "w-full pl-10 pr-4 py-2 rounded-lg",
        "bg-white dark:bg-slate-800",
        "border border-slate-200 dark:border-slate-700",
        "focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
      )}
    />
  </div>

  {/* Filter Chips - Simple */}
  <div className="flex gap-2">
    {['All', 'Profitable', 'Loss'].map(filter => (
      <button
        key={filter}
        className={cn(
          "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
          activeFilter === filter
            ? "bg-blue-500 text-white"
            : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
        )}
      >
        {filter}
      </button>
    ))}
  </div>
</div>
```

**Table:**
```tsx
<table className="w-full">
  <thead className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
    <tr>
      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase">
        Token
      </th>
      {/* ... more headers */}
    </tr>
  </thead>
  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
    {tokens.map(token => (
      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
        <td className="px-6 py-4">
          <TokenBadge mint={token.mint} />
        </td>
        <td className="px-6 py-4">
          <span className={cn(
            "text-base font-semibold",
            token.pnl > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
          )}>
            {token.pnl > 0 ? '+' : ''}{token.pnl.toFixed(2)} SOL
          </span>
        </td>
        {/* ... more cells */}
      </tr>
    ))}
  </tbody>
</table>
```

**What we REMOVED:**
- Sticky filter bar with backdrop blur (performance)
- Gradient filter chips (visual inconsistency)
- Gradient table header (unnecessary)
- Staggered row animations (annoying)
- Mini sparklines (Tremor doesn't have this, you'd need recharts = bundle bloat)
- Quick action buttons on hover (just link the whole row)
- Rounded corners on table (looks weird)

---

## 5. TABS (PNL Period/All-Time/Both)

**Simple Pill Tabs:**
```tsx
<div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
  {['Period', 'All-Time', 'Both'].map((tab, idx) => (
    <button
      key={tab}
      onClick={() => setMode(idx)}
      className={cn(
        "px-4 py-2 rounded-md text-sm font-medium transition-colors",
        mode === idx
          ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
          : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
      )}
    >
      {tab}
    </button>
  ))}
</div>
```

**What we REMOVED:**
- Gradient active state (keep it clean)
- Colored shadow on active tab (unnecessary)

---

## 6. TREMOR INTEGRATION (Keep Data Viz, Modernize Container)

**Tremor charts stay EXACTLY as they are. Just wrap them better:**

```tsx
<div className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-base">
  {/* Section Header */}
  <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
    Trading Patterns
  </h3>

  {/* Tremor Chart - UNTOUCHED */}
  <EChartComponent option={chartOptions} />
</div>

{/* For Tremor Metrics - Simple wrapper */}
<Card className="rounded-xl">  {/* Tremor Card with custom border-radius */}
  <Grid numItemsSm={2} numItemsMd={4} className="gap-4">
    <div>
      <Text>Realized PNL</Text>
      <Metric>{formatMetric(data.realizedPnl, 'SOL')}</Metric>
    </div>
    {/* ... more metrics */}
  </Grid>
</Card>
```

**What we REMOVED:**
- Gradient backgrounds on Tremor cards (clashes with Tremor's design)
- Glass-morphism on metric containers (reduces readability)
- Accordion for "Advanced Analytics" (just show it, it's important data)
- Gradient accent bars (visual noise)

**What we KEPT:**
- All Tremor components unchanged
- Clean wrapping containers
- Tremor's color system (green/red for profit/loss)

---

## 7. BUTTONS (The Only Place for Gradients)

**Primary CTA (Analyze, Submit, etc.):**
```tsx
<button className={cn(
  "px-4 py-2 rounded-lg",
  "bg-gradient-to-r from-blue-500 to-indigo-500",
  "hover:from-blue-600 hover:to-indigo-600",
  "text-white font-medium",
  "shadow-primary",
  "transition-all duration-200",
  "disabled:opacity-50 disabled:cursor-not-allowed"
)}>
  {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
  {label}
</button>
```

**Secondary (Cancel, Close, etc.):**
```tsx
<button className={cn(
  "px-4 py-2 rounded-lg",
  "bg-white dark:bg-slate-800",
  "border border-slate-200 dark:border-slate-700",
  "text-slate-700 dark:text-slate-300",
  "hover:bg-slate-50 dark:hover:bg-slate-700",
  "transition-colors"
)}>
  {label}
</button>
```

**What we REMOVED:**
- Hover lift effect (causes layout shift)
- Shine animation (dated)
- Multiple gradient directions (stick to one)

---

## LANDING PAGE (Simplified)

### Structure (4 Sections Only)
1. **Hero** (with nav)
2. **Features Grid** (6 items max)
3. **Tool Showcase** (1 tool, not 3)
4. **Footer** (with CTA)

**That's it. Users don't scroll through 7 sections.**

### Hero (Mobile-First)

```tsx
<section className="relative min-h-screen flex items-center justify-center px-6 pt-20 pb-12">
  {/* Simple gradient background - NO animated orbs */}
  <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-slate-950 dark:to-indigo-950" />

  <div className="relative max-w-4xl mx-auto text-center">
    {/* Badge (optional) */}
    <div className="inline-flex items-center gap-2 px-3 py-1 mb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-full text-sm">
      <span className="w-2 h-2 rounded-full bg-green-500" />
      <span className="text-slate-700 dark:text-slate-300">10,000+ wallets analyzed</span>
    </div>

    {/* Headline - Mobile: 3xl, Desktop: 5xl (NOT 8xl) */}
    <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-4 tracking-tight">
      Decode Solana Wallet Behavior
    </h1>

    {/* Subtitle */}
    <p className="text-lg sm:text-xl text-slate-600 dark:text-slate-400 mb-8 max-w-2xl mx-auto">
      Advanced behavioral analysis for Solana wallets. Discover trading patterns and holder profiles.
    </p>

    {/* CTAs */}
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
      <button className="w-full sm:w-auto px-6 py-3 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-semibold shadow-primary transition-all">
        Start Analyzing Free
      </button>
      <button className="w-full sm:w-auto px-6 py-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
        View Demo
      </button>
    </div>

    {/* Screenshot (NO floating cards overlay) */}
    <div className="mt-16 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-active">
      <img src="/screenshots/dashboard.png" alt="Dashboard" className="w-full" />
    </div>
  </div>
</section>
```

**What we REMOVED:**
- 8xl text (absurdly large, breaks mobile)
- Three animated gradient orbs (visual noise)
- Grid background overlay (dated)
- Framer Motion entrance animations (use CSS, save bundle)
- Floating stat cards over screenshot (maintenance nightmare)
- Scroll indicator (unnecessary)
- Gradient text (reduces contrast)

### Features Grid

```tsx
<section className="py-20 px-6">
  <div className="max-w-6xl mx-auto">
    <h2 className="text-3xl font-bold text-slate-900 dark:text-white text-center mb-12">
      Everything you need to analyze wallets
    </h2>

    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {features.map(feature => (
        <div key={feature.id} className="p-6 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-base hover:shadow-hover transition-shadow">
          <div className="w-12 h-12 mb-4 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <feature.icon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
            {feature.title}
          </h3>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            {feature.description}
          </p>
        </div>
      ))}
    </div>
  </div>
</section>
```

**What we REMOVED:**
- Staggered entrance animations (distracting)
- Gradient icon backgrounds (visual inconsistency)
- Hover lift effect (causes layout shift)
- Arrow on hover (unnecessary)
- Gradient accent bar (visual clutter)

### Footer CTA

```tsx
<section className="py-20 px-6 bg-slate-900 dark:bg-slate-950">
  <div className="max-w-4xl mx-auto text-center">
    <h2 className="text-3xl font-bold text-white mb-4">
      Ready to start analyzing?
    </h2>
    <p className="text-slate-400 mb-8">
      Join hundreds of traders using wallet intelligence
    </p>
    <button className="px-6 py-3 rounded-lg bg-white text-slate-900 font-semibold hover:bg-slate-100 transition-colors">
      Get Started Free
    </button>
  </div>
</section>
```

**What we REMOVED:**
- Full gradient background (too aggressive)
- Animated orbs (performance)
- Grid overlay (dated)
- Multiple CTAs (confusing)

---

## ANIMATION BUDGET (Hard Limits)

### Allowed Animations (CSS Only)
1. **Hover state transitions** - `transition-colors duration-200`
2. **Shadow transitions** - `transition-shadow duration-200`
3. **Loading spinner** - `animate-spin` on Loader2 icon
4. **Skeleton shimmer** - `animate-pulse` (built-in Tailwind)

### BANNED Animations
❌ Framer Motion entrance effects (use CSS if you MUST)
❌ Staggered delays on lists (annoying)
❌ Hover translate-y (causes layout shift)
❌ Shine effects (dated)
❌ Floating orbs (performance)
❌ Scale on hover (gimmicky)

### Performance Rules
- **Max transition duration:** 300ms (200ms preferred)
- **Use `will-change` sparingly:** Only on modals/dialogs during open/close
- **Test on real Android device:** Not just Chrome DevTools
- **Lighthouse Performance Score:** Must be > 90 on mobile

---

## ACCESSIBILITY (Non-Negotiable)

### Color Contrast
- **Text on background:** Minimum 4.5:1 ratio (WCAG AA)
- **NO gradient text for body content** - Fails contrast checks
- **Interactive elements:** Minimum 3:1 ratio

### Keyboard Navigation
```tsx
// All interactive elements need focus states
focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500
```

### Screen Readers
```tsx
// Use aria-label for icon-only buttons
<button aria-label="Close dialog">
  <X className="w-5 h-5" />
</button>

// Use aria-live for dynamic content
<div aria-live="polite" aria-atomic="true">
  {statusMessage}
</div>
```

### Testing Checklist
- [ ] Tab through entire page with keyboard
- [ ] Test with macOS VoiceOver or NVDA
- [ ] Test in High Contrast Mode (Windows)
- [ ] Run axe DevTools
- [ ] Check all focus indicators are visible

---

## MOBILE-FIRST RESPONSIVE (The Right Way)

### Breakpoints
```js
// Design mobile first, enhance for larger screens
sm: '640px',   // Small tablets
md: '768px',   // Tablets
lg: '1024px',  // Laptops
xl: '1280px',  // Desktops
```

### Common Patterns
```tsx
// Typography - start small, scale up
className="text-xl sm:text-2xl md:text-3xl"

// Grid - stack on mobile
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4"

// Padding - tighter on mobile
className="px-4 sm:px-6 lg:px-8"

// Hide decorative elements on mobile
className="hidden md:block"
```

---

## IMPLEMENTATION PRIORITY

### Week 1: Foundation
1. Update `tailwind.config.js` with new tokens
2. Create shared `Button` variants (Primary, Secondary)
3. Create shared `Card` wrapper
4. Test on real mobile device

### Week 2: High-Impact Components
1. Sidebar (most visible)
2. TokenBadge & WalletBadge (used everywhere)
3. Account Summary Card (first thing users see)

### Week 3: Dashboard Core
1. Token Performance Tab
2. Behavioral Patterns Tab (Tremor containers)
3. PNL Tab (Tremor containers)

### Week 4: Landing Page
1. Simple hero
2. Features grid
3. Footer CTA

### Week 5: Polish & Test
1. Accessibility audit
2. Performance audit
3. Real device testing (iOS, Android, tablets)
4. Fix issues, ship

---

## WHAT GREAT LOOKS LIKE (Real Examples)

### Linear
- **What they do well:** Micro-transitions (200ms), clean typography, single accent color
- **What to copy:** Fast transitions, generous spacing, minimal animations
- **What to avoid:** Their custom cursor (gimmicky)

### Stripe
- **What they do well:** Data clarity, consistent elevation, excellent mobile experience
- **What to copy:** Clear hierarchy, subtle shadows, mobile-first approach
- **What to avoid:** Their ultra-minimal aesthetic (too stark for crypto)

### Vercel
- **What they do well:** Dark mode, subtle gradients on primary CTAs only
- **What to copy:** Restrained gradient usage, excellent dark mode
- **What to avoid:** Their trend of making everything black (too severe)

---

## FINAL REALITY CHECK

### Before You Ship, Ask:
1. **Does this work on a $200 Android phone?** (Test it)
2. **Can my grandmother use this with a keyboard?** (Accessibility)
3. **Is the bundle size reasonable?** (< 100KB added for UI changes)
4. **Did I add animations just because I could?** (Remove them)
5. **Can I maintain this in 6 months?** (Simple > clever)

### The Brutal Truth
- Users don't care about your gradient orbs
- Users don't notice your 7-stage staggered entrance animation
- Users DO notice when:
  - The app is slow (performance)
  - They can't read text (contrast)
  - Buttons don't respond (hover states)
  - Mobile experience sucks (responsive)

**Ship the boring, functional stuff. Iterate based on real user feedback. Don't add animations to feel productive.**

---

## APPENDIX: THE BANNED LIST

Things that were in the previous docs that are now BANNED:

1. ❌ Backdrop blur (except modals, if you must)
2. ❌ Multiple gradient orbs
3. ❌ Framer Motion for basic stuff
4. ❌ Staggered animations > 5 items
5. ❌ Gradient text for metrics
6. ❌ Glass-morphism everywhere
7. ❌ Shimmer on everything
8. ❌ Hover effects that move elements
9. ❌ 500ms+ transitions
10. ❌ 3xl+ border radius on data components
11. ❌ Shine/sparkle effects
12. ❌ Floating screenshot cards
13. ❌ Grid background overlays
14. ❌ 7-section landing pages
15. ❌ Fake stats without data

**If you add any of these back, you've failed. Keep it simple, keep it fast, keep it accessible.**
