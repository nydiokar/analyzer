import { z } from "zod";
import type { SovaIntelClient, AgentHolderProfilesResult } from "@sova-intel/sdk";
import { pollJobResult, JobPollerError } from "../core/polling.js";
import {
  completedResult,
  queuedResult,
  errorResult,
  toMcpContent,
} from "../core/result.js";
import { classifyError } from "../core/errors.js";
import { summarizeHolderProfiles } from "../core/summary.js";

export const tokenHolderProfilesSchema = z.object({
  tokenMint: z.string().min(32).max(44).describe("Solana token mint address (base58)"),
  topN: z.number().int().min(1).max(50).default(20).optional().describe("Number of top holders to analyze (default 20)"),
});

export async function tokenHolderProfilesHandler(
  args: z.infer<typeof tokenHolderProfilesSchema>,
  client: SovaIntelClient,
  authMode: string,
) {
  const topN = args.topN ?? 20;

  // Queue once — capture job metadata for the queued envelope on timeout
  let job;
  try {
    job = await client.queueTokenHoldersAgent(args.tokenMint, topN);
  } catch (err) {
    const { code, message } = classifyError(err);
    return { content: [toMcpContent(errorResult("token_holder_profiles", code, message, authMode))], isError: true };
  }

  // Poll directly using the captured agentResultKey — no second queue call
  try {
    const res = await pollJobResult<AgentHolderProfilesResult>(
      client,
      job.jobId,
      job.agentResultKey,
    );
    return { content: [toMcpContent(completedResult(
      "token_holder_profiles",
      summarizeHolderProfiles(res),
      res,
      authMode,
    ))] };
  } catch (err) {
    if (err instanceof JobPollerError) {
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
    const { code, message } = classifyError(err);
    return { content: [toMcpContent(errorResult("token_holder_profiles", code, message, authMode))], isError: true };
  }
}
