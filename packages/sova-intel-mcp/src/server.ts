// ---------------------------------------------------------------------------
// Sova Intel MCP — server registration
// ---------------------------------------------------------------------------

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SovaIntelClient } from "@sova-intel/sdk";
import type { McpConfig } from "./config.js";
import type { ResolvedAuth } from "./auth/resolve-auth-mode.js";
import type { ToolCostMap } from "./core/pricing.js";

import { checkAvailability } from "./core/availability.js";
import { errorResult, toMcpContent } from "./core/result.js";

import { walletHudSchema, walletHudHandler } from "./tools/wallet-hud.js";
import { walletProfileSchema, walletProfileHandler } from "./tools/wallet-profile.js";
import { walletTokenPnlSchema, walletTokenPnlHandler } from "./tools/wallet-token-pnl.js";
import { batchWalletHudSchema, batchWalletHudHandler } from "./tools/batch-wallet-hud.js";
import { tokenHolderProfilesSchema, tokenHolderProfilesHandler } from "./tools/token-holder-profiles.js";
import { walletSimilaritySchema, walletSimilarityHandler } from "./tools/wallet-similarity.js";
import { deepTokenAnalysisSchema, deepTokenAnalysisHandler } from "./tools/deep-token-analysis.js";
import { jobStatusSchema, jobStatusHandler } from "./tools/job-status.js";
import { jobWaitSchema, jobWaitHandler } from "./tools/job-wait.js";

import { pricingResourceHandler } from "./resources/pricing.js";
import { skillResourceHandler } from "./resources/skill.js";
import { authHelpResourceHandler } from "./resources/auth-help.js";

function toPollOptions(timeoutMs: number, pollIntervalMs: number, maxPollAttempts: number) {
  return {
    intervalMs: pollIntervalMs,
    maxAttempts: Math.max(1, Math.min(maxPollAttempts, Math.ceil(timeoutMs / pollIntervalMs))),
  };
}

export function createServer(
  config: McpConfig,
  resolved: ResolvedAuth,
  client: SovaIntelClient | null,
  toolCosts: ToolCostMap,
): McpServer {
  const server = new McpServer({
    name: "sova-intel",
    version: "0.1.0",
  });

  const authMode = resolved.mode;
  const standardPollOptions = toPollOptions(
    config.waitTimeoutMs,
    config.pollIntervalMs,
    config.maxPollAttempts,
  );
  const deepPollOptions = toPollOptions(
    config.deepWaitTimeoutMs,
    config.pollIntervalMs,
    config.maxPollAttempts,
  );

  // Helper: guard paid tools in limited mode
  function guardedClient(toolName: string): SovaIntelClient | null {
    const unavailable = checkAvailability(toolName, resolved);
    return unavailable ? null : client;
  }

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  server.tool(
    "wallet_hud",
    "Fastest, cheapest wallet signal (1cr). Returns behavior type, win rate, hold time, data quality. Use this first for any wallet inquiry.",
    walletHudSchema.shape,
    async (args) => {
      const c = guardedClient("wallet_hud");
      if (!c) {
        const r = errorResult("wallet_hud", "limited_mode_unavailable", "Requires authentication. See sova://help/auth.", authMode);
        return { content: [toMcpContent(r)], isError: true };
      }
      return walletHudHandler(args, c, authMode, toolCosts);
    },
  );

  server.tool(
    "wallet_profile",
    "Full wallet intelligence (5cr). Returns everything in wallet_hud plus full PnL, behavior detail, and KOL identity. Escalate from wallet_hud when deeper context is needed.",
    walletProfileSchema.shape,
    async (args) => {
      const c = guardedClient("wallet_profile");
      if (!c) {
        const r = errorResult("wallet_profile", "limited_mode_unavailable", "Requires authentication. See sova://help/auth.", authMode);
        return { content: [toMcpContent(r)], isError: true };
      }
      return walletProfileHandler(args, c, authMode, toolCosts);
    },
  );

  server.tool(
    "wallet_token_pnl",
    "Per-token PnL breakdown for a wallet (3cr). Paginated and sortable. Use to drill into which tokens a wallet profited or lost on.",
    walletTokenPnlSchema.shape,
    async (args) => {
      const c = guardedClient("wallet_token_pnl");
      if (!c) {
        const r = errorResult("wallet_token_pnl", "limited_mode_unavailable", "Requires authentication. See sova://help/auth.", authMode);
        return { content: [toMcpContent(r)], isError: true };
      }
      return walletTokenPnlHandler(args, c, authMode, toolCosts);
    },
  );

  server.tool(
    "batch_wallet_hud",
    "Batch HUD signal for up to 30 wallets (5cr flat). Returns available HUDs immediately; stale wallets are queued in the background (informational only).",
    batchWalletHudSchema.shape,
    async (args) => {
      const c = guardedClient("batch_wallet_hud");
      if (!c) {
        const r = errorResult("batch_wallet_hud", "limited_mode_unavailable", "Requires authentication. See sova://help/auth.", authMode);
        return { content: [toMcpContent(r)], isError: true };
      }
      return batchWalletHudHandler(args, c, authMode, toolCosts);
    },
  );

  server.tool(
    "token_holder_profiles",
    "Top-holder behavioral intelligence for a token (20cr). Returns agent-optimised result: aggregate behavior distribution, supply concentration, and per-holder profiles. Default entry point for token analysis.",
    tokenHolderProfilesSchema.shape,
    async (args) => {
      const c = guardedClient("token_holder_profiles");
      if (!c) {
        const r = errorResult("token_holder_profiles", "limited_mode_unavailable", "Requires authentication. See sova://help/auth.", authMode);
        return { content: [toMcpContent(r)], isError: true };
      }
      return tokenHolderProfilesHandler(args, c, authMode, toolCosts, standardPollOptions);
    },
  );

  server.tool(
    "wallet_similarity",
    "Coordination analysis for 2–30 wallets (20cr). Returns a single coordinationScore (0–1), flagged pairs, and overlap metrics. Default entry point for coordination/sybil questions.",
    walletSimilaritySchema.shape,
    async (args) => {
      const c = guardedClient("wallet_similarity");
      if (!c) {
        const r = errorResult("wallet_similarity", "limited_mode_unavailable", "Requires authentication. See sova://help/auth.", authMode);
        return { content: [toMcpContent(r)], isError: true };
      }
      return walletSimilarityHandler(args, c, authMode, toolCosts, standardPollOptions);
    },
  );

  server.tool(
    "deep_token_analysis",
    "Bundled holder profiles + similarity for a token (35cr). Server discovers holders automatically. Returns full developer shapes — not agent-optimised. Use token_holder_profiles + wallet_similarity separately for compact results.",
    deepTokenAnalysisSchema.shape,
    async (args) => {
      const c = guardedClient("deep_token_analysis");
      if (!c) {
        const r = errorResult("deep_token_analysis", "limited_mode_unavailable", "Requires authentication. See sova://help/auth.", authMode);
        return { content: [toMcpContent(r)], isError: true };
      }
      return deepTokenAnalysisHandler(args, c, authMode, toolCosts, deepPollOptions);
    },
  );

  server.tool(
    "job_status",
    "Check the status of a queued job. Returns status (waiting/active/completed/failed) and progress. Prefer job_wait for blocking resumption.",
    jobStatusSchema.shape,
    async (args) => {
      return jobStatusHandler(args, config.baseUrl, authMode);
    },
  );

  server.tool(
    "job_wait",
    "Resume a queued analysis job and retrieve its result. Pass jobId and agentResultKey (or resultKey) from the queued envelope. Polls until complete or times out with another queued envelope.",
    jobWaitSchema.shape,
    async (args) => {
      const c = guardedClient("job_wait");
      if (!c) {
        const r = errorResult("job_wait", "limited_mode_unavailable", "Requires authentication. See sova://help/auth.", authMode);
        return { content: [toMcpContent(r)], isError: true };
      }
      return jobWaitHandler(args, c, authMode, deepPollOptions);
    },
  );

  // -------------------------------------------------------------------------
  // Resources — always available
  // -------------------------------------------------------------------------

  server.resource(
    "pricing",
    "sova://pricing",
    { mimeType: "text/plain" },
    async () => ({
      contents: [{
        uri: "sova://pricing",
        mimeType: "text/plain",
        text: await pricingResourceHandler(config.baseUrl),
      }],
    }),
  );

  server.resource(
    "skill",
    "sova://skill",
    { mimeType: "text/plain" },
    async () => ({
      contents: [{
        uri: "sova://skill",
        mimeType: "text/plain",
        text: await skillResourceHandler(),
      }],
    }),
  );

  server.resource(
    "auth-help",
    "sova://help/auth",
    { mimeType: "text/plain" },
    () => ({
      contents: [{
        uri: "sova://help/auth",
        mimeType: "text/plain",
        text: authHelpResourceHandler(),
      }],
    }),
  );

  return server;
}
