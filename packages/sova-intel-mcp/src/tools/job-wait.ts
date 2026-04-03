import { z } from "zod";
import type { SovaIntelClient } from "@sova-intel/sdk";
import { pollJobResult, isPollTimeoutError, type PollOptions } from "../core/polling.js";
import { completedResult, queuedResult, errorResult, toMcpContent } from "../core/result.js";
import { classifyError } from "../core/errors.js";

export const jobWaitSchema = z.object({
  jobId: z.string().optional().describe("Job ID from a queued tool response when available"),
  agentResultKey: z.string().optional().describe("agentResultKey from queued envelope â€” preferred for agent-endpoint tools"),
  resultKey: z.string().optional().describe("resultKey from queued envelope â€” fallback when agentResultKey is absent"),
  resultType: z.string().optional().describe("Hint from queued envelope â€” for context only"),
  input: z.unknown().optional().describe("Original input from queued envelope â€” for context only"),
});

export async function jobWaitHandler(
  args: z.infer<typeof jobWaitSchema>,
  client: SovaIntelClient,
  authMode: string,
  pollOptions: PollOptions = {},
) {
  const resolvedKey = args.agentResultKey ?? args.resultKey;

  if (!resolvedKey) {
    return {
      content: [toMcpContent(errorResult(
        "job_wait",
        "validation_error",
        "Either agentResultKey or resultKey must be provided from the queued envelope.",
        authMode,
      ))],
      isError: true,
    };
  }

  try {
    const data = await pollJobResult<unknown>(
      client,
      { jobId: args.jobId, resultKey: resolvedKey },
      pollOptions,
    );
    const completionTarget = args.jobId ?? resolvedKey;
    return { content: [toMcpContent(completedResult(
      "job_wait",
      `Queued result ${completionTarget} complete.`,
      data,
      authMode,
    ))] };
  } catch (err) {
    if (isPollTimeoutError(err)) {
      const pendingTarget = args.jobId ?? resolvedKey;
      return { content: [toMcpContent(queuedResult(
        "job_wait",
        `Queued result ${pendingTarget} still running. Call job_wait again to continue polling.`,
        {
          jobId: args.jobId,
          agentResultKey: args.agentResultKey,
          resultKey: args.resultKey,
          resumeTool: "job_wait",
          resultType: args.resultType ?? "unknown",
          input: args.input,
        },
        authMode,
      ))] };
    }
    const { code, message } = classifyError(err);
    return { content: [toMcpContent(errorResult("job_wait", code, message, authMode))], isError: true };
  }
}
