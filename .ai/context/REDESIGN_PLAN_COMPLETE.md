# COMPLETE REDESIGN PLAN - FULL CONTEXT EDITION
**Modern Design System for Authenticated Sova Intel**

> **Context:** This plan assumes the auth branch (`feature/user-jwt-auth`) will merge first, bringing JWT authentication, user accounts, email verification, and admin panel. We're designing for THAT future state, not current main.

---

## EXECUTIVE SUMMARY: THE FULL PICTURE

### **What We're Starting From (After Auth Merge):**

**Authentication Architecture:**
- ✅ User accounts (email/password, JWT tokens)
- ✅ Email verification required for analysis
- ✅ `useAuth()` hook (replaces old `useApiKeyStore()`)
- ✅ Admin panel for API key management (`/admin/api-keys`)
- ✅ Dual authentication: JWT (humans) + API keys (bots/services)

**Component Inventory:**
- ✅ 7 auth components (AuthModal, SignInModal, SignUpModal, UserMenu, UserProfileDropdown, UserProfile, EmailVerificationBanner)
- ✅ Dashboard components (AccountSummaryCard, TokenPerformanceTab, etc.) using Tremor
- ✅ Landing page with auth CTAs
- ✅ Basic `/home` page (minimal, needs redesign)
- ✅ Admin panel (stays as-is, you maintain)

**What's Gone (Deprecated):**
- ❌ API key storage in Zustand (`useApiKeyStore` for users)
- ❌ Demo mode toggle
- ❌ Settings page API key management section
- ❌ Status indicators for API key state

### **The Design Goal:**

Transform Sova Intel into a **modern, professional intelligence tool** that:
1. **Looks trustworthy** - Clean, consistent, minimal
2. **Guides new users** - Onboarding flow, clear paths
3. **Scales with complexity** - Dashboard handles heavy data gracefully
4. **Performs well** - <90ms interactions, <100KB added bundle

### **Time Estimate:**
~100 hours (2.5 weeks focused work)

---

## PART 1: DESIGN PRINCIPLES (THE NORTH STAR)

### **1. Anti-Bloat Philosophy**
We're building **intelligence tools**, not a SaaS marketing site.

**Banned:**
- ❌ Gradient backgrounds everywhere (only primary CTAs if needed)
- ❌ Animated orbs/blobs
- ❌ Backdrop blur (performance killer)
- ❌ Framer Motion for basic transitions (use CSS)
- ❌ Staggered entrance animations
- ❌ Hover effects that move elements (layout shift)
- ❌ Shimmer on every loading state

**Allowed:**
- ✅ CSS transitions (200ms max, `transition-colors`, `transition-shadow`)
- ✅ `animate-spin` for loaders
- ✅ `animate-pulse` for skeletons
- ✅ Subtle shadows (3-tier system: base, hover, active)
- ✅ Border-radius (lg: 12px, xl: 16px, 2xl: 24px for heroes only)

---

### **2. Performance First**
**Targets:**
- Lighthouse Performance: >90 mobile
- Bundle size: <100KB added for design changes
- Interaction latency: <100ms
- No N+1 queries in UI components

**How:**
- Use shadcn/ui (tree-shakeable)
- Keep Tremor charts (excellent, well-optimized)
- Lazy load tabs (already implemented)
- No third-party animation libraries

---

### **3. Accessibility (WCAG AA)**
**Non-Negotiable:**
- Color contrast: 4.5:1 for text, 3:1 for interactive
- Keyboard navigation: Tab through entire app
- Screen reader support: `aria-label`, `aria-live`
- Focus indicators: Visible on all interactive elements

---

### **4. Mobile-First Responsive**
**Breakpoints:**
```
Mobile:  375px (iPhone SE)
Tablet:  768px (iPad)
Laptop:  1024px
Desktop: 1920px
```

**Pattern:**
```tsx
// Start mobile, enhance for desktop
className="text-xl sm:text-2xl md:text-3xl"
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
className="px-4 sm:px-6 lg:px-8"
```

---

## PART 2: DESIGN TOKENS (FOUNDATION)

### **Tailwind Config Extensions**

**File:** `dashboard/tailwind.config.ts`

```js
export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Shadow system (3-tier)
      boxShadow: {
        'base': '0 1px 3px 0 rgb(0 0 0 / 0.1)',
        'hover': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        'active': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      },

      // Border radius (pragmatic)
      borderRadius: {
        'lg': '0.75rem',   // 12px - buttons, inputs
        'xl': '1rem',      // 16px - cards (default)
        '2xl': '1.5rem',   // 24px - hero cards only
      },

      // Keep existing shadcn colors
      colors: {
        // ... existing shadcn/ui color system
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

**Why minimal?**
- Tailwind defaults are excellent (spacing, typography)
- shadcn/ui already provides color system
- Just add shadows + border-radius tweaks

---

## PART 3: COMPONENT LIBRARY (CUSTOM ADDITIONS)

### **1. Custom `<Metric>` Component**

**File:** `dashboard/src/components/ui/metric.tsx`

**Purpose:** Replace Tremor's Metric with full control over typography + colors.

```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const metricVariants = cva(
  "font-bold tracking-tight",
  {
    variants: {
      variant: {
        default: "text-foreground",
        success: "text-green-600 dark:text-green-400",
        error: "text-red-600 dark:text-red-400",
        warning: "text-amber-600 dark:text-amber-400",
        info: "text-blue-600 dark:text-blue-400",
      },
      size: {
        sm: "text-xl",      // 20px
        md: "text-2xl",     // 24px
        lg: "text-4xl",     // 36px
        xl: "text-5xl",     // 48px
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

export interface MetricProps
  extends React.HTMLAttributes<HTMLParagraphElement>,
    VariantProps<typeof metricVariants> {
  suffix?: string  // e.g., "SOL", "USD"
  prefix?: string  // e.g., "+", "-"
}

const Metric = React.forwardRef<HTMLParagraphElement, MetricProps>(
  ({ className, variant, size, children, prefix, suffix, ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={cn(metricVariants({ variant, size, className }))}
        {...props}
      >
        {prefix && <span className="mr-1">{prefix}</span>}
        {children}
        {suffix && (
          <span className="text-base text-muted-foreground ml-2 font-normal">
            {suffix}
          </span>
        )}
      </p>
    )
  }
)
Metric.displayName = "Metric"

export { Metric, metricVariants }
```

**Usage:**
```tsx
<Metric variant="success" size="lg" suffix="SOL">+12.45</Metric>
// Renders: +12.45 SOL (green, 36px)

<Metric variant="error" size="md">-3.21</Metric>
// Renders: -3.21 (red, 24px)
```

---

### **2. `<StatCard>` Component**

**File:** `dashboard/src/components/ui/stat-card.tsx`

**Purpose:** Standardized secondary metrics (win rate, balance, etc.)

```tsx
import * as React from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export interface StatCardProps {
  label: string
  value: string | number
  subValue?: string  // USD equivalent, trade count, etc.
  variant?: "default" | "success" | "error" | "warning"
  icon?: React.ReactNode
  className?: string
}

export function StatCard({
  label,
  value,
  subValue,
  variant = "default",
  icon,
  className
}: StatCardProps) {
  const variantClasses = {
    default: "border-border",
    success: "border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/20",
    error: "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20",
    warning: "border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/20",
  }

  return (
    <Card className={cn(
      "p-4 rounded-lg border",
      variantClasses[variant],
      className
    )}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <p className="text-xl font-bold tracking-tight">{value}</p>
      {subValue && (
        <p className="text-xs text-muted-foreground mt-0.5">{subValue}</p>
      )}
    </Card>
  )
}
```

**Usage:**
```tsx
<StatCard
  label="Win Rate"
  value="62.5%"
  subValue="15/24 trades"
  variant="success"
/>
```

---

## PART 4: LAYOUT ARCHITECTURE (DUAL SHELL SYSTEM)

### **Current Problem:**
`LayoutClientShell` wraps everything → Sidebar shows on landing page (marketing)

### **Solution: Two Shell Systems**

#### **A. MarketingShell** (No Sidebar)

**File:** `dashboard/src/components/layout/MarketingShell.tsx`

```tsx
"use client"

import { ThemeProvider } from "@/components/theme-provider"
import { ThemeToggleButton } from "@/components/theme-toggle-button"
import { Toaster } from 'sonner'

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <div className="min-h-screen bg-background text-foreground">
        <ThemeToggleButton className="fixed top-4 right-4 z-50" />
        {children}
      </div>
      <Toaster />
    </ThemeProvider>
  )
}
```

**Used By:**
- `/` (Landing page - marketing only)

---

#### **B. ToolHubShell** (With Sidebar)

**File:** `dashboard/src/components/layout/ToolHubShell.tsx`

```tsx
"use client"

import React, { useState, useMemo } from 'react'
import { ThemeProvider } from "@/components/theme-provider"
import Sidebar from "@/components/layout/Sidebar"
import { EmailVerificationBanner } from "@/components/auth/EmailVerificationBanner"
import { Toaster } from 'sonner'
import { SWRConfig } from 'swr'
import { defaultSWRConfig } from '@/lib/swr-config'
import { AppCacheProvider } from '@/lib/cache-provider'

export function ToolHubShell({ children }: { children: React.ReactNode }) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true)

  const cacheProvider = useMemo(() => new AppCacheProvider(), [])
  const swrConfig = useMemo(() => ({
    ...defaultSWRConfig,
    provider: () => cacheProvider,
  }), [cacheProvider])

  return (
    <SWRConfig value={swrConfig}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <div className="flex h-screen w-screen bg-background text-foreground overflow-hidden">
          <Sidebar
            isCollapsed={isSidebarCollapsed}
            toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          />
          <main className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden transition-all duration-200">
            <EmailVerificationBanner />
            {children}
          </main>
        </div>
        <Toaster />
      </ThemeProvider>
    </SWRConfig>
  )
}
```

**Used By:**
- `/home` (Tool showcase hub)
- `/wallets/[address]` (Wallet analysis)
- `/similarity-lab` (Similarity analysis)
- `/tools/*` (All tools)
- `/settings` (User settings)

**NOT used by:**
- `/admin/api-keys` (Stays as-is, uses current shell)

---

#### **C. Update Root Layout**

**File:** `dashboard/src/app/layout.tsx`

```tsx
import type { Metadata } from "next";
import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

export const metadata: Metadata = {
  title: "Sova Intel - Solana Wallet Analytics",
  description: "Professional wallet analysis for Solana",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable}`}>
        {children}  {/* Pages choose their own shell */}
      </body>
    </html>
  );
}
```

**Key Change:** No wrapper - pages import their shell.

---

## PART 5: PAGE-BY-PAGE REDESIGN

### **Page 1: Landing** (`/`)

**Shell:** MarketingShell (no sidebar)

**Current State (Auth Branch):**
- Gradient animated background
- Auth CTAs (Sign In, Sign Up)
- Featured wallets
- Email verification banner if authenticated

**Design Changes:**
```tsx
import { MarketingShell } from '@/components/layout/MarketingShell'
import { AuthModal } from '@/components/auth/AuthModal'
import { UserMenu } from '@/components/auth/UserMenu'
import { useAuth } from '@/hooks/useAuth'

export default function LandingPage() {
  const { isAuthenticated } = useAuth()
  const [showAuthModal, setShowAuthModal] = useState(false)

  return (
    <MarketingShell>
      {/* Clean background - NO animated orbs */}
      <div className="min-h-screen bg-gradient-to-br from-slate-950 to-slate-900">

        {/* Header */}
        <header className="container max-w-5xl mx-auto px-6 py-4 flex justify-end">
          {isAuthenticated ? (
            <UserMenu />
          ) : (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowAuthModal(true)}
              >
                Sign In
              </Button>
              <Button
                onClick={() => setShowAuthModal(true)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Sign Up
              </Button>
            </div>
          )}
        </header>

        {/* Hero */}
        <main className="container max-w-5xl mx-auto px-6 py-20 text-center">
          <h1 className="text-5xl font-bold mb-4 text-slate-50">
            Solana Wallet Intelligence
          </h1>
          <p className="text-xl text-slate-400 mb-8 max-w-2xl mx-auto">
            Professional-grade wallet analysis. Decode strategies, track PNL, discover patterns.
          </p>

          {!isAuthenticated && (
            <Button
              size="lg"
              onClick={() => setShowAuthModal(true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Get Started Free
            </Button>
          )}

          {/* Featured Wallets */}
          <section className="mt-20">
            <h2 className="text-2xl font-semibold mb-6">Explore Sample Wallets</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {FEATURED_WALLETS.map(wallet => (
                <Link
                  key={wallet.address}
                  href={`/wallets/${wallet.address}`}
                >
                  <Card className="p-6 rounded-xl hover:shadow-hover transition-shadow">
                    <p className="font-semibold mb-2">{wallet.name}</p>
                    <p className="text-sm text-muted-foreground">{wallet.description}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        </main>

        <AuthModal
          open={showAuthModal}
          onOpenChange={setShowAuthModal}
        />
      </div>
    </MarketingShell>
  )
}
```

**Changes:**
- ✅ Wrapped in MarketingShell (no sidebar)
- ✅ Removed animated orbs
- ✅ Clean gradient background (static)
- ✅ Uses existing AuthModal from auth branch
- ✅ Featured wallets as cards (not grid with animations)

---

### **Page 2: Home** (`/home`)

**Shell:** ToolHubShell (with sidebar)

**Current State (Auth Branch):**
- Minimal gradient splash
- "Welcome to Sova Intel" with gradient text
- "Go to Dashboard" button

**Redesign: Rich Tool Showcase**

```tsx
import { ToolHubShell } from '@/components/layout/ToolHubShell'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  WalletIcon, Users, Bot, ListChecks,
  CheckIcon, SearchIcon
} from 'lucide-react'
import Link from 'next/link'

export default function HomePage() {
  const { user } = useAuth()

  return (
    <ToolHubShell>
      <div className="container max-w-6xl mx-auto px-6 py-12">

        {/* Hero Section */}
        <section className="mb-20">
          <h1 className="text-5xl font-bold mb-4">
            Welcome back, {user?.displayName || 'Analyst'}
          </h1>
          <p className="text-xl text-muted-foreground">
            Choose your analysis tool below
          </p>
        </section>

        {/* Tool Cards Grid */}
        <section className="grid md:grid-cols-2 gap-8 mb-20">
          <ToolCard
            title="Wallet Analysis"
            description="Deep-dive into any wallet's PNL, trading patterns, and behavioral classification"
            icon={<WalletIcon className="w-6 h-6" />}
            href="/wallets"
            features={[
              "Realized/Unrealized PNL tracking",
              "Token-level performance metrics",
              "Behavioral pattern recognition",
              "Historical trend analysis"
            ]}
          />

          <ToolCard
            title="Similarity Lab"
            description="Discover hidden connections between wallets based on trading behavior"
            icon={<Users className="w-6 h-6" />}
            href="/similarity-lab"
            features={[
              "Multi-wallet comparison",
              "Overlap heatmaps",
              "Common token discovery",
              "Portfolio similarity scoring"
            ]}
          />

          <ToolCard
            title="Holder Profiles"
            description="Outcome-first behavioral analysis for token cohorts and wallet scouts"
            icon={<Bot className="w-6 h-6" />}
            href="/tools/holder-profiles"
            features={[
              "Exit timing classification",
              "Hold time distribution",
              "Cognitive primitive scoring",
              "Wallet behavior clustering"
            ]}
          />

          <ToolCard
            title="Top Holders Explorer"
            description="Explore and analyze top holders of any Solana token"
            icon={<ListChecks className="w-6 h-6" />}
            href="/tools/top-holders"
            features={[
              "Real-time holder snapshots",
              "Bubble map visualization",
              "Bulk wallet selection",
              "Integration with Similarity Lab"
            ]}
          />
        </section>

        {/* Quick Actions */}
        <section>
          <h2 className="text-2xl font-bold mb-6">Quick Actions</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <QuickActionCard
              title="Analyze Wallet"
              icon={<SearchIcon className="w-5 h-5" />}
              href="/wallets"
            />
            <QuickActionCard
              title="Compare Wallets"
              icon={<Users className="w-5 h-5" />}
              href="/similarity-lab"
            />
            <QuickActionCard
              title="Explore Token"
              icon={<ListChecks className="w-5 h-5" />}
              href="/tools/top-holders"
            />
          </div>
        </section>
      </div>
    </ToolHubShell>
  )
}

function ToolCard({ title, description, icon, href, features }: {
  title: string
  description: string
  icon: React.ReactNode
  href: string
  features: string[]
}) {
  return (
    <Link href={href}>
      <Card className="p-6 rounded-xl shadow-base hover:shadow-hover transition-shadow h-full group">
        <div className="flex items-start gap-4 mb-4">
          <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
            {icon}
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-semibold mb-2 group-hover:text-blue-600 transition-colors">
              {title}
            </h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>

        <ul className="space-y-2">
          {features.map((feature, idx) => (
            <li key={idx} className="flex items-center text-sm">
              <CheckIcon className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Link>
  )
}

function QuickActionCard({ title, icon, href }: {
  title: string
  icon: React.ReactNode
  href: string
}) {
  return (
    <Link href={href}>
      <Card className="p-6 rounded-lg hover:shadow-hover transition-shadow flex items-center gap-4 group">
        <div className="p-2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 group-hover:text-blue-600 transition-colors">
          {icon}
        </div>
        <p className="font-medium">{title}</p>
      </Card>
    </Link>
  )
}
```

**Changes:**
- ✅ Wrapped in ToolHubShell (sidebar visible)
- ✅ Rich tool showcase (4 detailed cards)
- ✅ Feature lists per tool
- ✅ Quick actions section
- ✅ No animated orbs, clean background

---

### **Page 3: Wallet Analysis** (`/wallets/[address]`)

**Shell:** ToolHubShell (existing)

**Components to Migrate:**
1. AccountSummaryCard
2. TokenPerformanceTab
3. BehavioralPatternsTab
4. AccountStatsPnlTab

**See PART 6 for detailed migration.**

---

### **Page 4: Admin Panel** (`/admin/api-keys`)

**Shell:** Current (unchanged)

**Design:** **NO CHANGES**

**Rationale:** You maintain this, design can stay as-is.

---

## PART 6: COMPONENT MIGRATION MATRIX

### **Critical Path Components (Week 1)**

| Component | Current Stack | Target Stack | Priority | Effort | Notes |
|-----------|---------------|--------------|----------|--------|-------|
| **Custom Metric** | N/A | New component | 🔴 CRITICAL | 2h | Foundation for all migrations |
| **StatCard** | N/A | New component | 🔴 CRITICAL | 2h | Secondary metrics everywhere |
| **AccountSummaryCard** | Tremor Card/Metric | shadcn + Custom Metric | 🔴 HIGH | 4h | Most visible component |
| **TokenPerformanceTab** | Tremor Card | shadcn Card | 🟡 MEDIUM | 2h | Table wrapper only |
| **BehavioralPatternsTab** | Tremor Card/Metric | shadcn + Custom Metric | 🟡 MEDIUM | 3h | Chart wrappers |
| **AccountStatsPnlTab** | Tremor Card/Metric | shadcn + Custom Metric | 🟡 MEDIUM | 4h | Complex metrics grid |

**Total Week 1:** 17 hours (foundation + critical path)

---

### **Auth Components (Week 2 - Design Alignment)**

| Component | Current Design | Target Design | Priority | Effort | Notes |
|-----------|----------------|---------------|----------|--------|-------|
| **AuthModal** | Gradient background | Clean bg + shadow | 🟡 MEDIUM | 1h | Remove gradients |
| **SignInModal** | Gradient background | Clean bg + shadow | 🟡 MEDIUM | 0.5h | Same as AuthModal |
| **SignUpModal** | Gradient background | Clean bg + shadow | 🟡 MEDIUM | 0.5h | Same as AuthModal |
| **UserMenu** | Basic dropdown | Add rounded-xl | 🟢 LOW | 0.5h | Just polish |
| **UserProfileDropdown** | Basic dropdown | Add rounded-xl | 🟢 LOW | 0.5h | Just polish |
| **EmailVerificationBanner** | Basic banner | Add rounded-xl, shadow | 🟢 LOW | 0.5h | Just polish |

**Total Week 2:** 3.5 hours (auth alignment)

---

### **Layout Components (Week 2)**

| Component | Action | Priority | Effort | Notes |
|-----------|--------|----------|--------|-------|
| **MarketingShell** | Create new | 🔴 CRITICAL | 2h | No sidebar shell |
| **ToolHubShell** | Create new | 🔴 CRITICAL | 2h | With sidebar shell |
| **Root layout** | Update | 🔴 CRITICAL | 1h | Remove wrapper |
| **Landing page** | Wrap in MarketingShell | 🟡 MEDIUM | 2h | Update layout |
| **Home page** | Redesign + wrap | 🔴 CRITICAL | 8h | Full redesign |
| **All tool pages** | Wrap in ToolHubShell | 🟡 MEDIUM | 2h | Batch update |

**Total Week 2:** 17 hours (layout + home)

---

### **New Features (Week 3)**

| Feature | Action | Priority | Effort | Notes |
|---------|--------|----------|--------|-------|
| **Timeline page** | Create new (`/timeline`) | 🟡 MEDIUM | 8h | Job history |
| **JobCard component** | Create new | 🟡 MEDIUM | 2h | Timeline item |
| **OnboardingChecklist** | Create new | 🟡 MEDIUM | 4h | Home page widget |

**Total Week 3:** 14 hours (new features)

---

## PART 7: DETAILED MIGRATIONS

### **Migration 1: AccountSummaryCard**

**File:** `dashboard/src/components/dashboard/AccountSummaryCard.tsx`

**Current (Tremor):**
```tsx
import { Card, Metric, Text, Badge } from '@tremor/react'

<Card className="p-3 shadow-sm">
  <Text className="text-xs">PNL</Text>
  <Metric color="emerald">{pnl}</Metric>
</Card>
```

**Target (shadcn + Custom):**
```tsx
import { Card } from '@/components/ui/card'
import { Metric } from '@/components/ui/metric'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'

<Card className="p-6 rounded-xl shadow-base hover:shadow-hover transition-shadow">
  {/* Primary Metric - Big & Bold */}
  <div className="mb-6">
    <p className="text-sm font-medium text-muted-foreground mb-1 uppercase tracking-wide">
      Total PNL
    </p>
    <Metric variant="success" size="lg" suffix="SOL">
      {pnl.toFixed(2)}
    </Metric>
    {pnlUsd && (
      <p className="text-sm text-muted-foreground">${pnlUsd}</p>
    )}
  </div>

  {/* Secondary Metrics - Grid */}
  <div className="grid grid-cols-2 gap-4">
    <StatCard
      label="Win Rate"
      value={`${winRate}%`}
      subValue={`${profitableTrades}/${totalTrades} trades`}
      variant={winRate > 50 ? "success" : "default"}
    />
    <StatCard
      label="Balance"
      value={`${balance.toFixed(2)} SOL`}
      subValue={balanceUsd && `$${balanceUsd}`}
    />
  </div>

  {/* Footer Info */}
  <div className="pt-4 mt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
    <div className="flex items-center gap-2">
      <CalendarDays className="h-4 w-4" />
      <span>{formatDate(lastActive)}</span>
    </div>
    {classification && (
      <Badge variant="outline">{classification}</Badge>
    )}
  </div>
</Card>
```

**Changes:**
- ✅ Tremor imports → shadcn + custom
- ✅ `p-3` → `p-6` (more breathing room)
- ✅ `shadow-sm` → `shadow-base hover:shadow-hover`
- ✅ `Metric color="emerald"` → `Metric variant="success"`
- ✅ Secondary metrics as StatCards (consistent)
- ✅ Clear visual hierarchy (primary → secondary → footer)

**Testing:**
- [ ] All states: loading, error, success, empty
- [ ] Dark mode
- [ ] Mobile responsive
- [ ] Verify PNL colors (green/red)

---

### **Migration 2: Auth Components Alignment**

**File:** `dashboard/src/components/auth/AuthModal.tsx`

**Current (Auth Branch):**
```tsx
<DialogContent className="sm:max-w-[440px] p-0">
  <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-6">
    {/* Auth form */}
  </div>
</DialogContent>
```

**Target (Aligned with Design):**
```tsx
<DialogContent className="sm:max-w-[440px] p-0 overflow-hidden rounded-xl">
  <div className="bg-slate-900 border-t border-slate-800 p-6 shadow-active">
    {/* Auth form - unchanged logic */}
  </div>
</DialogContent>
```

**Changes:**
- ✅ Remove gradient background
- ✅ Add `shadow-active` for depth
- ✅ Add `rounded-xl` to dialog
- ✅ Keep all auth logic unchanged (just CSS)

**Apply same pattern to:**
- SignInModal.tsx
- SignUpModal.tsx

---

## PART 8: IMPLEMENTATION TIMELINE

### **Week 1: Foundation + Dashboard** (40h)

**Day 1 (8h):**
- [ ] Update `tailwind.config.ts` (shadow tokens, border-radius)
- [ ] Create `ui/metric.tsx` component
- [ ] Create `ui/stat-card.tsx` component
- [ ] Build test page (`/test-components`) showing all variants

**Day 2 (8h):**
- [ ] Migrate AccountSummaryCard
- [ ] Test all states (loading, error, success)
- [ ] Verify dark mode
- [ ] Mobile responsive check

**Day 3 (8h):**
- [ ] Migrate TokenPerformanceTab (card wrapper)
- [ ] Migrate BehavioralPatternsTab (metric cards)
- [ ] Test both tabs end-to-end

**Day 4 (8h):**
- [ ] Migrate AccountStatsPnlTab (complex metrics)
- [ ] Polish TokenBadge, WalletBadge (rounded-lg, hover shadows)
- [ ] Polish Sidebar (rounded-lg nav items, 200ms transitions)

**Day 5 (8h):**
- [ ] Regression testing (all wallet pages, all tabs)
- [ ] Fix edge cases
- [ ] Performance check (Lighthouse)

**Deliverable:** Dashboard components modern, consistent spacing/shadows.

---

### **Week 2: Layout + Home + Auth** (40h)

**Day 1 (8h):**
- [ ] Create `MarketingShell.tsx`
- [ ] Create `ToolHubShell.tsx`
- [ ] Update root layout (remove wrapper)
- [ ] Test shells in isolation

**Day 2 (8h):**
- [ ] Update landing page (wrap in MarketingShell)
- [ ] Remove animated orbs
- [ ] Test unauthenticated flow

**Day 3 (8h):**
- [ ] Redesign `/home` page (tool showcase)
- [ ] Create ToolCard component
- [ ] Add 4 tool cards
- [ ] Add Quick Actions section

**Day 4 (8h):**
- [ ] Wrap all tool pages in ToolHubShell
- [ ] Test sidebar visibility (landing vs tools)
- [ ] Mobile responsive testing

**Day 5 (8h):**
- [ ] Align auth components (remove gradients)
- [ ] Polish AuthModal, SignInModal, SignUpModal
- [ ] Test auth flow end-to-end

**Deliverable:** Clear layout separation, rich home page, polished auth.

---

### **Week 3: New Features + Polish** (20h)

**Day 1-2 (16h):**
- [ ] Create `/timeline` page
- [ ] Create JobCard component
- [ ] Create OnboardingChecklist component
- [ ] Wire to backend (if ready) or use mock data

**Day 3 (4h):**
- [ ] Final accessibility audit (WCAG AA)
- [ ] Performance audit (Lighthouse)
- [ ] Mobile responsive final check
- [ ] Fix any remaining issues

**Deliverable:** Complete redesign shipped.

---

## PART 9: BACKEND REQUIREMENTS

### **New Endpoint Needed:**

**`GET /api/v1/users/me/jobs`**

Returns user's analysis job history.

**Response Schema:**
```ts
interface UserJob {
  id: string
  type: 'wallet-analysis' | 'similarity-analysis' | 'holder-profiles'
  status: 'queued' | 'running' | 'completed' | 'failed'
  createdAt: string  // ISO timestamp
  completedAt?: string
  metadata: {
    walletAddress?: string
    walletCount?: number
    tokenMint?: string
  }
  result?: {
    summary: string
    url: string  // Link to results
  }
}

interface UserJobsResponse {
  jobs: UserJob[]
  total: number
}
```

**Query Parameters:**
```
?limit=50          // Pagination
?offset=0
?status=completed  // Filter by status
```

**Used By:** Timeline page (`/timeline`)

---

## PART 10: WHAT WE'RE NOT DOING (SCOPE DISCIPLINE)

### **Banned from Plan:**

1. ❌ **Admin Panel Redesign** - Stays as-is (user maintains)
2. ❌ **Custom Spacing Scale** - Use Tailwind defaults
3. ❌ **Custom Typography Scale** - Use Tailwind defaults
4. ❌ **Gradient Everywhere** - Only if absolutely needed, sparingly
5. ❌ **Framer Motion** - CSS only
6. ❌ **Staggered Animations** - No entrance effects
7. ❌ **Backdrop Blur** - Performance killer
8. ❌ **Shimmer Loading States** - CSS spinner is fine
9. ❌ **Hover Lift Effects** - Causes layout shift
10. ❌ **3xl Border Radius** - Too extreme for data tools

### **Keep Animations to:**
- `transition-colors duration-200`
- `transition-shadow duration-200`
- `animate-spin` (loaders only)
- `animate-pulse` (skeletons only)

---

## PART 11: CONTEXT-AWARE DECISIONS

### **Decision 1: API Key Store References**

**Current Plan Had:** References to `useApiKeyStore`, demo mode, API key settings

**Reality:** All deprecated in auth branch.

**Action:** Removed all `useApiKeyStore` references from plan. Use `useAuth()` hook instead.

---

### **Decision 2: Admin Panel**

**Current Plan Had:** No mention of admin panel

**Reality:** Admin panel exists and stays as-is (user-maintained)

**Action:** Explicitly noted "NO CHANGES" to admin panel.

---

### **Decision 3: Email Verification**

**Current Plan Had:** Generic onboarding checklist

**Reality:** Email verification is core requirement (already built)

**Action:** Onboarding checklist includes "Verify Email" as first step, integrates with existing `EmailVerificationBanner`.

---

### **Decision 4: Home Page Design**

**Current Plan Had:** Generic "tool showcase"

**Reality:** `/home` exists on auth branch (minimal gradient splash)

**Action:** Full redesign specified - rich tool cards, no animated orbs, sidebar visible.

---

### **Decision 5: Routing**

**Current Plan Had:** "/home as default route"

**Reality:** Landing (`/`) serves unauthenticated, Home (`/home`) serves authenticated

**Action:** Keep both routes, clarify purpose (landing = marketing, home = tool hub).

---

## PART 12: SUCCESS METRICS

### **Before (Current State After Auth Merge):**
- ❌ Inconsistent card padding (p-3, p-4, p-6)
- ❌ Mix of Tremor + shadcn design systems
- ❌ Sidebar on landing page (confusing UX)
- ❌ Minimal home page (just "Go to Dashboard")
- ❌ No user job history
- ❌ No onboarding flow
- ❌ Auth modals have gradients (against principles)

### **After (Target State):**
- ✅ Consistent spacing (`p-6` for cards, `gap-6` for grids)
- ✅ Single design system (shadcn + Tremor charts only)
- ✅ Clear layout split (Marketing vs Tool hub)
- ✅ Rich home page (tool showcase with feature lists)
- ✅ User timeline showing job history
- ✅ Guided onboarding checklist
- ✅ Modern aesthetics (rounded-xl, shadow system)
- ✅ Auth components aligned with design principles
- ✅ Performance >90 on Lighthouse
- ✅ WCAG AA compliant

### **User Impact:**
1. **New User:** Landing → Sign Up → Email Verify → Onboarding → Home (tool cards) → Choose Tool
2. **Returning User:** Sign In → Home (see tools + recent jobs) → Continue Work
3. **Admin:** Additional admin link in sidebar → API key management
4. **Visual Consistency:** Every card looks similar, shadows consistent, spacing predictable

---

## PART 13: RISK ASSESSMENT

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Auth merge breaks design work | LOW | MEDIUM | Design on separate branch, merge after auth |
| Tremor chart breaking after Card migration | LOW | HIGH | Don't touch Tremor charts, only wrappers |
| Layout split breaks pages | MEDIUM | HIGH | Test all pages systematically |
| Timeline backend not ready | MEDIUM | LOW | Build UI with mock data first |
| Time estimate too optimistic | MEDIUM | MEDIUM | Add 20% buffer (120h total) |

---

## FINAL WORD: THE COMPLETE PICTURE

**This plan is designed for the FUTURE STATE:**
- ✅ Assumes auth infrastructure (JWT, email verification, user accounts)
- ✅ Excludes deprecated concepts (API key store for users, demo mode)
- ✅ Includes auth components in migration plan
- ✅ Preserves admin panel (no changes)
- ✅ Designs for authenticated user journey
- ✅ Realistic timeline (~100h, 2.5 weeks)

**Key Differences from Original Plan:**
- ✅ Knows about auth components (7 files to align)
- ✅ Knows about admin panel (excluded from redesign)
- ✅ Knows about email verification (integrated into onboarding)
- ✅ Knows about user accounts (no API key references)
- ✅ Knows about dual shells (MarketingShell vs ToolHubShell)

**This is the COMPLETE picture. Ship it.** 🚀
