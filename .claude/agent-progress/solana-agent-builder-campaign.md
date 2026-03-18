# Solana Agent Builder Communities -- Outreach Campaign Package

**Prepared:** 2026-03-18 | **Campaign Brief:** Generate outreach package for Solana agent builder communities
**Objective:** Drive Sova Intel API adoption among Solana AI agent developers and framework builders

---

## Table of Contents

1. [Qualified Outreach Targets](#1-qualified-outreach-targets)
2. [Social Content -- Tweets & Threads](#2-social-content--tweets--threads)
3. [Technical Content -- Integration Guide Angle](#3-technical-content--integration-guide-angle)
4. [Integration Talking Points & Framework Notes](#4-integration-talking-points--framework-notes)
5. [Execution Sequence](#5-execution-sequence)

---

# 1. Qualified Outreach Targets

*Agent: outreach-researcher*

## Tier 1 -- Framework Maintainers (Highest Leverage)

These are the people who control what tools are available to thousands of agent builders. A single integration here multiplies distribution.

| Target | Platform | What They Build | Why Sova Intel Matters to Them | Outreach Channel |
|--------|----------|----------------|-------------------------------|------------------|
| **SendAI team** (@sendaifun) | X / GitHub | Solana Agent Kit (60+ actions, 17K+ stars equivalent ecosystem) | Their kit has DeFi, NFT, and token plugins but NO wallet behavioral intelligence plugin. Sova Intel fills a gap in their toolkit. | X DM + GitHub issue/PR |
| **ElizaOS core contributors** (Shaw Walters et al.) | X / GitHub / Discord | ElizaOS framework (17,600+ stars, 200+ plugins, 1,350+ contributors) | 200+ plugins but none for wallet behavioral profiling. An ElizaOS plugin for Sova Intel puts behavioral intelligence into every ElizaOS agent. | Discord (ElizaOS server) + X DM |
| **Crossmint / GOAT toolkit team** | X / GitHub | Great Onchain Agent Toolkit (multi-chain agent tools) | GOAT covers 200+ onchain tools across 30+ chains but has no behavioral classification tool. Sova Intel adds unique analytical capability. | X DM |
| **Rig framework maintainers** | X / GitHub | Rust-native agent framework with Solana integrations | Rust agents need data sources. Sova Intel API is language-agnostic (REST), easy to wrap. | GitHub |
| **Solana Agent (truemagic-coder)** | GitHub | solana-agent -- "Build agents in 3 lines of code" | Their framework lacks analytics/intelligence integrations. Sova Intel is a natural addition. | GitHub issue + X DM |

## Tier 2 -- Hackathon Winners & Notable Agent Builders

These developers have proven they can ship. They've already built agents that could benefit from wallet intelligence.

| Target | Project | Why They're Relevant | Outreach Angle |
|--------|---------|---------------------|----------------|
| **The Hive team** | DeFAI modular agent network ($BUZZ, $108M mcap) | Top Solana AI hackathon winner. DeFi proxy agents need wallet behavioral data to assess counterparty risk. | "Your agents interact with wallets. Do they know what kind of trader is on the other side?" |
| **FXN team** | Agent resource sharing network | Unifies agents across frameworks. Sova Intel could be a shared resource/skill in their network. | "Wallet behavioral intelligence as a shared agent resource." |
| **AgentiPy team** | Python toolkit connecting AI agents to blockchain | Python-native agent toolkit for Solana. Natural fit for a Langchain/Python Sova Intel tool. | "Add wallet profiling to your Python agent toolkit." |
| **Neur team** | Full-stack LLM + Solana application | Interacts with DeFi, NFTs. Adding behavioral intelligence enriches their agent's decision-making. | "Your agent can swap tokens. Can it profile who it's trading against?" |
| **Project Plutus team** | AI-driven trading center (transactional + analytical agents) | Analytical agent already exists. Sova Intel's behavioral taxonomy is exactly the data their analytical agent needs. | "Your analytical agent + our behavioral taxonomy = smarter trading signals." |
| **Voltr team** | AI-driven DeFi yield vaults | Revenue-generating vaults need to assess wallet quality of depositors/counterparties. | "Profile the wallets interacting with your vaults." |

## Tier 3 -- Community & Ecosystem Channels

These are distribution channels, not individual targets. Content posted here reaches hundreds of agent builders.

| Channel | Type | Audience Size | Strategy |
|---------|------|---------------|----------|
| **Solana Foundation awesome-solana-ai** (GitHub) | Curated list | Referenced by most Solana AI builders | Submit PR to add Sova Intel SDK, MCP server, and skill.md |
| **Solana Agent Registry** (solana.com/agent-registry) | On-chain registry | 9,000+ registered agents | Register Sova Intel as a discoverable agent skill/service |
| **SAID Protocol directory** | Agent identity/reputation | Growing directory | Register Sova Intel service identity |
| **ElizaOS Discord** | Discord server | 1,350+ active contributors | Share integration guide, offer plugin |
| **SendAI community channels** | Discord / Telegram | Active agent builder community | Share Solana Agent Kit plugin for Sova Intel |
| **Colosseum hackathon alumni** | X / Discord | 400+ teams from Jan 2025 hackathon, growing | Target with content and guides |
| **Solana Developer MCP** (mcp.solana.com) | MCP registry | All Solana MCP users | List Sova Intel MCP server |
| **Alchemy dapp store** | Directory | Broad developer audience | List under analytics tools |
| **Solana Compass** | Directory | Solana ecosystem directory | List Sova Intel |

## Tier 4 -- Individual Solana AI Developers on X

Target accounts to DM directly (founder must send these personally):

| Handle Pattern | Signal | How to Find |
|---------------|--------|-------------|
| Builders tweeting about Solana Agent Kit | Active agent devs | Search X: "solana agent kit" + filter:links |
| Contributors to sendaifun/solana-agent-kit on GitHub | Proven builders | GitHub contributors tab |
| ElizaOS plugin authors | Framework-native devs | GitHub + npm @elizaos scope |
| Solana AI Hackathon participants | Shipped agent projects | Colosseum submissions, hackathon threads |
| Developers using Phantom MCP server | MCP-aware builders | Search X: "phantom mcp" OR "solana mcp" |
| Builders mentioning x402 payments | Agent-economy native | Search X: "x402" + "solana" |
| Accounts following @sendaifun AND @solana_devs | Intersection of agent + Solana dev | X follower overlap |

**Action:** Use these search patterns to build a list of 20 specific handles. The outreach-researcher should produce the actual list; the founder sends the DMs.

---

# 2. Social Content -- Tweets & Threads

*Agent: social-content-generator*

## Content Strategy for Agent Builder Audience

The agent builder audience on CT cares about three things:
1. **What data can my agent access?** (capabilities)
2. **How easy is integration?** (developer experience)
3. **Does it work with my framework?** (compatibility)

All content below targets these concerns.

## Standalone Tweets (Post 1-2 per day, rotate these)

### Tweet 1: The Gap Statement
```
Every Solana AI agent can swap tokens and check prices.

Zero of them can tell you what KIND of trader a wallet is.

Sniper? Scalper? Swing trader? Hodler?

Sova Intel classifies wallets into 8 behavioral types via API. 1 credit per call.

Your agent just got smarter.
```

### Tweet 2: The x402 Hook
```
Your autonomous agent doesn't need an API key to use Sova Intel.

x402 payment: agent sees the price, pays in USDC, gets behavioral intelligence.

No signup. No key management. No human in the loop.

skill.md at sova-intel.com/skill.md -- your agent can read it right now.
```

### Tweet 3: The Framework Compatibility Signal
```
Sova Intel works with:
- Solana Agent Kit (@sendaifun)
- ElizaOS plugins
- Langchain tools
- Vercel AI SDK
- Any MCP-compatible client
- Raw REST API + TypeScript SDK

If your agent can make an HTTP call, it can profile wallets.

docs.sova-intel.com
```

### Tweet 4: The Use Case Paint
```
What if your trading agent could do this before every trade:

1. Check who holds $TOKEN
2. See that 80% are SNIPERS with <1min hold times
3. Flag: "high dump risk, proceed with caution"

That's one API call. 20 credits. Takes 30 seconds.

POST /intel/token/:mint/holders
```

### Tweet 5: The Confidence Tier Differentiator
```
Most wallet analytics: "this wallet made 500% gains"

Sova Intel: "this wallet made 500% gains. Confidence: BRONZE (only 4 completed cycles). Treat with caution."

Your agent deserves honest data, not inflated signals.
```

### Tweet 6: The Similarity / Cabal Detection Hook
```
Can your agent detect coordinated wallet groups?

POST /intel/wallets/similarity

Feed it 5-30 wallet addresses. Get back:
- Pairwise Jaccard similarity scores
- Capital-weighted overlap
- Shared token count per pair
- Global cluster metrics

Cabal detection as an API call. 20 credits.
```

### Tweet 7: The Builder Challenge
```
Challenge for Solana agent builders:

Build an agent that:
1. Watches new Pump.fun launches
2. Profiles top 20 holders via Sova Intel
3. Posts "SNIPER ALERT" if >60% are snipers

First person to ship this and tag @Sova_intel gets 1,000 free credits.

Go.
```

## Thread 1: "Why Your Solana Agent Needs Behavioral Intelligence" (8 tweets)

```
THREAD: Why your Solana AI agent is flying blind (and how to fix it)

1/8
Your agent can:
- Swap tokens on Jupiter
- Check prices on Birdeye
- Execute trades on Raydium

But can it answer: "What kind of trader is this wallet?"

No. And that's a problem.

2/8
Here's why it matters:

A wallet that bought $TOKEN could be:
- A SNIPER (<1min holds) -- will dump fast
- A SWING trader (1-7d holds) -- might stick around
- A HODLER (30d+) -- probably not selling

Same "buy" transaction. Completely different implications.

3/8
Sova Intel classifies every Solana wallet into 8 behavioral types based on completed exit cycles:

SNIPER | SCALPER | MOMENTUM | INTRADAY | DAY_TRADER | SWING | POSITION | HODLER

Not labels. Not guesses. Calculated from actual trading behavior.

4/8
And here's what nobody else gives you: confidence.

Every profile comes with a data quality tier:
- GOLD (10+ completed cycles) -- high confidence
- SILVER (5-9 cycles) -- reasonable
- BRONZE (3-4 cycles) -- treat with caution
- INSUFFICIENT (<3 cycles) -- not enough data

Your agent knows how much to trust the signal.

5/8
Three endpoints your agent should know:

GET /intel/wallet/:addr/hud -- Quick behavioral signal (1 credit)
POST /intel/token/:mint/holders -- Profile all top holders (20 credits)
POST /intel/wallets/similarity -- Detect coordinated groups (20 credits)

That's behavioral intelligence, holder quality, and cabal detection.

6/8
Integration is trivial:

npm install @sova-intel/sdk

Or skip the SDK entirely -- x402 payment means your agent pays per-call in USDC. No API key. No account. Read the skill descriptor at sova-intel.com/skill.md.

7/8
What you can build with this:

- Trading agent that checks holder quality before buying
- Portfolio manager that monitors behavioral shifts in held tokens
- Risk agent that flags coordinated wallet activity
- Alpha agent that identifies tokens with strong holder profiles
- Rug detection agent that spots sniper-heavy distributions

8/8
Sova Intel API is live. Free credits on signup.

Docs: docs.sova-intel.com
SDK: @sova-intel/sdk on npm
x402: sova-intel.com/skill.md

If you build something with it, tag @Sova_intel. We'll signal boost it.

The wallets have behavior. Your agent should know about it.
```

## Thread 2: "Solana Agent Kit + Sova Intel" (5 tweets)

```
1/5
If you're building with @sendaifun's Solana Agent Kit, here's a capability your agent is missing:

Wallet behavioral intelligence.

The kit gives you 60+ Solana actions. None of them tell you WHO you're trading against.

2/5
Sova Intel fills that gap. One API call returns:

- Behavioral type (Sniper to Hodler)
- Win rate and PnL
- Hold time distribution
- Confidence tier (GOLD/SILVER/BRONZE)
- Bot and whale flags

For any Solana wallet. Structured JSON. Ready for agent consumption.

3/5
Integration with Solana Agent Kit:

Your agent's tool list:
- swap_tokens (Jupiter)
- check_price (Birdeye)
- profile_wallet (Sova Intel) <-- new
- profile_holders (Sova Intel) <-- new
- detect_cabals (Sova Intel) <-- new

Three new capabilities. Three API endpoints.

4/5
The x402 angle matters here.

Solana Agent Kit agents can already manage wallets and sign transactions.

With x402, your agent pays Sova Intel directly in USDC. No API key provisioning. No credit management. Autonomous payment for autonomous intelligence.

5/5
We're building the official Solana Agent Kit plugin for Sova Intel.

Want early access? DM @Sova_intel or check the docs:
docs.sova-intel.com

Your agent is already executing trades. Time to give it eyes.
```

---

# 3. Technical Content -- Integration Guide Angle

*Agent: technical-content-writer*

## Guide Concept: "Add Wallet Behavioral Intelligence to Your Solana AI Agent in 10 Minutes"

### Target Reader
A developer actively building a Solana AI agent using Solana Agent Kit, ElizaOS, Langchain, or raw TypeScript. They already have an agent that can execute transactions. They want to add analytical capability.

### Guide Outline

```
Title: Add Wallet Behavioral Intelligence to Your Solana AI Agent in 10 Minutes

Hook: Your agent can trade. Can it think?

## The Problem
Your Solana agent executes trades, swaps tokens, checks prices. But it has no
intelligence about WHO it's trading against. It can't distinguish a sniper wallet
(dumps in <1 minute) from a swing trader (holds for days). This is like playing
poker without looking at the other players.

## What Sova Intel Gives Your Agent
- 8 behavioral types: SNIPER, SCALPER, MOMENTUM, INTRADAY, DAY_TRADER, SWING, POSITION, HODLER
- Confidence tiers: GOLD, SILVER, BRONZE, INSUFFICIENT
- Wallet similarity scoring for cabal detection
- Token holder behavioral distribution
- All via REST API, TypeScript SDK, or x402 autonomous payment

## Quick Start: SDK Installation

    npm install @sova-intel/sdk

## Example 1: Profile a Wallet (HUD -- 1 credit)

    import { SovaIntel } from '@sova-intel/sdk';

    const sova = new SovaIntel({ apiKey: process.env.SOVA_API_KEY });

    const hud = await sova.wallet.hud('WALLET_ADDRESS');

    console.log(hud.behaviorCode);     // "SNIPER"
    console.log(hud.speedCategory);    // "very_fast"
    console.log(hud.dataQualityTier);  // "GOLD"
    console.log(hud.winRate);          // 0.72
    console.log(hud.totalPnlUsd);     // 45230.50

    // Your agent now knows: this is a high-confidence sniper with 72% win rate.

## Example 2: Profile Token Holders (20 credits, async)

    const job = await sova.token.holders('TOKEN_MINT_ADDRESS', { limit: 20 });

    // Poll for completion
    let result = await sova.jobs.get(job.jobId);
    while (result.status !== 'completed') {
      await new Promise(r => setTimeout(r, 2000));
      result = await sova.jobs.get(job.jobId);
    }

    // Analyze the distribution
    const holders = result.data.holders;
    const sniperCount = holders.filter(h => h.behaviorCode === 'SNIPER').length;
    const sniperPct = (sniperCount / holders.length) * 100;

    if (sniperPct > 60) {
      console.log(`WARNING: ${sniperPct}% of top holders are snipers. High dump risk.`);
    }

## Example 3: Detect Coordinated Wallets (20 credits, async)

    const simJob = await sova.wallets.similarity({
      addresses: ['wallet1', 'wallet2', 'wallet3', 'wallet4', 'wallet5']
    });

    // Poll and check results
    // ... (same polling pattern)

    const pairs = simResult.data.pairs;
    const highSimilarity = pairs.filter(p => p.binaryScore > 0.8);

    if (highSimilarity.length > 0) {
      console.log(`ALERT: ${highSimilarity.length} wallet pairs with >80% overlap detected.`);
    }

## Example 4: x402 Payment (No API Key)

    // For autonomous agents -- pay per call in USDC, no account needed
    // Your agent reads the skill descriptor:
    // GET https://sova-intel.com/skill.md

    // Then calls endpoints with x402 payment header
    // The agent negotiates payment automatically

## Wiring It Into Your Agent's Decision Loop

    async function shouldBuyToken(mint: string): Promise<boolean> {
      // Step 1: Profile top holders
      const holderData = await profileHolders(mint);

      // Step 2: Check behavioral distribution
      const sniperPct = getSniperPercentage(holderData);
      const avgConfidence = getAverageConfidence(holderData);

      // Step 3: Make informed decision
      if (sniperPct > 60) return false;  // Too many snipers
      if (avgConfidence === 'INSUFFICIENT') return false;  // Not enough data

      return true;  // Holder profile looks reasonable
    }

## What's Next
- Full API docs: docs.sova-intel.com
- SDK reference: npm @sova-intel/sdk
- x402 skill descriptor: sova-intel.com/skill.md
- Questions? DM @Sova_intel on X

Your agent has hands (transactions). Give it eyes (intelligence).
```

### Companion Content Pieces

1. **Guide variant for ElizaOS**: Same concepts but wrapped as an ElizaOS plugin action. Show how to add a `profileWallet` action to an ElizaOS character.

2. **Guide variant for Python/Langchain**: Same concepts using requests library or a Langchain custom tool class. Target the AgentiPy and Langchain communities.

3. **Guide variant for MCP**: Show how to connect the Sova Intel MCP server to Claude Desktop or Cursor, then use natural language to profile wallets.

---

# 4. Integration Talking Points & Framework Notes

*Agent: integration-engineer*

## Framework Integration Priority Matrix

| Framework | Users/Stars | Integration Type | Effort | Impact | Priority |
|-----------|------------|-----------------|--------|--------|----------|
| **MCP Server** | All MCP clients (Claude, Cursor, etc.) | MCP tool server (TypeScript) | Medium | Very High -- universal access | P0 |
| **Solana Agent Kit** | 17K+ stars ecosystem | Plugin for SendAI toolkit | Low-Medium | Very High -- largest Solana agent community | P0 |
| **ElizaOS** | 17,600+ stars, 200+ plugins | Plugin (TypeScript) | Medium | High -- de facto agent OS | P1 |
| **Langchain** | Massive Python ecosystem | Custom tool class (Python) | Low | High -- most popular agent framework | P1 |
| **Vercel AI SDK** | Large TypeScript ecosystem | Tool provider | Low | Medium | P2 |
| **CrewAI** | Growing Python framework | Tool definition | Low | Medium | P2 |

## MCP Server Architecture Notes

The Sova Intel MCP server should expose these tools:

| MCP Tool Name | Sova Endpoint | Input | Notes |
|---------------|---------------|-------|-------|
| `sova_wallet_hud` | GET /intel/wallet/:addr/hud | wallet address | Sync, 1 credit |
| `sova_wallet_profile` | GET /intel/wallet/:addr | wallet address | Sync (may 202), 5 credits |
| `sova_wallet_tokens` | GET /intel/wallet/:addr/tokens | wallet address | Sync, 3 credits |
| `sova_batch_hud` | POST /intel/wallets/batch-hud | array of addresses (max 30) | Sync, 5 credits |
| `sova_token_holders` | POST /intel/token/:mint/holders | token mint, limit | Async (202 + polling), 20 credits |
| `sova_wallet_similarity` | POST /intel/wallets/similarity | array of addresses (2-30) | Async (202 + polling), 20 credits |
| `sova_job_status` | GET /jobs/:jobId | job ID | Free, for polling async jobs |

**Critical implementation detail:** The async endpoints (holders, similarity) return 202 with a jobId. The MCP tool must handle the polling loop internally and return the final result to the agent. Do not expose the polling as a separate step -- agents should call `sova_token_holders` and get back the completed result.

## Solana Agent Kit Plugin Notes

SendAI's Solana Agent Kit uses a plugin architecture with three plugin types:
- Token plugin (SPL operations)
- NFT plugin (Metaplex operations)
- DeFi plugin (protocol interactions)

Sova Intel would be an **Analytics plugin** -- a new category. The plugin should:
1. Register three tools: `profile_wallet`, `profile_token_holders`, `detect_coordinated_wallets`
2. Handle async polling transparently
3. Return structured data the agent can reason about
4. Support both API key auth and x402 payment

**Opportunity:** Propose this to SendAI as a PR or a listed community plugin. Being included in the official Solana Agent Kit plugin list puts Sova Intel in front of every developer who uses the kit.

## ElizaOS Plugin Notes

ElizaOS plugins are TypeScript modules that register actions, evaluators, and providers. A Sova Intel plugin should:
1. Register as `@elizaos/plugin-sova-intel` (or community namespace)
2. Provide actions: `PROFILE_WALLET`, `ANALYZE_TOKEN_HOLDERS`, `CHECK_SIMILARITY`
3. Include evaluators that trigger automatically (e.g., when a wallet address is mentioned in conversation)
4. Store results in ElizaOS memory for cross-conversation context

**Opportunity:** ElizaOS has an ecosystem fund for early-stage builders. The Sova Intel plugin could qualify for support.

## Key Talking Points for Outreach Conversations

### For Framework Maintainers
- "Sova Intel adds a capability no other data provider offers as structured API fields: behavioral classification of Solana wallets. Your framework's agents get a new sense -- understanding WHO they're interacting with, not just WHAT transactions are happening."
- "We support x402 natively, meaning autonomous agents can pay per-call without key management. This aligns with the agentic economy direction Solana is pushing."

### For Agent Builders
- "Your trading agent makes decisions based on price, volume, and momentum. What if it also knew that 80% of a token's holders are snipers who will dump within minutes? That's one API call."
- "The behavioral taxonomy is unique to Sova Intel. Nobody else classifies wallets as SNIPER/SCALPER/MOMENTUM/INTRADAY/DAY_TRADER/SWING/POSITION/HODLER with confidence scoring."

### For Hackathon Alumni / DeFAI Builders
- "Your DeFi agent interacts with wallets constantly. Behavioral intelligence tells your agent whether a counterparty is likely to hold or dump, whether a token's holder base is genuine or coordinated, and how confident that assessment is."
- "Free credits on signup. Build something, tag us, we'll signal boost it to our audience."

### Competitive Positioning (vs. what agents can currently access)
- Birdeye/DexScreener: Price and volume data. No behavioral classification.
- Nansen: Labels (Smart Trader, Whale) but no 8-type behavioral taxonomy. Subscription-gated.
- GMGN: Sniper flags but binary, not a full behavioral spectrum. No API for agents.
- **Sova Intel: Structured behavioral taxonomy + confidence tiers + similarity scoring. Pay-per-call. x402 native. Agent-first.**

## Solana Agent Registry Integration

The Solana Agent Registry (solana.com/agent-registry) launched March 3, 2026, with 9,000+ agents. Sova Intel should register as a **service/skill provider** -- not an agent itself, but a capability that agents can discover and use.

Registration should include:
- MCP endpoint URL
- skill.md URL
- Capability declarations (wallet profiling, holder analysis, similarity scoring)
- x402 payment terms

This makes Sova Intel discoverable by any agent querying the registry for "wallet intelligence" or "behavioral analysis" capabilities.

---

# 5. Execution Sequence

## Immediate Actions (This Week)

| Priority | Action | Owner | Dependencies | Est. Time |
|----------|--------|-------|-------------|-----------|
| 1 | Finalize list of 20 specific developer handles from Tier 2 + Tier 4 targets | Founder + outreach-researcher | Search patterns from Section 1 | 2 hours |
| 2 | Post Tweet 1 ("The Gap Statement") and Tweet 2 ("The x402 Hook") | Founder | None | 15 min |
| 3 | Write and publish integration guide "Add Wallet Intelligence to Your Agent in 10 Min" | technical-content-writer + Founder review | Guide outline from Section 3 | 4 hours |
| 4 | Post Thread 1 as X thread | Founder | Thread draft from Section 2 | 15 min |
| 5 | Begin MCP server build | integration-engineer | Architecture notes from Section 4 | 2-3 days |
| 6 | Submit PR to solana-foundation/awesome-solana-ai | Founder | Sova Intel SDK and docs must be public | 30 min |
| 7 | Register on Solana Agent Registry | Founder | skill.md must be live | 1 hour |

## Week 2 Actions

| Priority | Action | Owner |
|----------|--------|-------|
| 1 | Send 10 personalized DMs to Tier 1 + Tier 2 targets (batch 1) | Founder (cannot delegate) |
| 2 | Publish Solana Agent Kit plugin or PR | integration-engineer |
| 3 | Post Thread 2 ("Solana Agent Kit + Sova Intel") | Founder |
| 4 | Send remaining 10 DMs (batch 2) | Founder |
| 5 | Publish ElizaOS plugin | integration-engineer |
| 6 | Submit to Solana Compass and Alchemy dapp store | Founder |

## Week 3 Actions

| Priority | Action | Owner |
|----------|--------|-------|
| 1 | Publish Langchain Python tool | integration-engineer |
| 2 | Build and open-source demo agent (trending token holder profiler) | integration-engineer |
| 3 | Post demo agent showcase on X | Founder |
| 4 | Follow up on all DMs, provide support to any developers who responded | Founder |
| 5 | Post Tweet 7 ("Builder Challenge") with free credits offer | Founder |

---

# Appendix: Research Sources

- [How to Build a Solana AI Agent in 2026 -- Alchemy](https://www.alchemy.com/blog/how-to-build-solana-ai-agents-in-2026)
- [Solana AI Innovation](https://solana.com/ai)
- [Solana Agent Kit -- GitHub](https://github.com/sendaifun/solana-agent-kit)
- [Solana Foundation awesome-solana-ai](https://github.com/solana-foundation/awesome-solana-ai)
- [ElizaOS on Solana -- Solana Compass](https://solanacompass.com/projects/elizaos)
- [Solana Agent Registry](https://solana.com/agent-registry)
- [SendAI Solana MCP Server -- GitHub](https://github.com/sendaifun/solana-mcp)
- [Solana Developer MCP](https://mcp.solana.com/)
- [Phantom MCP Server Launch](https://www.mexc.com/news/747358)
- [Solana AI Hackathon Winners](https://coinlaunch.space/blog/solana-ai-hackathon-the-best-ai-agents/)
- [Colosseum AI Agent Hackathon](https://genfinity.io/2026/02/02/solana-colosseum-launches-ai-agent-hackathon/)
- [Solana Agent (Agentic IQ) -- GitHub](https://github.com/truemagic-coder/solana-agent)
- [ElizaOS Plugin Solana -- npm](https://www.npmjs.com/package/@elizaos/plugin-solana)
- [openSVM Agent Registry Protocol -- GitHub](https://github.com/openSVM/aeamcp)

---

*This campaign package was assembled on 2026-03-18 by the Sova Intel playbook manager, synthesizing outputs from outreach-researcher, social-content-generator, technical-content-writer, and integration-engineer workstreams. All content requires founder review before publishing.*
