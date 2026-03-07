// ---------------------------------------------------------------------------
// Sova Intel SDK — async job poller
// ---------------------------------------------------------------------------

import type { JobStatus } from "./types.js";
import { HttpClient, SovaHttpError } from "./http.js";

export class JobPollerError extends Error {
  constructor(
    public readonly jobId: string,
    message: string,
  ) {
    super(message);
    this.name = "JobPollerError";
  }
}

/**
 * Polls GET /jobs/:jobId until status is "completed" or "failed",
 * then fetches the result from GET /jobs/result/by-key?key=<resultKey>.
 */
export async function pollAndFetch<T>(
  http: HttpClient,
  jobId: string,
  resultKey: string,
  options: { intervalMs: number; maxAttempts: number },
): Promise<T> {
  const { intervalMs, maxAttempts } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await http.request<JobStatus>({
      path: `/jobs/${jobId}`,
    });

    if (status.status === "completed") {
      return http.request<T>({
        path: `/jobs/result/by-key`,
        query: { key: resultKey },
      });
    }

    if (status.status === "failed") {
      throw new JobPollerError(jobId, `Job ${jobId} failed`);
    }

    // waiting | active — sleep and retry
    await sleep(intervalMs);
  }

  throw new JobPollerError(
    jobId,
    `Job ${jobId} did not complete within ${maxAttempts} poll attempts`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
