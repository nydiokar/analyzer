// ---------------------------------------------------------------------------
// MCP-level polling helper
// Wraps the SDK's pollAndFetch using only the public SDK API surface.
// tools use this instead of touching SDK internals directly.
// ---------------------------------------------------------------------------

import { SovaIntelClient, pollAndFetch, JobPollerError } from "@sova-intel/sdk";

// The SDK exports pollAndFetch but its first arg is HttpClient (not exported).
// We extract the type from the function signature to stay honest about what we depend on.
type HttpClient = Parameters<typeof pollAndFetch>[0];

/**
 * Extract the internal HttpClient from a SovaIntelClient instance.
 * This is the only place in the MCP that touches an SDK non-public field.
 * It is isolated here so it can be updated in one place if the SDK changes.
 */
function getHttp(client: SovaIntelClient): HttpClient {
  return (client as unknown as { http: HttpClient }).http;
}

export interface PollOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

/**
 * Poll a job to completion and fetch the result by key.
 * Throws JobPollerError on timeout or job failure — callers decide how to surface that.
 */
export async function pollJobResult<T>(
  client: SovaIntelClient,
  jobId: string,
  resultKey: string,
  options: PollOptions = {},
): Promise<T> {
  return pollAndFetch<T>(
    getHttp(client),
    jobId,
    resultKey,
    {
      intervalMs: options.intervalMs ?? 5000,
      maxAttempts: options.maxAttempts ?? 9,
    },
  );
}

export { JobPollerError };
