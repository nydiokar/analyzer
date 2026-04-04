# Sova Intel MCP

MCP server for Sova Intel wallet and token intelligence.

## Install

### Claude Desktop

Windows config: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sova-intel": {
      "command": "npx",
      "args": ["-y", "sova-intel-mcp"],
      "env": {
        "SOVA_API_KEY": "ak_your_key"
      }
    }
  }
}
```

### Claude Code

Project config: `.mcp.json`

```json
{
  "mcpServers": {
    "sova-intel": {
      "command": "npx",
      "args": ["-y", "sova-intel-mcp"],
      "env": {
        "SOVA_API_KEY": "ak_your_key"
      }
    }
  }
}
```

## Environment

Required for API key mode:

```text
SOVA_API_KEY=ak_your_key
```

Optional:

```text
SOVA_BASE_URL=https://api.sova-intel.com/api/v1
SOVA_AUTH_MODE=auto
SOVA_WAIT_TIMEOUT_MS=45000
SOVA_DEEP_WAIT_TIMEOUT_MS=45000
SOVA_POLL_INTERVAL_MS=5000
SOVA_MAX_POLL_ATTEMPTS=9
```

Advanced `x402` mode:

```text
SOVA_AUTH_MODE=x402
SOLANA_PRIVATE_KEY=your_base58_keypair
SOLANA_RPC_URL=https://your-rpc-endpoint
```

## Tools

- `wallet_hud`: fastest wallet triage, 1 credit
- `wallet_profile`: full wallet intelligence, 5 credits
- `wallet_token_pnl`: per-token wallet breakdown, 3 credits
- `batch_wallet_hud`: batch HUD scan for up to 30 wallets, 5 credits flat
- `token_holder_profiles`: agent-optimized holder analysis, 20 credits
- `wallet_similarity`: agent-optimized coordination analysis, 20 credits
- `deep_token_analysis`: holder profiles plus similarity, 35 credits
- `job_status`: inspect a queued job, 0 credits
- `job_wait`: resume queued work, 0 credits

## Resources

- `sova://pricing`
- `sova://skill`
- `sova://help/auth`

## Example invocations

### `batch_wallet_hud`

Request:
```json
{
  "wallets": [
    "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
  ]
}
```

Response:
```json
{
  "ok": true,
  "tool": "batch_wallet_hud",
  "mode": "completed",
  "summary": "2 HUDs ready.",
  "data": {
    "huds": {
      "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU": {
        "behaviorCode": "SWING_TRADER",
        "winRate": 0.61,
        "medianHoldTimeHours": 18.4,
        "dataQualityTier": "GOLD",
        "isBot": false,
        "isWhale": false
      },
      "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": {
        "behaviorCode": "SCALPER",
        "winRate": 0.44,
        "medianHoldTimeHours": 0.3,
        "dataQualityTier": "SILVER",
        "isBot": false,
        "isWhale": false
      }
    },
    "queued": [],
    "skipped": [],
    "calculatedAt": "2026-04-04T10:00:00.000Z"
  },
  "job": null,
  "meta": { "source": "sova-intel-api", "authMode": "apikey" }
}
```

### `wallet_similarity`

Request:
```json
{
  "wallets": [
    "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "3FHpkMTQ3QyAJoLoXvdAJ8e7B9d3KGxQZ5zWriTuYoGB"
  ]
}
```

Response:
```json
{
  "ok": true,
  "tool": "wallet_similarity",
  "mode": "completed",
  "summary": "coordination score 0.74 (HIGH), 3 wallets, 2 flagged pairs.",
  "data": {
    "coordinationScore": 0.74,
    "pairs": [
      {
        "walletA": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        "walletB": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        "similarityScore": 0.81,
        "sharedTokenCount": 14,
        "portfolioSizeA": 22,
        "portfolioSizeB": 19,
        "overlapPctA": 0.64,
        "overlapPctB": 0.74,
        "flag": "HIGH_SIMILARITY_AND_OVERLAP"
      }
    ],
    "globalMetrics": { "averageSimilarity": 0.61 },
    "metadata": {
      "walletsAnalyzed": 3,
      "totalPairs": 3,
      "meaningfulPairs": 2,
      "flaggedPairs": 2
    }
  },
  "job": null,
  "meta": { "source": "sova-intel-api", "authMode": "apikey" }
}
```
