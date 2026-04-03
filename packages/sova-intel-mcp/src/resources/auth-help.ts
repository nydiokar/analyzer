// ---------------------------------------------------------------------------
// sova://help/auth — setup and auth help, always available
// ---------------------------------------------------------------------------

export function authHelpResourceHandler(): string {
  return `# Sova Intel MCP — Auth Setup

## Option A — API Key (recommended)

Set the following environment variable in your MCP client config:

  SOVA_API_KEY=ak_your_key

Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json on Mac):

{
  "mcpServers": {
    "sova-intel": {
      "command": "npx",
      "args": ["-y", "sova-intel-mcp"],
      "env": { "SOVA_API_KEY": "ak_your_key" }
    }
  }
}

Claude Code (project .mcp.json):

{
  "mcpServers": {
    "sova-intel": {
      "command": "npx",
      "args": ["-y", "sova-intel-mcp"],
      "env": { "SOVA_API_KEY": "ak_your_key" }
    }
  }
}

Get an API key: https://docs.sova-intel.com

## Option B — X402 (autonomous, no account needed)

Set:
  SOVA_AUTH_MODE=x402
  SOLANA_PRIVATE_KEY=your_base58_keypair

The MCP pays for each request automatically using USDC from your wallet.

Optional: SOLANA_RPC_URL=https://your-rpc-endpoint (defaults to mainnet-beta public RPC)

## Auth modes

  SOVA_AUTH_MODE=auto     (default) API key if set, else X402, else limited mode
  SOVA_AUTH_MODE=apikey   Requires SOVA_API_KEY
  SOVA_AUTH_MODE=x402     Requires SOLANA_PRIVATE_KEY

## Limited mode

When no auth is configured, the MCP starts in limited mode.
Only sova://pricing, sova://skill, and sova://help/auth are available.
All analysis tools require authentication.
`;
}
