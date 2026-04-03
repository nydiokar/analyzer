// ---------------------------------------------------------------------------
// MCP-level polling helper
// Wraps the SDK's public resume methods.
// tools use this instead of touching SDK internals directly.
// ---------------------------------------------------------------------------

import { SovaIntelClient, JobPollerError } from "@sova-intel/sdk";

export interface PollOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

export interface ResultPollRef {
  jobId?: string;
  resultKey: string;
}

/**
 * Poll a job to completion and fetch the result by key.
 * Throws JobPollerError on timeout or job failure — callers decide how to surface that.
 */
export async function pollJobResult<T>(
  client: SovaIntelClient,
  ref: ResultPollRef,
  options: PollOptions = {},
): Promise<T> {
  const resolvedOptions = {
    intervalMs: options.intervalMs ?? 5000,
    maxAttempts: options.maxAttempts ?? 9,
  };

  if (ref.jobId) {
    return client.pollJobResult<T>(ref.jobId, ref.resultKey, resolvedOptions);
  }

  return client.pollResultByKey<T>(ref.resultKey, resolvedOptions);
}

export function isPollTimeoutError(err: unknown): boolean {
  if (err instanceof JobPollerError) {
    return err.message.includes("did not complete within");
  }

  return err instanceof Error &&
    err.message.includes("did not appear within");
}

export { JobPollerError };
