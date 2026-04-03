#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Sova Intel MCP — entrypoint (stdio transport)
// ---------------------------------------------------------------------------

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { resolveAuth } from "./auth/resolve-auth-mode.js";
import { createSovaClient } from "./client/create-sova-client.js";
import { fetchToolCosts, type ToolCostMap } from "./core/pricing.js";
import { createServer } from "./server.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`[sova-intel-mcp] Config error: ${(err as Error).message}`);
    process.exit(1);
  }

  const resolved = resolveAuth(config);

  if (resolved.mode === "limited") {
    console.error(
      "[sova-intel-mcp] Starting in limited mode — no auth configured.\n" +
      "  Set SOVA_API_KEY or SOLANA_PRIVATE_KEY to enable analysis tools.\n" +
      "  Resources (pricing, skill, auth help) are available.",
    );
  } else {
    console.error(`[sova-intel-mcp] Auth mode: ${resolved.mode}`);
  }

  // Fetch live pricing once at startup — used for actionable payment_error messages.
  // Non-fatal: if the fetch fails, tools still work but payment errors won't include cost details.
  let toolCosts: ToolCostMap = {};
  try {
    toolCosts = await fetchToolCosts(config.baseUrl);
    console.error(`[sova-intel-mcp] Pricing loaded (${Object.keys(toolCosts).length} tools).`);
  } catch (err) {
    console.error(`[sova-intel-mcp] Warning: could not fetch pricing — payment error messages will omit cost details. (${(err as Error).message})`);
  }

  const client = resolved.mode !== "limited"
    ? createSovaClient(config, resolved)
    : null;

  const server = createServer(config, resolved, client, toolCosts);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[sova-intel-mcp] Ready.");
}

main().catch((err) => {
  console.error("[sova-intel-mcp] Fatal:", err);
  process.exit(1);
});
