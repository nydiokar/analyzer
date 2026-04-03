import { z } from "zod";
import type { SovaIntelClient } from "@sova-intel/sdk";
import { pollJobResult, JobPollerError } from "../core/polling.js";
import { pollResultKey } from "@sova-intel/sdk";
import {
  completedResult,
  queuedResult,
  errorResult,
  toMcpContent,
} from "../core/result.js";
import { classifyError } from "../core/errors.js";

export const deepTokenAnalysisSchema = z.object({
  tokenMint: z.string().min(32).max(44).describe("Solana token mint address (base58)"),
  topN: z.number().int().min(1).max(50).default(20).optional().describe("Number of top holders to analyze (default 20)"),
});

export async function deepTokenAnalysisHandler(
  args: z.infer<typeof deepTokenAnalysisSchema>,
  client: SovaIntelClient,
  authMode: string,
) {
  const topN = args.topN ?? 20;

  // Queue once — captures both job descriptors
  let jobs;
  try {
    jobs = await client.queueDeepAnalysis(args.tokenMint, topN);
  } catch (err) {
    const { code, message } = classifyError(err);
    return { content: [toMcpContent(errorResult("deep_token_analysis", code, message, authMode))], isError: true };
  }

  // Step 1: poll holder-profiles job using its resultKey
  let holderProfiles: unknown;
  try {
    holderProfiles = await pollJobResult<unknown>(
      client,
      jobs.holderProfiles.jobId,
      `holder-profiles:result:${jobs.holderProfiles.jobId}`,
    );
  } catch (err) {
    if (err instanceof JobPollerError) {
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
    const { code, message } = classifyError(err);
    return { content: [toMcpContent(errorResult("deep_token_analysis", code, message, authMode))], isError: true };
  }

  // Step 2: poll the similarity result key — chained by the processor after holder-profiles completes
  // Use pollResultKey directly (no jobId for the chained similarity job)
  const http = (client as unknown as { http: Parameters<typeof pollResultKey>[0] }).http;
  let similarity: unknown;
  try {
    similarity = await pollResultKey<unknown>(
      http,
      jobs.similarity.resultKey,
      { intervalMs: 5000, maxAttempts: 9 },
    );
  } catch (err) {
    const { code, message } = classifyError(err);
    return { content: [toMcpContent(errorResult("deep_token_analysis", code, message, authMode))], isError: true };
  }

  return { content: [toMcpContent(completedResult(
    "deep_token_analysis",
    `Deep analysis complete for ${args.tokenMint.slice(0, 8)}…. Returns full developer shapes — use token_holder_profiles + wallet_similarity separately for agent-optimised results.`,
    { holderProfiles, similarity },
    authMode,
  ))] };
}
