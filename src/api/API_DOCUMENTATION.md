# Sova Intel API Documentation

## Overview

Sova Intel is a comprehensive Solana wallet analysis platform with credit-based monetization. The API provides detailed insights into trading behavior, PnL analysis, wallet similarity comparisons, and wallet discovery. Solana Pay integration enables credit purchases; authenticated users access all features.

- **Application**: Sova Intel v0.18.0+
- **Technology Stack**: NestJS, TypeScript, BullMQ, Prisma, Redis
- **Base URL**: `/api/v1` (default, configurable)
- **Authentication**: Composite (JWT primary, API Keys for services, optional cookies)
- **Rate Limiting**: Applied per endpoint (varies; see endpoint docs)
- **Credits**: Pay-per-use model; endpoints decorated with `@RequireCredits(N)` deduct credits on success

---

## Authentication & Security

### Authentication Methods

1. **JWT (Primary)**: Bearer token via `Authorization: Bearer <access_token>`
   - 30-minute TTL (configurable `JWT_EXPIRES_IN`)
   - Issued via `/auth/register`, `/auth/login`, `/auth/refresh`
   - Supports rotating refresh tokens (7-day sliding window)

2. **API Keys (Services/Legacy)**: Via `X-API-Key` header
   - Admin-only creation (`POST /admin/api-keys`)
   - Scoped: `'read'`, `'write'`, `'admin'`, `'full'`
   - Optional expiry; can be revoked

3. **Cookies (Optional)**: `httpOnly`, `secure`, `sameSite=strict` when `AUTH_COOKIE_MODE=true`
   - Requires CSRF token via `X-CSRF-Token` header for state-changing requests
   - Get token: `GET /auth/csrf-token`

### Global Guards (in order)

1. **CompositeAuthGuard** — Routes JWT or API Key to appropriate handler; allows `@Public()` decorator
2. **ThrottlerGuard** — Rate limiting (default 200 req/min app-wide)
3. **AdminGuard** — Checks `User.isAdmin` flag for `@AdminOnly()` endpoints
4. **CreditGuard** — Pre-checks balance for `@RequireCredits(N)` endpoints; returns HTTP 402 if insufficient

### Global Interceptors

1. **CreditInterceptor** — Post-deducts credits on successful response (async, non-blocking)

### Credit System

- **Cost Model**: Static per endpoint (e.g., `@RequireCredits(5)`)
- **Response on Insufficient Credits**: HTTP 402 `{ error: "credits_exhausted", message: "Account credits exhausted. Top up required.", balance: N, required: N }`
- **Deduction Timing**: After handler succeeds (failed requests don't charge)
- **Transaction Ledger**: Append-only `CreditTransaction` records; never mutate `CreditBalance` directly
- **Signup Bonus**: `FREE_CREDITS_ON_SIGNUP` env var (default 100 credits)

### Security Features

- **JWT Claims**: `kid`, `iss`, `aud`, `nbf` for enhanced validation
- **Password Security**: bcrypt (12 rounds) + pepper (32+ chars required)
- **Timing Attack Protection**: Constant-time user lookups prevent enumeration
- **Password Reset**: Generic 200 response; tokens only emailed (never in API response)
- **Registration Control**: Kill-switch + optional code requirement (admin-configurable)
- **Email Verification**: Token-based, auto-sent after registration (non-fatal if email fails)

---

## Modules & Endpoints

Base path: `/api/v1/`

### 1. Health (`/health`)

**Overview**: Tiered health monitoring for operational status and infrastructure metrics.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | Public | Minimal status (operational/down). Safe for external monitoring. |
| `/health/detailed` | GET | Admin | Comprehensive metrics: database, cache, performance (admin-only). |
| `/health/queues` | GET | Admin | BullMQ queue health and Redis status (admin-only). |
| `/health/cache-metrics` | GET | Admin | Cache statistics for monitoring (admin-only). |
| `/health/metrics` | GET | Public (API Key) | Prometheus text format metrics (use API key with `'admin'` or `'full'` scope). |

**Rate Limiting**: Standard (200 req/min)

---

### 2. Authentication (`/auth`)

**Overview**: Complete JWT-based auth with email verification, password reset, and session management.

| Endpoint | Method | Auth | Rate Limit | Description |
|----------|--------|------|------------|-------------|
| `/register` | POST | Public | 15 req/min | Register new user; returns access + refresh tokens. Optional registration code required (admin-configurable). Auto-sends verification email. |
| `/login` | POST | Public | 10 req/min | Login with email/password; returns access + refresh tokens. |
| `/refresh` | POST | Public | 20 req/min | Refresh access token using refresh token (rotating refresh). |
| `/me` | GET | JWT/API Key | None | Get current user profile (id, email, isAdmin, createdAt, lastLoginAt). |
| `/logout` | POST | Public | 10 req/min | Logout user (revokes refresh session, clears cookie if enabled). |
| `/logout-all` | POST | JWT | None | Logout all sessions (revokes all user's refresh tokens). |
| `/csrf-token` | GET | Public | 30 req/min | Get CSRF token (only when cookie mode enabled). |
| `/request-verification` | POST | JWT (unverified) | 10 req/5min | Request email verification; auto-sends token. |
| `/verify-email` | POST | JWT (unverified) | 10 req/5min | Verify email with token. |
| `/forgot-password` | POST | Public | 3 req/5min | Request password reset link via email. Generic 200 response (prevents enumeration). |
| `/reset-password` | POST | Public | 10 req/min | Reset password with emailed token. |

**Notes**:
- Login/register may set httpOnly cookie if `AUTH_COOKIE_MODE=true`
- All password reset tokens are single-use and expire after 24 hours
- Verification emails only sent if `EMAIL_SERVICE_ENABLED=true` (else token logged to console)

---

### 3. Users (`/users`)

**Overview**: User profile and credit management.

| Endpoint | Method | Auth | Credits | Description |
|----------|--------|------|---------|-------------|
| `/me` | GET | JWT/API Key | — | Get authenticated user profile. |
| `/me/credits` | GET | JWT/API Key | — | Get credit balance and recent 20 transactions. Returns `{ balance, updatedAt, transactions[] }`. |

---

### 4. User Favorites (`/users/me/favorites`)

**Overview**: Wallet tracking with collections, import, and batch analysis.

| Endpoint | Method | Auth | Rate Limit | Description |
|----------|--------|------|------------|-------------|
| `/` | GET | JWT | None | List all favorited wallets. |
| `/` | POST | JWT | None | Add wallet to favorites. Body: `{ walletAddress, collectionName?, note? }`. Returns `{ id, walletAddress, ... }`. |
| `/:walletAddress` | DELETE | JWT | None | Remove wallet from favorites. |
| `/` | DELETE | JWT | None | Clear all favorites. |
| `/:walletAddress` | PATCH | JWT | None | Update favorite note/metadata. Body: `{ note? }`. |
| `/:walletAddress/viewed` | POST | JWT | None | Mark wallet as viewed (updates `lastViewedAt`). |
| `/collections` | GET | JWT | None | List all collection names and counts. |
| `/import` | POST | JWT | 10 req/hr | Bulk import up to 300 wallets. Body: `{ walletAddresses: string[] }`. Returns `{ imported, skipped, duplicates }`. |
| `/batch-analyze` | POST | JWT | 15 req/hr | Queue analysis jobs for up to 20 wallets. Body: `{ walletAddresses, scope: 'flash'|'working'|'deep' }`. Returns job references. |
| `/collections/:name/refresh` | POST | JWT | 10 req/hr | Refresh all wallets in collection (re-queues analysis). |

**Rate Limits**: Per-user, sliding window (1 hour)

---

### 5. Security (`/security`)

**Overview**: Security monitoring, alerts, and audit logging.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/metrics` | GET | JWT | Security metrics and monitoring data. |
| `/health` | GET | JWT | Security system health check. |
| `/alerts` | GET | JWT | Get active security alerts. |
| `/alerts/:id/resolve` | POST | JWT | Resolve a security alert. |

---

### 6. Admin (`/admin`)

**Overview**: System administration: API keys, registration codes, user management.

**All endpoints require `@AdminOnly()` (verified via `User.isAdmin` flag).**

#### API Key Management

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api-keys` | GET | Admin | List all API keys. |
| `/api-keys` | POST | Admin | Create new API key. Body: `{ userId, description, scopes[], expiresInDays? }`. Returns full key (save immediately). |
| `/api-keys/:keyId` | PATCH | Admin | Update API key metadata. Body: `{ description?, scopes[]? }`. |
| `/api-keys/:keyId/revoke` | PATCH | Admin | Revoke (deactivate) API key. |
| `/api-keys/:keyId` | DELETE | Admin | Permanently delete API key. |

#### Registration Code Management

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/registration-codes` | GET | Admin | List registration codes. Query: `status` (active/used/revoked), `limit`. |
| `/registration-codes` | POST | Admin | Create single code. Body: `{ description?, maxUses?, expiresAt? }`. |
| `/registration-codes/bulk` | POST | Admin | Create bulk codes. Body: `{ count (1-100), description?, maxUses?, expiresAt? }`. |
| `/registration-codes/stats` | GET | Admin | Get code statistics (issued, used, expired, available). |
| `/registration-codes/:code` | PATCH | Admin | Revoke code (mark unusable). |
| `/registration-codes/:code` | DELETE | Admin | Permanently delete code. |

#### Registration Control

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/registration/kill-switch` | GET | Admin | Get kill-switch status (true/false). |
| `/registration/kill-switch/enable` | POST | Admin | Block all new registrations (emergency). |
| `/registration/kill-switch/disable` | POST | Admin | Allow registrations. |
| `/registration/code-requirement` | GET | Admin | Get code requirement status (true/false). |
| `/registration/code-requirement/enable` | POST | Admin | Make codes mandatory. |
| `/registration/code-requirement/disable` | POST | Admin | Allow open registration (no code required). |

#### User Management

| Endpoint | Method | Auth | Query Params | Description |
|----------|--------|------|--------------|-------------|
| `/users` | GET | Admin | `search`, `isActive`, `isAdmin`, `isDemo`, `sortBy`, `sortOrder`, `limit`, `offset` | List users with pagination. Returns `{ users[], total, limit, offset }`. |
| `/users/:userId/disable` | PATCH | Admin | — | Disable user account (sets `isActive=false`). |
| `/users/:userId/enable` | PATCH | Admin | — | Re-enable user account (sets `isActive=true`). |

---

### 7. Wallets (`/wallets`)

**Overview**: Wallet analysis, performance, and behavioral metrics.

| Endpoint | Method | Auth | Credits | Rate Limit | Description |
|----------|--------|------|---------|------------|-------------|
| `/search` | GET | JWT/API Key | — | None | Search wallets by address fragment. Query: `query` (min 3 chars), `limit?`. Returns matching addresses. |
| `/:address/summary` | GET | JWT/API Key | — | None | Fast wallet summary (status, counts, classification). |
| `/:address/behavior-analysis` | GET | JWT/API Key | **5** | Standard | Detailed trading behavior (entry patterns, holds, exits). |
| `/:address/exit-timing-tokens/:timeBucket` | GET | JWT/API Key | — | Standard | Tokens exited in time bucket (5min, 15min, 1h, etc). |
| `/:address/pnl-overview` | GET | JWT/API Key | — | Standard | PnL by token, exit timing, realized gains. Query: `startDate?`, `endDate?`. |
| `/:address/token-performance` | GET | JWT/API Key | — | Standard | Token holdings ranked by performance. Query: `sortBy?` (pnl, return, etc), `limit?`. |
| `/:address/hud` | GET | Public | — | Standard | **Public** heads-up display: condensed metrics (isBot, isWhale, medianPnl, avgTxValue). |
| `/hud/batch` | POST | Public | — | 100 req/10min | **Public** batch HUD fetch. Body: `{ addresses[] }`. Returns `{ hudMap: { [address]: HUD } }`. |

**Notes**:
- `/summary` endpoint: Fast read, tells wallet analysis state (unanalyzed, alreadyRunning, skipped, ok with/without HUD)
- All `/address/*` endpoints perform optional `@RequireCredits()` check

---

### 8. Analyses (`/analyses`)

**Overview**: Analysis queuing, status monitoring, and specialized studies (similarity, holder profiles, etc).

| Endpoint | Method | Auth | Credits | Rate Limit | Description |
|----------|--------|------|---------|------------|-------------|
| `/similarity/enrich-balances` | POST | JWT/API Key | — | 20 req/min | Enrich wallet balance snapshots for similarity calculation. |
| `/similarity/queue` | POST | JWT/API Key | **100** | 5 req/min | Queue similarity analysis across wallets. Body: `{ wallets, scope }`. Returns job reference. |
| `/wallets/status` | POST | JWT/API Key | — | None | Check analysis status for multiple wallets. Body: `{ addresses[] }`. Returns status map. |
| `/wallets/dashboard-analysis` | POST | JWT/API Key | **10** | 5 req/min | Queue dashboard wallet analysis (all scopes). Body: `{ address, scope: 'flash'|'working'|'deep' }`. |
| `/holder-profiles` | POST | JWT/API Key | — | 10 req/min | Queue holder profiles analysis (wallet set). Body: `{ wallets[] }`. |
| `/holder-profiles/wallet` | POST | JWT/API Key | — | 50 req/min | Queue single wallet holder profiles. Body: `{ address }`. |

**Notes**:
- Scope tiers: `'flash'` (fast, <1min), `'working'` (medium, ~5min), `'deep'` (comprehensive, ~30min)
- All analysis endpoints return job ID + status; poll via `/jobs/:jobId/status`

---

### 9. Jobs (`/jobs`)

**Overview**: Background job status and WebSocket subscription.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/status/:jobId` | GET | JWT/API Key | Get job status (queued, processing, completed, failed). Returns metadata, progress %, results if done. |
| `/events` | WS | JWT/API Key | **WebSocket** subscribe to real-time job progress. Emits `job:progress`, `job:completed`, `job:failed`. |

---

### 10. Discover (`/discover`)

**Overview**: Public wallet discovery and trend aggregation.

| Endpoint | Method | Auth | Caching | Description |
|----------|--------|------|---------|-------------|
| `/wallets` | GET | Public | 2min | Discover trending/new wallets. Query: `limit`, `offset`, `sort` (trending, new, etc). |
| `/aggregation` | GET | Public | 2min | Trend aggregation (top tokens, categories, etc). |

---

### 11. Wallet HUD (`/wallets/:address/hud`)

**Overview**: Public heads-up display (no auth required).

| Endpoint | Method | Auth | Caching | Description |
|----------|--------|------|---------|-------------|
| `/wallets/:address/hud` | GET | Public | Aggressive | **Public** condensed metrics: `isBot`, `isWhale`, `medianPnl`, `avgTxValueSol`, `trimmedMeanPnl`, `signalType`. |
| `/wallets/hud/batch` | POST | Public | Aggressive | **Public** batch HUD. Body: `{ addresses[] }`. Returns map. |

---

### 12. Wallet Hunt (`/wallet-hunts`)

**Overview**: Cross-token wallet discovery via token intersection.

**All endpoints require JWT auth.**

| Endpoint | Method | Auth | Rate Limit | Description |
|----------|--------|------|------------|-------------|
| `/` | GET | JWT | None | List all hunts for user (max 5 per user). |
| `/` | POST | JWT | None | Create hunt. Body: `{ name }`. Returns hunt with empty snapshots. |
| `/:id` | GET | JWT | None | Get hunt details (snapshots, candidates, metadata). |
| `/:id` | DELETE | JWT | None | Delete hunt (cascade: snapshots + candidates removed). |
| `/:id/snapshots` | POST | JWT | None | Add token snapshot (top holders from Solana RPC). Body: `{ mint, source }`. Duplicate check (same mint+source). |
| `/:id/snapshots/:snapshotId` | DELETE | JWT | None | Remove snapshot. |
| `/:id/candidates/:wallet/track` | POST | JWT | None | Track candidate wallet (add to favorites). |

**Validation**: 5-hunt limit per user, duplicate snapshot detection with 400 error.

---

### 13. Token Info (`/token-info`)

**Overview**: Token metadata, holders, and market data.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/:mint` | GET | JWT/API Key | Token metadata (name, symbol, supply, holder count). |
| `/:mint/holders` | GET | JWT/API Key | Top token holders. Query: `limit`, `offset`. |
| `/:mint/price` | GET | JWT/API Key | Current token price (via Dexscreener). |

---

### 14. Payments (`/payments`)

**Overview**: Solana Pay credit purchase integration.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/packs` | GET | Public | List available credit packs. Returns `[{ id, name, credits, priceUsd, priceSol }]`. |
| `/checkout` | POST | JWT | Create payment intent + Solana Pay QR. Body: `{ packId }`. Returns `{ intentId, qrCode (base64), url, reference }`. |
| `/:id/status` | GET | JWT | Poll payment status. Returns `{ status: 'pending'|'confirmed'|'expired', ... }`. |

**Packs** (seeded): Starter ($15 / 1k credits), Builder ($120 / 10k credits), Pro ($900 / 100k credits).

**Process**:
1. User calls `/payments/packs` to list options
2. User calls `/payments/checkout` with pack ID → receives Solana Pay QR
3. User scans QR, sends USDC to treasury wallet
4. Helius webhook (`POST /integrations/helius/payment-webhook`) verifies + confirms payment → credits added
5. User polls `/payments/:id/status` to confirm (optional; webhook is source of truth)

---

### 15. Metrics (`/metrics`)

**Overview**: Prometheus metrics endpoint (public, typically scraped by Prometheus server).

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/metrics` | GET | Public (API Key) | Prometheus text format metrics. Use API key with `'admin'` or `'full'` scope for scraper. |

**Common Metrics**: Request count/latency, BullMQ job counts, credit deductions, cache hits/misses.

---

### 16. Bot Integration (`/bot`)

**Overview**: Hidden from Swagger; for automated integrations (e.g., PFT Oracle Bot).

**Hidden endpoints** (not listed in Swagger for security/simplicity). Typically used by trusted external bots for programmatic analysis requests.

---

### 17. Webhooks (`/webhooks`)

**Overview**: Inbound webhook handlers.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/email` | POST | API Key | Email service callbacks (bounce, delivery). |

---

### 18. Integrations (`/integrations`)

**Overview**: Third-party service integrations.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/helius/payment-webhook` | POST | Helius Secret | Solana transaction webhook from Helius. Verifies USDC payment → credits top-up. Idempotent (reconciliation processor fallback). |

**Helius Flow**:
1. Transaction on-chain: user sends USDC to treasury wallet with payment intent reference
2. Helius detects → calls webhook with txn details
3. Webhook verifies reference + amount → calls `creditsService.topUp()`
4. Payment marked `confirmed` in DB
5. If webhook fails/times out: `PaymentReconciliationProcessor` (BullMQ worker) runs every 5min, reconciles pending intents

---

## Queue System

**Overview**: BullMQ worker pool for async jobs.

### Job Types

| Type | Module | Processor | Trigger | Scope |
|------|--------|-----------|---------|-------|
| `dashboard-analysis` | AnalysesModule | DashboardAnalysisProcessor | `POST /analyses/wallets/dashboard-analysis` | flash/working/deep (deep default) |
| `pnl-analysis` | PnlAnalysisModule | PnlAnalysisProcessor | auto-triggered by dashboard | internal |
| `behavior-analysis` | BehaviorModule | BehaviorAnalysisProcessor | auto-triggered by dashboard | internal |
| `similarity-analysis` | SimilarityModule | SimilarityAnalysisProcessor | `POST /analyses/similarity/queue` | predefined (all 3) |
| `holder-profiles` | HolderProfilesCacheModule | HolderProfilesCacheProcessor | `POST /analyses/holder-profiles` | all wallets |
| `payment-reconciliation` | QueueModule | PaymentReconciliationProcessor | every 5min by scheduler | all pending intents |
| `wallet-hunt-candidate` | WalletHuntModule | internal | candidate fetch | internal |

### WebSocket Events

Clients subscribe to `/jobs/events` (WebSocket) to receive real-time updates:

```json
{
  "type": "job:progress",
  "jobId": "...",
  "progress": 45,
  "status": "processing"
}

{
  "type": "job:completed",
  "jobId": "...",
  "results": { ... }
}

{
  "type": "job:failed",
  "jobId": "...",
  "error": "..."
}
```

---

## Response Formats

### Success Response

```json
{
  "data": { ... },
  "meta": {
    "timestamp": "2026-02-24T12:34:56Z",
    "version": "v1"
  }
}
```

### Error Response

```json
{
  "error": "error_code",
  "message": "Human-readable error message",
  "statusCode": 400,
  "timestamp": "2026-02-24T12:34:56Z"
}
```

### Credit Insufficient Response (HTTP 402)

```json
{
  "error": "credits_exhausted",
  "balance": 5,
  "required": 10,
  "message": "Insufficient credits. Current balance: 5, Required: 10"
}
```

---

## Error Handling

| Status | Error | Meaning |
|--------|-------|---------|
| 400 | `BAD_REQUEST` | Invalid input (validation failed). |
| 401 | `UNAUTHORIZED` | Authentication failed (invalid token, expired refresh). |
| 402 | `INSUFFICIENT_CREDITS` | Credit balance too low (see above). |
| 403 | `FORBIDDEN` | Authorization failed (not admin, not owner, etc). |
| 404 | `NOT_FOUND` | Resource not found. |
| 409 | `CONFLICT` | Resource already exists (e.g., duplicate registration code). |
| 429 | `TOO_MANY_REQUESTS` | Rate limit exceeded. |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected server error. |
| 503 | `SERVICE_UNAVAILABLE` | Service temporarily unavailable (e.g., kill-switch active). |

---

## Rate Limiting

**Default**: 200 requests/minute (configurable via `ThrottlerModule`)

**Per-Endpoint Overrides**:
- Registration: 15 req/min (higher due to email sending)
- Login: 10 req/min
- Refresh: 20 req/min
- Forgot Password: 3 req/5min (strict to prevent email spam)
- Batch operations: 10–50 req/hour per-user (sliding window)
- Health/Metrics: Standard
- Analysis queuing: 5 req/min per scope

---

## Pagination

Standard pagination parameters:

- `limit`: Max results (default 50, max 1000)
- `offset`: Results to skip (default 0)
- `sortBy`: Field to sort by (context-dependent)
- `sortOrder`: `'asc'` or `'desc'` (default varies)

---

## Environment Variables

Key configuration:

```
# Authentication
JWT_EXPIRES_IN=30m
JWT_SECRET=<32+ char random>
JWT_REFRESH_SECRET=<32+ char random>
PEPPER_SECRET=<32+ char random>

# Cookie Mode
AUTH_COOKIE_MODE=false
AUTH_COOKIE_NAME=analyzer.sid
AUTH_COOKIE_SECURE=true

# CSRF (only in cookie mode)
CSRF_SECRET=<32+ char random>

# Email
EMAIL_SERVICE_ENABLED=false  # Set true to enable SES/SMTP
EMAIL_FROM=noreply@sova.ai

# Payments
TREASURY_WALLET_ADDRESS=<Solana pubkey>
HELIUS_API_KEY=<key>
HELIUS_PAYMENT_WEBHOOK_SECRET=<secret>

# Credits
FREE_CREDITS_ON_SIGNUP=100

# Admin Registration Control (via Redis)
REGISTRATION_KILL_SWITCH=false
REGISTRATION_REQUIRE_CODES=false
```

---

## Common Use Cases

### 1. Register & Login

```bash
# Register
POST /auth/register
{ "email": "user@example.com", "password": "secret123" }

# Login
POST /auth/login
{ "email": "user@example.com", "password": "secret123" }

# Get profile
GET /auth/me
Headers: Authorization: Bearer <access_token>
```

### 2. Analyze Wallet

```bash
# Queue analysis
POST /analyses/wallets/dashboard-analysis
{ "address": "So....", "scope": "flash" }

# Poll job
GET /jobs/status/<jobId>

# Check credit balance
GET /users/me/credits
```

### 3. Buy Credits

```bash
# List packs
GET /payments/packs

# Create payment intent
POST /payments/checkout
{ "packId": "starter" }

# User scans QR, sends USDC
# Webhook confirms → credits added

# Check status (optional)
GET /payments/<intentId>/status
```

### 4. Admin: Create API Key

```bash
# Create key
POST /admin/api-keys
{ "userId": "...", "description": "...", "scopes": ["read", "write"] }

# Use key
GET /wallets/search?query=So
Headers: X-API-Key: <full-key>
```

---

## SDKs & Clients

No official SDK yet. Use HTTP client of choice (fetch, axios, httpx, curl).

---

## Support & Feedback

- **Documentation**: This file (API_DOCUMENTATION.md)
- **Architecture**: See `map.md` for DI structure
- **Issues**: Report via GitHub issues
- **Email**: support@sova.ai

---

**Last Updated**: 2026-02-24
**API Version**: v1 (production)
