import { z } from "zod";
import type { SovaIntelClient, WalletProfileResponse } from "@sova-intel/sdk";
import { isPollTimeoutError, type PollOptions } from "../core/polling.js";
import { completedResult, queuedResult, toMcpContent } from "../core/result.js";
import { handleToolError } from "../core/handle-error.js";
import type { ToolCostMap } from "../core/pricing.js";
import { summarizeWalletProfile } from "../core/summary.js";

export const walletProfileSchema = z.object({
  walletAddress: z.string().min(32).max(44).describe("Solana wallet address (base58)"),
});

export async function walletProfileHandler(
  args: z.infer<typeof walletProfileSchema>,
  client: SovaIntelClient,
  authMode: string,
  toolCosts: ToolCostMap,
  pollOptions: PollOptions = {},
) {
  let raw;
  try {
    raw = await client.fetchWalletProfile(args.walletAddress);
  } catch (err) {
    return handleToolError("wallet_profile", err, authMode, toolCosts);
  }

  // Fresh — return immediately
  if (!("status" in raw && raw.status === "queued")) {
    return { content: [toMcpContent(completedResult("wallet_profile", summarizeWalletProfile(raw as WalletProfileResponse), raw, authMode))] };
  }

  // Stale — poll job status, then re-fetch with prepaid job id
  const queued = raw;
  const prepaidJobId = queued.prepaidJobId ?? queued.jobId;

  try {
    await client.waitForJob(queued.jobId, pollOptions);
    const profile = await client.fetchWalletProfilePrepaid(args.walletAddress, prepaidJobId);
    return { content: [toMcpContent(completedResult("wallet_profile", summarizeWalletProfile(profile), profile, authMode))] };
  } catch (err) {
    if (isPollTimeoutError(err)) {
      return {
        content: [toMcpContent(queuedResult(
          "wallet_profile",
          `Analysis still running for ${args.walletAddress.slice(0, 8)}…. Use job_wait to retrieve the result.`,
          {
            jobId: queued.jobId,
            prepaidJobId,
            monitoringUrl: queued.monitoringUrl,
            resumeTool: "job_wait",
            resultType: "wallet_profile",
            input: args.walletAddress,
          },
          authMode,
        ))],
      };
    }
    return handleToolError("wallet_profile", err, authMode, toolCosts);
  }
}
