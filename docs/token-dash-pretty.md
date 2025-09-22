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
- Routing: Kept `#thread=<addr>` hash for selection to avoid churn; can migrate to `?view=token&addr=` in a follow-up.
- Virtualization: Deferred (no new deps). Current feeds paginate with “Load more…”.
- Rendering: In scoped token threads, inline token pill for the scoped token is suppressed (as specified).

Open Questions / Next Steps

- Server pins: Implemented basic boolean `isPinned` on Message, endpoint, and socket broadcast. Future: richer pin metadata (pinnedAt, pinnedBy) and fetching pins outside current slice.
- Virtualized feed: Introduce `react-virtuoso` for large rooms once dependency installs are green-lit.
- Quote-reply and reactions: Add lightweight UI affordances and SSE/socket events; aligns with Phase 2.
- URL state: Migrate from hash to query param, then add `/m/[id]` permalinks and scroll anchors.
- Token drawer: Split drawer from thread for richer KPIs (mini chart, tag management) without duplicating the feed.
