# API MAP & STRATEGY

## WHAT YOU HAVE
```
96+ REST endpoints
Full auth (API keys + JWT)
WebSocket (real-time jobs)
Job queue (BullMQ)
Swagger docs (/api-docs)
Prometheus metrics
Rate limiting
```

## API CATEGORIES
```
PUBLIC
├─ /health
├─ /auth (register, login, refresh)
└─ /metrics

AUTHENTICATED
├─ /wallets/{address}/* (summary, pnl, behavior, notes, hud)
├─ /analyses/* (similarity, dashboard, holder-profiles)
├─ /users/me/favorites/* (manage, batch-analyze, collections)
├─ /discover (find wallets)
└─ /token-info

ADMIN
├─ /admin/api-keys
├─ /admin/users
├─ /admin/registration-codes
├─ /jobs/* (queue management)
└─ /security/*

WEBSOCKET
└─ /socket.io/ (job-progress, job-completed, job-failed)
```

## WHAT'S MISSING TO SELL IT

### Critical (Can't monetize without)
- Usage tracking per API key
- Stripe billing integration
- Tier enforcement (free/paid limits)
- TypeScript SDK

### Important (Growth blockers)
- GraphQL endpoint
- Webhook delivery
- Batch request API
- Python SDK

### Nice-to-have
- MCP server
- Ocean Protocol listing
- White-label option
- Rust SDK

## MONETIZATION TIERS

```
EXPLORER (Free)
├─ 1K requests/month
├─ 10 req/min
└─ Basic endpoints only

BUILDER ($79/mo)
├─ 50K requests/month
├─ 60 req/min
└─ All features + WebSocket

PROFESSIONAL ($399/mo)
├─ 500K requests/month
├─ 300 req/min
├─ Webhooks
└─ 99.5% SLA

ENTERPRISE (Custom)
├─ 5M+ requests/month
├─ White-label
└─ On-premise option
```

## REVENUE CHANNELS

```
1. Direct API sales (Stripe subscriptions)
2. SDK marketplace (RapidAPI listing)
3. MCP server (Claude Desktop users)
4. Ocean Protocol (data marketplace)
5. White-label (B2B2C)
```

## 4-WEEK LAUNCH PLAN

```
Week 1-2: Build It
├─ Usage tracking middleware
├─ Stripe integration
└─ Tier enforcement

Week 3: Package It
├─ Generate TypeScript SDK
├─ API self-service portal
└─ Quickstart docs

Week 4: Launch It
├─ Beta test with 10 users
├─ Public launch (Product Hunt)
├─ Reddit/Twitter/Discord
└─ RapidAPI listing
```

## NEXT ACTIONS (DO THESE FIRST)

1. Add `ApiUsage` + `Subscription` tables to Prisma
2. Build usage tracking middleware
3. Integrate Stripe checkout
4. Generate SDK from OpenAPI spec
5. Create /api-keys dashboard page
6. Soft launch to existing users

## KEY METRICS

```
Month 1: 10 paid users, $1K MRR
Month 3: 100 paid users, $12K MRR
Month 6: 500 paid users, $60K MRR
Month 12: 2,500 paid users, $320K MRR
```

## COMPETITIVE EDGE

- Behavioral analysis (unique)
- Similarity matching (no one else has this)
- Real-time WebSocket (better UX)
- MCP integration (future-proof)
- Solana-native depth

## DISTRIBUTION STRATEGY

```
Month 1-2: Direct (your users, Twitter, Reddit)
Month 3-4: Marketplaces (RapidAPI, APILayer)
Month 5-6: MCP server (Claude Desktop)
Month 7+: Ocean Protocol, partnerships
```

## RISKS

- Helius dependency (cost risk)
- Competition from Helius/SimpleHash
- Compute costs for deep analysis
- Need 67 users to break even ($8K fixed costs)

## RECOMMENDED PATH

**Go all-in on API-first:**
1. Your API is production-ready NOW
2. Frontend proved demand
3. Better margins (85-90%)
4. Multi-channel distribution
5. Scales infinitely

**Avoid:** More frontend features, heavy docs, Ocean Protocol first

**Focus:** Usage tracking → Stripe → SDK → Launch
