# Sova Intel — Landing Page Design Brief

## Assignment

Design and implement a new landing page for **Sova Intel** (`dashboard/src/app/page.tsx`).

The current page is a placeholder — a centered headline with two blur blobs. It needs to become
a high-quality marketing page that converts visitors into users. The target audience is Solana
on-chain researchers, traders, and developers. They are sophisticated. They will not respond to
generic crypto hype. They respond to specificity, density, and credibility.

This is **not** a documentation page and **not** a feature dump. It is a story about why this
tool exists, what it uniquely does, and why someone should sign up right now.

---

## The Product

Sova Intel has two distinct surfaces. Both must be represented on the landing page.

### 1. The Dashboard (sova-intel.com)

A web application for Solana wallet analytics and behavioral intelligence. Authenticated users get
access to:

**Discover**
Browse a curated, filterable feed of Solana wallets ranked by PnL, winrate, and activity. Each
wallet is classified by two behavioral axes:
- **Speed** — how fast a wallet exits positions: Sniper (<5min), Scalper, Momentum, Intraday,
  Day Trader, Swing, Position, Hodler (30+ days)
- **Flow** — buy/sell balance pattern: Buy-Only, Accumulator, Balanced, Distributor, Sell-Only

**Similarity Lab**
Submit a list of wallet addresses (or pull top holders of any token). The system runs a
background analysis job and returns a similarity matrix — which wallets share capital allocation
patterns, overlapping token exposure, and coordinated behavior. Used to detect coordinated
buying, shared teams, or related smart money clusters.

**Tracked Wallets**
Save wallets with nicknames and custom collections. View portfolio-level stats across all tracked
wallets. Batch-analyze groups of wallets. Import/export wallet lists.

**Holder Profiles**
Deep behavioral profile for any wallet: behavior composition, exit timing breakdown, cognitive
primitives, similarity pairs, and a human-readable narrative of how the wallet trades.

**Wallet Hunt**
Search for wallets matching specific behavioral criteria.

Do not mention: Radar, Chat, Tokens pages. These are not publicly available.

### 2. The Intel API (api.sova-intel.com)

A REST API for developers and AI agents to consume Sova Intel data programmatically.

**What it provides:**
- Wallet HUD — quick behavior snapshot: speed category, flow pattern, winrate, PnL, bot/whale
  flags (1 credit)
- Wallet Profile — full behavioral analysis (5 credits)
- Wallet Tokens — per-token P&L breakdown (3 credits)
- Batch HUD — multiple wallets in one call (5 credits)
- Token Holder Profiles — async job, returns behavioral profile for all holders of a token
  (20 credits)
- Wallet Similarity — async job, compares wallets for behavioral overlap (20 credits)

**Two authentication paths:**
- **API Key** — generate from the dashboard, pass as `X-Api-Key` header, credits deducted per
  call. Self-serve, immediate, no approval needed.
- **X402 (Autonomous Payments)** — pay-per-call directly from a Solana USDC wallet. No
  pre-funded account needed. HTTP 402 response carries payment instructions, client builds and
  signs a USDC transaction, resends with `payment-signature` header. Designed for AI agents
  operating autonomously.

**SDK:**
```bash
npm install @sova-intel/sdk
```
Zero dependencies. TypeScript. Handles cold-wallet 202 fallback, async job polling, and both auth
modes automatically.

**Docs:** docs.sova-intel.com

**Pricing (credit packs):**
| Pack | Credits | Price |
|------|---------|-------|
| Starter | 1,000 | $15 |
| Builder | 10,000 | $120 |
| Pro | 100,000 | $900 |

1 credit = $0.015 at Starter, down to $0.009 at Pro.

---

## Technical Constraints

- Framework: **Next.js 14** (App Router, `'use client'`)
- Styling: **Tailwind CSS** + **shadcn/ui** components
- File to replace: `dashboard/src/app/page.tsx`
- Wrap the page in `LandingShell` from `@/components/layout/LandingShell` (provides ThemeProvider
  and Toaster)
- Auth modal: `AuthModal` from `@/components/auth/AuthModal` — keep the existing trigger logic
  (see current `page.tsx` for the pattern — Sign In / Sign Up open the modal, authenticated
  users redirect to `/discover`)
- Logo asset: `/sova_badge_primary.svg` in `/public`
- Existing color tokens in `globals.css`: slate-950/900 backgrounds, blue-to-purple gradient
  accent, green-500/red-500 for profit/loss
- Do **not** add new npm packages. Do not create new files. Single `page.tsx` only.
- Inline SVGs for any icons not available in lucide-react

---

## Required Sections

These 7 sections must be present, in this order. How they look is up to the agents.

1. **Navigation** — logo + sign in / sign up
2. **Hero** — the page's most important moment
3. **Two-surface split** — Dashboard (for traders) and API (for builders), side by side
4. **Dashboard feature highlights** — Discover, Similarity Lab, Tracked Wallets, Holder Profiles,
   Wallet Hunt. Real names, real capabilities.
5. **API / Developer section** — SDK install command, a real code snippet using the SDK,
   the x402 autonomous payment concept, link to docs
6. **Pricing** — Starter / Builder / Pro, credits and prices, factual
7. **Footer** — logo, Telegram (`https://t.me/sovaintel`), X (`https://x.com/Sova_intel`),
   docs (`https://docs.sova-intel.com`), `/terms`, `/help`

---

## Tone and Audience

The reader is a Solana trader or developer who has spent time on-chain trying to make sense of
wallets manually. They know what PnL is. They know what a wallet address looks like. Do not
explain blockchain to them.

The product should feel like a precision instrument — not a startup, not a protocol, not a
"platform." Credibility comes from specificity.

---

## Hard Constraints on Content

- Do **not** mention: Radar, Chat, or Tokens pages
- Do **not** use: "AI-powered", "next-gen", "cutting-edge", "revolutionary", "all-in-one",
  "unlock", or any phrase that could appear on any other crypto product
- Do **not** use emojis anywhere on the page
- The word "AI" is only acceptable in the precise technical context of x402 agent payments

---

## Definition of Done

- [ ] Page renders correctly in dark mode (default) with no hydration errors
- [ ] Auth flow preserved: modal opens on Sign In / Sign Up, authenticated users go to `/discover`
- [ ] All 7 sections present, no placeholder text
- [ ] Links only to routes that exist: `/terms`, `/help`, `/discover`,
      `https://docs.sova-intel.com`, `https://t.me/sovaintel`, `https://x.com/Sova_intel`
- [ ] Responsive: readable on mobile, excellent on desktop
- [ ] Single file, no new dependencies, no new files
- [ ] Radar, Chat, Tokens not mentioned anywhere
