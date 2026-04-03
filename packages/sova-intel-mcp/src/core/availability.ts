// ---------------------------------------------------------------------------
// Availability — which tools are usable in each auth mode.
// ---------------------------------------------------------------------------

import type { ResolvedAuth } from "../auth/resolve-auth-mode.js";
import { errorResult, type ToolResult } from "./result.js";

const ALWAYS_AVAILABLE = new Set([
  "sova://pricing",
  "sova://skill",
  "sova://help/auth",
]);

const PAID_TOOLS = new Set([
  "wallet_hud",
  "wallet_profile",
  "wallet_token_pnl",
  "batch_wallet_hud",
  "token_holder_profiles",
  "wallet_similarity",
  "deep_token_analysis",
  // job_status is free (no auth per API contract) — not blocked in limited mode
  "job_wait", // requires auth to hydrate the result key
]);

export function checkAvailability(
  toolName: string,
  resolved: ResolvedAuth,
): ToolResult | null {
  if (ALWAYS_AVAILABLE.has(toolName)) return null;
  if (PAID_TOOLS.has(toolName) && resolved.mode === "limited") {
    return errorResult(
      toolName,
      "limited_mode_unavailable",
      `${toolName} requires authentication. Set SOVA_API_KEY or SOLANA_PRIVATE_KEY.`,
      "limited",
      {
        missingConfig: ["SOVA_API_KEY", "SOLANA_PRIVATE_KEY"],
        remedy: "Set SOVA_API_KEY=ak_your_key in the MCP server environment.",
      },
    );
  }
  return null;
}
