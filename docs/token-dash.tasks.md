# Token Dash — Implementation Tasks

> Live, minimal checklist to drive implementation. We'll update statuses as we go.

### Tasks
- [x] Add Prisma models and indexes for Messages/Tags/WatchedToken
  - Message, MessageMention, MessageRevision, Tag, TokenTag, WatchedToken
  - Indexes: Message(createdAt,id), MessageMention(kind,refId), MessageMention(messageId), TokenTag(tagId)
- [x] Scaffold MessagesModule, service, DTOs, and pure mention parser
- [x] Implement REST endpoints: POST/GET /messages, GET /tokens/:addr/messages, PATCH /messages/:id, GET /messages/resolve/symbol
- [x] Implement MessageGateway with rooms for global and per-token threads
- [x] Smoke test: create → list global/thread → edit → WS publish

### Next
- [x] Frontend: GlobalChat + MessageComposer with @ autocomplete and unresolved @sym: blocking
- [x] Frontend: TokenThread panel with metrics strip, infinite scroll, and inline composer
- [x] Shared mention-grammar between web/server; client pre-parse + server re-validate
- [x] WebSocket integration: message.created append to global/thread stores (rooms join)
- [x] Token List: use `WatchedToken` join; show tags and last message time; open thread on click
- [ ] Tag editor chips on token: POST /tokens/:addr/tags; rate-limit on server
- [x] Symbol resolver UX: modal to disambiguate @sym:, rewrite to @ca: before submit

### Upcoming (next session)
- [x] Backend: POST /tokens/:tokenAddress/tags (upsert Tag/TokenTag in TX; rate limit)
- [x] Frontend: Tag editor in TokenThread header; add/remove chips via API
- [x] WebSocket: emit message.edited; clients update messages live
- [x] API: GET /token-info?addrs=... (200 OK) used by chat/thread
- [x] Metadata unify: prefer WatchedToken cache, fallback token-info for unknown mints
- [x] UI polish: compact symbol labels; hide scoped @ca: in thread; sticky header

### New targets
- [ ] Composer typeahead for `@sym:` and tags; enforce ≤5 token mentions
- [ ] Add rate-limit to tag creation per user per token (server + 429 UX)
- [ ] Add `GET /tokens/:addr/messages` alias (compat) and wire in client
- [ ] Persist tag chips visually in Watched list rows (read from TokenTag)
- [ ] Visual refactor phase 1: layout spacing, color scale, message row component

### UI/UX Roadmap (proposed)
- [ ] Global layout: Right panel hosts only Global Chat; Token Thread opens as a closable Drawer/Modal
  - Open on token click from Watched list or symbol click in chat; join WS room on open, leave on close
  - Keep URL hash `#thread=<addr>` for deep linking and back/forward behavior
- [ ] Chat bubbles: left/right alignment (others vs you), compact spacing, timestamp and author inline
  - Show author handle (or "You"), message body, time; small menu: copy, delete (own only)
  - Backend: add DELETE /messages/:id (soft delete flag) with auth guard; emit message.deleted WS
- [ ] Token metrics in Watched list rows
  - Show price, 24h %, market cap, 24h volume, liq; surface tags; hover shows mini card
  - Use TokenInfo fields (priceUsd, marketCapUsd, liquidityUsd, volume24h); compute 24h% if available
- [ ] Metadata completeness
  - Batch fetch token-info for all mints on screen (global + drawer) with debounce; refresh watched list after enrichment
  - Even if DexScreener filters a token, persist/display name/symbol when known
- [ ] Accessibility & mobile
  - Keyboard nav for composer & tag chips; responsive layout (drawer covers screen on mobile)

### Progress log
- 2025-09-15: Added models and enums to prisma/schema.prisma and documented indexes.
- 2025-09-15: Module + endpoints + gateway implemented; smoke test passed.
- 2025-09-15: Implemented GlobalChat + Composer, TokenThread, shared mention grammar, and WS live updates.
 - 2025-09-16: Unified metadata path; compact symbol labels; suppressed scoped @ca: in thread; fixed watched-token uniqueness.
 - 2025-09-16: Added Tag API + editor; WS message.edited; batch token-info for future use.
