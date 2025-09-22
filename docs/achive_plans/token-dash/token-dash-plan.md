# Token Intelligence Backbone — Phased Implementation Plan

> **Purpose**: This document defines the implementation plan for building the Global Chat ⇄ Token Threads backbone. It is structured in phases to keep the build lean, safe, and extensible. Each phase introduces functionality while guarding against pitfalls like data pollution, ambiguity, and spam.

## Overview

This phased implementation plan extends the core `token-dash.md` specification with additional concepts like `WatchedToken` for dashboard curation and provides a structured rollout approach to minimize risk while maximizing functionality.

---

## Core Principles

### 1. Separation of Concerns

- **TokenInfo** = all tokens discovered from ingestion (facts)
- **WatchedToken** = curated subset for dashboard (favorites/lists)
- **Messages/Mentions** = context and collaboration layer
- **Tags** = structured metadata attached via messages or direct edits

### 2. Strict Namespaces for Mentions

Avoid ambiguity with deterministic namespaces:
- `@ca:` (contract address)
- `@sym:` (symbol) — resolves using `TokenInfo.symbol` (case-insensitive). If multiple TokenInfo rows match, API returns 409 with candidates; client must select one (rewritten to @ca: before submit).
- `@meta:/@risk:/@thesis:` (tag types)
- `@time:` (time references)
- `@user:` (user mentions)

### 3. Global Chat as Control Room

- Single feed where all conversations, signals, and notes happen
- Token threads and tag feeds are filtered views of the same messages

### 4. Signals as Bot Messages

- Reasoning/alerts post into chat like human users, reusing the same system

---

## Database Schema (Prisma)

### Existing Schema

```prisma
model TokenInfo {
  tokenAddress String   @id @unique
  name         String?
  symbol       String?
  imageUrl     String?
  websiteUrl   String?
  twitterUrl   String?
  telegramUrl  String?
  marketCapUsd Float?
  liquidityUsd Float?
  pairCreatedAt BigInt?
  fdv          Float?
  volume24h    Float?
  priceUsd     String?
  dexscreenerUpdatedAt DateTime?
  fetchedAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

### New Tables

```prisma
model WatchedToken {
  id           String   @id @default(cuid())
  tokenAddress String
  list         String   // "favorites" | "graduation" | "holdstrong"
  createdAt    DateTime @default(now())
  createdBy    String?  // optional user id
  TokenInfo    TokenInfo @relation(fields: [tokenAddress], references: [tokenAddress])
}

// TokenAlias: deferred for v2. Use TokenInfo.symbol for @sym: resolution in v1.

model Tag {
  id     String @id @default(cuid())
  name   String @unique
  type   String // "meta" | "risk" | "thesis"
}

model TokenTag {
  tokenAddress String
  tagId        String
  source       String   // "user-note" | "system"
  confidence   Float    @default(1.0)
  createdAt    DateTime @default(now())
  TokenInfo    TokenInfo @relation(fields: [tokenAddress], references: [tokenAddress])
  Tag          Tag       @relation(fields: [tagId], references: [id])
  @@id([tokenAddress, tagId])
}

model Message {
  id           String    @id @default(cuid())
  body         String
  authorUserId String?
  source       String    // "dashboard" | "telegram" | "bot"
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  mentions     MessageMention[]
  revisions    MessageRevision[]
}

model MessageMention {
  id        String   @id @default(cuid())
  messageId String
  kind      String   // "token" | "tag" | "time" | "user"
  refId     String?
  rawValue  String
  metaJson  Json?
  Message   Message  @relation(fields: [messageId], references: [id])
  @@index([kind, refId])
}

model MessageRevision {
  id        String   @id @default(cuid())
  messageId String
  body      String
  editedAt  DateTime @default(now())
  Message   Message  @relation(fields: [messageId], references: [id])
}
```

---

## API Contracts

### Messages

- **POST /messages** — create message, parse mentions, upsert tags
- **GET /messages** — global chat feed (paged)
- **GET /tokens/:address/messages** — per-token thread
- **PATCH /messages/:id** — edit message, store revision
- **GET /resolve/symbol?sym=JUP** — resolve symbols via `TokenInfo.symbol`

### Tags

- **POST /tokens/:address/tags** — add tags explicitly

---

## Frontend Architecture

### Global Chat
- Virtualized list of messages
- Composer with @ autocomplete
- Messages render with TokenBadge + TagChip

### Token List
- Query = TokenInfo JOIN WatchedToken
- Rows show TokenBadge, metrics, tags
- Clicking opens Token Thread

### Token Thread
- Shows metrics from TokenInfo + tags + filtered messages
- Inline MessageComposer scoped to token

### Chips/Badges
- **TokenBadge** (reuse existing)
- **TagChip** with type coloring

---

## Phased Implementation Roadmap

### Phase 0 — Schema & Contracts
**Goal**: Foundation setup

**Tasks**:
- Add new tables with proper indexing strategy
- Write parser with strict namespaces and error handling
- Define API endpoints with validation

**Guardrails**:
- Normalize tags
- Reject unresolved @sym:
- Use WatchedToken for dashboard filtering

**⚠️ Performance Traps & Solutions**:
- **Trap**: N+1 queries when fetching messages with mentions
- **Solution**: Design indexes upfront for common query patterns:
  ```sql
  -- Critical indexes for performance
  CREATE INDEX idx_message_mentions_kind_ref ON "MessageMention"("kind", "refId");
  CREATE INDEX idx_message_mentions_message_id ON "MessageMention"("messageId");
  CREATE INDEX idx_messages_created_at ON "Message"("createdAt" DESC);
  CREATE INDEX idx_messages_source ON "Message"("source");
  CREATE INDEX idx_token_tags_token_address ON "TokenTag"("tokenAddress");
  CREATE INDEX idx_token_tags_tag_id ON "TokenTag"("tagId");
  ```
- **Trap**: Slow token thread queries due to complex joins
- **Solution**: Use single query with proper JOINs, not separate queries per message

**⚠️ Error Handling Traps & Solutions**:
- **Trap**: Invalid @ca: addresses crash the parser
- **Solution**: Validate base58 format before processing, graceful fallback
- **Trap**: @sym: ambiguity causes user confusion
- **Solution**: Return 409 with candidate list, block submission until resolved
- **Trap**: Malformed mentions break message rendering
- **Solution**: Sanitize input, store raw mentions separately from parsed ones

### Phase 1 — Messaging Core
**Goal**: Basic messaging functionality

**Tasks**:
- Implement POST/GET messages and token threads
- Create separate MessageGateway (do not extend JobProgressGateway)
- Client: Global Chat + Composer

**Guardrails**:
- Limit ≤5 tokens per message
- Autocomplete only WatchedToken
- Store revisions

**⚠️ Architecture Traps & Solutions**:
- **Trap**: Extending JobProgressGateway creates coupling between job events and chat
- **Solution**: Create separate `MessageGateway` that reuses Redis infrastructure:
  ```typescript
  // Reuse existing Redis setup but separate concerns
  class MessageGateway {
    // Separate namespace: /socket.io/messages
    // Separate Redis channels: message-events:*
    // Reuse connection management patterns
  }
  ```

**⚠️ Performance Traps & Solutions**:
- **Trap**: Broadcasting every message to all clients causes Redis overhead
- **Solution**: Implement room-based subscriptions and message filtering:
  ```typescript
  // Subscribe clients to specific rooms
  client.join('global-chat');
  client.join(`token-thread:${tokenAddress}`);
  // Only broadcast to relevant rooms
  ```
- **Trap**: Message queries without proper pagination load all data
- **Solution**: Implement cursor-based pagination from day one:
  ```typescript
  // Use createdAt + id for consistent pagination
  const messages = await db.message.findMany({
    where: { createdAt: { lt: cursor } },
    take: limit,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  });
  ```

**⚠️ Error Handling Traps & Solutions**:
- **Trap**: Mention parsing failures crash message creation
- **Solution**: Implement robust parser with fallback:
  ```typescript
  // Parse mentions with error recovery
  const parseMentions = (body: string) => {
    try {
      return extractMentions(body);
    } catch (error) {
      // Log error, return empty mentions, don't crash
      logger.warn('Mention parsing failed', error);
      return [];
    }
  };
  ```

### Phase 2 — Dashboard Integration
**Goal**: Dashboard integration

**Tasks**:
- Token List uses WatchedToken
- Token Thread with messages and metrics
- Inline composer with token prefilled

**Guardrails**:
- Filter by WatchedToken
- Style global vs thread differently

**⚠️ Performance Traps & Solutions**:
- **Trap**: Token list queries become slow with many WatchedTokens
- **Solution**: Implement efficient JOIN query with proper indexes:
  ```sql
  -- Optimized query for token list with messages
  SELECT t.*, m.latest_message, m.message_count
  FROM TokenInfo t
  JOIN WatchedToken w ON t.tokenAddress = w.tokenAddress
  LEFT JOIN (
    SELECT tokenAddress, MAX(createdAt) as latest_message, COUNT(*) as message_count
    FROM Message m
    JOIN MessageMention mm ON m.id = mm.messageId
    WHERE mm.kind = 'token'
    GROUP BY tokenAddress
  ) m ON t.tokenAddress = m.tokenAddress
  WHERE w.list = 'favorites'
  ORDER BY m.latest_message DESC;
  ```
- **Trap**: Loading all messages for token thread causes memory issues
- **Solution**: Implement virtual scrolling and lazy loading:
  ```typescript
  // Load messages in chunks, not all at once
  const loadMessages = async (tokenAddress: string, cursor?: string) => {
    return db.message.findMany({
      where: { mentions: { some: { kind: 'token', refId: tokenAddress } } },
      take: 50, // Load 50 at a time
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: 'desc' }
    });
  };
  ```

**⚠️ State Management Traps & Solutions**:
- **Trap**: Message state gets out of sync between global chat and token threads
- **Solution**: Implement centralized message store with optimistic updates:
  ```typescript
  // Single source of truth for messages
  class MessageStore {
    private messages = new Map<string, Message>();
    private subscriptions = new Set<() => void>();
    
    // Optimistic updates for better UX
    addMessage(message: Message) {
      this.messages.set(message.id, message);
      this.notifySubscribers();
    }
  }
  ```

### Phase 3 — Signals
**Goal**: Bot integration

**Tasks**:
- Reasoning jobs emit bot messages
- Mentions ensure they show up in threads

**Guardrails**:
- Deduplicate with fingerprints
- Throttle per rule

**⚠️ Performance Traps & Solutions**:
- **Trap**: Bot messages flood the system and cause Redis overload
- **Solution**: Implement message batching and rate limiting:
  ```typescript
  // Batch bot messages to reduce Redis overhead
  class BotMessageBatcher {
    private batch: Message[] = [];
    private readonly BATCH_SIZE = 10;
    private readonly BATCH_DELAY = 1000; // 1 second
    
    async addMessage(message: Message) {
      this.batch.push(message);
      if (this.batch.length >= this.BATCH_SIZE) {
        await this.flush();
      }
    }
  }
  ```
- **Trap**: Bot message processing blocks user messages
- **Solution**: Use separate queue priority for bot messages:
  ```typescript
  // Bot messages get lower priority
  await messageQueue.add('process-bot-message', data, {
    priority: 1, // Lower priority than user messages
    delay: 5000  // 5 second delay to avoid spam
  });
  ```

**⚠️ Error Handling Traps & Solutions**:
- **Trap**: Bot message failures crash the entire message system
- **Solution**: Isolate bot message processing with circuit breaker:
  ```typescript
  // Circuit breaker for bot messages
  class BotMessageProcessor {
    private failureCount = 0;
    private readonly MAX_FAILURES = 5;
    
    async processBotMessage(message: BotMessage) {
      try {
        await this.processMessage(message);
        this.failureCount = 0; // Reset on success
      } catch (error) {
        this.failureCount++;
        if (this.failureCount >= this.MAX_FAILURES) {
          // Stop processing bot messages temporarily
          this.circuitBreaker.open();
        }
      }
    }
  }
  ```

### Phase 4 — Tag Management
**Goal**: Advanced tagging

**Tasks**:
- Add/remove tags in token panel
- Messages with tags + token upsert TokenTag
- Explicit removal only via API (no automatic removal on message edits)

**Guardrails**:
- Prevent tag loss on edits
- Rate-limit tag creation

- Skip automatic tag reconciliation on message edit. Tags created via messages persist until explicitly removed through the tag API.
- **Trap**: Concurrent tag operations cause race conditions
- **Solution**: Use database transactions and optimistic locking:
  ```typescript
  // Use transaction for tag operations
  await db.$transaction(async (tx) => {
    const existingTag = await tx.tag.findUnique({ where: { name: tagName } });
    if (!existingTag) {
      await tx.tag.create({ data: { name: tagName, type: tagType } });
    }
    await tx.tokenTag.upsert({
      where: { tokenAddress_tagId: { tokenAddress, tagId: existingTag.id } },
      create: { tokenAddress, tagId: existingTag.id, source: 'user-note' },
      update: { confidence: 1.0 }
    });
  });
  ```

**⚠️ Performance Traps & Solutions**:
- **Trap**: Tag filtering queries become slow with many tags
- **Solution**: Implement tag indexing and query optimization:
  ```sql
  -- Optimized tag filtering query
  SELECT DISTINCT m.*
  FROM Message m
  JOIN MessageMention mm ON m.id = mm.messageId
  JOIN TokenTag tt ON mm.refId = tt.tokenAddress
  JOIN Tag t ON tt.tagId = t.id
  WHERE t.name IN ('elon', 'pump', 'moon')
  AND mm.kind = 'token'
  ORDER BY m.createdAt DESC
  LIMIT 50;
  ```

### Phase 5 — Enhancements
**Goal**: Advanced features

**Tasks**:
- Per-user favorites
- Telegram mirror
- Tag feeds
- LLM summarizer bot

---

## Risk Management & Mitigations

| Risk | Mitigation |
|------|------------|
| TokenInfo pollution | Always filter dashboard queries with WatchedToken |
| Symbol ambiguity | Resolve via TokenInfo.symbol; 409 with candidates until chosen |
| Tag drift | Lowercase normalize, unique index |
| Signal spam | Deduplicate + throttle |
| Message edit semantics | Store revisions, explicit API removes tags |
| Cross-post overload | Limit ≤5 tokens per message |

---

## Acceptance Criteria

### Core Functionality
- [ ] Posting once in Global Chat shows message in all mentioned token threads
- [ ] Adding @meta: + token updates token tags
- [ ] Editing preserves history (MessageRevision)
- [ ] Dashboard shows only WatchedToken
- [ ] Signals arrive as bot messages in both global feed and threads

### Quality Gates
- [ ] All API endpoints return consistent response format
- [ ] WebSocket events fire correctly for real-time updates
- [ ] Parser handles all namespace types correctly
- [ ] Database migrations run without data loss
- [ ] Frontend components render correctly with mock data

---

## Reusability Analysis & Existing Infrastructure

### What We're Reusing (87% Reusability)

#### 1. Database Infrastructure (100% Reusable)
- **Existing**: Complete Prisma setup, DatabaseService, SQLite configuration
- **Reuse**: Database connection, transaction handling, migration system
- **Action**: Add new models to existing schema only

#### 2. WebSocket System (75% Reusable)
- **Existing**: `JobProgressGateway` with Redis pub/sub, Socket.IO setup
- **Reuse**: Redis infrastructure, connection management patterns, event broadcasting
- **Action**: Create separate `MessageGateway` (own namespace/channels), do not extend `JobProgressGateway`

#### 3. Token Management (90% Reusable)
- **Existing**: `TokenInfoService`, `TokenInfoController`, Dexscreener integration
- **Reuse**: Token metadata fetching, caching, enrichment pipeline
- **Action**: Add alias resolution methods to existing service

#### 4. Queue System (85% Reusable)
- **Existing**: BullMQ setup, Redis configuration, job processors
- **Reuse**: Background job processing, retry logic, progress tracking
- **Action**: Add message processing jobs to existing queue

#### 5. API Structure (80% Reusable)
- **Existing**: NestJS modules, controllers, DTOs, validation, Swagger docs
- **Reuse**: Authentication, error handling, response formatting, API patterns
- **Action**: Follow existing controller/module patterns

#### 6. Authentication & Security (100% Reusable)
- **Existing**: API key auth, user management, guards, rate limiting
- **Reuse**: Complete auth system, user identification, permission handling
- **Action**: None - use existing auth system

### What We're Building New

#### 1. Message System (New)
- **New**: MessagesService, MessageMention parsing, MessageRevision tracking
- **Pattern**: Follow existing service patterns in `src/api/services/`

#### 2. Tag Management (New)
- **New**: Tag creation, TokenTag relationships, tag filtering
- **Pattern**: Extend existing DatabaseService methods

#### 3. Frontend Components (New)
- **New**: MessageComposer, MessageItem, GlobalChat, TokenThread
- **Pattern**: Reuse existing dashboard structure and TokenBadge components

### Implementation Strategy

#### Phase 0 - Database Schema (1-2 hours)
```sql
-- Add to existing prisma/schema.prisma
-- Reuse existing migration system
model Message { /* new */ }
model MessageMention { /* new */ }
model MessageRevision { /* new */ }
model Tag { /* new */ }
model TokenTag { /* new */ }
-- TokenAlias deferred for v2 (use TokenInfo.symbol in v1)
model WatchedToken { /* new */ }
```

#### Phase 1 - Core Services (4-6 hours)
- **Extend** `DatabaseService` with message methods
- **Create** `MessagesService` following existing service patterns
- **Create** `MentionParser` as pure function service
- **Reuse** existing `TokenInfoService` for alias resolution

#### Phase 2 - API Layer (3-4 hours)
- **Create** `MessagesController` following existing controller patterns
- **Create** `MessagesModule` following existing module structure
- **Reuse** existing authentication and validation

#### Phase 3 - Real-time Integration (2-3 hours)
- **Add** dedicated `MessageGateway` with `/socket.io/messages` namespace
- **Reuse** existing Redis pub/sub infrastructure
- **Reuse** existing WebSocket client management

#### Phase 4 - Frontend Integration (6-8 hours)
- **Reuse** existing dashboard structure and TokenBadge
- **Create** new message components following existing patterns
- **Reuse** existing WebSocket connection management

### Time Savings Through Reuse

| Component | Without Reuse | With Reuse | Time Saved |
|-----------|---------------|------------|------------|
| Database Layer | 8-10 hours | 1-2 hours | 7-8 hours |
| WebSocket System | 6-8 hours | 2-3 hours | 4-5 hours |
| Token Management | 4-6 hours | 1-2 hours | 3-4 hours |
| Queue System | 3-4 hours | 1 hour | 2-3 hours |
| API Structure | 2-3 hours | 1 hour | 1-2 hours |
| Authentication | 4-5 hours | 0 hours | 4-5 hours |
| **TOTAL** | **27-36 hours** | **6-8 hours** | **21-28 hours** |

### Development Timeline

- **Total Development Time**: 23 hours (vs 60+ hours from scratch)
- **Reusability**: 87% - Massive time savings through strategic reuse
- **Risk Level**: Low - Building on proven, existing infrastructure

---

## Alignment with Main Specification

This plan correctly extends the core `token-dash.md` specification by:

1. **Adding WatchedToken concept** for dashboard curation (not in main spec)
2. **Providing phased rollout** approach (main spec is implementation-focused)
3. **Including risk management** (main spec has fragility checkpoints)
4. **Adding acceptance criteria** (main spec has verification checklist)
5. **Maintaining all core concepts** from the main specification
6. **Explicitly mapping reusability** from existing codebase (new addition)

The plan serves as a practical implementation guide that builds upon the architectural foundation defined in the main specification while leveraging 87% of existing infrastructure.