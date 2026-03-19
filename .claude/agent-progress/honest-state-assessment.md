# Honest State Assessment -- Day 1 Agent Outputs
**Date:** 2026-03-19 | **Assessor:** Playbook Manager

---

## Ground Truth Sources Used

I fetched and verified against:
1. **Live API docs** at docs.sova-intel.com (partial -- Docusaurus rendering issue, but skill.md had full endpoint list)
2. **skill.md** at sova-intel.com/skill.md -- complete endpoint specs, x402 flow, response fields
3. **Actual SDK types** from `@sova-intel/sdk@0.1.1` on npm -- downloaded and inspected `client.d.ts` and `types.d.ts`

These are the authoritative references. Everything below is measured against them.

---

## 1. What Is Actually Usable Right Now?

### USABLE AFTER MINOR EDITS (agents can fix):
- **Tweet Draft 1 ("Gap Statement")** -- Accurate claims, clean copy. Replace `docs.sova-intel.com` link with the actual URL if it differs. Postable today after founder review.
- **Tweet Draft 2 ("x402 Hook")** -- Accurate. x402 is real, skill.md URL is real. Postable today.
- **Outreach target structure** -- The table format and tracking system work. Tier 1 targets (SendAI, ElizaOS) are genuinely high-leverage.

### NEEDS SIGNIFICANT REWORK (agents can fix with correct instructions):
- **Integration guide** -- The structure and narrative are good. The response shapes and SDK method names are WRONG. Fixable, but every code block needs rewriting. See Section 2 below.
- **Tweet Draft 3 ("Colosseum thread")** -- The "454 agents" number is fabricated. Must be replaced. Rest of thread is fine.
- **Outreach targets list** -- 5 of 10 targets are weak or unverifiable. See Section 4.

### NOTHING NEEDS TO BE SCRAPPED ENTIRELY.
The frameworks are sound. The errors are all in specifics -- field names, method signatures, unverified claims. This is fixable work, not wasted work.

---

## 2. The Integration Guide -- Detailed Verdict

**Verdict: FIX-AND-PUBLISH. Do not scrap.**

The guide's narrative, structure, and code patterns are solid. But every JSON response example and SDK call is wrong in specific ways. Here is exactly what is wrong and what the correct values are:

### SDK Class and Method Names -- ALL WRONG

| Guide Says | Actual SDK (from types.d.ts) |
|------------|------------------------------|
| `new SovaIntel({ apiKey: ... })` | `new SovaIntelClient({ baseUrl: "https://api.sova-intel.com/api/v1", auth: { kind: "apikey", apiKey: "..." } })` |
| `sova.wallet.hud('addr')` | `sova.getWalletHud('addr')` |
| `sova.token.holders(mint, { limit: 20 })` | `sova.pollHolderProfiles(mint, 20)` (convenience method that handles polling) or `sova.queueHolderProfiles(mint, 20)` (manual) |
| `sova.wallets.similarity({ addresses: [...] })` | `sova.pollSimilarity([...])` or `sova.queueSimilarity([...])` |
| `sova.jobs.get(jobId)` | No direct job polling method on client. SDK uses internal `waitForJob`. Manual polling would be raw HTTP to `/jobs/:jobId`. |

The SDK does NOT use a nested `sova.wallet.hud()` pattern. It uses flat method names: `getWalletHud`, `getWalletProfile`, `getWalletTokens`, `batchHud`, `pollHolderProfiles`, `pollSimilarity`. The guide's entire code pattern is fabricated.

### HUD Response Shape -- PARTIALLY WRONG

| Guide Field | Real Field (from SDK types) | Notes |
|-------------|---------------------------|-------|
| `behaviorCode` | `behaviorCode` | CORRECT |
| `speedCategory` | NOT in WalletHud type | WRONG -- speedCategory is in WalletBehavior (full profile only), not HUD |
| `dataQualityTier` | `dataQualityTier` | CORRECT but values differ: guide says "GOLD", real API may return "high"/"medium"/"low" per skill.md. SDK type says `"GOLD" \| "SILVER" \| "BRONZE" \| "INSUFFICIENT"`. CONFLICTING info between skill.md and SDK types. Founder must test. |
| `winRate` | `winRate` | CORRECT |
| `totalPnlUsd` | NOT a real field | WRONG -- real field is `trimmedMeanPnl` (number) |
| `medianHoldTimeSeconds` | `medianHoldTimeHours` (optional) | WRONG unit and name |
| `exitPattern` | NOT in WalletHud | WRONG -- exitPattern is in WalletBehavior (full profile only) |
| `isBot` | `isBot` | CORRECT per SDK types. skill.md says `isBotFlagged`. Another inconsistency to test. |
| `isWhale` | `isWhale` | CORRECT per SDK types. skill.md says `isWhaleFlagged`. |

Real HUD also includes fields the guide misses entirely: `walletAddress`, `signalType`, `avgTxValueSol`, `behaviorCategory`, `avgTradesPerDay`, `uniqueTokensPerDay`, `currentHoldingsSol`, `currentHoldingsUsd`, `calculatedAt`, `provenance`.

### Holder Profiles Response Shape -- SUBSTANTIALLY WRONG

The guide fabricates this structure:
```json
{ "data": { "holders": [{ "behaviorCode": "SNIPER", "winRate": 0.81, ... }], "distribution": { "SNIPER": 14, ... } } }
```

Real structure (from SDK `HolderProfilesResult` type):
```json
{
  "mode": "token",
  "tokenMint": "...",
  "profiles": [{
    "walletAddress": "...",
    "rank": 1,
    "supplyPercent": 0.05,
    "behaviorType": "SNIPER",     // NOT behaviorCode
    "dataQualityTier": "GOLD",
    "medianHoldTimeHours": 0.5,
    "exitPattern": "partial",
    "completedCycleCount": 12,
    "confidence": 0.85,
    "walletPnlSol": 45.2,
    "solBalance": 120.0
  }],
  "metadata": {
    "totalHoldersRequested": 20,
    "totalHoldersAnalyzed": 18,
    "totalProcessingTimeMs": 4500,
    "avgProcessingTimePerWalletMs": 250
  }
}
```

Key differences:
- Field is `behaviorType`, NOT `behaviorCode` (different from HUD which uses `behaviorCode`)
- No `distribution` summary object -- the guide invented it entirely
- No `winRate` per holder -- instead has `walletPnlSol`, `confidence`, `completedCycleCount`
- No `holdingValueUsd` -- instead `tokenHoldingValueSol` and `supplyPercent`
- Array is `profiles`, not `holders`
- Uses `pollHolderProfiles()` convenience method, NOT manual job polling

### Similarity Response Shape -- PARTIALLY WRONG

Guide fabricates:
```json
{ "pairs": [{ "binaryScore": 0.91, "capitalScore": 0.87, "sharedTokenCount": 18 }],
  "globalMetrics": { "averageSimilarity": 0.64, "clusterCount": 2 } }
```

Real structure (from SDK `SimilarityResult` type):
```json
{
  "vectorTypeUsed": "combined",
  "pairwiseSimilarities": [{
    "walletA": "...", "walletB": "...",
    "binaryScore": 0.91,
    "capitalScore": 0.87,
    "sharedTokens": [{ "mint": "..." }],
    "capitalAllocation": { "mint": { "weightA": 0.3, "weightB": 0.25 } },
    "binarySharedTokenCount": 18,
    "binaryUniqueTokenCountA": 25,
    "binaryUniqueTokenCountB": 30,
    "capitalSharedTokenCount": 15,
    "capitalUniqueTokenCountA": 22,
    "capitalUniqueTokenCountB": 28
  }],
  "globalMetrics": {
    "averageSimilarity": 0.64,
    "mostSimilarPairs": [{ "walletA": "...", "walletB": "...", "similarityScore": 0.91, "sharedTokenCount": 18 }]
  },
  "uniqueTokensPerWallet": { "walletAddr": { "binary": 25, "capital": 22 } }
}
```

Key differences:
- Array is `pairwiseSimilarities`, NOT `pairs`
- `sharedTokenCount` is actually `binarySharedTokenCount`
- `clusterCount` does NOT exist -- entirely fabricated
- Real structure includes `sharedTokens` array with mints, `capitalAllocation`, and per-wallet unique token counts
- `globalMetrics.mostSimilarPairs` exists instead of `maxSimilarity`

### What The Fix Requires

An agent CAN fix this. The instructions need to include:
1. The exact SDK type definitions (copy from types.d.ts above)
2. The real constructor pattern (`SovaIntelClient` with `baseUrl` + `auth` object)
3. The real method names (flat: `getWalletHud`, `pollHolderProfiles`, `pollSimilarity`)
4. Instruction to use `pollHolderProfiles` and `pollSimilarity` convenience methods instead of manual polling (the SDK handles it internally)
5. The `shouldBuyToken` function needs rewriting to use `profile.behaviorType` instead of `holder.behaviorCode` and `profile.confidence` instead of `dataQualityTier`

**Estimated fix time for an agent: one pass with correct type definitions as input.**

---

## 3. The Tweet Drafts

### Draft 1 ("Gap Statement") -- GOOD TO POST
- All claims verified. 8 behavioral types: real. 1 credit per HUD call: real.
- `docs.sova-intel.com` URL works (though Docusaurus had a rendering hiccup, the site exists).
- No changes needed beyond founder's tone preferences.

### Draft 2 ("x402 Hook") -- GOOD TO POST
- x402 is real and documented in skill.md with full implementation details.
- `sova-intel.com/skill.md` URL is live and returns real content.
- "No signup. No key management." -- accurate, x402Auth requires only a payment callback, no API key.
- Postable as-is.

### Draft 3 ("Colosseum Thread") -- ONE FIX REQUIRED
- "454 agents" is unverified. The campaign doc says "400+ teams from Jan 2025 hackathon." The agent itself flagged uncertainty. Replace with "Hundreds of agents" or find the real number.
- Rest of thread is accurate: 8 behavioral types, confidence-scored, structured JSON, x402 native -- all verified.

### Overall: 2 of 3 drafts are postable today. Draft 3 needs one line changed. This is a good output.

---

## 4. The Outreach Targets

### GENUINELY GOOD LEADS (5 of 10):

1. **@sendaifun** -- Tier 1, verified. Solana Agent Kit is real (GitHub: sendaifun/solana-agent-kit). No wallet behavioral intelligence plugin exists. Highest-leverage target. Audience claim "50K+ followers" needs verification but the target itself is excellent.

2. **@elizaos** -- Tier 1, verified. ElizaOS is real (17,600+ stars). No behavioral profiling plugin. The @elizaos handle and core maintainer names match public info. Audience "100K+ followers" needs verification.

3. **@thearyanag** -- Verified Solana Agent Kit contributor. PR #433 (Pump.fun) is a real, checkable claim. Active builder.

4. **@scriptscrypt** -- Verified contributor. MCP documentation and LLMs.txt contributions (#436, #432) are specific and checkable.

5. **@michaelessiet** -- Verified contributor. Magic Eden #435, Raydium Launchlab #437 are specific PRs.

### WEAK OR QUESTIONABLE (5 of 10):

6. **@jsonhedman** -- Handle association with The Hive/$BUZZ is UNVERIFIED. The campaign doc mentions "The Hive team" but never names this handle. If the handle is wrong, you DM a stranger. Must verify before outreach.

7. **@aimaster-dev** -- Listed as GitHub-only with "2K followers." If this person doesn't have an X account with open DMs, they're not a DM target. The repo (ai-agent-solana) sounds plausible but unverified.

8. **@langlor** -- "<1K followers", GitHub-only. Same DM reachability problem. Small audience, unverified project.

9. **@TinaSend** -- "AI agent token on Pump.fun." This is a meme/token project. Quality and seriousness as an integration partner is uncertain. Low confidence lead.

10. **@D3AD-E** -- Solana sniper bot developer. Legitimate niche, but your product DETECTS snipers. The outreach angle is awkward -- you're selling them a tool that exposes their own behavior. Needs very careful framing or should be replaced.

### Verdict: 5 solid, 5 questionable. The list needs 10 more targets (20 total for Week 2), and the 5 weak ones should be either verified or replaced. The agent did well on Tier 1 and Solana Agent Kit contributors but padded the list with unverifiable GitHub accounts.

---

## 5. Is This Agent System Actually Helping?

**Honest answer: Yes, but only about 40% of the way.**

### What the agents did well:
- **Speed.** Three deliverables in one session. A founder doing all of this solo would need 4-6 hours minimum.
- **Structure.** The guide, social drafts, and outreach list all follow correct formats. The frameworks are sound even when the details are wrong.
- **Self-awareness.** The social agent flagged its own unverified claim ("454 agents"). The guide agent correctly described the async polling pattern. These are not mindless outputs.

### What the agents got wrong:
- **Every SDK method name.** The guide uses `sova.wallet.hud()` when the real method is `sova.getWalletHud()`. It uses `sova.token.holders()` when the real method is `sova.pollHolderProfiles()`. This isn't a minor detail -- a developer who copies this code gets immediate errors.
- **Every response shape.** Field names, nesting structure, and even the presence/absence of fields are fabricated. `totalPnlUsd` doesn't exist. `distribution` object doesn't exist. `clusterCount` doesn't exist. `pairs` should be `pairwiseSimilarities`. `behaviorCode` in holders should be `behaviorType`.
- **Unverifiable claims.** Follower counts, handle associations, hackathon statistics.

### The root cause:
The agents were given conceptual descriptions of the API (from the playbook and campaign doc) but NOT the actual SDK types or real API responses. They filled in the gaps with plausible fabrications. This is exactly what LLMs do when given incomplete information.

### What needs to change:
1. **Give agents the real SDK types as input.** The `types.d.ts` file from `@sova-intel/sdk` contains the ground truth for every response shape and method signature. Any agent writing code or JSON examples MUST receive this file as context.
2. **Give agents one real API response per endpoint.** The founder needs to make one HUD call, one holder profiles call, and one similarity call, and save the raw JSON. These become the reference for all content.
3. **Stop using the campaign doc Section 3 as a code reference.** That section contains the same fabricated patterns the guide copied. It's a planning document, not a technical reference.

### Is it creating more work?
Right now, partially. The manager review + this assessment = ~2 hours of verification work. But the fix is straightforward: correct the input, and the agents produce correct output. The first day was the most expensive in terms of verification because we didn't have real API data to give them. Once we do, the quality gap closes significantly.

---

## 6. What Should Happen Next

**Answer: (b) -- Specific things need to be fixed with better instructions. Nothing needs to be scrapped.**

### The ONE thing the founder must do before any agent gets dispatched again:

**Run three real API calls and save the raw JSON responses.**

```bash
# 1. HUD call
curl -H "X-Api-Key: $SOVA_API_KEY" \
  https://api.sova-intel.com/api/v1/intel/wallet/KNOWN_WALLET_ADDRESS/hud > hud-response.json

# 2. Holder profiles (async -- note the jobId, then poll)
curl -X POST -H "X-Api-Key: $SOVA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"topN": 10}' \
  https://api.sova-intel.com/api/v1/intel/token/KNOWN_TOKEN_MINT/holders > holders-job.json

# 3. Similarity (async -- same pattern)
curl -X POST -H "X-Api-Key: $SOVA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"wallets": ["ADDR1", "ADDR2", "ADDR3"]}' \
  https://api.sova-intel.com/api/v1/intel/wallets/similarity > similarity-job.json
```

Then poll the jobs and save the completed results.

### After that, dispatch sequence:

1. **technical-content-writer** -- Rewrite guide code blocks using the real SDK types (provide `types.d.ts` and `client.d.ts` as context) and real API response JSON. This is a fix pass, not a rewrite. The narrative stays. Every code block and JSON example gets replaced.

2. **social-content-generator** -- Fix "454 agents" to "Hundreds of agents" in Draft 3. Generate Day 2 drafts using real HUD data from the API calls above (token holder breakdown, wallet spotlight).

3. **outreach-researcher** -- Produce 10 more verified targets. Verify @jsonhedman handle. Confirm @aimaster-dev and @langlor have X accounts with open DMs. Replace any that fail verification.

4. **Founder** -- Review and post 2 tweets today (Drafts 1 and 2 are ready). Design wallet profile card format (still outstanding from Day 1 playbook).

### What the agents CANNOT do for you:
- Run the API calls (they don't have your key)
- Post tweets (your credibility is the asset)
- Send DMs (same reason)
- Decide whether the agent-builder guide replaces the Telegram bot guide from the original playbook

---

## Appendix: SDK Reference (Ground Truth)

The real SDK is exported as `SovaIntelClient` from `@sova-intel/sdk`. Key facts:

- **Constructor:** `new SovaIntelClient({ baseUrl: "https://api.sova-intel.com/api/v1", auth: { kind: "apikey", apiKey: "..." } })`
- **Methods:** `getWalletHud(addr)`, `getWalletProfile(addr)`, `getWalletTokens(addr, params?)`, `batchHud(wallets[])`, `queueHolderProfiles(mint, topN?)`, `pollHolderProfiles(mint, topN?)`, `queueSimilarity(wallets[])`, `pollSimilarity(wallets[])`
- **HUD type name:** `WalletHud` -- key fields: `walletAddress`, `behaviorCode`, `winRate`, `trimmedMeanPnl`, `dataQualityTier`, `isBot`, `isWhale`, `medianHoldTimeHours`, `avgTradesPerDay`, `calculatedAt`
- **Holder type name:** `HolderProfile` -- key fields: `walletAddress`, `rank`, `supplyPercent`, `behaviorType` (NOT behaviorCode), `dataQualityTier`, `confidence`, `completedCycleCount`, `medianHoldTimeHours`, `exitPattern`, `walletPnlSol`
- **Similarity type name:** `SimilarityResult` -- key fields: `pairwiseSimilarities[]` (NOT pairs), each with `binaryScore`, `capitalScore`, `binarySharedTokenCount`, `sharedTokens[]`; `globalMetrics` with `averageSimilarity` and `mostSimilarPairs[]` (NO clusterCount)
- **Convenience methods** `pollHolderProfiles` and `pollSimilarity` handle the async job polling internally -- no need for manual polling loops in guide code.

This appendix should be provided to the technical-content-writer agent as mandatory context for the guide fix pass.
