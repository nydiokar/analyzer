import { z } from "zod";
import type { SovaIntelClient } from "@sova-intel/sdk";
import { pollJobResult, isPollTimeoutError, type PollOptions } from "../core/polling.js";
import { completedResult, queuedResult, toMcpContent } from "../core/result.js";
import { handleToolError } from "../core/handle-error.js";
import type { ToolCostMap } from "../core/pricing.js";

export const deepTokenAnalysisSchema = z.object({
  tokenMint: z.string().min(32).max(44).describe("Solana token mint address (base58)"),
  topN: z.number().int().min(1).max(50).default(20).optional().describe("Number of top holders to analyze (default 20)"),
});

export async function deepTokenAnalysisHandler(
  args: z.infer<typeof deepTokenAnalysisSchema>,
  client: SovaIntelClient,
  authMode: string,
  toolCosts: ToolCostMap,
  pollOptions: PollOptions = {},
) {
  const topN = args.topN ?? 20;

  let jobs;
  try {
    jobs = await client.queueDeepAnalysis(args.tokenMint, topN);
  } catch (err) {
    return handleToolError("deep_token_analysis", err, authMode, toolCosts);
  }

  let holderProfiles: unknown;
  try {
    holderProfiles = await pollJobResult<unknown>(
      client,
      {
        jobId: jobs.holderProfiles.jobId,
        resultKey: `holder-profiles:result:${jobs.holderProfiles.jobId}`,
      },
      pollOptions,
    );
  } catch (err) {
    if (isPollTimeoutError(err)) {
      return { content: [toMcpContent(queuedResult(
        "deep_token_analysis",
        `Deep analysis still running for ${args.tokenMint.slice(0, 8)}…. Use job_wait to resume.`,
        {
          jobId: jobs.holderProfiles.jobId,
          monitoringUrl: jobs.holderProfiles.monitoringUrl,
          resultKey: `holder-profiles:result:${jobs.holderProfiles.jobId}`,
          resumeTool: "job_wait",
          resultType: "deep_analysis",
          input: args.tokenMint,
        },
        authMode,
      ))] };
    }
    return handleToolError("deep_token_analysis", err, authMode, toolCosts);
  }

  let similarity: unknown;
  try {
    similarity = await pollJobResult<unknown>(
      client,
      { resultKey: jobs.similarity.resultKey },
      pollOptions,
    );
  } catch (err) {
    if (isPollTimeoutError(err)) {
      return { content: [toMcpContent(queuedResult(
        "deep_token_analysis",
        `Deep analysis still running for ${args.tokenMint.slice(0, 8)}…. Use job_wait to resume (similarity phase).`,
        {
          monitoringUrl: jobs.holderProfiles.monitoringUrl,
          resultKey: jobs.similarity.resultKey,
          resumeTool: "job_wait",
          resultType: "deep_analysis_similarity",
          input: args.tokenMint,
        },
        authMode,
      ))] };
    }
    return handleToolError("deep_token_analysis", err, authMode, toolCosts);
  }

  return { content: [toMcpContent(completedResult(
    "deep_token_analysis",
    `Deep analysis complete for ${args.tokenMint.slice(0, 8)}…. Returns full developer shapes — use token_holder_profiles + wallet_similarity separately for agent-optimised results.`,
    { holderProfiles, similarity },
    authMode,
  ))] };
}
