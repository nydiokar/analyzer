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
- [ ] Frontend: GlobalChat + MessageComposer with @ autocomplete and unresolved @sym: blocking
- [ ] Frontend: TokenThread panel with metrics strip, infinite scroll, and inline composer
- [ ] Shared mention-grammar between web/server; client pre-parse + server re-validate
- [ ] WebSocket integration: message.created append to global/thread stores (rooms join)
- [ ] Token List: use `WatchedToken` join; show tags and last message time; open thread on click
- [ ] Tag editor chips on token: POST /tokens/:addr/tags; rate-limit on server
- [ ] Symbol resolver UX: modal to disambiguate @sym:, rewrite to @ca: before submit

### Progress log
- 2025-09-15: Added models and enums to prisma/schema.prisma and documented indexes.
- 2025-09-15: Module + endpoints + gateway implemented; smoke test passed.
