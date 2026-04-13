# @sova-intel/mcp

MCP server for [Sova Intel](https://sova-intel.com) — on-chain wallet and token intelligence for AI agents.

Ask natural-language questions about Solana wallets and token holders from any MCP-compatible client. Get behavioral profiles, holder maps, coordination scores, and per-token PnL — without writing a single line of code.

## What you can ask

```
What kind of trader is DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm?
```
```
Who are the top holders of J5DnHXXmKsXmCAeSvPRc5qR64ruYKcZHKwZijv9HnZgK
and what are their trading styles?
```
```
Do any of those holders look coordinated or like the same actor?
```

That's it. The MCP handles the API calls, async jobs, and polling automatically.

## Quickstart

**1. Get an API key** at [sova-intel.com](https://sova-intel.com)

**2. Add to your MCP client**

Claude Code (one command):
```bash
claude mcp add sova-intel -e SOVA_API_KEY=ak_your_key -- npx -y "@sova-intel/mcp"
```

Claude Desktop — add to `claude_desktop_config.json`:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`

Cursor — add to `.cursor/mcp.json` in your project root.

```json
{
  "mcpServers": {
    "sova-intel": {
      "command": "npx",
      "args": ["-y", "@sova-intel/mcp"],
      "env": { "SOVA_API_KEY": "ak_your_key" }
    }
  }
}
```

**3. Restart your client** and confirm `sova-intel` appears connected.

**4. Ask your first question** — paste any of the prompts above.

### No API key?

Use X402 mode — pay per call with Solana USDC, no account needed:

```json
{
  "mcpServers": {
    "sova-intel": {
      "command": "npx",
      "args": ["-y", "@sova-intel/mcp"],
      "env": {
        "SOLANA_PRIVATE_KEY": "your_base58_keypair"
      }
    }
  }
}
```

Requires USDC in that wallet. See `env.example` for all config options.

## Tools

| Tool | What it returns | Credits |
|------|----------------|---------|
| `wallet_hud` | Behavior type, win rate, hold time, data quality | 1cr |
| `wallet_profile` | Full wallet intel — HUD + PnL + behavior + KOL identity | 5cr |
| `wallet_token_pnl` | Per-token PnL breakdown, paginated | 3cr |
| `batch_wallet_hud` | HUD signals for up to 30 wallets | 5cr flat |
| `token_holder_profiles` | Behavioral profiles for a token's top holders | 20cr |
| `wallet_similarity` | Coordination / sybil score for 2–30 wallets | 20cr |
| `deep_token_analysis` | Holder profiles + similarity in one call | 35cr |
| `job_status` | Check a queued job | 0cr |
| `job_wait` | Resume a queued job and get the result | 0cr |

`token_holder_profiles`, `wallet_similarity`, and `deep_token_analysis` queue analysis server-side. If results aren't ready within the poll window they return a `jobId` — the MCP automatically resumes with `job_wait`. **Credits are charged once regardless of poll rounds.**

## Resources

- `sova://pricing` — live credit costs
- `sova://skill` — full tool reference
- `sova://help/auth` — auth setup guide

## Examples

[`examples/smoke-test-transcript.md`](examples/smoke-test-transcript.md) — real session showing `wallet_hud`, async `token_holder_profiles → job_wait`, and `wallet_similarity` with actual output.

## License

MIT
