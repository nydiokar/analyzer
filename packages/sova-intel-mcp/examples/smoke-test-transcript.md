# Smoke test transcript

Real session — Claude Code with `sova-intel · ✓ connected` confirmed via `/mcp`.

## 1. wallet_hud — live call

**Input:**
```json
{ "walletAddress": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm" }
```

**Output:**
```json
{
  "ok": true,
  "tool": "wallet_hud",
  "mode": "completed",
  "summary": "D profile, win rate 30%, median hold 12.9h, data quality GOLD, whale.",
  "data": {
    "walletAddress": "DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm",
    "behaviorCode": "D",
    "behaviorCategory": "DAY_TRADER",
    "winRate": 0.2987,
    "medianHoldTimeHours": 12.876,
    "dataQualityTier": "GOLD",
    "isBot": false,
    "isWhale": true,
    "currentHoldingsSol": 777.22,
    "currentHoldingsUsd": 62892.76,
    "calculatedAt": "2026-04-04T18:11:30.273Z"
  },
  "job": null,
  "meta": { "source": "sova-intel-api", "authMode": "apikey" }
}
```

## 2. token_holder_profiles — async flow

Analysis took >45s, so the MCP returned a queued envelope. `job_wait` retrieved the result. **Credits charged once.**

**Step 1 — token_holder_profiles:**
```json
{ "tokenMint": "J5DnHXXmKsXmCAeSvPRc5qR64ruYKcZHKwZijv9HnZgK", "topN": 10 }
```

**Response (mode: queued):**
```json
{
  "ok": true,
  "tool": "token_holder_profiles",
  "mode": "queued",
  "summary": "Analysis still running for J5DnHXXm…. Use job_wait to retrieve the result.",
  "data": null,
  "job": {
    "jobId": "holder-profiles-J5DnHXXmKsXmCAeSvPRc5qR64ruYKcZHKwZijv9HnZgK-10-...",
    "agentResultKey": "holder-profiles:agent:result:holder-profiles-J5DnHXXm...",
    "resumeTool": "job_wait",
    "resultType": "agent_holder_profiles"
  },
  "meta": { "source": "sova-intel-api", "authMode": "apikey" }
}
```

**Step 2 — job_wait:**
```json
{
  "jobId": "holder-profiles-J5DnHXXm...",
  "agentResultKey": "holder-profiles:agent:result:holder-profiles-J5DnHXXm..."
}
```

**Response (mode: completed):**
```json
{
  "ok": true,
  "tool": "job_wait",
  "mode": "completed",
  "data": {
    "aggregate": {
      "totalHolders": 10,
      "analyzedHolders": 9,
      "top5SupplyPct": 17.98,
      "behaviorDistribution": [
        { "behaviorType": "INTRADAY", "count": 4, "supplyPct": 11.898 },
        { "behaviorType": "MOMENTUM", "count": 2, "supplyPct": 6.608 },
        { "behaviorType": "SWING",    "count": 1, "supplyPct": 3.728 },
        { "behaviorType": "DAY_TRADER", "count": 1, "supplyPct": 3.407 },
        { "behaviorType": "SNIPER",   "count": 1, "supplyPct": 2.965 }
      ],
      "avgWalletPnlSol": -260.73
    }
  },
  "job": null,
  "meta": { "source": "sova-intel-api", "authMode": "apikey" }
}
```

## 3. wallet_similarity — coordination check

Same token's 9 analyzable holders passed directly into similarity.

**Output:**
```json
{
  "ok": true,
  "tool": "wallet_similarity",
  "mode": "completed",
  "summary": "coordination score 0.28 (LOW), 9 wallets, 6 flagged pairs.",
  "data": {
    "coordinationScore": 0.277,
    "pairs": [
      {
        "walletA": "2jjgBEwQqhUXRPjSqGqwsWCkqgRsZ7MkT3kTeWJJ8e7Q",
        "walletB": "ACp9B94HaNELWmcf2941kUKMGz8AMQHEBJsM4s6UBEKN",
        "similarityScore": 0.82,
        "sharedTokenCount": 677,
        "overlapPctA": 0.444,
        "overlapPctB": 0.491,
        "flag": "HIGH_SIMILARITY_AND_OVERLAP"
      }
    ],
    "metadata": {
      "walletsAnalyzed": 9,
      "totalPairs": 36,
      "meaningfulPairs": 7,
      "flaggedPairs": 6
    }
  },
  "job": null,
  "meta": { "source": "sova-intel-api", "authMode": "apikey" }
}
```
