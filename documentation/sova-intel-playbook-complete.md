# SOVA INTEL — Competitive Analysis & Dissemination Playbook

**Prepared: March 18, 2026**
**Status: Working Document — Start Executing**

---

# TABLE OF CONTENTS

1. [Competitor Matrix](#1-competitor-matrix)
2. [Moat Analysis](#2-moat-analysis)
3. [Attack Vectors](#3-attack-vectors)
4. [AI Agent Specialist Definitions](#4-ai-agent-specialist-definitions)
5. [30-Day Execution Playbook](#5-30-day-execution-playbook)

---

# 1. COMPETITOR MATRIX

## 1.1 Product Summary

Sova Intel is a **behavioral intelligence API for Solana wallets**. It classifies wallets into structured trader types (Sniper, Scalper, Momentum, Intraday, Day Trader, Swing, Position, Hodler) based on completed exit cycles, provides data quality confidence tiers (GOLD/SILVER/BRONZE/INSUFFICIENT), detects coordinated wallet clusters via pairwise similarity scoring, and profiles token holders by behavioral type. Delivered as a REST API with x402 autonomous payment support, a TypeScript SDK, a dashboard, and Telegram/Twitter bot integrations.

## 1.2 Feature Comparison

| Feature | Sova Intel | Nansen | Birdeye (BDS) | Arkham | GMGN.ai | Cielo Finance | Solsniffer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Behavioral taxonomy** (8-type: Sniper→Hodler) | **YES** | NO | NO | NO | NO | NO | NO |
| **Hold time / speed category** | **YES** | NO | NO | NO | NO | NO | NO |
| **Exit pattern classification** (partial vs all-at-once) | **YES** | NO | NO | NO | NO | NO | NO |
| **Data quality / confidence tiers** | **YES** | NO | NO | NO | NO | NO | NO |
| **Wallet similarity scoring** (Jaccard + capital-weighted) | **YES** | NO | NO | NO | NO | NO | NO |
| **Token holder behavioral profiles** | **YES** | Partial¹ | NO | NO | NO | NO | NO |
| **Wallet PnL** (realized + unrealized) | YES | YES | YES | YES | YES | YES | NO |
| **Win rate** | YES | YES | YES | YES | YES | YES | NO |
| **Bot / whale flags** (structured, threshold-based) | YES | Partial | NO | Partial | Partial | NO | NO |
| **Batch wallet scoring** (up to 30) | YES | YES | NO | NO | NO | NO | NO |
| **API-first** (structured JSON) | YES | YES | YES | YES | NO | YES | YES |
| **x402 autonomous payment** | **YES** | YES | NO | NO | NO | NO | NO |
| **AI agent skill descriptor** (skill.md) | **YES** | NO | NO | NO | NO | NO | NO |
| **TypeScript SDK** | YES | NO | NO | NO | NO | NO | NO |
| **Multi-chain support** | NO | YES (30+) | YES (10) | YES (18+) | YES (5) | YES (30+) | NO |
| **Real-time alerts / notifications** | NO | YES | YES | YES | YES | YES | NO |
| **Integrated DEX trading** | NO | YES | NO | YES | YES | YES | NO |
| **Entity labeling** (funds, exchanges, teams) | NO | YES (500M+) | NO | YES | NO | NO | NO |
| **Exchange flow tracking** (CEX in/out) | NO | YES | NO | YES | NO | NO | NO |
| **Token security scoring** | NO | NO | NO | NO | NO | NO | YES |

¹ Nansen shows holder distribution and PnL leaderboard per token but does not classify each holder's behavioral type, exit pattern, or confidence tier.

## 1.3 Pricing Comparison

| Provider | Free Tier | Entry Paid | Mid Tier | Model | Per-Wallet Cost |
|---|---|---|---|---|---|
| **Sova Intel** | Bonus credits on signup | $15 / 1,000 credits | $120 / 10K credits ($0.012/cr) | Pay-per-call + x402 | $0.015 (HUD) / $0.075 (full) |
| **Nansen** | Limited (100 API credits, basic features) | $49/mo (annual) or $69/mo | $69/mo is the only paid tier | Subscription + API credits | Bundled; credits vary by endpoint |
| **Birdeye (BDS)** | 30K compute units | $39/mo (1.5M CUs) | $199/mo (15M CUs) | Subscription + CU overage | CU-based, varies by endpoint |
| **Arkham** | Free platform access | API credit-based (not fully public) | Custom | Free + credits | Not transparent |
| **GMGN.ai** | Free platform | Trading API by application only | N/A | Free platform, trading fees | No analytics API pricing |
| **Cielo Finance** | 250 wallets, 10 Solana | $59/mo (Pro, annual) | $199/mo (Whale, annual) | Subscription tiers | Bundled in subscription |
| **Solsniffer** | Free basic checks | API access by contact | Enterprise | Custom | Not transparent |

**Sova Intel pricing advantage:** Pure pay-per-call with no subscription floor. A developer pays $0.015 per wallet HUD check — zero commitment, zero subscription. x402 means autonomous agents can pay per-call with no account setup. This is the cheapest entry point for programmatic wallet intelligence in the market.

## 1.4 Distribution & Reach Comparison

| Provider | Est. Users | Primary Channels | API Availability | Developer Ecosystem |
|---|---|---|---|---|
| **Nansen** | 100K+ | Web app, API, MCP, mobile | Full REST API | Large; $75M Series B funded |
| **Birdeye (BDS)** | 500K+ (consumer app) | Web app, API, WebSocket | 60+ endpoints | Large; powers Phantom, Raydium, Coinbase |
| **Arkham** | 200K+ | Web platform, API, exchange | REST API | Growing; pivoting to exchange |
| **GMGN.ai** | 100K+ | Web, Telegram bot, mobile app | Trading API only (by application) | Small; closed ecosystem |
| **Cielo Finance** | 500K+ (4M wallets tracked) | Web app, Telegram/Discord bots, API | REST API (Whale tier) | Medium; growing |
| **Solsniffer** | 70K+ | Web app, API | Enterprise API | Small |
| **Sova Intel** | Early stage | API, Dashboard, Telegram bot, Twitter bot | Full REST API + x402 + SDK | **Building** |

---

# 2. MOAT ANALYSIS

## 2.1 What Sova Intel Has That Nobody Else Has

### MOAT 1: Structured Behavioral Taxonomy via API

**Claim:** Sova Intel is the only product that classifies Solana wallets into a structured 8-type behavioral taxonomy (Sniper, Scalper, Momentum, Intraday, Day Trader, Swing, Position, Hodler) based on median hold times from completed exit cycles, delivered as structured API fields.

**Evidence:**
- Nansen labels wallets as "Smart Trader," "Fund," "Whale" — these are identity/reputation labels, not behavioral classifications. Their API returns `labels` arrays, not `behaviorCode` fields with hold-time-based categories. Source: Nansen API reference (docs.nansen.ai) — Profiler endpoints return balances, PnL, transactions, counterparties, and labels. No behavioral type classification.
- Birdeye Data Services offers Wallet PnL (realized/unrealized), trade counts, and a "Trader Profile" endpoint — but returns financial metrics, not behavioral classification. No hold time categories, no speed taxonomy. Source: BDS changelog (August 2025) and API docs.
- Arkham provides entity labeling and "Ultra" AI clustering (grouping wallets by entity), plus intent detection (sell vs. collateral). But no trader-type taxonomy. Source: Arkham 2026 feature updates (Bitget Academy review).
- GMGN tracks insider wallets, snipers, and first buyers — but "sniper" is a binary label based on buy timing, not a behavioral classification derived from exit cycle analysis across the wallet's full history.
- Cielo ranks wallets by PnL and win rate in discovery, but does not classify behavioral type.
- No product reviewed assigns `exitPattern: "partial_exit" | "all_at_once"` or `speedCategory: "medium"` as structured fields.

**Why it's defensible:** Building this requires (a) ingesting and parsing full transaction histories, (b) identifying completed buy-sell exit cycles per token, (c) computing median hold times across cycles, (d) applying threshold-based classification, and (e) exposing it as a real-time API with caching and freshness logic. This is months of data engineering work. A larger player could build it, but it's not a weekend project — and they'd need to prioritize it over their existing feature roadmap.

**Estimated time for a competitor to replicate:** 3–6 months for a well-resourced team (Nansen, Birdeye) if they chose to prioritize it. Longer for smaller players.

### MOAT 2: Explicit Data Quality / Confidence Tiers

**Claim:** Sova Intel is the only product that returns a structured confidence assessment (GOLD/SILVER/BRONZE/INSUFFICIENT) based on completed cycle count for every wallet analysis.

**Evidence:**
- No competitor reviewed returns a `dataQualityTier` or equivalent confidence field on wallet profiles.
- Nansen's labels have implicit confidence (institutional wallets are higher confidence than individual trader labels, per their own documentation: "Individual trader labels rely on historical profitability patterns, which are probabilistic rather than certain"), but this is not exposed as a structured field.
- Birdeye, Arkham, GMGN, Cielo — none return confidence scoring on individual wallet assessments.

**Why it matters:** This is a trust signal. When your API says "BRONZE — treat with caution," it's telling the consumer not to over-rely on thin data. This is especially valuable for automated systems (bots, agents) that need to programmatically decide how much to trust a signal. Nobody else provides this, which means every other platform's wallet data is presented with implicit 100% confidence — which is misleading.

### MOAT 3: Wallet Similarity as a Dedicated Analytical Endpoint

**Claim:** Sova Intel is the only product offering pairwise wallet similarity scoring (Jaccard binary + capital-weighted) with cluster detection as a dedicated API endpoint.

**Evidence:**
- Nansen has "Related Wallets" in their Profiler API — but this shows addresses associated with a single wallet, not pairwise similarity scores across a user-defined group of 2–30 wallets.
- Arkham clusters wallets by entity using their "Ultra" AI, but this is entity resolution (who owns this?), not behavioral similarity scoring (do these wallets trade alike?).
- Solsniffer mentions "clustering analysis" for manipulation detection, but this is part of their token security scoring, not an exposed API endpoint for arbitrary wallet comparison.
- No competitor returns `binaryScore`, `capitalScore`, `sharedTokenCount`, or `globalMetrics.averageSimilarity` across a user-defined wallet set.

**Why it's defensible:** The similarity endpoint requires pre-computed token-holding vectors for each wallet, an efficient pairwise comparison algorithm that scales to 30-wallet groups (435 pairs), and both binary and capital-weighted scoring. This is a distinct analytical product, not a feature that falls out of existing wallet tracking.

### MOAT 4: Agent-Native Architecture (x402 + skill.md)

**Claim:** Sova Intel is the only Solana wallet intelligence API designed for autonomous AI agent consumption from the ground up, with x402 payment and a machine-readable skill descriptor.

**Evidence:**
- Nansen recently added x402 support (per their API case study with Corbits), making them the only other player in this specific niche with x402. However, Nansen does not publish a skill.md descriptor for agent discovery.
- No other competitor (Birdeye, Arkham, GMGN, Cielo, Solsniffer) supports x402 or publishes a machine-readable skill descriptor.
- Sova Intel's skill.md at `sova-intel.com/skill.md` allows any x402-capable agent to discover the API, understand its capabilities, and pay per-call — zero registration, zero API key.

**Why it's defensible:** This is forward-positioning for the AI agent economy. The defensibility comes from being early — once agents learn to use Sova Intel for behavioral intelligence, switching costs emerge through prompt/workflow lock-in. First-mover advantage matters here.

## 2.2 Key Vulnerabilities

| Vulnerability | Severity | Mitigation |
|---|---|---|
| **Nansen adds behavioral classification** | HIGH | Move fast on distribution. Build brand association: "behavioral intelligence = Sova Intel." |
| **Solana-only limits addressable market** | MEDIUM | Solana is the dominant memecoin/degen chain. This is fine for now. Multi-chain later. |
| **Limited historical data depth** | MEDIUM | Frame as "current behavioral snapshot" with honest confidence tiers. Expand history depth as revenue allows. |
| **No real-time alerts** | LOW | Not your core value prop. Cielo/Nansen do this. You do intelligence, not monitoring. |
| **Small user base** | HIGH | The primary problem to solve. Everything in Section 3–5 addresses this. |

## 2.3 Differentiation Window

**Estimated window of clear differentiation: 6–9 months.**

Nansen is the most likely competitor to add behavioral classification. They have the data (500M+ labeled addresses), the engineering team, and the API infrastructure. However, they are currently focused on (a) integrated trading, (b) NXP points/token incentives, and (c) multi-chain expansion. Behavioral classification is unlikely to be their top priority in Q2 2026. Birdeye is focused on data infrastructure breadth (new chains, WebSocket, market data). Arkham is building an exchange.

This window closes faster if Sova Intel gains visible traction — success attracts imitation. Use the window to build distribution and brand, not more features.

---

# 3. ATTACK VECTORS

## Vector 1: Crypto Twitter Visibility (Dashboard + Twitter Bot)

### Customer Location
Crypto Twitter (X). Specifically: Solana memecoin traders, token analysts, rug-pull investigators, alpha callers, and KOL followers. These people spend hours daily on X, share wallet screenshots, investigate new tokens, and call out coordinated wallets. They number in the tens of thousands of active daily users on Solana CT alone.

### Entry Mechanism

**Primary asset: The Twitter bot (@Sova_intel) producing shareable visual cards.**

Two content formats:

**Format A — Token Holder Distribution (already built):**
User or bot posts a token mint → Sova Intel replies with the behavioral distribution chart (Sniper/Scalper/Momentum/etc. bar chart with hold time ranges). This answers "who holds this token and are they likely to dump?"

**Format B — Individual Wallet Profile Card (to build):**
User or bot posts a wallet address → Sova Intel replies with a profile card showing behavioral type, win rate, PnL, confidence tier, hold time, bot/whale flags, exit pattern. This answers "what kind of trader is this wallet?"

**On the data limitation for individual wallets:** The current system analyzes recent transactions (~1,000–1,500 txns), not full history. For very active wallets (bots), this may only cover 1–2 days. **This is fine.** Frame it explicitly: "Current behavioral snapshot based on recent activity. Confidence: GOLD/SILVER/BRONZE/INSUFFICIENT." The confidence tier IS the answer to this limitation. A BRONZE result on a bot wallet is honest and useful — it tells the user "I can see this wallet but I don't have enough exit cycles to classify it confidently." Nobody else gives this signal at all.

**Rate limiting for cost control:** Start with 20–30 free lookups per day via the Twitter bot. Enough for organic usage and content generation. Not enough for someone to scrape your entire database through Twitter.

### Conversion Path

```
Organic CT user sees shareable Sova Intel card in their feed
  → Visits sova-intel.com to try it themselves
  → Signs up, gets bonus credits
  → Uses dashboard for personal analysis
  → Power users discover API docs
  → Builds bot/tool using API → buys credit packs
```

**Secondary conversion:** CT traders who see Sova Intel cards start requesting them in group chats and communities. "Check this wallet on Sova" becomes a verb. Brand association builds.

### Key Metrics
- Impressions per week on @Sova_intel posts
- Organic mentions ("check this on Sova Intel") per week
- Dashboard signups from X referral traffic
- Bot invocations per day (if opened publicly)

### Cost
- Twitter API costs for bot operation (primary expense)
- Your time for content curation (1–2 hours/day initially, then delegate to content agent)

---

## Vector 2: Developer / Builder Adoption (API)

### Customer Location
Solana developers building: trading bots (Telegram, Discord), copy-trade platforms, token analysis dashboards, portfolio trackers, alpha group tools, and on-chain analytics products. Found on: X/Twitter (dev accounts), GitHub (Solana repos), Telegram groups (Solana dev communities), and ecosystem directories (Solana Compass, Alchemy dapp store).

### Entry Mechanism

**Step 1: Integration content (guides that ARE marketing)**

Three guides, published on docs.sova-intel.com AND posted as X threads:

1. **"Add wallet intelligence to your Telegram trading bot in 10 minutes"** — Shows how to use the SDK to call the HUD endpoint and display behavioral type + win rate inline in a Telegram bot. Code-complete, copy-paste-ready.

2. **"Check token holder quality before aping — a developer guide"** — Shows how to call the holder profiles endpoint, parse the behavioral distribution, and surface red flags (80% snipers = dump incoming). Includes a working example.

3. **"Detect coordinated wallets with 5 lines of code"** — Shows the similarity endpoint, how to interpret Jaccard + capital scores, and how to flag clusters. This is the "catching cabals" guide — extremely shareable on CT.

**Step 2: Direct outreach to 20 builders**

Identify 20 people on X/GitHub who are building Solana trading tools. DM each one personally:

> "Hey — I built an API that classifies Solana wallets by trading behavior (Sniper, Scalper, Swing Trader, etc.) and detects coordinated wallet clusters. Free credits to try it. Would this be useful for [their specific project]?"

This is not spam. This is product-market fit research that also drives adoption.

**Step 3: Directory listings**

List Sova Intel on:
- Solana Compass (solanacompass.com) — project listing
- Alchemy dapp store — analytics tools category
- QuickNode marketplace — if applicable
- awesome-solana GitHub lists
- Any Solana ecosystem directory that accepts submissions

**Step 4: Generous free tier**

Ensure the bonus credits on signup cover at least 50–100 HUD calls and 5–10 full profiles. A developer needs to build a working prototype without worrying about credits. The conversion happens when they go to production and need sustained API access.

### Conversion Path

```
Developer reads integration guide or receives DM
  → Signs up, gets free credits
  → Integrates HUD endpoint into their tool
  → Tool goes live → sustained API calls
  → Developer buys credit packs ($15–$900)
  → Their tool becomes Sova Intel distribution (their users see Sova data)
```

### Key Metrics
- API signups per week
- Active API consumers (≥1 call/week)
- Daily API call volume
- Credit pack purchases
- Third-party tools/bots using Sova Intel (public integrations)

### Cost
- Your time for guide writing (or delegate to Technical Writer Agent — see Section 4)
- Your time for 20 DMs (cannot be delegated — you are the builder, your credibility sells)
- Free credits given away (~$15–30 worth per developer, invest in 20–50 developers = $300–1,500)

---

## Vector 3: AI Agent Ecosystem (x402 + skill.md + frameworks)

### Customer Location
AI agent developers and framework maintainers. Found on: GitHub (agent framework repos), X (AI x crypto intersection), Discord servers for ElizaOS/ai16z, Langchain community, and the growing autonomous agent ecosystem on Solana. Also: any x402-capable agent that discovers your skill.md — these are machines, not humans, and they're already your customers if they can find you.

### Entry Mechanism

**Step 1: Framework integrations (the multiplier)**

Build and publish tool wrappers for:

| Framework | What to Build | Where to Publish |
|---|---|---|
| **ElizaOS (ai16z)** | Plugin/tool that wraps Sova Intel endpoints | ElizaOS plugin registry / GitHub |
| **Langchain / LangGraph** | Custom tool class for Sova Intel | PyPI package + Langchain docs |
| **CrewAI** | Tool definition for Sova Intel | CrewAI tool registry |
| **Vercel AI SDK** | Tool provider for Sova Intel | npm package |
| **MCP (Model Context Protocol)** | MCP server exposing Sova Intel endpoints | GitHub + MCP tool registries |

Each integration = thousands of agents potentially discovering and paying for your API automatically. This is the highest-leverage distribution channel because it scales without human effort once published.

**Step 2: Demo agent (the showcase)**

Build and open-source a demo agent that:
1. Monitors new token launches on Pump.fun (or trending tokens on DexScreener)
2. Automatically calls Sova Intel's holder profiles endpoint for the top 20 holders
3. Generates a summary: "New token $XYZ — 7/10 top holders are SNIPERS, 2 are BOTS. BRONZE confidence. Proceed with caution."
4. Posts to X or Telegram

This agent IS marketing. It demonstrates real-time value. And its source code becomes a tutorial for other developers.

**Step 3: Agent hackathon (week 6–8 amplifier)**

Host a "Build with Sova Intel" challenge. Inspired by Mert (Helius) hosting Claude Code hackathons:
- Provide free API credits to participants
- Agents and/or humans compete to build the best tool using Sova Intel
- Winning entries get featured and potentially integrated
- All entries become showcase projects

Don't rush this — do it after you have the framework integrations and demo agent in place, so participants have examples to build from.

### Conversion Path

```
Agent framework user discovers Sova Intel tool/plugin
  → Installs plugin in their agent
  → Agent calls Sova Intel API (paid via x402 or API key)
  → Each agent invocation = API revenue
  → Agent developer shares their agent → more agents discover Sova Intel
```

```
x402-capable agent discovers skill.md
  → Reads endpoint descriptions and pricing
  → Calls API, pays per-call via x402
  → Zero human intervention required
  → Agent scales → API calls scale → revenue scales
```

### Key Metrics
- Framework integrations published (target: 3–5)
- Agent-originated API calls per day
- x402 payment transactions per week
- GitHub stars on tool wrappers / demo agent
- Hackathon submissions (if/when run)

### Cost
- Engineering time to build tool wrappers (or delegate to Integration Agent — see Section 4)
- Free credits for hackathon participants
- Negligible ongoing cost — once published, integrations maintain themselves

---

# 4. AI AGENT SPECIALIST DEFINITIONS

These are the three AI agent "roles" you need to operate to execute this playbook with minimal human headcount. Each definition includes the agent's purpose, system prompt structure, required tools, and expected outputs.

---

## Agent 1: Technical Content Writer

### Purpose
Produces integration guides, API tutorials, comparison pages, and developer-facing documentation that doubles as marketing content. Publishes to docs site and drafts X threads.

### System Promptx

```
You are the Technical Content Writer for Sova Intel, a Solana wallet behavioral 
intelligence API. Your job is to create developer-facing content that is both 
technically accurate and compelling enough to drive API adoption.

CONTEXT:
- Sova Intel API docs: https://docs.sova-intel.com/
- TypeScript SDK: @sova-intel/sdk on npm
- Base URL: https://api.sova-intel.com/api/v1
- Key endpoints: /intel/wallet/:addr (full profile, 5cr), /intel/wallet/:addr/hud 
  (quick signal, 1cr), /intel/wallet/:addr/tokens (per-token PnL, 3cr), 
  /intel/wallets/batch-hud (batch scoring, 5cr), /intel/token/:mint/holders 
  (holder profiles, 20cr), /intel/wallets/similarity (similarity analysis, 20cr)
- Behavioral types: SNIPER (<1min), SCALPER (1-5min), MOMENTUM (5-30min), 
  INTRADAY (30min-4hr), DAY_TRADER (4-24hr), SWING (1-7d), POSITION (7-30d), 
  HODLER (30d+)
- Data quality tiers: GOLD (10+ cycles), SILVER (5-9), BRONZE (3-4), 
  INSUFFICIENT (<3)
- Auth: X-Api-Key header or x402 Solana USDC payment

YOUR STYLE:
- Write like a developer talking to another developer. No fluff.
- Every guide must include working code examples (TypeScript preferred, curl 
  as fallback).
- Lead with the problem being solved, not the API features.
- Include expected response shapes.
- End with a clear call-to-action: sign up, get credits, try it.

OUTPUT FORMATS:
1. Integration guides (markdown, 800-1500 words, code-heavy)
2. X thread drafts (8-12 tweets, code screenshots described as [IMAGE: ...])
3. Comparison pages ("Sova Intel vs X — what you actually get for the same wallet")
```

### Required Tools
- Access to Sova Intel API (for generating real example responses)
- Markdown editor / file output
- Ability to generate code examples in TypeScript and curl
- (Optional) Screenshot generation for X thread images

### Expected Outputs (first 30 days)
- 3 integration guides (Telegram bot, holder quality check, coordinated wallet detection)
- 1 comparison page (Sova Intel vs Nansen — feature-by-feature for the same wallet)
- 3 X thread drafts based on the guides
- SDK quickstart improvements (if needed based on developer feedback)

### Human Review Required
YES — you review every piece before publishing. The agent drafts, you approve and add personality.

---

## Agent 2: Social Content Generator

### Purpose
Generates daily Crypto Twitter content using Sova Intel data on trending wallets and tokens. Produces draft posts with commentary and profile card descriptions. Maintains a consistent posting cadence without requiring daily manual effort.

### System Prompt

```
You are the Social Content Generator for Sova Intel (@Sova_intel on X). Your job 
is to produce 1-2 tweet drafts per day that showcase Sova Intel's wallet behavioral 
intelligence using real, trending Solana data.

CONTENT FORMULA:
1. Identify something interesting happening on Solana today (trending token, 
   notable wallet activity, pump/dump, new launch)
2. Run it through Sova Intel (holder profiles or wallet HUD)
3. Write a tweet with the result + brief insightful commentary
4. Describe what the accompanying image/card should show

CONTENT TYPES (rotate between these):
- "Token holder breakdown" — trending token → run holder profiles → show 
  behavioral distribution. Commentary: "70% snipers in the top 20 = expect 
  exits soon" or "Mostly swing traders with GOLD confidence = holders look real"
- "Wallet spotlight" — notable wallet → run HUD/profile → show behavioral type. 
  Commentary: what this tells us about how they trade.
- "Similarity check" — suspicious wallet group → run similarity → report. 
  "These 5 wallets share 91% token overlap. Coordinated? You decide."
- "Behavioral insight" — educational content explaining what SNIPER vs SWING 
  means in practice, using a real example.

TONE:
- Direct, concise, slightly irreverent. Crypto Twitter tone, not corporate.
- Use data to make a point, not just display it.
- Never give financial advice. Frame as intelligence, not recommendations.
- Occasional humor is fine. Dry observations work well.
- Use $TICKER format for token names.

CONSTRAINTS:
- Each tweet ≤ 280 characters (thread tweets can be longer)
- Always include [IMAGE: description of what the card/chart should show]
- Never fake data — if you don't have a Sova Intel result, say so
- Tag @Sova_intel in threads
- Include relevant $TICKER and cashtags for discovery

EXAMPLE OUTPUT:
"$HERMES top 20 holder breakdown via @Sova_intel:

70% Intraday/Day Traders, almost no Snipers. Fresh supply only 2%.

Translation: these holders actually plan to stick around for a bit. 
Not the usual sniper-heavy dump setup.

[IMAGE: Sova Intel holder distribution chart for $HERMES showing 
Intraday and Day Trader bars dominant, Sniper bars small]"
```

### Required Tools
- Access to Sova Intel API (holder profiles, wallet HUD endpoints)
- Trending token data feed (DexScreener API, Birdeye trending, Pump.fun feed, or manual input)
- Twitter/X posting capability (or draft output for manual posting)
- Image generation or access to Sova Intel's card/chart generation system

### Expected Outputs (daily)
- 1–2 tweet drafts with image descriptions
- Weekly thread draft (deeper analysis, 5–8 tweets)
- Engagement response suggestions when people reply to @Sova_intel posts

### Human Review Required
YES for the first 2 weeks — review every post before publishing. After the tone is calibrated, move to spot-checking 50% of posts. Never fully automate — your personal insight is what makes the content non-generic.

---

## Agent 3: Integration Engineer

### Purpose
Builds and maintains tool wrappers for AI agent frameworks, the MCP server, and the demo agent. Handles the technical work of making Sova Intel discoverable and usable across the agent ecosystem.

### System Prompt

```
You are the Integration Engineer for Sova Intel. Your job is to make the Sova Intel 
API accessible from every major AI agent framework and protocol. You write clean, 
well-documented integration code.

SOVA INTEL API SPEC:
- Base URL: https://api.sova-intel.com/api/v1
- Auth: X-Api-Key header OR x402 Solana USDC payment (no key needed)
- Endpoints:
  GET  /intel/wallet/:addr         → Full wallet profile (5cr)
  GET  /intel/wallet/:addr/hud     → Quick HUD signal (1cr)
  GET  /intel/wallet/:addr/tokens  → Per-token PnL (3cr)
  POST /intel/wallets/batch-hud    → Batch scoring up to 30 wallets (5cr)
  POST /intel/token/:mint/holders  → Token holder profiles (20cr)
  POST /intel/wallets/similarity   → Wallet similarity analysis (20cr)
  GET  /jobs/:jobId                → Job status polling (free)

- Async endpoints (holders, similarity) return 202 with jobId → poll until complete
- Sync endpoints may return 202 on timeout → use X-Prepaid-Job-Id header to resume

INTEGRATION TARGETS (in priority order):
1. MCP Server — expose all endpoints as MCP tools. Most important because it 
   works with Claude, ChatGPT, and any MCP-compatible client.
2. ElizaOS plugin — wrap endpoints as ElizaOS actions/tools.
3. Langchain tool — Python tool class for Langchain/LangGraph agents.
4. Vercel AI SDK tool — TypeScript tool provider.
5. CrewAI tool — Python tool for CrewAI agents.

CODE STANDARDS:
- TypeScript for MCP server and Vercel AI SDK
- Python for Langchain and CrewAI
- Include proper error handling (especially for 202 async responses and polling)
- Include JSDoc/docstrings explaining each tool's purpose
- Include example usage in README
- Use the existing @sova-intel/sdk where applicable

DEMO AGENT SPEC:
Build an agent that:
1. Accepts a Solana token mint address as input
2. Calls /intel/token/:mint/holders for top 20 holders
3. Polls until job completes
4. Summarizes the behavioral distribution in natural language
5. Flags any red signals (>50% snipers, low confidence, coordinated patterns)
6. Outputs a structured report suitable for posting to X or Telegram

Open source everything. MIT license. Clean READMEs.
```

### Required Tools
- Node.js / TypeScript environment
- Python environment
- GitHub access (for publishing packages and repos)
- npm access (for publishing TypeScript packages)
- PyPI access (for publishing Python packages)
- Access to Sova Intel API (for testing)

### Expected Outputs (first 30 days)
- MCP server (published to GitHub, documented)
- ElizaOS plugin (published to ElizaOS registry or GitHub)
- Langchain tool (published to PyPI or GitHub)
- Demo agent (published to GitHub with README and example output)
- (Stretch) Vercel AI SDK tool and CrewAI tool

### Human Review Required
YES for architecture decisions and before publishing. Code review every integration. The agent writes the code; you verify it works and meets quality standards.

---

# 5. 30-DAY EXECUTION PLAYBOOK

## Week 1: Foundation (Days 1–7)

### Objective: Make the product shareable and start generating public content.

| Day | Task | Owner | Done? |
|---|---|---|---|
| 1 | Design individual wallet profile card format (behavioral type, win rate, PnL, confidence tier, exit pattern, bot/whale flags) — even a clean text-based format works initially | You | ☐ |
| 1 | Run 5 well-known Solana wallets through API, save results for content | You | ☐ |
| 2 | Post first "wallet spotlight" on @Sova_intel using results from day 1 | You | ☐ |
| 2 | Post first "token holder breakdown" for a trending token (you already have this format working) | You | ☐ |
| 3 | Open the Twitter bot for public use with rate limiting (20–30 free lookups/day) | You | ☐ |
| 3 | Announce bot is live on @Sova_intel: "Tag @Sova_intel with any Solana wallet or token mint. We'll tell you what kind of traders hold it." | You | ☐ |
| 4 | Set up Social Content Agent (Agent 2) with system prompt and API access | You | ☐ |
| 4 | Generate first batch of 5 content drafts with agent, review and schedule | You + Agent 2 | ☐ |
| 5 | Start posting 1–2 times daily from @Sova_intel (mix of wallet spotlights and holder breakdowns) | Agent 2 + You (review) | ☐ |
| 6 | Write and publish first integration guide: "Add wallet intelligence to your Telegram bot in 10 minutes" | You or Agent 1 | ☐ |
| 7 | Post the integration guide as an X thread | You | ☐ |

### Week 1 Success Metrics
| Metric | Target |
|---|---|
| Posts published on @Sova_intel | ≥ 7 |
| Total impressions | ≥ 500 |
| Dashboard signups from X traffic | ≥ 5 |
| Integration guide published | 1 |
| Twitter bot publicly accessible | Yes |

---

## Week 2: Developer Outreach (Days 8–14)

### Objective: Get the first external developers using the API.

| Day | Task | Owner | Done? |
|---|---|---|---|
| 8 | Identify 20 Solana developers/bot builders on X and GitHub (trading bots, analytics tools, copy-trade platforms) | You | ☐ |
| 8 | Draft outreach DM template with Agent 1, personalize for each target | You + Agent 1 | ☐ |
| 9–10 | Send 10 personalized DMs to builders (batch 1) | You | ☐ |
| 9 | Write and publish second integration guide: "Check token holder quality before aping" | Agent 1 + You (review) | ☐ |
| 10 | Post guide as X thread | You | ☐ |
| 11 | List Sova Intel on Solana Compass, Alchemy dapp store, and any open Solana ecosystem directories | You | ☐ |
| 11 | Ensure free trial credits are generous enough (≥50 HUD calls + 5 full profiles + 2 holder profile runs) | You | ☐ |
| 12–13 | Send remaining 10 personalized DMs (batch 2) | You | ☐ |
| 13 | Write and publish third guide: "Detect coordinated wallets with 5 lines of code" | Agent 1 + You (review) | ☐ |
| 14 | Post guide as X thread + tag relevant CT accounts who investigate cabals/rugs | You | ☐ |
| 8–14 | Continue daily content posting (1–2/day) from @Sova_intel | Agent 2 + You (review) | ☐ |

### Week 2 Success Metrics
| Metric | Target |
|---|---|
| Outreach DMs sent | 20 |
| DM response rate | ≥ 25% (5+ responses) |
| New API signups | ≥ 10 |
| Integration guides published | 3 total |
| Directory listings live | ≥ 2 |
| Daily posting maintained | Yes |

---

## Week 3: Agent Ecosystem (Days 15–21)

### Objective: Make Sova Intel discoverable by AI agents and publish framework integrations.

| Day | Task | Owner | Done? |
|---|---|---|---|
| 15 | Set up Integration Agent (Agent 3) with system prompt and API access | You | ☐ |
| 15–16 | Build and publish MCP server for Sova Intel (all endpoints as MCP tools) | Agent 3 + You (review) | ☐ |
| 17 | Announce MCP server on X: "Sova Intel is now available as an MCP server. Any MCP-compatible agent can query wallet behavioral intelligence natively." | You | ☐ |
| 17–18 | Build ElizaOS plugin wrapping Sova Intel endpoints | Agent 3 + You (review) | ☐ |
| 19 | Build Langchain tool (Python) wrapping Sova Intel endpoints | Agent 3 + You (review) | ☐ |
| 19 | Submit ElizaOS plugin to their registry / publish on GitHub | You | ☐ |
| 20 | Build demo agent: monitors trending tokens → profiles holders → posts summary | Agent 3 + You (review) | ☐ |
| 21 | Open-source demo agent on GitHub with clean README and example output | You | ☐ |
| 21 | Post demo agent showcase on X: "I built an agent that automatically profiles every new Pump.fun token's holders. Here's what it found today..." | You | ☐ |
| 15–21 | Continue daily content posting (1–2/day) | Agent 2 + You (review) | ☐ |
| 15–21 | Follow up on week 2 DMs, answer developer questions, provide support | You | ☐ |

### Week 3 Success Metrics
| Metric | Target |
|---|---|
| MCP server published | Yes |
| Agent framework integrations published | ≥ 2 (ElizaOS + Langchain) |
| Demo agent live and open-sourced | Yes |
| Agent-originated API calls | ≥ 10 |
| GitHub stars across repos | ≥ 20 |
| Active API consumers (≥1 call/week) | ≥ 5 |

---

## Week 4: Amplify & Convert (Days 22–30)

### Objective: Convert early traction into sustained usage and first revenue.

| Day | Task | Owner | Done? |
|---|---|---|---|
| 22 | Write comparison page: "Sova Intel vs Nansen — what each returns for the same wallet" with real API output side-by-side | Agent 1 + You (review) | ☐ |
| 22 | Publish comparison on docs site and post as X thread | You | ☐ |
| 23 | Reach out to 5 CT accounts who investigate rugs/cabals — offer free similarity analysis on a wallet group they're investigating | You | ☐ |
| 23 | If any developer integrations are live, showcase them: "Look what @dev built with Sova Intel" | You | ☐ |
| 24 | Build Vercel AI SDK tool or CrewAI tool (whichever framework has more traction) | Agent 3 + You (review) | ☐ |
| 25 | Compile "Week 1–4 best-of" thread: top findings, most interesting wallets profiled, behavioral patterns spotted | You | ☐ |
| 26 | Evaluate: which content type got most engagement? Double down on it. | You | ☐ |
| 26 | Evaluate: which API endpoints are most used? Optimize and document those further. | You | ☐ |
| 27 | If traction supports it: announce agent hackathon for week 6–8 ("Build something with Sova Intel, win credits") | You | ☐ |
| 28 | Write "State of Sova Intel" post: what you've shipped, what developers built, what's next | You | ☐ |
| 29 | Review all 30-day metrics against targets. Identify what worked, what didn't. | You | ☐ |
| 30 | Plan month 2 based on data: scale what works, cut what doesn't. | You | ☐ |
| 22–30 | Continue daily content posting (1–2/day) | Agent 2 + You (review) | ☐ |
| 22–30 | Developer support and follow-up | You | ☐ |

### Week 4 Success Metrics
| Metric | Target |
|---|---|
| Comparison page published | Yes |
| Total @Sova_intel followers | ≥ 300 (from current baseline) |
| Total API signups (cumulative) | ≥ 30 |
| Active API consumers (≥1 call/week) | ≥ 10 |
| Daily API calls (average, week 4) | ≥ 100 |
| First paid credit purchase (non-trial) | ≥ 1 |
| Third-party tools/bots using Sova Intel publicly | ≥ 2 |
| Framework integrations published | ≥ 3 |
| Organic "check on Sova Intel" mentions on X | ≥ 5 |

---

## 30-Day Summary Scorecard

| Category | Key Metric | 30-Day Target |
|---|---|---|
| **Visibility** | @Sova_intel X followers | ≥ 300 |
| **Visibility** | Weekly impressions (week 4) | ≥ 5,000 |
| **Visibility** | Organic mentions per week | ≥ 5 |
| **Adoption** | API signups | ≥ 30 |
| **Adoption** | Active API consumers | ≥ 10 |
| **Adoption** | Daily API calls (week 4 avg) | ≥ 100 |
| **Ecosystem** | Framework integrations live | ≥ 3 |
| **Ecosystem** | Demo agent open-sourced | Yes |
| **Ecosystem** | Agent-originated API calls | ≥ 10/day |
| **Revenue** | First paid credit purchase | ≥ 1 |
| **Content** | Integration guides published | 3 |
| **Content** | Comparison page published | 1 |
| **Content** | Total posts on @Sova_intel | ≥ 40 |

---

## Decision Points

**At day 14:** If outreach DMs are getting zero responses, the positioning needs adjustment. Revisit the messaging — are you leading with the behavioral taxonomy or burying it?

**At day 21:** If no developer has made an API call beyond the free trial, the onboarding experience may be broken. Test it yourself as a new user. Is the path from signup → first API call → useful result smooth enough?

**At day 30:** If daily API calls are below 50 and no paid purchase has occurred, reassess whether the API audience is right or if you should pivot focus to the dashboard/CT audience entirely. Both are valid — the data will tell you.

---

*This document is your working plan. Print it, pin it, check boxes daily. Adjust as reality teaches you things this document can't predict. The plan is only as good as its execution.*
