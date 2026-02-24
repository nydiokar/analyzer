# Sova Intel — Solana Wallet Analysis Platform

A comprehensive NestJS API platform for deep Solana wallet analysis, PnL tracking, behavior profiling, and wallet discovery. Built on Solana Pay for credit-based monetization with real-time job processing via BullMQ.

## What Is This?

**Sova Intel** is a **backend API platform** (not a CLI tool) that provides:

- **Wallet Analytics**: Behavior analysis, PnL tracking, token performance, trading patterns
- **Similarity Engine**: Compare wallets across tokenomics and trading behavior
- **Wallet Discovery**: Trend discovery, holder profile caching, cross-token wallet hunting
- **Monetization**: Solana Pay credit system with per-endpoint credit costs (HTTP 402 support)
- **Admin Panel**: API key management, registration codes, user management, kill-switches
- **Real-time Updates**: WebSocket gateway for job progress streaming
- **Production-Ready**: Sentry monitoring, Prometheus metrics, Redis caching, atomic transactions

## Core Features

### 1. Wallet Analysis
- **Behavior Analysis** (5 credits) — Trading entry patterns, hold times, exits
- **PnL Overview** — Realized/unrealized gains by token with exit timing
- **Token Performance** — Holdings ranked by ROI, sorted by multiple criteria
- **Exit Timing** — Tokens exited in specific time buckets (5min, 15min, 1h, etc)
- **Quick Summary** — Fast wallet state check (analyzed, pending, system wallet)

### 2. Cross-Wallet Insights
- **Similarity Analysis** (100 credits) — Compare wallets: shared tokens, capital alignment, behavior correlation
- **Holder Profiles** — Aggregate holder behavior and PnL across wallet sets
- **Dashboard Analysis** (10 credits) — Full analysis pipeline: behavior + PnL + token performance

### 3. Discovery & Tracking
- **Public Wallet Discovery** — Trending/new wallets, aggregated trends (no auth required)
- **Wallet Hunt** — Find wallets via token intersection (e.g., "which wallets hold both Token A and Token B?")
- **User Favorites** — Track wallets, organize in collections, bulk import (300 wallets), batch analyze, auto-refresh

### 4. Credit System
- **Pay-per-Use Model** — Purchase credit packs via Solana Pay
- **Atomic Deduction** — Credits deducted only on successful response (failed requests are free)
- **HTTP 402 Response** — `{ error: "insufficient_credits", balance: N, required: N }` when balance too low
- **Transaction Ledger** — Append-only audit trail of all credit movements
- **Signup Bonus** — New users get FREE_CREDITS_ON_SIGNUP credits (configurable)

### 5. Admin Controls
- **API Keys** — Create, revoke, list, update API keys with scoped permissions
- **Registration Codes** — Bulk code generation, usage tracking, code-requirement toggle
- **Kill-Switch** — Emergency button to block all new registrations
- **User Management** — List users (paginated, searchable), disable/enable accounts

## Tech Stack

- **Framework**: NestJS v10+
- **Language**: TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Cache**: Redis (balance cache, job payloads, lock management)
- **Job Queue**: BullMQ (async analysis jobs)
- **Auth**: JWT (primary) + API Keys (services/legacy) + optional cookies
- **Monitoring**: Sentry (errors), Prometheus (metrics)
- **Solana**: `@solana/pay` (checkout), `@solana/web3.js` (RPC), Helius API (webhooks)

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL or PostgreSQL-compatible database
- Redis server
- Helius API key (for Solana RPC)

### Installation

```bash
# Clone and install
git clone <repo>
cd analyzer
npm install

# Setup database
npx prisma generate
npx prisma migrate dev

# Create .env file
cp .env.example .env
# Edit .env with your keys:
#   DATABASE_URL=postgresql://...
#   REDIS_HOST=localhost
#   HELIUS_API_KEY=...
#   JWT_SECRET=<32+ char random>
#   TREASURE_WALLET_ADDRESS=<Solana pubkey>
#   etc.

# Start development server
npm run start:dev
```

Server runs on `http://localhost:3000`. API available at `http://localhost:3000/api/v1`.

## API Structure

**Base URL**: `/api/v1`

**Authentication**: Bearer token (`Authorization: Bearer <access_token>`) or API Key (`X-API-Key: <key>`)

### Main Endpoint Groups

| Prefix | Purpose | Auth | Example |
|--------|---------|------|---------|
| `/auth` | Registration, login, refresh | Public/JWT | `POST /auth/register`, `POST /auth/login` |
| `/users` | Profile, credits, favorites | JWT | `GET /users/me`, `GET /users/me/credits`, `POST /users/me/favorites` |
| `/wallets` | Wallet analysis, search | JWT | `GET /wallets/:address/behavior-analysis`, `GET /wallets/:address/hud` |
| `/analyses` | Analysis queuing | JWT | `POST /analyses/wallets/dashboard-analysis`, `POST /analyses/similarity/queue` |
| `/jobs` | Job status + WebSocket | JWT | `GET /jobs/status/:jobId`, `WS /jobs/events` |
| `/admin` | API keys, codes, users | Admin | `POST /admin/api-keys`, `POST /admin/registration-codes` |
| `/payments` | Credit checkout | JWT | `GET /payments/packs`, `POST /payments/checkout` |
| `/discover` | Public trends | Public | `GET /discover/wallets`, `GET /discover/aggregation` |
| `/wallet-hunts` | Cross-token discovery | JWT | `POST /wallet-hunts`, `POST /wallet-hunts/:id/snapshots` |
| `/health` | System status | Public | `GET /health` |

**Full API docs:** See `src/api/API_DOCUMENTATION.md`

**Architecture & DI:** See `src/api/map.md` (with Mermaid diagrams)

## Key Workflows

### 1. Register & Analyze Wallet

```bash
# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secret123"}'

# Get access token from response
# Use token for subsequent calls: -H "Authorization: Bearer <token>"

# Queue analysis
curl -X POST http://localhost:3000/api/v1/analyses/wallets/dashboard-analysis \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"address":"So...","scope":"flash"}'

# Poll job
curl http://localhost:3000/api/v1/jobs/status/<jobId> \
  -H "Authorization: Bearer <token>"
```

### 2. Buy Credits (Solana Pay)

```bash
# List packs
curl http://localhost:3000/api/v1/payments/packs

# Checkout
curl -X POST http://localhost:3000/api/v1/payments/checkout \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"packId":"starter"}'

# Response includes QR code (base64) + Solana Pay URL
# User scans QR, sends USDC to treasury wallet
# Webhook confirms → credits added automatically
```

### 3. Admin: Create API Key

```bash
# Create key
curl -X POST http://localhost:3000/api/v1/admin/api-keys \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"userId":"...","description":"My service","scopes":["read","write"]}'

# Response includes full API key (save immediately)
# Use key: -H "X-API-Key: <full-key>"
```

## Project Structure

```
src/
├── app.module.ts                    # Root module (global guards, imports)
├── api.module.ts                    # API root (feature modules)
├── api/
│   ├── controllers/                 # 19 controllers (endpoints)
│   ├── modules/                     # Feature modules (wallets, analyses, etc)
│   ├── services/                    # Core business logic
│   ├── shared/
│   │   ├── guards/                  # CompositeAuthGuard, CreditGuard, AdminGuard
│   │   ├── decorators/              # @RequireCredits, @AdminOnly, @Public
│   │   └── interceptors/            # CreditInterceptor
│   └── integrations/                # Helius, Dexscreener, Email
├── queues/
│   ├── processors/                  # BullMQ job handlers
│   ├── queue.module.ts              # Queue infrastructure
│   └── *.queue.ts                   # Queue definitions
├── core/                            # Shared business logic (wallets, analysis math)
├── types/                           # TypeScript interfaces
└── main.ts                          # Server entry point

prisma/
├── schema.prisma                    # Database schema (Prisma ORM)
├── migrations/                      # Database migrations
└── seed.ts                          # Seed script (credit packs, test data)
```

## Configuration

Key environment variables (see `.env.example`):

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/analyzer

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=<32+ char random>
JWT_REFRESH_SECRET=<32+ char random>
JWT_EXPIRES_IN=30m

# Auth
PEPPER_SECRET=<32+ char random>
AUTH_COOKIE_MODE=false
AUTH_COOKIE_NAME=analyzer.sid

# CSRF (only if cookie mode)
CSRF_SECRET=<32+ char random>

# Email
EMAIL_SERVICE_ENABLED=false
EMAIL_FROM=noreply@sova.ai

# Helius (Solana RPC)
HELIUS_API_KEY=<key>
HELIUS_PAYMENT_WEBHOOK_SECRET=<secret>

# Payments (Solana Pay)
TREASURY_WALLET_ADDRESS=<pubkey>
SOLANA_NETWORK=mainnet-beta

# Credits
FREE_CREDITS_ON_SIGNUP=100

# Admin
ADMIN_EMAILS=admin@example.com

# Monitoring
SENTRY_DSN=https://...
```

## Credit System Details

### Cost Model

| Endpoint | Credits | Reason |
|----------|---------|--------|
| `GET /wallets/:addr/behavior-analysis` | 5 | Fast analysis |
| `POST /analyses/wallets/dashboard-analysis` | 10 | Full pipeline (behavior + PnL + token perf) |
| `POST /analyses/similarity/queue` | 100 | Expensive multi-wallet comparison |
| All others | 0 | No credit cost |

### How It Works

1. **Pre-Check** (CreditGuard): Before handler executes, guard checks balance
   - If insufficient → return HTTP 402 with `{ error, balance, required }`
   - If sufficient → continue to handler
2. **Post-Deduct** (CreditInterceptor): After handler succeeds, interceptor deducts credits asynchronously
   - Failed requests don't charge
   - Deduction happens in background (non-blocking)
3. **Audit Trail**: All transactions logged to `CreditTransaction` table (append-only)

### Credit Packs (Seeded)

| Pack | Price | Credits | USD/Credit |
|------|-------|---------|-----------|
| Starter | $15 | 1,000 | $0.015 |
| Builder | $120 | 10,000 | $0.012 |
| Pro | $900 | 100,000 | $0.009 |

## Monitoring & Observability

### Logs
- Standard NestJS logger for application events
- Security logger for authentication/authorization events
- BullMQ logs for job processing

### Metrics
- Prometheus endpoint: `GET /api/v1/metrics`
- Metrics include: request counts, latency, job status, credit deductions
- Scrape with Prometheus (use API key with 'admin' scope)

### Error Tracking
- Sentry integration captures all exceptions
- Custom error context (user ID, endpoint, credits, etc)

### Health Checks
- `GET /health` — Basic status (public)
- `GET /health/detailed` — Comprehensive metrics (admin only)
- `GET /health/queues` — BullMQ queue status (admin only)

## Development

### Run Tests
```bash
npm run test              # Unit tests
npm run test:e2e         # E2E tests
npm run test:watch      # Watch mode
```

### Format & Lint
```bash
npm run format           # Prettier
npm run lint            # ESLint
npm run lint:fix        # Fix issues
```

### Database Migrations
```bash
npx prisma migrate dev --name <name>   # Create migration
npx prisma migrate reset               # Reset to initial state
npx prisma studio                      # GUI database viewer
```

### Seed Database
```bash
npx ts-node prisma/seed.ts            # Run seeds (credit packs, test users, etc)
```

## Deployment

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Generate strong JWT/CSRF secrets (32+ chars random)
- [ ] Enable email service (`EMAIL_SERVICE_ENABLED=true`)
- [ ] Configure Sentry (`SENTRY_DSN`)
- [ ] Set `AUTH_COOKIE_SECURE=true` (HTTPS only)
- [ ] Rotate Helius webhook secret
- [ ] Create treasury wallet (non-hot wallet)
- [ ] Configure PostgreSQL backups
- [ ] Set up Redis persistence
- [ ] Enable rate limiting (review `ThrottlerModule` limits)
- [ ] Set up log aggregation (ELK, Datadog, etc)
- [ ] Test payment webhook integration

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .
RUN npm ci --omit=dev
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
```

```bash
docker build -t sova-intel .
docker run -p 3000:3000 --env-file .env sova-intel
```

## Contributing

1. Create feature branch: `git checkout -b feat/my-feature`
2. Follow [CLAUDE.md](.claude/CLAUDE.md) coding standards
3. Write tests for new features
4. Submit PR with description of changes

## License

Proprietary — Sova Intel, 2026

## Support

- **Documentation**: `src/api/API_DOCUMENTATION.md` (endpoints)
- **Architecture**: `src/api/map.md` (DI structure + diagrams)
- **Issues**: GitHub Issues
- **Email**: support@sova.ai

---

**Version**: 0.18.0+
**Status**: Production (PAY-1/2 complete, X402 pending)
**Last Updated**: 2026-02-24
