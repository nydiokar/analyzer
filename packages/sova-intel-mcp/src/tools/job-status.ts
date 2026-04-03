import { z } from "zod";
import { completedResult, errorResult, toMcpContent } from "../core/result.js";
import { classifyError } from "../core/errors.js";

export const jobStatusSchema = z.object({
  jobId: z.string().describe("Job ID from a queued tool response"),
});

export async function jobStatusHandler(
  args: z.infer<typeof jobStatusSchema>,
  baseUrl: string,
  authMode: string,
) {
  try {
    // Job status endpoint is free and requires no auth (per API contract)
    const res = await fetch(`${baseUrl}/jobs/${args.jobId}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const status = await res.json() as { status: string; progress?: number };
    const result = completedResult(
      "job_status",
      `Job ${args.jobId}: ${status.status}${status.progress != null ? ` (${status.progress}%)` : ""}.`,
      status,
      authMode,
    );
    return { content: [toMcpContent(result)] };
  } catch (err) {
    const { code, message } = classifyError(err);
    const result = errorResult("job_status", code, message, authMode);
    return { content: [toMcpContent(result)], isError: true };
  }
}
