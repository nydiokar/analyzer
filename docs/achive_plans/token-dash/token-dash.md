# Global Chat ⇄ Token Threads Backbone

> **Purpose**: Use this to brief an LLM and verify implementation scope. Splits into Backend and Frontend, with schemas, API contracts, and wiring. Aligns with your NestJS/Prisma/BullMQ stack and existing TokenInfo module and DI layout.

## Overview

This document outlines the implementation plan for a global chat system that integrates with token-specific threads, enabling users to discuss tokens while maintaining organized conversations.

---

## Backend Implementation

### 1. Database Architecture

#### 1.1 Reuse vs New Models

**Strategy**: Keep `TokenInfo` as the canonical metadata row keyed by `tokenAddress`. Don't duplicate. New tables reference `TokenInfo.tokenAddress` as FK. This fits current TokenInfo module and Dexscreener ingestion.

#### 1.2 Database Schema (Prisma)

Add these models; keep names stable for migrations.

```prisma
model Message {
  id           String    @id @default(cuid())
  body         String
  authorUserId String?          // optional for anonymous/bot system posts
  source       String           // "dashboard" | "telegram" | "bot"
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  mentions     MessageMention[]
  revisions    MessageRevision[]
}

model MessageRevision {
  id         String   @id @default(cuid())
  messageId  String
  body       String
  editedAt   DateTime @default(now())
  Message    Message  @relation(fields: [messageId], references: [id])
}

model MessageMention {
  id         String   @id @default(cuid())
  messageId  String
  kind       String          // "token" | "tag" | "time" | "user"
  refId      String?         // tokenAddress | tagId | userId | null
  rawValue   String          // original text like "ca:V5cC..." or "meta:elon"
  metaJson   Json?
  Message    Message  @relation(fields: [messageId], references: [id])

  @@index([kind, refId])
  @@index([messageId])
}

model Tag {
  id     String @id @default(cuid())
  name   String @unique     // "elon"
  type   String             // "meta" | "risk" | "thesis"
  // optional: createdBy, createdAt
}

model TokenTag {
  tokenAddress String
  tagId        String
  source       String   // "user-note" | "system" | "import"
  confidence   Float    @default(1.0)
  createdAt    DateTime @default(now())

  TokenInfo TokenInfo @relation(fields: [tokenAddress], references: [tokenAddress])
  Tag       Tag       @relation(fields: [tagId], references: [id])

  @@id([tokenAddress, tagId])
  @@index([tagId])
}
```

#### 1.3 Virtual/Thread Views (SQL, not Prisma models)

- `v_token_thread(tokenAddress)` = all Message rows that have a MessageMention(kind='token', refId=tokenAddress)
- `v_tag_feed(tagId)` = messages mentioning that tag

**Note**: Using existing TokenInfo: no changes required; tags & threads hang off it.

### 2. Parser and Namespaces

Deterministic, strict namespaces to avoid collisions:

- `@ca:<ADDRESS>` → token by contract (Solana base58, len 32–44)
- `@sym:<SYMBOL>` → resolve against `TokenInfo.symbol` (case-insensitive). If multiple TokenInfo rows share the symbol, return 409 with candidate list; client must choose one (rewrites to @ca:<ADDRESS> before submit).
- `@meta:<tag> @risk:<tag> @thesis:<tag>` → create Tag if missing
- `@time:(\d+)(m|h|d)` → store `{"minutes":N}` in metaJson
- `@user:<handle>` → optional link to users table

**Implementation**: Client does pre-parse for UX; server re-parses and validates as source of truth.

### 3. API Contracts (REST)

Use existing auth and guards. Keep responses in your standard envelope.

#### 3.1 Messages

**POST /messages**

```json
{
  "body": "Found @ca:V5cCi... @meta:elon likely pump @time:5h",
  "source": "dashboard"
}
```

**Server responsibilities:**
- Parse, resolve mentions, 409 on unresolved @sym:
- Insert Message, MessageMention[] in one TX
- Side-effect: for any {kind:'token'} + tag mentions, upsert TokenTag
- Response: `{ id, createdAt, mentions:[...] }`

**GET /messages?cursor=...&limit=50**
- Global feed (sorted desc by createdAt)
- Returns message + expanded chips: `{ kind, refId, display }`

**GET /tokens/:tokenAddress/messages?cursor=...&limit=50**
- Token thread view (via join on mentions)

**PATCH /messages/:id**
- Re-parse, store MessageRevision, update Message, recompute mentions
- Do not auto-remove TokenTags on edit. Tags are only removed explicitly via tag API.

#### 3.2 Tagging Shortcuts

**POST /tokens/:tokenAddress/tags**

```json
{ "items":[{"type":"meta","name":"elon"}] }
```

Upsert Tag and TokenTag (used by UI tag editor chips). Removal of tags happens only via this endpoint; message edits do not cascade removals.

#### 3.3 Alias Resolution

**GET /resolve/symbol?sym=JUP**

Returns candidates: `[{"tokenAddress":"...","name":"Jupiter"}]`

Client uses this for @sym: autocomplete.

#### 3.4 Signals as Messages

Reasoning posts to /messages with source:"bot" and corresponding mentions. No special endpoint needed.

**Job/queue integration**: unchanged; continue to enrich TokenInfo/metrics via your existing queues and services. Messages are orthogonal to those modules.

### 4. Services and Wiring (NestJS)

#### 4.1 MessagesModule

**MessagesController** (endpoints above)

**MessagesService**
- `createMessage(input)`
  - `parseMentions(body)` (pure)
  - `resolveMentions(mentions)` → addresses, tags, users, time
  - TX: insert Message, MessageMention[], upsert tags
- `listGlobal(cursor, limit)`
- `listForToken(tokenAddress, cursor, limit)`
- `editMessage(id, body)`

**MentionParser** (pure function, unit-test heavy)

**Dependencies**: DatabaseService, optional UsersService, TokenInfoService (for alias resolution), DexscreenerService only indirectly via your existing flows.

#### 4.2 WebSocketModule (Separate Gateway)

Use a dedicated `MessageGateway` (do not extend `JobProgressGateway`) with its own namespace and channels, reusing the Redis infrastructure:

```typescript
// namespace: /socket.io/messages
// channels: message-events:global, message-events:token:<address>
```

### 5. Backend Fragility Checkpoints

- **Ambiguity**: disallow bare @<thing>; enforce @ca:/@sym: namespaces; return 409 with choices
- **Cross-posting explosion**: limit ≤5 token mentions per message
- **Edits**: on edit, recompute mentions; store MessageRevision; do not auto-delete TokenTags
- **Idempotency**: optional X-Idempotency-Key header to dedupe Telegram mirrors
- **Performance**: add indexes MessageMention(kind,refId) and Message(createdAt); paginate by (createdAt, id)

---

## Frontend Implementation

**Tech Stack**: Next.js + Tailwind + Tremor. Reuse your TokenBadge for chips and list items.

### 1. Routes and Layout

#### 1.1 /tokens
Two-column layout:
- **Left**: Token List + collapsible per-token thread panel
- **Right**: Global Chat (persistent)

#### 1.2 /tags/:tag (optional)
Filtered token list and a "tag feed" using the same message renderer.

### 2. State and Data Hooks

- `useGlobalChat({ cursor })` → GET /messages
- `useTokenThread(tokenAddress, { cursor })` → GET /tokens/:tokenAddress/messages
- `usePostMessage()` → POST /messages
- `useResolveSymbol(sym)` → GET /resolve/symbol

**WebSocket Integration**: Subscribe to message.created and append to appropriate lists. Use your existing gateway and Redis pub infrastructure.

### 3. Components

#### 3.1 MessageComposer
- Rich text input
- @ autocomplete trays: ca, sym, meta, risk, thesis, time, user
- Preview chips for parsed mentions before submit
- Block submit on unresolved @sym:

#### 3.2 MessageItem
- Renders text with inline TokenBadge for @ca:/@sym:
- Click on TokenBadge focuses left panel on that token and opens thread
- Click on tag chip filters token list by tag

#### 3.3 GlobalChat
- Virtualized list, infinite scroll, shows MessageItem
- Top-fixed MessageComposer

#### 3.4 TokenThread
- Same renderer, scoped data
- Shows small metrics strip from TokenInfo (price, mcap, ret24h) using your current enrichment

#### 3.5 TokenList
- Table with columns: token, tags, price, mcap, 24h%, last message time
- Row click → focus TokenThread
- Tag chips inline editable → uses POST /tokens/:addr/tags

#### 3.6 TokenBadge (reuse)
- Accepts `{ tokenAddress, name?, symbol?, imageUrl? }`
- On hover → mini-card with metrics from TokenInfo

### 4. UX Details That Drive Correctness

- Composer validates @ca: base58 and @sym: resolution on the client with debounced calls; server still re-validates
- When message includes both a token mention and @meta:/@risk:/@thesis:, show a "Tag will be added" hint; after submit, optimistic update the token's tags in the left panel
- Signals from the backend appear as bot messages with a distinct left stripe; they carry token mentions so they also show inside each token's thread automatically

### 5. Frontend Fragility Checkpoints

- **Parse drift**: keep a single mention-grammar.ts shared between web and server; generate types from it
- **Unresolved @sym: UX**: present a modal with candidates; choosing one rewrites the composer token to @ca:... before submit
- **Scroll traps**: maintain independent cursors for Global and Thread; don't auto-scroll on new messages if user scrolled up

---

## API Mapping

| UI Action | API Call | Side-effects |
|-----------|----------|--------------|
| Post in Global Chat | POST /messages | Creates message+mentions; upserts TokenTag if token+tag mentioned; WS message.created |
| View Global Chat | GET /messages | Paged list |
| View Token Thread | GET /tokens/:addr/messages | Paged list filtered via mentions |
| Add tag chip on token | POST /tokens/:addr/tags | Upsert Tag+TokenTag; reflect in list/thread |
| Type @sym:JUP | GET /resolve/symbol?sym=JUP | If multiple, block submit until chosen |

**Integration Note**: No changes to existing wallet/analysis/jobs modules; add a new `MessagesModule` plus Tag tables. `@sym:` resolves via `TokenInfo.symbol` (no `TokenAlias` in v1). Keeps your current DI map intact and avoids entangling with BullMQ paths.

---

## Verification & Quality Assurance

### Acceptance Checklist

- [ ] One message in Global Chat renders simultaneously in each mentioned token's thread without duplication
- [ ] Tag mentions co-mentioned with a token immediately appear on that token
- [ ] @sym: cannot submit unresolved; @ca: base58 validated
- [ ] Edits produce a MessageRevision; threads reconcile after edit
- [ ] Through WS, new messages arrive live in both global and token views

### Risk Areas

- **Symbol collisions** → enforce alias resolution flow; prefer @ca: for precision
- **Over-mentioning** → cap tokens per message to 5
- **Tag spam** → throttle TokenTag writes per user per token; show confirmation if >3 new tags in one post
- **Edit races** → optimistic concurrency on Message.updatedAt; on conflict, fetch-latest and reapply
- **Search (later)** → if you add full-text, index Message.body with trigram/FTS; keep MessageMention as primary filter

---

## Implementation Order

### Minimal Migrations Order

1. Create Tag, TokenTag
2. Create Message, MessageMention, MessageRevision
3. Add FKs to TokenInfo(tokenAddress) for tag/token joins
4. Create indexes:
   ```sql
   CREATE INDEX idx_mm_kind_ref ON "MessageMention"("kind","refId");
   CREATE INDEX idx_msg_created ON "Message"("createdAt" DESC);
   ```

### Optional v2 Features

- Mirror Telegram ↔ /messages with idempotency keyed by Telegram message_id
- Bot signals post via same API, reuse your Queue Alerting service to send mirrors 