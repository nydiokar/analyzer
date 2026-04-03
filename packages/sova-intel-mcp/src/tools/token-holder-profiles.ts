import { z } from "zod";
import type { SovaIntelClient, AgentHolderProfilesResult } from "@sova-intel/sdk";
import { pollJobResult, isPollTimeoutError, type PollOptions } from "../core/polling.js";
import { completedResult, queuedResult, toMcpContent } from "../core/result.js";
import { handleToolError } from "../core/handle-error.js";
import type { ToolCostMap } from "../core/pricing.js";
import { summarizeHolderProfiles } from "../core/summary.js";

export const tokenHolderProfilesSchema = z.object({
  tokenMint: z.string().min(32).max(44).describe("Solana token mint address (base58)"),
  topN: z.number().int().min(1).max(50).default(20).optional().describe("Number of top holders to analyze (default 20)"),
});

export async function tokenHolderProfilesHandler(
  args: z.infer<typeof tokenHolderProfilesSchema>,
  client: SovaIntelClient,
  authMode: string,
  toolCosts: ToolCostMap,
  pollOptions: PollOptions = {},
) {
  const topN = args.topN ?? 20;

  let job;
  try {
    job = await client.queueTokenHoldersAgent(args.tokenMint, topN);
  } catch (err) {
    return handleToolError("token_holder_profiles", err, authMode, toolCosts);
  }

  try {
    const res = await pollJobResult<AgentHolderProfilesResult>(
      client,
      { jobId: job.jobId, resultKey: job.agentResultKey },
      pollOptions,
    );
    return { content: [toMcpContent(completedResult(
      "token_holder_profiles",
      summarizeHolderProfiles(res),
      res,
      authMode,
    ))] };
  } catch (err) {
    if (isPollTimeoutError(err)) {
      return { content: [toMcpContent(queuedResult(
        "token_holder_profiles",
        `Analysis still running for ${args.tokenMint.slice(0, 8)}…. Use job_wait to retrieve the result.`,
        {
          jobId: job.jobId,
          monitoringUrl: job.monitoringUrl,
          agentResultKey: job.agentResultKey,
          resultKey: job.resultKey,
          resumeTool: "job_wait",
          resultType: "agent_holder_profiles",
          input: args.tokenMint,
        },
        authMode,
      ))] };
    }
    return handleToolError("token_holder_profiles", err, authMode, toolCosts);
  }
}
