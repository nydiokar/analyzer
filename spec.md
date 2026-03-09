# spec.md — Tracked Holding Wallets Page

## Purpose
Create a restricted dashboard page for tracking known wallets and the tokens they currently hold.

The page is not meant to be a public wallet explorer. It is an internal operational page for monitoring tracked wallets, detecting newly seen tokens, and reviewing holdings efficiently.

---

## Product Goal
The page should let an authorized user:
- add wallets for tracking
- view current token holdings for each tracked wallet
- filter out dust and irrelevant balances
- detect newly seen tokens quickly
- avoid repeatedly reviewing the same token-wallet holdings

---

## Core Design Decision
The page must separate:

1. **Current holdings state**
2. **Change / event feed**

This avoids turning the page into a cluttered dump of wallets and token balances.

---

## Data Source and Holdings Derivation

### Source
Use **Helius** directly.

### Holdings Method
Do **not** rely on full wallet history as the main source.

Instead:
- retrieve the wallet's **Associated Token Accounts (ATA)**
- derive current token holdings from ATA balances

This is the primary method for determining what a tracked wallet currently holds.

---

## Access Control
The page must **not** be public.

Access must be restricted.

Implementation options:
- restrict to specific users directly
- or introduce role-based access

Current decision:
- keep the page restricted
- exact backend authorization model can be finalized during implementation
- role-based access is optional if it is worth the added backend complexity

---

## Backend Requirements

### 1. Tracked Wallet Storage
System must accept and store wallet addresses for tracking.

Required capabilities:
- add tracked wallet
- persist tracked wallet
- list tracked wallets
- remove or disable tracked wallet if needed

### 2. Holdings Snapshot Extraction
For each tracked wallet:
- fetch ATA data from Helius
- derive current token balances
- attach token metadata already available in the system where applicable

### 3. Dust Filtering
Exclude low-value or pointless balances from the visible holdings list.

Initial filtering targets:
- token value below **$80** should be filtered out
- token amount below **1 SOL equivalent** may be filtered out when relevant

This threshold should ideally be configurable, but fixed defaults are acceptable for v1.

### 4. Persistent Wallet-Token State
Backend should persist state per **wallet-token pair** so the system can detect changes over time.

Recommended stored fields:
- `wallet`
- `tokenMint`
- `firstSeenAt`
- `lastSeenAt`
- `firstSeenBalance`
- `latestBalance`
- `latestUsdValue`
- `isActiveHolding`
- `lastChangedAt`

Optional but recommended:
- `reviewStatus`
- `reviewedAt`
- `note`

This state is required for a useful feed.

### 5. Change Detection
System should derive events from differences between the latest holdings snapshot and the previously stored state.

Minimal useful event types:
- **new token first seen in wallet**
- **token removed from wallet**
- **token balance materially increased**
- **token balance materially decreased**
- **new wallet added to tracking**

For v1, the highest-priority event is:
- **first seen token in tracked wallet**

### 6. Review State
Each wallet-token pair should support a lightweight review state.

Recommended statuses:
- `unreviewed`
- `reviewed`
- `ignored`

Purpose:
- reduce repeated work
- hide known noise
- keep the feed high-signal

### 7. Optional Profit / Loss
If easy to derive from backend data, expose per-token wallet PnL.

This is a feature, not a requirement.

---

## Frontend Requirements

### 1. Default View: Event Feed
The default landing view should be a **change/event feed**, not a full holdings dump.

Purpose:
- show what changed since the last checks
- surface newly seen tokens fast
- make the page operationally useful on entry

#### Feed content
Feed should show relevant wallet-token events such as:
- newly seen token in wallet
- token removed from wallet
- meaningful balance increase
- meaningful balance decrease
- newly tracked wallet

#### Feed default behavior
Recommended default:
- show newest relevant items first
- prioritize **unreviewed** items

Recommended sort:
- `lastChangedAt DESC`

Alternative:
- `firstSeenAt DESC`

### 2. Secondary View: Wallet Holdings
The page should also support inspecting the current holdings of each tracked wallet.

Each wallet entry should show:
- wallet address
- filtered token holdings

Each token row should show:
- token badge
- token symbol
- token name if available
- token amount
- token USD value if available
- timing fields if available, such as first seen / last changed

Optional if backend provides it:
- per-token PnL

### 3. Token Badge Usage
Use the existing **token badge** component.

The token badge already carries useful token information such as:
- symbol
- name
- image
- market data / market cap if available
- socials if supported by existing badge logic

This should be reused rather than rebuilt.

### 4. Sorting and Filtering

#### Feed sorting
Primary sort:
- newest relevant changes first

#### Wallet holdings sorting
Support sorting by:
- largest USD value
- newest acquired / first seen
- oldest held
- biggest balance increase
- biggest balance decrease

#### Review filtering
Support filtering by:
- unreviewed
- reviewed
- ignored

At minimum, user should be able to hide ignored items.

---

## Recommended UX Structure

### Landing Section
Top summary area may include:
- number of tracked wallets
- number of new tokens in last 24h / 7d
- number of unreviewed items

Main area:
- event feed

Secondary area:
- tracked wallet list

### Wallet Detail View
Wallet detail or expandable wallet section should include:
- wallet header
- total filtered holdings count
- sortable holdings list
- first seen / last changed indicators where available
- review status where relevant

---

## Operational Rules

### Reviewed Items
A token-wallet pair that has already been checked should not keep surfacing as new work.

Use review state to control visibility:
- `unreviewed` = requires attention
- `reviewed` = known and already checked
- `ignored` = known but intentionally hidden from normal workflow

### Feed Philosophy
The page should be optimized for answering:
- **What changed?**
- **What is new?**
- **What still needs review?**

It should not be optimized as a giant static holdings table.

---

## Non-Goals for v1
Avoid overloading the first version with extra features.

Not required for v1:
- favorites
- complex notes or commentary workflows
- advanced social review mechanics
- public access
- heavy historical portfolio analytics
- full wallet history as the primary source

These can be added later if needed.

---

## v1 Priority Scope

### Required
- restricted page access
- tracked wallet input and storage
- Helius ATA-based holdings extraction
- dust filtering
- current holdings view per wallet
- persistent wallet-token state
- newly seen token feed
- review status: unreviewed / reviewed / ignored
- token badge integration

### Optional
- token removal and balance change events beyond first-seen detection
- per-token PnL
- configurable dust thresholds
- role-based access model instead of direct user restriction

---

## Final Implementation Direction
This should be implemented as **one page / feature spec**, not as two separate specs.

The combined spec covers:
- backend behavior
- frontend behavior
- access control
- operational design model

The important design decision is that the page has **two views within one feature**:
- **event feed for changes and newly seen tokens**
- **wallet holdings inspection view for current state**
