import { z } from "zod";
import type { SovaIntelClient, AgentSimilarityResult } from "@sova-intel/sdk";
import { pollJobResult, isPollTimeoutError, type PollOptions } from "../core/polling.js";
import { completedResult, queuedResult, toMcpContent } from "../core/result.js";
import { handleToolError } from "../core/handle-error.js";
import type { ToolCostMap } from "../core/pricing.js";
import { summarizeSimilarity } from "../core/summary.js";

export const walletSimilaritySchema = z.object({
  wallets: z
    .array(z.string().min(32).max(44))
    .min(2)
    .max(30)
    .describe("Array of Solana wallet addresses (base58), 2–30"),
});

export async function walletSimilarityHandler(
  args: z.infer<typeof walletSimilaritySchema>,
  client: SovaIntelClient,
  authMode: string,
  toolCosts: ToolCostMap,
  pollOptions: PollOptions = {},
) {
  // Queue once — capture job metadata for the queued envelope on timeout
  let job;
  try {
    job = await client.queueWalletSimilarityAgent(args.wallets);
  } catch (err) {
    return handleToolError("wallet_similarity", err, authMode, toolCosts);
  }

  // Poll directly using the captured agentResultKey — no second queue call
  try {
    const res = await pollJobResult<AgentSimilarityResult>(
      client,
      { jobId: job.jobId, resultKey: job.agentResultKey },
      pollOptions,
    );
    return { content: [toMcpContent(completedResult(
      "wallet_similarity",
      summarizeSimilarity(res),
      res,
      authMode,
    ))] };
  } catch (err) {
    if (isPollTimeoutError(err)) {
      return { content: [toMcpContent(queuedResult(
        "wallet_similarity",
        `Similarity analysis still running for ${args.wallets.length} wallets. Use job_wait to retrieve the result.`,
        {
          jobId: job.jobId,
          monitoringUrl: job.monitoringUrl,
          agentResultKey: job.agentResultKey,
          resultKey: job.resultKey,
          resumeTool: "job_wait",
          resultType: "agent_similarity",
          input: args.wallets,
        },
        authMode,
      ))] };
    }
    return handleToolError("wallet_similarity", err, authMode, toolCosts);
  }
}
