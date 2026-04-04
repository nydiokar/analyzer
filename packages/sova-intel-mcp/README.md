# @sova-intel/mcp

MCP server for [Sova Intel](https://sova-intel.com) — on-chain wallet and token intelligence for AI agents.

Behavioral wallet profiles, holder maps, coordination detection, per-token PnL. Pay via API key or X402 (Solana USDC).

## Install

```bash
claude mcp add sova-intel -e SOVA_API_KEY=ak_your_key -- npx -y @sova-intel/mcp
```

Or add to your MCP client config manually:

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

- **Claude Desktop** — `%APPDATA%\Claude\claude_desktop_config.json` (Windows) / `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac)
- **Claude Code** — `claude mcp add` command above, or `.mcp.json` in project root
- **Cursor** — `.cursor/mcp.json` in project root

Get an API key at [sova-intel.com](https://sova-intel.com).

**No API key?** Use X402 mode — pay per call with Solana USDC, no account needed:

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

`token_holder_profiles`, `wallet_similarity`, and `deep_token_analysis` are async — if analysis exceeds the poll window they return `mode: "queued"` with a `jobId`. Call `job_wait` to resume. Credits are charged once regardless of poll rounds.

## Resources & prompts

- `sova://pricing` — live credit costs
- `sova://skill` — full tool reference
- `sova://help/auth` — auth setup guide
- `sova://playbooks/token-analysis` — step-by-step token analysis decision tree
- `analyze_token` prompt — runs `token_holder_profiles` → `wallet_similarity` in sequence, handles async automatically (40cr)

## Examples

See [`examples/smoke-test-transcript.md`](examples/smoke-test-transcript.md) for a real session showing `wallet_hud`, the async `token_holder_profiles → job_wait` flow, and `wallet_similarity`.

## License

MIT
