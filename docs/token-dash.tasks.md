# Token Dash — Implementation Tasks

> Live, minimal checklist to drive implementation. We'll update statuses as we go.

### Tasks
- [x] Add Prisma models and indexes for Messages/Tags/WatchedToken
  - Message, MessageMention, MessageRevision, Tag, TokenTag, WatchedToken
  - Indexes: Message(createdAt,id), MessageMention(kind,refId), MessageMention(messageId), TokenTag(tagId)
- [ ] Scaffold MessagesModule, service, DTOs, and pure mention parser
- [ ] Implement REST endpoints: POST/GET /messages, GET /tokens/:addr/messages, PATCH /messages/:id
- [ ] Implement MessageGateway with rooms for global and per-token threads

### Progress log
- 2025-09-15: Added models and enums to prisma/schema.prisma and documented indexes.
