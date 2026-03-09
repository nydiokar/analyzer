# spec.md — Holdings Radar

## Purpose
An internal operational page for monitoring specific wallets and the tokens they currently hold. Authorized users add wallets to the radar, detect newly appeared tokens across their holdings, and mark items as reviewed to maintain a clean signal feed.

This is **not** connected to the analysis pipeline. Radar wallets do not need to be analyzed. Holdings come from ATA data fetched directly via Helius. A wallet can be added to the radar the moment its address is entered.

---

## Core Design Constraint
**Analysis-pipeline-independent.**

No dependency on `Wallet`, `AnalysisResult`, or any existing analysis model. New dedicated models. A radar wallet is just an address — nothing more is required to start monitoring it.

---

## Product Goal
- Add wallets to the radar
- View current token holdings per wallet
- Filter out dust and irrelevant balances
- See tokens that appeared for the first time in a wallet's holdings ("new to our radar")
- Mark items reviewed to keep the feed signal-high

---

## Core Design Decision
Two views within one page:

1. **Event feed** — what changed / what's new since last check
2. **Holdings view** — current state per wallet

The feed is the landing view. It answers: *what is new, what still needs review?*

---

## Access Control

### Problem with `isAdmin`
`isAdmin` is an administrative role (manage users, API keys, registration codes). It cannot be handed to analysts or collaborators doing operational monitoring without granting full system control. Wrong gate.

### Solution
Add `isAnalyst` boolean to the `User` model. `isAnalyst = true` gates this page. Admins implicitly pass the check (admin can do everything an analyst can). No new role system needed — one flag, one guard.

**New guard:** `AnalystGuard` — checks `user.isAnalyst === true || user.isAdmin === true`.

Frontend: redirect non-analyst/non-admin users on page load, same pattern as `/admin`.

---

## Data Source

Use the existing **`BalanceCacheService`** (`src/api/services/balance-cache.service.ts`).

It already:
- calls `WalletBalanceService.fetchWalletBalancesRaw()` via `getTokenAccountsByOwner` for both SPL Token and Token-2022 programs
- returns `TokenBalanceDetails[]` with `mint`, `uiBalance`, `decimals`, optional `priceUsd` / `valueUsd`
- wraps results in Redis with incremental slot-based updates via `TokenAccountWatermark`

No new Helius integration needed.

---

## Backend Requirements

### 1. New Prisma Models

**`RadarWallet`** — wallets under monitoring:
```
wallet     String    @id
label      String?
addedAt    DateTime  @default(now())
isActive   Boolean   @default(true)
addedBy    String?   // userId
```

**`RadarHolding`** — persistent state per wallet-token pair:
```
id              String    @id @default(cuid())
wallet          String
tokenMint       String
firstSeenAt     DateTime  @default(now())
lastSeenAt      DateTime
uiBalance       Float
usdValue        Float?
isActiveHolding Boolean   @default(true)
reviewStatus    String    @default("unreviewed")  // "unreviewed" | "reviewed" | "ignored"
reviewedAt      DateTime?
note            String?

@@unique([wallet, tokenMint])
@@index([wallet])
@@index([firstSeenAt])
@@index([reviewStatus])
@@index([isActiveHolding])
```

No foreign key to the existing `Wallet` model. These are standalone.

Also add to `User` model:
```
isAnalyst  Boolean  @default(false)
```

### 2. Snapshot Logic
For each active `RadarWallet`, on snapshot trigger:
1. Call `BalanceCacheService.getBalances(address)` — reuses existing service
2. Apply dust filter
3. Upsert into `RadarHolding`:
   - **new token:** insert with `firstSeenAt = now`, `reviewStatus = "unreviewed"` → this is the "first seen" event
   - **existing token:** update `lastSeenAt`, `uiBalance`, `usdValue`, `isActiveHolding = true`
4. Tokens previously in DB but absent from current snapshot → set `isActiveHolding = false`

`firstSeenAt` = first time **we** saw this token in this wallet's holdings. This is not necessarily when the wallet acquired the token — it is when the radar first detected it. This framing is intentional: the feed surfaces *what appeared on our radar*, not wallet trade history.

### 3. Dust Filtering
Exclude holdings where:
- `usdValue < 80` (when USD price is available)
- `uiBalance < 200` (consistent with `WalletBalanceService` internal threshold)

Fixed defaults for v1.

### 4. ATA-Based Acquisition Time (Optional v1 Enhancement)
For newly inserted holdings, the actual acquisition time can be derived by querying the ATA (not the wallet address). The ATA address is computed from mint + wallet, then `getTransactionsForAddress` on the ATA returns only token-specific transactions — far fewer than the wallet's full history.

This gives the real first-transfer timestamp for a token, which can be stored as `acquiredAt` on `RadarHolding`.

Whether to implement this in v1: it adds one extra Helius call per newly seen token (not per snapshot). Low cost, high signal for the feed. Include as optional — implement if the first-seen feed feels incomplete without real acquisition timestamps.

### 5. Snapshot Trigger
On-demand for v1. The backend exposes:
- `POST /analyst/radar/:address/snapshot` — runs snapshot for one wallet

Frontend triggers this on page load for wallets where `lastSeenAt` is older than 5 minutes.

Background scheduled refresh is post-v1.

### 6. Review State
`RadarHolding.reviewStatus`:
- `unreviewed` — default, requires attention
- `reviewed` — checked, known
- `ignored` — intentionally hidden from normal workflow

Backend exposes `PATCH /analyst/radar/holdings/:id/review` with `{ status }`.

### 7. Change Detection for v1
Derived from snapshot upsert. Two event types only:
- **new token first seen** — newly inserted holding
- **token removed** — `isActiveHolding` flipped to false

Balance change detection (increase/decrease) is post-v1.

---

## API Endpoints (Analyst-only)

```
GET    /analyst/radar                        — list radar wallets
POST   /analyst/radar                        — add wallet { address, label? }
DELETE /analyst/radar/:address               — deactivate wallet
POST   /analyst/radar/:address/snapshot      — run snapshot for one wallet
GET    /analyst/radar/:address/holdings      — current holdings for one wallet
GET    /analyst/radar/feed                   — event feed across all wallets
PATCH  /analyst/radar/holdings/:id/review    — update review status
```

All endpoints guarded by `AnalystGuard`.

---

## Frontend Requirements

### Route
`/radar`

### Access Gate
Check `user.isAnalyst || user.isAdmin` on page load. Redirect otherwise.

### 1. Default View: Event Feed
Landing view shows the feed — not holdings.

Feed items show:
- `TokenBadge` (`variant="inline"`, `size="s"`) — reuse existing component
- Wallet address (truncated, copy button; link to `/wallets/:address` where analysis data happens to exist, plain otherwise)
- Event type: "New token" / "Removed"
- `firstSeenAt` as relative timestamp ("2h ago")
- If `acquiredAt` available and differs materially from `firstSeenAt`: show actual acquisition time as secondary label
- Review actions: "Mark reviewed" / "Ignore" inline

Default sort: unreviewed first, then `firstSeenAt DESC`.
Default filter: hide ignored items. Toggle to show all.

### 2. Holdings View
Per-wallet expandable section.

Wallet header:
- address + label (if set)
- active holding count
- last snapshot time

Holdings table per wallet:
- `TokenBadge variant="inline" size="s"` — symbol, name, image, mcap, links all handled by the existing component
- `uiBalance` formatted
- `usdValue` formatted (if available)
- `firstSeenAt` relative
- `acquiredAt` if available
- review status badge + quick action

Sortable by: USD value desc (default), firstSeenAt desc, uiBalance desc.

### 3. Summary Stats (page top)
- radar wallet count
- unreviewed items count
- new tokens seen in last 24h

### 4. Add Wallet to Radar
Solana address input + submit. Validates address format client-side. On submit: `POST /analyst/radar` → immediately trigger snapshot → show holdings.

### 5. Token Badge
Reuse `TokenBadge` (`dashboard/src/components/shared/TokenBadge.tsx`). It handles symbol, name, image, market cap, socials, batched metadata fetching, loading states. `variant="inline"` for table rows.

---

## Operational Rules

### Feed Philosophy
- `unreviewed` = requires attention
- `reviewed` = known and checked
- `ignored` = intentionally hidden

The feed is the primary workflow surface. Holdings view is for deeper inspection.

### First-Seen Framing
`firstSeenAt` means "first detected by this radar." If a wallet has held a token for months and is only added today, the first snapshot will show all its current holdings as "new." This is expected and correct — they are new *to our monitoring*. Over time, as wallets stay on the radar, the feed will show genuinely new acquisitions.

---

## v1 Scope

### Required
- `User.isAnalyst` flag + `AnalystGuard`
- `RadarWallet` and `RadarHolding` models
- `BalanceCacheService` reuse for ATA holdings
- Snapshot upsert with `firstSeenAt` / `lastSeenAt` / `isActiveHolding`
- Dust filtering (fixed thresholds)
- Event feed: new-token + removed-token events, unreviewed-first
- Holdings view per wallet
- Review status (unreviewed / reviewed / ignored)
- `TokenBadge` reuse (`variant="inline"`)
- Add wallet to radar + immediate snapshot trigger

### Optional v1
- ATA-based `acquiredAt` (one Helius call per new token — query ATA address, get first transfer timestamp)

### Post-v1
- Balance change event detection (increase / decrease)
- Background scheduled snapshot job
- Configurable dust thresholds
- Per-token PnL
- Wallet label editing after add
