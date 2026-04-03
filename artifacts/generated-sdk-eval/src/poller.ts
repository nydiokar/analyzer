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
        path: "/jobs/result/by-key",
        query: { key: resultKey },
      });
    }

    if (status.status === "failed") {
      throw new JobPollerError(jobId, `Job ${jobId} failed`);
    }

    await sleep(intervalMs);
  }

  throw new JobPollerError(jobId, `Job ${jobId} timed out`);
}

export async function pollResultKey<T>(
  http: HttpClient,
  resultKey: string,
  options: { intervalMs: number; maxAttempts: number },
): Promise<T> {
  const { intervalMs, maxAttempts } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await http.request<T>({
        path: "/jobs/result/by-key",
        query: { key: resultKey },
      });
    } catch (error) {
      if (error instanceof SovaHttpError && error.status === 404) {
        await sleep(intervalMs);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Result key "${resultKey}" did not appear within ${maxAttempts} attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
