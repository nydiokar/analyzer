# MONETIZABLE API MAP - What Actually Makes Money

## 💰 PREMIUM ENDPOINTS (High Value)

### Wallet Intelligence (Core Product)
```
GET  /wallets/{address}/summary          [MONEY MAKER]
├─ Returns: PnL, win rate, behavior, classification
├─ Compute Cost: LOW (cached data)
├─ Value: HIGH (instant insights)
└─ Pricing: 2 credits

GET  /wallets/{address}/behavior-analysis [MONEY MAKER]
├─ Returns: Trading style, patterns, risk profile
├─ Compute Cost: LOW (cached)
├─ Value: VERY HIGH (unique analysis)
└─ Pricing: 5 credits

GET  /wallets/{address}/pnl-overview      [MONEY MAKER]
├─ Returns: Detailed P&L breakdown, trade metrics
├─ Compute Cost: MEDIUM (database aggregation)
├─ Value: HIGH (financial insights)
└─ Pricing: 3 credits

GET  /wallets/{address}/token-performance [MONEY MAKER]
├─ Returns: Token-by-token performance (paginated)
├─ Compute Cost: LOW-MEDIUM (depends on page size)
├─ Value: HIGH (trade history)
└─ Pricing: 2 credits per page
```

### Deep Analysis (Premium Jobs)
```
POST /analyses/wallets/dashboard-analysis [PREMIUM]
├─ Scopes: flash (2min) | working (5min) | deep (15min)
├─ Compute Cost: HIGH (Helius RPCs, heavy processing)
├─ Value: VERY HIGH (fresh analysis)
├─ Pricing: flash=10 credits | working=25 credits | deep=50 credits
└─ Returns: jobId → monitor via WebSocket

POST /analyses/similarity/queue           [PREMIUM]
├─ Compares 2-30 wallets for similar behavior
├─ Compute Cost: VERY HIGH (multi-wallet processing)
├─ Value: UNIQUE (no competitors have this)
└─ Pricing: 100 credits base + 10 per wallet

POST /analyses/holder-profiles            [PREMIUM]
├─ Analyzes top N holders of a token
├─ Compute Cost: HIGH (N wallet analyses)
├─ Value: HIGH (token research)
└─ Pricing: 50 credits + 5 per holder analyzed
```

### Token Data (Utility)
```
POST /token-info                          [UTILITY]
├─ Returns: Token metadata (name, symbol, supply)
├─ Compute Cost: LOW (cached, fire-and-forget enrichment)
├─ Value: MEDIUM (supporting data)
└─ Pricing: 1 credit

GET  /token-info/{mint}/top-holders       [UTILITY]
├─ Returns: Top holders list
├─ Compute Cost: MEDIUM (Helius RPC)
├─ Value: MEDIUM (whale tracking)
└─ Pricing: 5 credits
```

## 🎁 FREE ENDPOINTS (Loss Leaders)

### Discovery (Hook Users)
```
GET /discover/wallets                     [FREE]
├─ Purpose: Get users interested
├─ Limit: 20 results, cached 2min
└─ Upsell: "Want more? Upgrade!"

GET /wallets/search                       [FREE]
├─ Purpose: Let users find wallets
├─ Limit: Basic search only
└─ Upsell: "Analyze this wallet →"
```

### User Management (Free)
```
POST /auth/register, /auth/login          [FREE]
GET  /auth/me                             [FREE]
GET  /users/me/favorites                  [FREE to list]
POST /users/me/favorites                  [CONSUMES CREDITS]
```

## 🔧 ADMIN ENDPOINTS (Internal)
```
/admin/*                                  [ADMIN ONLY]
/jobs/*                                   [ADMIN ONLY]
/security/*                               [ADMIN ONLY]
```

## 📊 CREDIT SYSTEM DESIGN

### Request-Based Credits
```
Simple GET (cached):        1-5 credits
Complex GET (computed):     5-10 credits
Background Job (light):     10-50 credits
Background Job (heavy):     50-200 credits
```

### Why Credits > Requests?
- Different endpoints have VASTLY different costs
- `/summary` hits cache (cheap)
- `/dashboard-analysis` hits Helius 100+ times (expensive)
- Credits = fair pricing based on actual compute

### Credit Tiers (Proposal)
```
EXPLORER (Free)
├─ 100 credits/month
├─ Can do: 50 summaries OR 10 deep analyses OR 2 similarities
└─ Goal: Let them taste the product

BUILDER ($79/mo)
├─ 5,000 credits/month
├─ Can do: Mix of endpoints
├─ Overage: $0.02/credit
└─ Target: Indie devs, small tools

PROFESSIONAL ($399/mo)
├─ 50,000 credits/month
├─ Overage: $0.015/credit
├─ All features unlocked
└─ Target: Trading platforms, funds

ENTERPRISE (Custom)
├─ 500K+ credits/month
├─ Custom credit pricing
├─ Dedicated infrastructure
└─ Target: Exchanges, institutions
```

## 🚀 WHAT'S ACTUALLY UNIQUE (MOAT)

### 1. Behavioral Analysis (NO COMPETITORS)
```
/wallets/{address}/behavior-analysis

Returns:
- Trading style classification
- Risk profile (flipper vs holder)
- Consistency metrics
- Exit timing patterns
- Strategic tags

Competitors offer: Balance tracking only
You offer: Behavioral AI
```

### 2. Similarity Analysis (UNIQUE)
```
/analyses/similarity/queue

Input: Array of wallet addresses
Output: How similar their trading behavior is

Use cases:
- Find copycat wallets
- Detect coordinated behavior
- Cluster analysis for funds
- Sybil detection

NO ONE ELSE HAS THIS
```

### 3. Holder Profile Analysis (DIFFERENTIATOR)
```
/analyses/holder-profiles

Input: Token mint
Output: Risk profiles of top holders

Use cases:
- Is this token held by bots?
- Are holders flippers or diamond hands?
- Rug risk assessment

Others: Show holder balances
You: Show holder BEHAVIOR
```

## 🔌 PLUG ARCHITECTURE (Multi-Payment Ready)

### Current State
```
Request → Auth (API Key/JWT) → Rate Limit → Controller → Response
```

### Target State (Payment Agnostic)
```
Request
  ↓
Auth Layer (who are you?)
  ↓
Credit Check (do you have credits?)  ← PLUG HERE
  ↓
Credit Deduct (charge credits)       ← PLUG HERE
  ↓
Rate Limit (anti-abuse)
  ↓
Controller (business logic)
  ↓
Response
```

### Payment Plug Interface
```typescript
interface PaymentProvider {
  // Check if user has enough credits
  checkCredits(userId: string, cost: number): Promise<boolean>;

  // Deduct credits after successful request
  deductCredits(userId: string, cost: number, metadata: any): Promise<void>;

  // Get user's current balance
  getBalance(userId: string): Promise<number>;
}

class StripePaymentProvider implements PaymentProvider {
  // Stripe metered billing
}

class CryptoPaymentProvider implements PaymentProvider {
  // HTTP 402 / blockchain payments
}

class L402PaymentProvider implements PaymentProvider {
  // Lightning Network payments
}

class MCPPaymentProvider implements PaymentProvider {
  // MCP tool usage billing
}
```

### Implementation Strategy
```
1. Create PaymentService abstraction
2. Implement StripeProvider first (fastest to market)
3. Add decorator: @RequireCredits(10)
4. Middleware deducts on success
5. Later: Swap provider via env var

Example:
@Get(':address/summary')
@RequireCredits(2)  ← Just add this
async getSummary() { ... }

Done. Works with ANY payment provider.
```

## 🎯 PLUG COMPATIBILITY ANALYSIS

### Stripe (90% Compatible NOW)
```
✅ User accounts exist
✅ API key system exists
✅ Request tracking possible
❌ Need: Usage metering API integration
❌ Need: Webhook handlers
Time to implement: 1 week
```

### HTTP 402 / Crypto (70% Compatible)
```
✅ Request/response flow works
✅ Can add payment headers
❌ Need: Lightning/crypto wallet integration
❌ Need: Payment verification logic
Time to implement: 2-3 weeks
```

### MCP Server (95% Compatible NOW)
```
✅ REST API perfect for MCP tools
✅ JSON in/out works perfectly
✅ Auth via env vars (API key)
❌ Need: Create MCP server wrapper (4 hours)
❌ Need: Tool definitions (2 hours)
Time to implement: 1 day
```

### Ocean Protocol (60% Compatible)
```
✅ Can export data as datasets
✅ REST endpoints work as compute-to-data
❌ Need: Ocean smart contract integration
❌ Need: Data asset creation
Time to implement: 3-4 weeks
```

## 🔥 IMMEDIATE ACTIONS (Priority Order)

### Week 1: Make It Sellable
```
1. Add credit cost to each endpoint (decorator)
2. Create credits tracking table
3. Build credit check middleware
4. Add /users/me/credits endpoint
5. Test credit deduction flow
```

### Week 2: Stripe Integration
```
1. Stripe account setup
2. Create subscription products
3. Webhook handlers (payment events)
4. Credit top-up flow
5. Usage dashboard
```

### Week 3: SDK + MCP
```
1. Generate TypeScript SDK from OpenAPI
2. Publish to NPM
3. Create MCP server wrapper
4. Test with Claude Desktop
5. Submit to MCP directory
```

### Week 4: Launch
```
1. Soft launch to 10 beta users
2. Iterate on pricing
3. Public launch (Product Hunt)
4. Reddit/Twitter marketing
5. RapidAPI listing
```

## 📈 PRICING STRATEGY (Final)

### Credit Costs Per Endpoint
```
TIER 1: Free Data (1 credit)
├─ /discover/wallets
├─ /wallets/search
└─ /token-info

TIER 2: Cached Insights (2-5 credits)
├─ /wallets/{address}/summary (2)
├─ /wallets/{address}/token-performance (2)
├─ /wallets/{address}/pnl-overview (3)
├─ /wallets/{address}/classification (2)
└─ /wallets/{address}/hud (3)

TIER 3: Computed Analysis (5-10 credits)
├─ /wallets/{address}/behavior-analysis (5)
├─ /token-info/{mint}/top-holders (5)
└─ /wallets/{address}/exit-timing-tokens/* (3)

TIER 4: Background Jobs (10-50 credits)
├─ /analyses/wallets/dashboard-analysis
│   ├─ flash: 10 credits
│   ├─ working: 25 credits
│   └─ deep: 50 credits
├─ /analyses/holder-profiles (50 + 5/holder)
└─ /users/me/favorites (auto-analysis: 10)

TIER 5: Heavy Compute (100+ credits)
└─ /analyses/similarity/queue (100 + 10/wallet)
```

### Monthly Plans
```
FREE: 100 credits
├─ 50 summaries
├─ 20 behavior analyses
├─ 2 deep analyses
└─ 0 similarities

BUILDER: $79 = 5,000 credits
├─ 2,500 summaries
├─ 1,000 behavior analyses
├─ 100 deep analyses
└─ 10 similarities (2-wallet)

PRO: $399 = 50,000 credits
├─ Basically unlimited cached endpoints
├─ 1,000 deep analyses
└─ 100+ similarities

ENTERPRISE: Custom
├─ 500K+ credits
├─ Volume discounts
└─ Custom pricing
```

## 🎪 DISTRIBUTION CHANNELS (Ranked)

### 1. Direct API (Own Website)
```
Control: 100%
Margin: 100%
Effort: Low (already built)
Revenue Potential: HIGH
Action: Just add Stripe
```

### 2. MCP Server (Claude Desktop)
```
Control: 80%
Margin: 100%
Effort: Very Low (1 day)
Revenue Potential: MEDIUM
Distribution: Millions of Claude users
Action: Wrap API in MCP, use Stripe for billing
```

### 3. RapidAPI Marketplace
```
Control: 60%
Margin: 80% (RapidAPI takes 20%)
Effort: Low (just list it)
Revenue Potential: MEDIUM
Distribution: Large developer audience
Action: List next week
```

### 4. Ocean Protocol
```
Control: 50%
Margin: 70-90%
Effort: HIGH (3-4 weeks)
Revenue Potential: LOW-MEDIUM
Distribution: Niche crypto audience
Action: Do later (month 3-4)
```

### 5. White-Label Partners
```
Control: 40%
Margin: 30% (give partners 70%)
Effort: MEDIUM (2 weeks)
Revenue Potential: HIGH (if you find good partners)
Action: After product/market fit
```

## ✅ FINAL ANSWER: Can You Achieve Plug Architecture?

### YES - 95% Ready

**What you have:**
- Clean REST API (perfect for any client)
- OpenAPI spec (SDK generation ready)
- API key system (swap auth easily)
- Request/response flow (stateless, pluggable)
- Job queue system (async = any payment protocol)

**What you need:**
- Payment abstraction layer (1 week)
- Credit tracking system (1 week)
- Provider implementations (1-4 weeks each)

**Architecture:**
```
Your API (unchanged)
     ↓
Payment Middleware (new - 1 week)
     ↓
PaymentProvider Interface
     ├─ StripeProvider (1 week)
     ├─ L402Provider (2 weeks)
     ├─ CryptoProvider (3 weeks)
     └─ MCPProvider (1 day - uses Stripe under hood)
```

**Recommendation:**
1. Build credit system (week 1)
2. Ship with Stripe (week 2)
3. Add MCP (week 3)
4. Later: L402, Ocean Protocol

You're not missing pieces - you just need payment middleware. Everything else is already plug-ready.
