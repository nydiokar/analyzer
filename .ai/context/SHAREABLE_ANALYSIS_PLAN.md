# Shareable Analysis Results — Plan & Architecture

**Created:** 2026-03-24
**Status:** Not started — spec only

---

## Problem

The app is a fully auth-gated SPA. Sharing analysis results (e.g. a Holder Profiles run) means:
1. Sending a link that requires the recipient to log in
2. Recipient must then manually re-run the same job
3. No preview when the link is pasted in Discord/Twitter/Telegram — bots see a blank HTML shell

---

## Background: Rendering Models

| Mode | HTML generated | OG unfurl | Best for |
|---|---|---|---|
| **SPA (current)** | In the browser via JS | ❌ Bots see empty shell | Authenticated, interactive tools |
| **SSR** | On the server per request | ✅ Full OG tags + content | Dynamic public pages |
| **SSG** | At build time | ✅ Full OG tags + content | Truly static content |
| **ISR** | Pre-rendered, refreshed in background | ✅ Full OG tags, stays fresh | Semi-static public pages |

### What are OG Images?

Open Graph (`og:`) is the metadata protocol that platforms (Twitter, Discord, Telegram, WhatsApp) use to render link preview cards. It lives in `<head>`:

```html
<meta property="og:title" content="Holder Profiles: BONK" />
<meta property="og:description" content="47 wallets — 12 snipers, 8 holders, 5 scalpers" />
<meta property="og:image" content="https://sova.intel/api/og/hp/abc123" />
<meta property="og:url" content="https://sova.intel/share/hp/abc123" />
```

The `og:image` URL points to a **dynamically rendered PNG** (1200×630px). Next.js supports this natively via `ImageResponse` in `next/og` — renders a React component to an image at request time via an edge function (no Puppeteer).

**Current state:** The app has no OG tags on any route. All pages use `"use client"` — Next.js middleware blocks unauthenticated access — so bots scraping shared links see a blank page.

---

## Architecture for Shareable Analysis Results

The key design principle: **the job never re-runs for a share link visitor.** The result is frozen at share-creation time. The share page is a read-only SSR view of that frozen snapshot.

```
User clicks "Share" (authenticated)
    │
    ▼
[1] POST /api/v1/share/hp
    • Reads cached HolderProfilesResult from Redis/DB
    • Creates HolderProfileShare row (nanoid token + snapshotJson)
    • Returns: { shareId, url }
    │
    ▼
[2] User copies link: https://sova.intel/share/hp/<shareId>
    │
    ▼
[3] Anyone opens link (no auth needed)
    │
    ├──▶ Next.js middleware: /share/* is PUBLIC (excluded from auth matcher)
    │
    ▼
[4] app/share/hp/[shareId]/page.tsx  ← SERVER COMPONENT
    • Fetches snapshot from GET /api/v1/share/hp/:id (public, no guard)
    • Renders read-only results (no job controls, no re-run button)
    • Sets OG tags via Next.js generateMetadata()
    │
    ├──▶ og:image → /api/og/hp/[shareId]
    │         Uses next/og ImageResponse
    │         Renders: token name, behavior breakdown, key stats, Sova branding
    │         1200×630px PNG, edge-cached
    │
    └──▶ Full read-only holder profiles UI rendered server-side
         → Discord/Telegram/Twitter shows real preview card
         → Recipient sees results instantly, no login, no job re-run
```

---

## Implementation Checklist

### Backend (NestJS)

- [ ] **Prisma**: Add `HolderProfileShare` model
  ```prisma
  model HolderProfileShare {
    id           String   @id @default(nanoid(10))
    snapshotJson Json
    createdAt    DateTime @default(now())
    expiresAt    DateTime?
    createdBy    String?  // userId — nullable so system/script shares work
    viewCount    Int      @default(0)
    user         User?    @relation(fields: [createdBy], references: [id])
  }
  ```
- [ ] **Controller**: `POST /api/v1/share/hp` (auth required) — reads from holder-profiles cache, writes share row
- [ ] **Controller**: `GET /api/v1/share/hp/:id` (`@Public()`) — returns snapshot JSON, increments viewCount
- [ ] Strip sensitive fields from snapshot before persisting (no internal job IDs, no user info)

### Frontend (Next.js)

- [ ] **Middleware**: Add `/share` to public paths in `dashboard/src/middleware.ts` matcher exclusions
- [ ] **Page**: `app/share/hp/[shareId]/page.tsx` — server component, fetches public endpoint, renders read-only view
- [ ] **Metadata**: `generateMetadata()` on share page — sets `og:title`, `og:description`, `og:image`, `og:url`
- [ ] **OG image route**: `app/api/og/hp/[shareId]/route.ts` — uses `ImageResponse` from `next/og`
- [ ] **Share button**: In holder profiles results UI — calls `POST /share/hp`, copies link to clipboard, shows toast

### OG Image Design (1200×630)

Content for the generated image:
- Token name + mint (truncated)
- Top behavior type breakdown (e.g. "12 Snipers · 8 Holders · 5 Scalpers")
- Key stats: median hold time, exit rate, data quality tier
- Sova Intel branding (logo, colors)
- "View full analysis →" CTA text

---

## What NOT to do

- Do not re-run the job on share page load — serve frozen snapshot only
- Do not gate the share page behind auth — defeats the entire purpose
- Do not render the share page as `"use client"` — OG tags require server-rendered `<head>`
- Do not expose user identity in the share URL or snapshot

---

## Future Extensions

- Share expiry (24h, 7d, forever — user picks)
- Password-protected shares
- Share for other analysis types: Sig Buyers, Wallet Profile, Similarity
- Embeddable widget (`<iframe>` or JS snippet) for sharing on external sites
- Public "gallery" of recent interesting analyses (opt-in)
