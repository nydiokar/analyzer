# Onchain Metadata Enrichment Architecture

**Status:** ✅ Implementation Complete - Ready for Testing
**Branch:** `feature/onchain-metadata-enrichment`
**Date:** October 29, 2025

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

## Display Priority Rules

### Name, Symbol, Image (Display Fields)
**Priority:** ONCHAIN FIRST → DexScreener fallback

```typescript
name: token.onchainName || token.name || 'Unknown Token'
symbol: token.onchainSymbol || token.symbol || truncateMint(address)
imageUrl: token.onchainImageUrl || token.imageUrl || null
```

### Social Links
**Priority:** DEXSCREENER FIRST (more up-to-date) → Onchain fallback

```typescript
twitter: token.twitterUrl || token.onchainTwitterUrl || null
website: token.websiteUrl || token.onchainWebsiteUrl || null
telegram: token.telegramUrl || token.onchainTelegramUrl || null
discord: token.onchainDiscordUrl || null // Onchain only
```

### Trading Data
**Source:** DEXSCREENER ONLY

```typescript
priceUsd: token.priceUsd
volume24h: token.volume24h
marketCapUsd: token.marketCapUsd
```

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

#### 5. `src/api/services/token-performance.service.ts` 🔄 UPDATED
**Purpose:** Map token metadata to DTOs with onchain-first priority

**Key Changes:**
```typescript
// Lines 336-343
name: tokenInfo?.onchainName || tokenInfo?.name || fallbackMetadata?.name,
symbol: tokenInfo?.onchainSymbol || tokenInfo?.symbol || fallbackMetadata?.symbol,
imageUrl: tokenInfo?.onchainImageUrl || tokenInfo?.imageUrl,
websiteUrl: tokenInfo?.websiteUrl || tokenInfo?.onchainWebsiteUrl,
twitterUrl: tokenInfo?.twitterUrl || tokenInfo?.onchainTwitterUrl,
telegramUrl: tokenInfo?.telegramUrl || tokenInfo?.onchainTelegramUrl,
```

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

### Frontend (Optional Enhancement)

#### `dashboard/src/lib/tokenMetadataAggregator.ts` ⭐ NEW
**Purpose:** Utility for merging onchain and dexscreener metadata

**Key Function:**
```typescript
getDisplayMetadata(token: TokenInfo): DisplayMetadata
```

**Usage:** Can be used in frontend components to consistently apply priority rules

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

### ✅ Completed
1. Database schema updated with onchain fields
2. OnchainMetadataService implemented with HTTP pooling
3. HeliusApiClient.getAssetBatch() method added
4. TokenInfoService orchestration updated (3-stage pipeline)
5. DexscreenerService hybrid metadata marking
6. Module registration with optional separate API key
7. Display logic updated (backend DTO mapping)
8. Frontend utility created (tokenMetadataAggregator)
9. Environment variable documentation
10. Setup scripts (setup.sh, docker-compose.yml)

### 🔄 Ready for Testing
- Database migration needs to be run: `npx prisma migrate dev`
- Backend needs to start with new code
- Test enrichment with real tokens

### 📝 Pending (After Testing)
- Performance monitoring
- Production deployment
- Documentation updates based on real-world usage

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
