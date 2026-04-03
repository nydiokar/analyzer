import { z } from "zod";
import type { SovaIntelClient } from "@sova-intel/sdk";
import { pollJobResult, JobPollerError } from "../core/polling.js";
import { completedResult, queuedResult, errorResult, toMcpContent } from "../core/result.js";
import { classifyError } from "../core/errors.js";

export const jobWaitSchema = z.object({
  jobId: z.string().describe("Job ID from a queued tool response"),
  agentResultKey: z.string().optional().describe("agentResultKey from queued envelope — preferred for agent-endpoint tools"),
  resultKey: z.string().optional().describe("resultKey from queued envelope — fallback when agentResultKey is absent"),
  resultType: z.string().optional().describe("Hint from queued envelope — for context only"),
  input: z.string().optional().describe("Original input from queued envelope — for context only"),
});

export async function jobWaitHandler(
  args: z.infer<typeof jobWaitSchema>,
  client: SovaIntelClient,
  authMode: string,
) {
  // Prefer agentResultKey — compact agent-optimised shape
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
    const data = await pollJobResult<unknown>(client, args.jobId, resolvedKey);
    return { content: [toMcpContent(completedResult(
      "job_wait",
      `Job ${args.jobId} complete.`,
      data,
      authMode,
    ))] };
  } catch (err) {
    if (err instanceof JobPollerError) {
      // Still running — return another queued envelope so agent can retry
      return { content: [toMcpContent(queuedResult(
        "job_wait",
        `Job ${args.jobId} still running. Call job_wait again to continue polling.`,
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
