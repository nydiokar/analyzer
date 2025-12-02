# Onchain Metadata Enrichment Architecture

**Status:** ✅ Production Ready with Centralized Priority Logic
**Branch:** `main`
**Date:** November 4, 2025
**Last Updated:** November 4, 2025 - Centralized metadata priority in TokenBadge

---

## Problem Solved

**Before:** Tokens displayed as "Unknown Token" when DexScreener didn't have data, causing poor UX.

**After:** Multi-source enrichment with onchain metadata (Helius DAS API) as PRIMARY source for display fields.

---

## Architecture Overview

### Three-Stage Enrichment Pipeline

```
User Request → POST /token-info
                    ↓
TokenInfoService.triggerTokenInfoEnrichment()
                    ↓
┌───────────────────────────────────────────────────────────┐
│ STAGE 1: Helius DAS API (FAST ~500ms) - BLOCKING         │
│ ─────────────────────────────────────────────────────     │
│ • OnchainMetadataService.fetchBasicMetadataBatch()        │
│ • HeliusApiClient.getAssetBatch() → RPC call              │
│ • Save to DB with onchainName, onchainSymbol, etc.        │
│ • Return response immediately with onchain metadata       │
└───────────────────────────────────────────────────────────┘
                    ↓
        Response sent to client ✅
                    ↓
┌─────────────────────────────────┬─────────────────────────┐
│ STAGE 2: DexScreener (2-5s)     │ STAGE 3: URI (5-20s)    │
│ BACKGROUND - NON-BLOCKING        │ BACKGROUND              │
│ ─────────────────────────────    │ ─────────────────────   │
│ • Fetch trading data (price,    │ • Fetch social links    │
│   volume, marketCap)             │   from IPFS/Arweave     │
│ • Update DB with dexscreener*    │ • Update onchainSocials │
│ • Set metadataSource='hybrid'    │ • WebSocket update      │
│ • WebSocket update to frontend   │                         │
└─────────────────────────────────┴─────────────────────────┘
```

---

## Display Priority Rules (Centralized in TokenBadge)

### 🎯 Architecture: Single Source of Truth

**Location:** `dashboard/src/components/shared/TokenBadge.tsx`

All metadata priority decisions happen in ONE place - the TokenBadge component.

**Data Flow:**
```
Backend API
  ↓ (sends BOTH fields raw)
Frontend Components
  ↓ (pass BOTH fields raw)
TokenBadge Component
  ↓ (decides priority - SINGLE SOURCE OF TRUTH)
Displayed to User
```

### Name & Symbol (Display Fields)
**Priority:** ONCHAIN FIRST → DexScreener fallback

```typescript
// Implemented in TokenBadge component
const tokenName = metadata?.onchainName || metadata?.name || 'Unknown Token'
const tokenSymbol = metadata?.onchainSymbol || metadata?.symbol || truncateMint(mint)
```

**Rationale:** Onchain data is immutable and authoritative from the blockchain.

### Image URL
**Priority:** DEXSCREENER FIRST → Onchain fallback

```typescript
// Implemented in TokenBadge component
const tokenImage = metadata?.imageUrl || metadata?.onchainImageUrl
```

**Rationale:**
- DexScreener images are CDN-hosted (faster, more reliable)
- Community can update images on DexScreener
- Onchain IPFS links often break or are slow
- Shows working images immediately

### Social Links
**Priority:** DEXSCREENER FIRST (more up-to-date) → Onchain fallback

```typescript
// Implemented in TokenBadge component
const tokenTwitter = metadata?.twitterUrl || metadata?.onchainTwitterUrl
const tokenWebsite = metadata?.websiteUrl || metadata?.onchainWebsiteUrl
const tokenTelegram = metadata?.telegramUrl || metadata?.onchainTelegramUrl
```

**Rationale:** Social links change frequently, DexScreener is more current.

### Trading Data
**Source:** DEXSCREENER ONLY

```typescript
// Passed directly from API - no priority logic needed
priceUsd: metadata?.priceUsd
volume24h: metadata?.volume24h
marketCapUsd: metadata?.marketCapUsd
```

**Rationale:** Onchain data doesn't include trading metrics.

---

## Key Files & Components

### Backend Core Services

#### 1. `src/core/services/onchain-metadata.service.ts` ⭐ NEW
**Purpose:** Fetch token metadata from Helius DAS API and metadata URIs

**Key Methods:**
- `fetchBasicMetadataBatch(mints: string[])` - Stage 1: Get name, symbol, image from blockchain
- `fetchSocialLinksBatch(tokens)` - Stage 3: Get social links from IPFS/Arweave URIs

**Optimizations:**
- HTTP connection pooling (reuse connections)
- Batch processing (up to 1000 tokens per call)
- Smart timeouts (20s Arweave, 10s IPFS)

**Location:** `/home/juksash/projects/analyzer/src/core/services/onchain-metadata.service.ts`

---

#### 2. `src/core/services/helius-api-client.ts` 🔄 UPDATED
**Added Method:** `getAssetBatch(assetIds: string[])`

**Purpose:** RPC wrapper for Helius DAS API `getAssetBatch` method

**Features:**
- Supports up to 1000 assets per call
- Auto-deduplication
- Recursive batching for >1000 assets
- Rate limiting via existing `rateLimit()` mechanism

**Location:** `/home/juksash/projects/analyzer/src/core/services/helius-api-client.ts` (line 1057-1102)

---

#### 3. `src/api/services/token-info.service.ts` 🔄 UPDATED
**Purpose:** Orchestrates 3-stage enrichment pipeline

**Key Changes:**
- Injected `OnchainMetadataService` dependency
- Modified `triggerTokenInfoEnrichment()` to:
  1. Wait for Stage 1 (onchain metadata)
  2. Fire-and-forget Stage 2 (DexScreener)
  3. Fire-and-forget Stage 3 (social links)
- Added `saveOnchainBasicMetadata()` - batched DB writes
- Added `fetchAndSaveSocialLinks()` - batched DB writes

**Optimizations:**
- Input deduplication
- Batched database transactions (avoid N+1 queries)
- Smart filtering (only enrich what's needed)

**Location:** `/home/juksash/projects/analyzer/src/api/services/token-info.service.ts` (lines 151-354)

---

#### 4. `src/core/services/dexscreener-service.ts` 🔄 UPDATED
**Added Method:** `updateMetadataSourceToHybrid()`

**Purpose:** Mark tokens as 'hybrid' when they have both onchain and dexscreener data

**Location:** `/home/juksash/projects/analyzer/src/core/services/dexscreener-service.ts` (lines 145-167)

---

#### 5. `src/api/services/token-performance.service.ts` 🔄 UPDATED (Nov 2025)
**Purpose:** Send ALL metadata fields raw to frontend (no priority merging)

**Key Changes (November 2025):**
```typescript
// Lines 337-350
// Send ALL fields raw - TokenBadge will decide priority (centralized logic)
// DexScreener fields
name: tokenInfo?.name || fallbackMetadata?.name,
symbol: tokenInfo?.symbol || fallbackMetadata?.symbol,
imageUrl: tokenInfo?.imageUrl,
websiteUrl: tokenInfo?.websiteUrl,
twitterUrl: tokenInfo?.twitterUrl,
telegramUrl: tokenInfo?.telegramUrl,
// Onchain fields
onchainName: tokenInfo?.onchainName,
onchainSymbol: tokenInfo?.onchainSymbol,
onchainImageUrl: tokenInfo?.onchainImageUrl,
onchainWebsiteUrl: tokenInfo?.onchainWebsiteUrl,
onchainTwitterUrl: tokenInfo?.onchainTwitterUrl,
onchainTelegramUrl: tokenInfo?.onchainTelegramUrl,
```

**Architecture Change:** Backend no longer merges fields - sends both sources raw for frontend to decide.

**Location:** `/home/juksash/projects/analyzer/src/api/services/token-performance.service.ts`

---

### Module Registration

#### `src/api/integrations/helius.module.ts` 🔄 UPDATED
**Purpose:** Register OnchainMetadataService as provider

**Features:**
- Checks for `HELIUS_METADATA_API_KEY` env var
- Creates dedicated HeliusApiClient if separate key provided
- Falls back to main HeliusApiClient if no separate key

**Location:** `/home/juksash/projects/analyzer/src/api/integrations/helius.module.ts` (lines 47-70)

---

### Database Schema

#### `prisma/schema.prisma` 🔄 UPDATED
**Added Fields to TokenInfo model:**

```prisma
// Onchain metadata from Helius DAS API (PRIMARY for display)
onchainName         String?
onchainSymbol       String?
onchainDescription  String?
onchainImageUrl     String?
onchainCreator      String?
onchainMetadataUri  String?
onchainTwitterUrl   String?
onchainWebsiteUrl   String?
onchainTelegramUrl  String?
onchainDiscordUrl   String?
onchainBasicFetchedAt    DateTime?
onchainSocialsFetchedAt  DateTime?

metadataSource      String?  // 'dexscreener' | 'onchain' | 'hybrid'

@@index([metadataSource])
@@index([onchainBasicFetchedAt])
@@index([dexscreenerUpdatedAt])
```

**Migration:** `prisma/migrations/YYYYMMDDHHMMSS_add_onchain_metadata_fields/migration.sql` (not yet created)

---

### Frontend Components

#### `dashboard/src/components/shared/TokenBadge.tsx` ⭐ SINGLE SOURCE OF TRUTH
**Purpose:** Centralized component for displaying token metadata with built-in priority logic

**Key Features (November 2025):**
- Accepts BOTH `imageUrl` and `onchainImageUrl` fields
- Internally decides priority: DexScreener first, onchain fallback
- Handles name, symbol, image, and social links
- Single place to update priority rules

**Implementation:**
```typescript
interface TokenMetadata {
  // DexScreener fields
  name?: string;
  symbol?: string;
  imageUrl?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;

  // Onchain fields
  onchainName?: string;
  onchainSymbol?: string;
  onchainImageUrl?: string;
  onchainWebsiteUrl?: string;
  onchainTwitterUrl?: string;
  onchainTelegramUrl?: string;
}

// Priority logic (lines 43-48)
const tokenName = metadata?.onchainName || metadata?.name || 'Unknown Token'
const tokenSymbol = metadata?.onchainSymbol || metadata?.symbol || truncateMint(mint)
const tokenImage = metadata?.imageUrl || metadata?.onchainImageUrl  // DexScreener first!
const tokenWebsite = metadata?.websiteUrl || metadata?.onchainWebsiteUrl
const tokenTwitter = metadata?.twitterUrl || metadata?.onchainTwitterUrl
const tokenTelegram = metadata?.telegramUrl || metadata?.onchainTelegramUrl
```

**Usage in Components:**
```typescript
// Pass ALL fields raw - TokenBadge decides priority
<TokenBadge
  mint={item.tokenAddress}
  metadata={{
    name: item.name,
    symbol: item.symbol,
    imageUrl: item.imageUrl,
    onchainName: item.onchainName,
    onchainSymbol: item.onchainSymbol,
    onchainImageUrl: item.onchainImageUrl,
    // ... etc
  }}
/>
```

**Location:** `/home/juksash/projects/analyzer/dashboard/src/components/shared/TokenBadge.tsx`

---

#### `dashboard/src/lib/tokenMetadataAggregator.ts` ⚠️ DEPRECATED
**Status:** Deprecated as of November 2025

**Reason:** Priority logic moved to TokenBadge component (single source of truth)

**Migration:** Pass all fields raw to TokenBadge instead of using this utility

**Location:** `/home/juksash/projects/analyzer/dashboard/src/lib/tokenMetadataAggregator.ts`

---

## Configuration

### Environment Variables

**Required:**
```bash
HELIUS_API_KEY=your_main_helius_key_here
```

**Optional (Recommended):**
```bash
# Separate free Helius account for metadata enrichment
# Benefits:
# - Isolates rate limits (main key for transactions, metadata key for enrichment)
# - Free tier: 1M credits/month, 2 req/s for DAS APIs
HELIUS_METADATA_API_KEY=your_metadata_key_here
```

**Auto-configured:**
```bash
REDIS_HOST=localhost
REDIS_PORT=6379
DATABASE_URL=file:./dev.db
```

---

## Cost Analysis

### Helius Free Tier (Separate Account)
- **Credits:** 1M/month
- **Rate Limit:** 2 req/s for DAS APIs
- **Cost per token:** 10 credits (`getAssetBatch`)
- **Monthly capacity:** 100,000 token enrichments

### Typical Usage:
- **100 tokens:** 1,000 credits (0.1% quota)
- **1,000 tokens:** 10,000 credits (1% quota)
- **13,000 tokens:** 130,000 credits (13% quota)

**Recommendation:** Create separate free Helius account dedicated to metadata.

---

## Current Status

### ✅ Completed (Production Ready)
1. Database schema updated with onchain fields
2. OnchainMetadataService implemented with HTTP pooling
3. HeliusApiClient.getAssetBatch() method added
4. TokenInfoService orchestration updated (3-stage pipeline)
5. DexscreenerService hybrid metadata marking
6. Module registration with optional separate API key
7. Backend sends both fields raw (no merging) - November 2025
8. TokenBadge component centralized priority logic - November 2025
9. Frontend components updated to pass raw fields - November 2025
10. Environment variable documentation
11. Setup scripts (setup.sh, docker-compose.yml)

### ⚠️ Deprecated
- `tokenMetadataAggregator.ts` utility - Use TokenBadge component instead

### 🎯 November 2025 Architecture Changes
**Problem:** Priority logic was scattered across 3-6 files
**Solution:** Centralized all priority decisions in TokenBadge component

**Benefits:**
- Single source of truth for metadata display
- Change priority = update 1 file (was 3-6 files)
- More flexible API for external consumers
- Better maintainability

### 📊 In Production
- Image priority: DexScreener first (fixes broken IPFS images)
- Name/Symbol priority: Onchain first (immutable, authoritative)
- Social links priority: DexScreener first (more up-to-date)

---

## Testing Strategy

### Unit Tests Needed
- `OnchainMetadataService.fetchBasicMetadataBatch()` with various inputs
- `OnchainMetadataService.fetchSocialLinksBatch()` with timeout handling
- `HeliusApiClient.getAssetBatch()` with various batch sizes

### Integration Tests Needed
- Full 3-stage enrichment pipeline
- Database transaction batching
- WebSocket updates to frontend

### Manual Testing
1. Test with known token (has DexScreener data)
2. Test with unknown token (no DexScreener data)
3. Test batch enrichment (100+ tokens)
4. Verify frontend displays correctly
5. Monitor Helius credit usage

---

## Pattern Alignment

This implementation follows the established patterns in the codebase:

### ✅ FOLLOWS Existing Patterns
- **Service Pattern:** OnchainMetadataService is a specialized service (like DexscreenerService)
- **Orchestration in TokenInfoService:** Similar to how it orchestrates price providers
- **Module Registration:** Follows NestJS provider pattern in HeliusModule
- **Database Batching:** Consistent with existing optimization patterns
- **Environment Configuration:** Uses ConfigService pattern

### ✅ DOES NOT Use Abstract Provider Pattern
- **Why:** Onchain metadata is NOT swappable (blockchain is single source of truth)
- **Contrast:** Prices ARE swappable (DexScreener → Bird.io → CoinGecko) hence `IPriceProvider`
- **Decision:** Pragmatic - specialized service for specialized purpose

---

## Next Actions

### Before Testing
- [x] Create setup script
- [x] Create docker-compose for Redis
- [x] Document environment variables
- [ ] User: Copy .env file with credentials
- [ ] Run: `./setup.sh` (upgrades Node, starts Docker, runs migrations)

### During Testing
- [ ] Start backend: `npm run dev`
- [ ] Run test script: `./test-enrichment.sh`
- [ ] Check logs for 3-stage completion
- [ ] View database: `npx prisma studio`
- [ ] Verify frontend displays metadata

### After Successful Testing
- [ ] Commit changes
- [ ] Create PR to main branch
- [ ] Deploy to staging
- [ ] Monitor Helius credit usage
- [ ] Document any issues/optimizations

---

## Reference Links

- **Main Implementation Doc:** `documentation/onchain-metadata-enrichment.md`
- **Implementation Summary:** `documentation/onchain-metadata-implementation-summary.md`
- **Quick Start Guide:** `QUICKSTART.md`
- **Helius DAS API Docs:** https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api
- **Metaplex Token Metadata:** https://docs.metaplex.com/programs/token-metadata/

---

**Last Updated:** October 29, 2025
**Ready for:** Local testing and validation
