import { z } from "zod";
import type { SovaIntelClient, WalletHud } from "@sova-intel/sdk";
import { isPollTimeoutError, type PollOptions } from "../core/polling.js";
import { completedResult, queuedResult, toMcpContent } from "../core/result.js";
import { handleToolError } from "../core/handle-error.js";
import type { ToolCostMap } from "../core/pricing.js";
import { summarizeWalletHud } from "../core/summary.js";

export const walletHudSchema = z.object({
  walletAddress: z.string().min(32).max(44).describe("Solana wallet address (base58)"),
});

export async function walletHudHandler(
  args: z.infer<typeof walletHudSchema>,
  client: SovaIntelClient,
  authMode: string,
  toolCosts: ToolCostMap,
  pollOptions: PollOptions = {},
) {
  let raw;
  try {
    raw = await client.fetchWalletHud(args.walletAddress);
  } catch (err) {
    return handleToolError("wallet_hud", err, authMode, toolCosts);
  }

  // Fresh — return immediately
  if (!("status" in raw && raw.status === "queued")) {
    return { content: [toMcpContent(completedResult("wallet_hud", summarizeWalletHud(raw as WalletHud), raw, authMode))] };
  }

  // Stale — poll job status, then re-fetch with prepaid job id
  const queued = raw;
  const prepaidJobId = queued.prepaidJobId ?? queued.jobId;

  try {
    await client.waitForJob(queued.jobId, pollOptions);
    const hud = await client.fetchWalletHudPrepaid(args.walletAddress, prepaidJobId);
    return { content: [toMcpContent(completedResult("wallet_hud", summarizeWalletHud(hud), hud, authMode))] };
  } catch (err) {
    if (isPollTimeoutError(err)) {
      return {
        content: [toMcpContent(queuedResult(
          "wallet_hud",
          `Analysis still running for ${args.walletAddress.slice(0, 8)}…. Use job_wait to retrieve the result.`,
          {
            jobId: queued.jobId,
            prepaidJobId,
            monitoringUrl: queued.monitoringUrl,
            resumeTool: "job_wait",
            resultType: "wallet_hud",
            input: args.walletAddress,
          },
          authMode,
        ))],
      };
    }
    return handleToolError("wallet_hud", err, authMode, toolCosts);
  }
}
