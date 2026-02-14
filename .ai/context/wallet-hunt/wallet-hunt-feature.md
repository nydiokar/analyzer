# Wallet Hunt Feature Specification

## Overview

Detect a person's wallet by capturing wallet lists from tokens they promote and finding wallets that appear across multiple tokens. The system is **source-agnostic** - snapshots can come from different wallet sources (top holders, significant buyers, etc.) and the intersection logic works regardless of source.

## Core Concept

```
Token A posted → Capture wallets (from chosen source) → Snapshot A
Token B posted → Capture wallets (from chosen source) → Snapshot B
Intersection(A, B) = Candidate wallets

Token C posted → Capture wallets (from chosen source) → Snapshot C
Intersection(A, B, C) = Narrower candidates

More tokens = Higher confidence
```

## Wallet Sources

The system supports multiple wallet sources per snapshot. Each source has different characteristics:

| Source | Key | Wallet Count | Signal | Use When |
|--------|-----|--------------|--------|----------|
| Top Holders | `TOP_HOLDERS` | Max 20 (RPC limit) | Current position size | Target likely holding large bag |
| Significant Buyers | `SIGNIFICANT_BUYERS` | 30-100+ | Entry behavior, buy size | Target likely bought significant amount |
| Early Buyers | `EARLY_BUYERS` | Variable | Timing, early access | Target likely got in early (future) |

### Source Selection Strategy

- **Top Holders**: Best when target flexes large positions, but limited to 20 wallets
- **Significant Buyers**: Casts wider net, better for targets who buy big but may not be top holder
- **Mix both**: User can add same token twice with different sources for maximum coverage

### Adding New Sources (Future)

To add a new source:
1. Add key to `SnapshotSourceType` enum
2. Implement fetcher in `WalletHuntService.fetchWalletsForSource()`
3. No schema changes needed - `sourceType` field handles any string

## Data Model

### Hunt
Represents a single investigation targeting one person.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier (cuid) |
| userId | string | Owner of this hunt |
| name | string | User-provided label (e.g., "TG Caller Alpha") |
| createdAt | datetime | When hunt was created |
| lastVisitedAt | datetime | Last time user viewed this hunt (for inactivity tracking) |

### HuntSnapshot
A point-in-time capture of wallets for one token from a specific source.

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier (cuid) |
| huntId | string | Parent hunt |
| tokenMint | string | Token address |
| sourceType | string | Source of wallets: `TOP_HOLDERS`, `SIGNIFICANT_BUYERS`, etc. |
| capturedAt | datetime | When snapshot was taken |
| holders | string[] | Array of wallet addresses (count varies by source) |
| note | string? | Optional user note ("Posted at 3pm in TG") |

### Candidates (Computed, Not Stored)
Derived at read time by intersecting all snapshots in a hunt.

| Field | Type | Description |
|-------|------|-------------|
| walletAddress | string | Candidate wallet |
| appearanceCount | number | How many unique tokens this wallet appeared in |
| tokenMints | string[] | Which tokens this wallet appeared in |
| sources | string[] | Which source types found this wallet |
| confidence | number | appearanceCount / uniqueTokenCount |

## Constraints

| Constraint | Value | Rationale |
|------------|-------|-----------|
| Max hunts per user | 5 | Prevents unbounded growth; forces user to manage |
| Max snapshots per hunt | 10 | Beyond this, intersection is conclusive or hunt is invalid |
| Inactivity warning | 14 days | Notify user hunt will be deleted |
| Auto-delete threshold | 21 days | Clean up abandoned hunts |

### Source-Specific Limits

| Source | Max Wallets | Notes |
|--------|-------------|-------|
| TOP_HOLDERS | 20 | Solana RPC limit; ~10-15 after filtering LPs/burns |
| SIGNIFICANT_BUYERS | 100 | Configurable; service-dependent |

Note: Same token can appear multiple times with different sources. Uniqueness is `[huntId, tokenMint, sourceType]`.

## User Flow

### Creating a Hunt
1. User clicks "New Hunt"
2. If user has 5 active hunts → block with message "Delete an existing hunt first"
3. User enters name → hunt created
4. Redirected to hunt detail view

### Adding a Token
1. User enters token mint address
2. User selects source: `Top Holders` or `Significant Buyers`
3. System validates address
4. System fetches wallets from selected source:
   - **Top Holders**: via `TokenHoldersService.getTopHolders()`
   - **Significant Buyers**: via `SignificantBuyersService` (existing)
5. System filters out known wallets (LPs, burns, exchanges, lock vaults)
6. Remaining wallets stored as snapshot with `sourceType` tag
7. Hunt's `lastVisitedAt` updated
8. Candidates recomputed and displayed

Note: User can add same token twice with different sources to cast wider net.

### Viewing Candidates
1. System loads all snapshots for hunt
2. System computes intersection:
   - Build map: wallet → list of tokens where it appears
   - Filter to wallets appearing in 2+ tokens (if 2+ snapshots exist)
   - Sort by appearance count descending
3. Display candidates with:
   - Wallet address (linked to profile)
   - Confidence percentage
   - Which tokens they appeared in

### Removing a Snapshot
1. User clicks remove on a snapshot
2. Snapshot deleted
3. Candidates recomputed
4. If 0 snapshots remain, hunt becomes empty (still valid)

Note: Removing a snapshot is by specific snapshot ID, not by token. User can remove just the TOP_HOLDERS snapshot while keeping SIGNIFICANT_BUYERS for same token.

### Resolving a Hunt
1. User identifies the wallet
2. User clicks "Save to Tracked Wallets" on candidate
3. Wallet added to user's favorites/tracked list
4. User can close/delete hunt

### Hunt Lifecycle & Cleanup
1. Daily job runs at 3 AM
2. Find hunts where `lastVisitedAt < now - 14 days`
3. Mark for warning (set flag or send notification)
4. Find hunts where `lastVisitedAt < now - 21 days`
5. Before deletion: if candidates exist, prompt user to save them
6. Delete hunt and all snapshots

## System Flow

### Add Token Endpoint
```
POST /wallet-hunts/:huntId/tokens

Request:
{
  tokenMint: string,
  sourceType: "TOP_HOLDERS" | "SIGNIFICANT_BUYERS",
  note?: string
}

Response:
{
  snapshot: { id, tokenMint, sourceType, capturedAt, holderCount },
  candidates: [{ walletAddress, appearanceCount, confidence, tokenMints, sources }]
}
```

**Steps:**
1. Validate huntId belongs to user
2. Check snapshot count < 10
3. Check `[tokenMint, sourceType]` combo not already in hunt
4. Fetch wallets based on `sourceType`:
   - `TOP_HOLDERS`: via `TokenHoldersService.getTopHolders(tokenMint)`
   - `SIGNIFICANT_BUYERS`: via `SignificantBuyersService.getSignificantBuyers(tokenMint)`
5. Filter wallets:
   - Exclude if `knownType` is BURN, LP, EXCHANGE, PROTOCOL, or any non-null known type
   - Keep only resolved wallet addresses
6. Store snapshot with `sourceType` and filtered wallet list
7. Update hunt's `lastVisitedAt`
8. Compute and return candidates

### Get Hunt Endpoint
```
GET /wallet-hunts/:huntId

Response:
{
  hunt: { id, name, createdAt, lastVisitedAt },
  snapshots: [{ id, tokenMint, sourceType, capturedAt, holderCount, note }],
  candidates: [{ walletAddress, appearanceCount, confidence, tokenMints, sources }]
}
```

Note: `candidates[].sources` shows which source types the wallet appeared in (e.g., `["TOP_HOLDERS", "SIGNIFICANT_BUYERS"]`).

**Steps:**
1. Validate huntId belongs to user
2. Update `lastVisitedAt` to now
3. Load all snapshots
4. Compute candidates from intersection
5. Return combined response

### Candidate Computation Algorithm

```
function computeCandidates(snapshots):
  if snapshots.length === 0:
    return []

  if snapshots.length === 1:
    return snapshots[0].holders.map(wallet => ({
      walletAddress: wallet,
      appearanceCount: 1,
      confidence: 1.0,
      tokenMints: [snapshots[0].tokenMint],
      sources: [snapshots[0].sourceType]
    }))

  // Build wallet → { tokens, sources } map
  walletData = new Map()

  for snapshot in snapshots:
    for wallet in snapshot.holders:
      if not walletData.has(wallet):
        walletData.set(wallet, { tokens: new Set(), sources: new Set() })
      walletData.get(wallet).tokens.add(snapshot.tokenMint)
      walletData.get(wallet).sources.add(snapshot.sourceType)

  // Filter to wallets in 2+ snapshots, sort by count
  candidates = []
  totalSnapshots = snapshots.length

  for [wallet, data] in walletData:
    // Count appearances (unique tokens, not snapshots - same token different source counts as 1)
    appearanceCount = data.tokens.size

    if appearanceCount >= 2:
      candidates.push({
        walletAddress: wallet,
        appearanceCount: appearanceCount,
        confidence: appearanceCount / uniqueTokenCount(snapshots),
        tokenMints: Array.from(data.tokens),
        sources: Array.from(data.sources)
      })

  return candidates.sort((a, b) => b.appearanceCount - a.appearanceCount)
```

**Note on confidence calculation**: Confidence is based on unique tokens, not snapshots. If user adds Token A with both TOP_HOLDERS and SIGNIFICANT_BUYERS, that's still 1 token appearance for confidence purposes.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /wallet-hunts | List user's hunts (id, name, snapshotCount, lastVisitedAt) |
| POST | /wallet-hunts | Create new hunt (name required) |
| GET | /wallet-hunts/:id | Get hunt with snapshots and computed candidates |
| DELETE | /wallet-hunts/:id | Delete hunt and all snapshots |
| POST | /wallet-hunts/:id/snapshots | Add snapshot (tokenMint + sourceType required) |
| DELETE | /wallet-hunts/:id/snapshots/:snapshotId | Remove specific snapshot |
| POST | /wallet-hunts/:id/candidates/:wallet/track | Save candidate to tracked wallets |

## Prisma Schema

```prisma
model WalletHunt {
  id            String   @id @default(cuid())
  userId        String
  name          String
  createdAt     DateTime @default(now())
  lastVisitedAt DateTime @default(now())

  snapshots     WalletHuntSnapshot[]
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([lastVisitedAt])
}

model WalletHuntSnapshot {
  id         String   @id @default(cuid())
  huntId     String
  tokenMint  String
  sourceType String   // "TOP_HOLDERS" | "SIGNIFICANT_BUYERS" | future sources
  capturedAt DateTime @default(now())
  holders    String[] // Array of wallet addresses (count varies by source)
  note       String?

  hunt       WalletHunt @relation(fields: [huntId], references: [id], onDelete: Cascade)

  // Same token can have multiple sources; uniqueness is token + source combo
  @@unique([huntId, tokenMint, sourceType])
  @@index([huntId])
}
```

## Services Required

### WalletHuntService
- `createHunt(userId, name)` - Create new hunt (check limit)
- `getHunts(userId)` - List user's hunts
- `getHunt(huntId, userId)` - Get hunt with candidates (updates lastVisitedAt)
- `deleteHunt(huntId, userId)` - Delete hunt
- `addSnapshot(huntId, userId, tokenMint, sourceType, note?)` - Add snapshot from source
- `removeSnapshot(huntId, userId, tokenMint, sourceType)` - Remove specific snapshot
- `trackCandidate(huntId, userId, walletAddress)` - Add to user favorites
- `fetchWalletsForSource(tokenMint, sourceType)` - Route to appropriate service based on source

### WalletHuntCleanupService
- `warnInactiveHunts()` - Find hunts >14 days inactive, mark/notify
- `deleteAbandonedHunts()` - Find hunts >21 days inactive, delete

### Source Routing

```typescript
async fetchWalletsForSource(tokenMint: string, sourceType: string): Promise<string[]> {
  switch (sourceType) {
    case 'TOP_HOLDERS':
      const holders = await this.tokenHoldersService.getTopHolders(tokenMint);
      return holders.holders
        .filter(h => !h.knownType)
        .map(h => h.ownerAccount)
        .filter(Boolean);

    case 'SIGNIFICANT_BUYERS':
      const buyers = await this.significantBuyersService.getSignificantBuyers(tokenMint);
      return buyers
        .filter(b => !isKnownWallet(b.wallet))
        .map(b => b.wallet);

    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
}
```

## Cron Jobs

| Schedule | Job | Action |
|----------|-----|--------|
| Daily 3 AM | cleanupInactiveHunts | Warn at 14 days, delete at 21 days |

## UI Components

### Hunt List View
- Card per hunt showing: name, token count, last visited, top candidate preview
- "New Hunt" button (disabled if at limit with tooltip)
- Delete button per hunt

### Hunt Detail View
- Hunt name (editable?)
- Snapshot list with:
  - Token symbol/address
  - Source badge (TOP_HOLDERS / SIGNIFICANT_BUYERS)
  - Captured timestamp
  - Wallet count
  - Remove button
- Add snapshot form:
  - Token mint input
  - Source selector dropdown
  - Optional note field
- Candidates table:
  - Wallet address (clickable to profile)
  - Confidence bar/percentage
  - Token pills showing which tokens
  - Source pills showing which sources
  - "Track" button to save to favorites

## Edge Cases

### User adds same token + source combo that's already in hunt
- Return error: "This token/source combination already exists in this hunt"

### User adds same token with different source
- Allowed. Creates separate snapshot. Useful for wider coverage.

### User adds token with no valid wallets after filtering
- Store snapshot with empty holders array
- Warn user: "No trackable wallets found (all were LPs/burns)"

### All candidates have only 1 appearance
- Show them but indicate "No overlapping wallets found yet - add more snapshots"

### User at hunt limit tries to create new
- Block with message: "You have 5 active hunts. Delete one to create a new hunt."

### Hunt has 10 snapshots and user tries to add more
- Block with message: "Maximum 10 snapshots per hunt reached"

### Source service fails (rate limit, timeout)
- Return error with source context: "Failed to fetch significant buyers - try again later"
- Do not create partial snapshot

## Integration Points

### Existing Services Used
- `TokenHoldersService.getTopHolders(tokenMint)` - Fetch top holders (source: TOP_HOLDERS)
- `SignificantBuyersService` - Fetch significant buyers (source: SIGNIFICANT_BUYERS)
- `UserFavoritesService.addFavoriteWallet()` - Save candidate to tracked wallets
- Known wallet detection (LP, burn, exchange filtering)

### Database
- Two new tables: `WalletHunt`, `WalletHuntSnapshot`
- Migration required
- Add relation to `User` model

## Security Considerations

- Hunts are user-scoped; users can only access their own hunts
- Token mints validated as valid Solana addresses
- Rate limiting applies to token addition (RPC calls)

## Success Metrics

- Hunt resolution rate (user tracks a candidate)
- Average tokens needed to find wallet
- Hunt abandonment rate

## Out of Scope (Future)

- Telegram bot integration for auto-adding tokens
- Shared hunts between users
- Historical holder data (showing rank changes)
- Bot detection flagging for candidates
- Additional sources: EARLY_BUYERS, DEV_WALLETS, etc. (architecture supports adding)
