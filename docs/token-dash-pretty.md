Effort bands

Phase 1 (tri-pane layout, drawer, composer, pins, virtualization): 2–4 dev days.

Phase 2 (quote-reply, reactions, saved views, unread anchors, edit window): 3–6 dev days.

Phase 3 (alerts, charts, permalinks, mobile bottom sheet, moderation): 4–8 dev days.

Add 1–2 days for polish/QA per phase.


Token Chat v2 — Build Spec
Stack

Next.js 14 (app router), TypeScript, Tailwind, shadcn/ui (+ Radix), lucide-react, framer-motion, react-virtuoso.

Routes

/tokens — tri-pane workspace.

Query: ?view=global|token&addr=<base58>&tag=<prefix:value>

Permalink: /m/[id] → resolves, selects token, highlights message.

API base (existing): /messages, /tokens, /tags.

Layout

Left: TokenSidebar

Center: ChatFeed + Composer

Right: TokenDrawer (sticky; collapses <1280px)

Components & Props
type TokenLite = {
  address: string; symbol: string; name: string; avatarUrl?: string;
  priceUsd?: number; marketCapUsd?: number; liquidityUsd?: number; volume24h?: number;
  spark?: number[]; latestMessageAt?: string; tags?: Tag[];
};

type Tag = { id: string; key: 'meta'|'risk'|'sym'|'ca'; value: string; usageCount?: number };

type Message = {
  id: string; token?: TokenLite; author: { id:string; name:string; avatarUrl?:string };
  text: string; createdAt: string; editedAt?: string; isPinned?: boolean; parentId?: string|null;
  mentions?: Array<{ type:'token'|'tag'|'user'; value:string }>;
  reactions?: Array<{ type:'like'|'warn'|'test'; count:number; me?:boolean }>;
};

type FeedMode = { kind:'global' } | { kind:'token'; addr:string } | { kind:'tag'; tag:Tag };

<TokenSidebar
  sections={[
    { id:'favorites', title:'Favorites', tokens: TokenLite[] },
    { id:'recent', title:'Recent', tokens: TokenLite[] },
    { id:'mentioned', title:'Mentioned Today', tokens: TokenLite[] },
  ]}
  selectedAddr?: string
  onSelect={(addr:string)=>void}
/>

<TokenDrawer
  token: TokenLite
  onWatchToggle: ()=>void
  onOpenChart: ()=>void
  onOpenDex: ()=>void
  onAddTag={(t:Tag)=>void}
  onRemoveTag={(id:string)=>void}
/>

<ChatFeed
  mode: FeedMode
  pinned: Message[]
  messages: Message[]
  onLoadMore: ()=>void
  onReply={(m:Message)=>void}
  onPin={(m:Message)=>void}
  onReact={(m:Message, type:'like'|'warn'|'test')=>void}
  onDelete={(m:Message)=>void}
/>

<Composer
  scope?: { kind:'global' } | { kind:'token'; token:TokenLite }
  onSend={(text:string, opts?:{ parentId?:string })=>void}
/>

Keyboard Map

Ctrl/⌘+Enter send

↑ edit last message (30s window)

J/K navigate feed, Enter open actions

Alt+K focus search, Alt+P pin, Alt+W watch toggle

Q quote-reply selected

URL/State Rules

Shallow-push on token select: ?view=token&addr=...

Preserve scroll anchors per token; show “Jump to latest” button when new messages arrive above.

Socket Events
'message.created'  { message: Message }
'message.updated'  { message: Message }
'message.deleted'  { id: string }
'message.pinned'   { id: string, isPinned: boolean }
'reaction.updated' { id: string, type: string, delta: 1|-1 }


Batch events at 100–200ms before applying to state.

API Contracts (minimal)

GET /messages?mode=global|token&addr=&cursor= → { items: Message[], nextCursor?: string }

POST /messages { text, tokenAddr?, parentId? } → Message (idempotency key header)

PATCH /messages/:id { text? } → Message

DELETE /messages/:id → { ok: true }

POST /messages/:id/pin { isPinned: boolean } → { ok: true }

POST /messages/:id/react { type: 'like'|'warn'|'test', on:true|false } → { ok:true }

GET /tokens/watched → TokenLite[]

POST /tokens/:addr/watch { on:boolean } → { ok:true }

GET /tokens/:addr/tags → Tag[]

POST /tokens/:addr/tags { key, value } → Tag

DELETE /tags/:id → { ok:true }

GET /tags/suggest?prefix=me → Tag[]

Rendering Rules

Group messages by date; unread divider from last seen.

Message bubble: author name 12px, timestamp muted; content 14px; actions on hover/focus only.

Mentions render as inline chips; scoped token pill suppressed.

Pinned band above feed; dismiss per user (local state).

Visual Tokens

Radius: rounded-2xl bubbles, rounded-xl cards.

Spacing: 8-pt grid; message padding 12/14.

Chips: 12px, 1px border, low-saturation bg, deterministic color by hash(key+value).

Contrast ≥ 4.5:1; visible focus rings.

Performance

Virtualize feed (react-virtuoso).

Optimistic send/delete/pin; rollback on error.

Coalesce revalidation; drop the current immediate+delayed double fetch.

Accessibility

Landmarks: nav (sidebar), main (feed), complementary (drawer).

ARIA menus for actions; keyboard-first operable; tooltips have aria-describedby.

Empty/Loading States

Global empty: “No messages yet. Share an insight to start the stream.”

Token empty: “Be first to add context for {symbol}.”

Skeletons for list rows, feed items, drawer KPIs.

MVP Cut (Phase 1)

Tri-pane layout + drawer

Virtualized ChatFeed

Pinned messages

Composer with autocomplete for @meta:, @risk:, @sym:

Deep-linking and scroll anchors

Basic tag add/remove in drawer

Nice-to-Have (Phase 2+)

Quote-reply, reactions, edit window

Saved views and tag filters

Alerts per token; mini charts in drawer

Permalinks and external share

Mobile bottom-sheet drawer

Test Checklist

Keyboard flows work without mouse

Back/forward preserves selection and scroll

Pinned persists across reloads

Mentions chip rendering accurate; scoped suppression works

Optimistic updates recover on 500/timeout

Color tokens pass dark/light modes


---

V1 Implementation Notes (Least-Action Pass)

- Tri-pane layout: Implemented on `/tokens` using existing components.
  - Left: `WatchedTokenList` (nav landmark, focus-visible rings).
  - Center: `GlobalChat` feed + composer.
  - Right: Token thread shown as a drawer on `xl+` screens; modal fallback on mobile.
- Pinned messages: Server-persisted via `POST /messages/:id/pin` with socket `message.pinned` events; pinned band above feeds reflects server state. Band dismissal per user can stay local as a future enhancement.
- Composer polish: Ctrl/⌘+Enter send; inline symbol resolution preserved; scoped `@ca:<addr>` auto-prefix when composing inside a token thread.
- Watch toggle: Added backend `POST /watched-tokens/:addr/watch { on }` and a simple Watch/Unwatch button in the thread header; watched list revalidates live.
- Accessibility: Landmarks (nav/main/aside), focus-visible rings on interactive rows, compact labels.
- Routing: Added query-based selection (`?view=token&addr=&mid=`) and `/m/[id]` permalinks that resolve, scroll, and highlight.
- Virtualization: Lightweight pass using CSS `content-visibility` and IntersectionObserver-based infinite scroll (no external deps).
- Rendering: In scoped token threads, inline token pill for the scoped token is suppressed (as specified).

Phase 1 Status — Done

- Tri-pane layout widths: Tokens list widened (xl: 360px, 2xl: 420px). Drawer matches for balance.
- Pinned messages: Server-side pins with socket updates and a pinned band.
- Composer: Ctrl/⌘+Enter; scoped auto-@ca.
- Deep links: `/m/[id]` → `/tokens?view=token&addr=&mid=` + scroll-to + highlight.
- Full-height layout: Only feed scrolls; composer fixed and visible.
- Perf: Content-visibility on rows + sentinel auto-load.

 Phase 2 Progress

 - Server pins: Implemented basic boolean `isPinned` on Message, endpoint, and socket broadcast. Future: richer pin metadata (pinnedAt, pinnedBy) and fetching pins outside current slice.
 - Quote-reply: Reply-to bar in composer + parent preview rendered above message.
 - Reactions: Buttons (like/warn/test) with counts; socket `reaction.updated`; optimistic UI refresh.
 - Unread anchors: Track last-seen per scope; show “Jump to latest” when new messages arrive above.
 - Edit window: Minimal prompt-based edit for last posted message window.
 - Saved views and tag filters: Deferred per request.

---

Phase 3 — Sparkline (no polling, no iframe)

Goal: native, lightweight mini trend line in the token drawer without client-side polling or third‑party iframes.

Approach (minimal, future‑proof)

- Data pipeline (Redis, no DB migration):
  - Producer: when `DexscreenerService.fetchAndSaveTokenInfo` updates a token's `priceUsd`, also append a point to a Redis ring buffer key `spark:<tokenAddress>` using `RPUSH` and `LTRIM` to keep the last 96 points. Value format: JSON `{ t: <epochMs>, p: <number> }`.
  - Triggers:
    - On-demand via `WatchedTokensService.ensureWatchedAndEnrich` (already called on token mentions and watch toggles).
    - Light periodic job (every 2–5 minutes, jittered) over currently watched tokens. Cap batch size to avoid rate spikes.

- API (read‑only, cached):
  - `GET /token-info/:addr/sparkline?points=24` → `{ points: Array<[ts:number, price:number]> }`.
  - Reads last N entries from Redis list; normalizes/compacts response. Add `Cache-Control: public, max-age=60` and ETag.

- Frontend (no timers):
  - Replace `useMiniPriceSeries` polling with a one-shot fetch when the drawer opens or token selection changes; re-fetch on socket reconnect or manual refresh.
  - Render via the existing `Sparkline` component; color trend by first vs last point.
  - If no data yet, hide sparkline gracefully.

- Ops & safeguards:
  - No Prisma migration required; avoids DB bloat. Optional later: move to a `TokenPriceSnapshot` table if long-term retention is needed.
  - Backoff and cap periodic enrichment (top N watched tokens, jittered intervals). Timeouts and retries reuse Dexscreener settings.
  - Feature flag the endpoint/use-site for safe rollout.

Why this design

- Eliminates client polling and iframe dependency.
- Reuses existing enrichment flow and infra (Redis, Dexscreener).
- Small blast radius; easy to extend to other UI surfaces.

Scheduler + provider fallback (details)

- Cadence & cohort
  - Run every 2–5 minutes with jitter.
  - Select a capped cohort per tick (e.g., 100–200) from watched tokens, prioritizing tokens with recent activity (recent messages or trades).
  - Enforce per-token minimum interval (≥ 2–5 minutes) to avoid tight loops.

- Source order and throttles
  - Primary: Dexscreener via existing service (reuse `chunkSize`, `maxConcurrentRequests`, `baseWaitTimeMs`).
  - Fallback (feature-flagged): Jupiter price API when Dexscreener misses/429s a token. Cache each fallback response for 60–120s.
  - Backoff on 429/5xx; global ceilings per tick and per minute; abort early if error rate spikes.

- Snapshot write policy
  - After successful price fetch, append to Redis ring buffer only if: (a) last snapshot older than min interval OR (b) absolute/percent delta exceeds threshold to avoid flat spam.
  - Key: `spark:<tokenAddress>`; value: JSON `{ t: <epochMs>, p: <number> }`; `RPUSH` + `LTRIM` to keep last 96 points; optional TTL (e.g., 72h) for inactive tokens.

- API contract
  - `GET /token-info/:addr/sparkline?points=24` → `{ points: Array<[ts:number, price:number]> }`.
  - Reads from Redis only; `Cache-Control: public, max-age=60` + ETag.

- Frontend behavior
  - On token selection/drawer open: fetch once; re-fetch on socket reconnect or manual refresh.
  - Render with `Sparkline`; color trend by first vs last; hide if fewer than 2 points.

- Observability & safety
  - Metrics: tokens processed per tick, API success/429/5xx, snapshot writes, endpoint hit rate.
  - Logs: cohort size, duration, backoff decisions; circuit breaker triggers.
  - Feature flags: enable/disable scheduler; enableJupiterApi (see `src/config/constants.ts`).