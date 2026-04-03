// ---------------------------------------------------------------------------
// Creates a configured SovaIntelClient from resolved auth + config.
// ---------------------------------------------------------------------------

import { SovaIntelClient } from "@sova-intel/sdk";
import type { McpConfig } from "../config.js";
import type { ResolvedAuth } from "../auth/resolve-auth-mode.js";

export function createSovaClient(
  config: McpConfig,
  resolved: ResolvedAuth,
): SovaIntelClient {
  if (resolved.mode === "limited") {
    throw new Error("Cannot create SDK client in limited mode — no auth configured.");
  }

  return new SovaIntelClient({
    baseUrl: config.baseUrl,
    auth: resolved.auth,
    pollIntervalMs: config.pollIntervalMs,
    maxPollAttempts: config.maxPollAttempts,
  });
}
