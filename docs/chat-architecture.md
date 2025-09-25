## Chat Architecture and Migration Plan

### Purpose
Create a single, reusable chat engine that both Global Chat and Token Thread consume, so future features (e.g., token-specific UI, LLM chat) can wrap the same core without duplicating behavior.

### Core Concepts
- **Scope**
  - `global`: system-wide feed
  - `token`: per-token feed `{ tokenAddress }`
- **Message (lite)**
  - `id`, `body`, `createdAt`, `editedAt?`, `parentId?`, `mentions[]`, `reactions[]`, `isPinned?`
- **Events**
  - `message.created|updated|deleted|pinned`, `reaction.updated`

### Behaviors to Centralize
- Fetch/paginate: list, `nextCursor`, `loadMore`
- Real-time: subscribe to scope, mutate on events
- Unread: `lastSeen` per scope; show “Jump to latest”
- Pinned: toggle; render pinned band
- Keyboard: `J/K` navigate, `Enter` open actions, `Q` reply, `Alt+P` pin, `Alt+W` watch (thread only)
- Infinite scroll: sentinel auto-load older pages
- Scroll management: scroll-to-bottom after post

### Presentational Responsibilities (Keep Thin)
- Feed list: ascending render, content-visibility
- Row: bubble layout, mentions chips, pinned badge, reactions display, actions trigger
- Composer: input, reply bar, Ctrl/⌘+Enter send
- Header/Footer: domain-specific UI (token badge, sparkline, tags)

---

## Target Structure

### 1) `useChatData(scope, pageSize?)`
- Internally picks the correct data source:
  - Global → `useGlobalMessages(pageSize)`
  - Token → `useTokenMessages(tokenAddress, pageSize)`
- Returns: `{ items, nextCursor, isLoading, error, mutate, loadMore }`

### 2) `useChatBehavior({ items, nextCursor, mutate, loadMore, scope }, deps, opts)`
- Deps:
  - `openActionsFor(id)`
  - `onReplySet({ id, body })`
  - `onTogglePin(id, nextIsPinned)`
  - `getIsPinned(id)`
  - `onWatchToggle?()` (enables Alt+W)
- Opts: `{ lastSeenKey }`
- Owns:
  - Socket subscription (single place)
  - Unread anchors: `lastSeen`, `showJump`
  - Infinite scroll sentinel
  - Keyboard (via `useChatKeyboard`)
  - `scrollRef` and `scrollToBottom()`
- Returns:
  - `{ itemsAsc, pinnedItems, sentinelRef, scrollRef, scrollToBottom, lastSeen, setLastSeen, showJump, containerProps, isSelected }`

### 3) `ChatFeed` (headless component)
- Props:
  - `scope`, `pageSize?`
  - `RowComponent` (default `MessageRow`), `rowPropsMapper?`
  - Slots: `Header`, `PinnedBand`, `Footer`, `Composer`
  - `actions`: `{ onTogglePin, onReact, onReply, openActionsFor, onWatchToggle? }`
- Internals: compose `useChatData` + `useChatBehavior` and render the feed with slots.

### 4) `MessageRow` (presentational)
- Props: `message`, `isOwn`, `isPinned`, `highlighted`, `selected`, `byMint?`, `threadAddress?`
- Emits: `onReply`, `onTogglePin`, `onReact`
- Must include `[data-msg-actions-trigger]` for Enter-key action

### 5) `MessageComposer` (presentational)
- Props: `scope?`, `replyTo`, `onCancelReply`, `onPosted`
- Parent triggers `scrollToBottom()` and `mutate()` after `onPosted()`

### 6) (Optional) `useChatActions`
- Wrap pin/react/reply fetch+mutate patterns for reuse by wrappers (e.g., LLM chat).

---

## Current State in Repo (as of REF)
- `useChatKeyboard`: shared keyboard behaviors (J/K/Enter/Q/Alt+P/Alt+W)
- `useInfiniteScroll`: intersection observer sentinel
- `useChatFeed`: implemented (acts as behavior hook; handles sockets, unread, sentinel, keyboard, scroll)
- GlobalChat: refactored to use `useChatFeed` (sockets/lastSeen removed from wrapper)
- TokenThread: still has local sockets/lastSeen/sentinel/keyboard (to be migrated)

---

## Migration Plan (LLM-executable)

### Phase 0 — Types and Utilities
1. Add `dashboard/src/chat/types.ts` for `MessageLite`, `Scope`, `ChatActions`.
2. Add `dashboard/src/chat/utils.ts` for shared helpers (mention formatting, etc.).

### Phase 1 — Data Hook
1. Create `useChatData(scope, pageSize?)` wrapping existing `useGlobalMessages`/`useTokenMessages`.
2. Ensure shape: `{ items, nextCursor, isLoading, error, mutate, loadMore }`.

### Phase 2 — Behavior Hook
1. Rename/adjust `useChatFeed` → `useChatBehavior` to only accept data inputs and deps.
2. Keep responsibilities: sockets, lastSeen/showJump, sentinel, keyboard, scroll.
3. Return the standardized behavior object.

### Phase 3 — Headless `ChatFeed`
1. Implement `ChatFeed` that composes `useChatData` + `useChatBehavior`.
2. Support slots for `Header`, `PinnedBand`, `Footer`, and `Composer`.
3. Default to existing `MessageRow`/`MessageComposer` if slots not provided.

### Phase 4 — Integrate Wrappers
1. GlobalChat: replace inline logic with `ChatFeed`.
   - Provide `RowComponent` or `rowPropsMapper` for `byMint`/`watchedByMint` props.
   - Provide `actions` (pin/react/reply/openActionsFor).
2. TokenThread: replace inline logic with `ChatFeed`.
   - `Header` slot renders token badge, sparkline, watch toggle.
   - Provide `onWatchToggle` in `actions` to enable Alt+W.
   - Keep `highlightId` scroll-on-mount logic (wrapper concern).

### Phase 5 — Cleanup & Tests
1. Remove direct `useMessagesSocket` and `lastSeen` from wrappers.
2. Keep domain-only UI in wrappers (sparkline, token badge, tags UI).
3. Add tests for: keyboard, showJump, pin toggle, sentinel load, scroll-to-bottom after post.

---

## Acceptance Criteria
- No UX regressions: same visuals and interactions in both GlobalChat and TokenThread.
- One source for sockets/unread/sentinel/keyboard.
- After posting, feed reliably scrolls to bottom.
- Wrappers remain thin: only domain-specific UI and data mapping.
- Easy embedding for new contexts (e.g., LLM chat) by reusing `ChatFeed` with custom slots/actions.

---

## File Map (proposed)
- `dashboard/src/chat/types.ts`
- `dashboard/src/chat/utils.ts`
- `dashboard/src/hooks/useChatData.ts`
- `dashboard/src/hooks/useChatBehavior.ts` (rename from `useChatFeed`)
- `dashboard/src/components/chat/ChatFeed.tsx`
- `dashboard/src/components/chat/MessageRow.tsx`
- `dashboard/src/components/chat/MessageComposer.tsx`
- Wrappers:
  - `dashboard/src/components/chat/GlobalChat.tsx` (thin)
  - `dashboard/src/components/chat/TokenThread.tsx` (thin)

---

## Notes
- Keep `MessageRow` and `MessageComposer` strictly presentational.
- `Enter` must target `[data-msg-actions-trigger]` inside row.
- Use unique `lastSeenKey` per scope (`lastSeen:global`, `lastSeen:token:<addr>`).
- `Alt+W` only active when `onWatchToggle` is provided.


