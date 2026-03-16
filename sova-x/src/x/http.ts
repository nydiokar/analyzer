export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  options?: {
    maxAttempts?: number;
    baseDelayMs?: number;
  },
): Promise<Response> {
  const maxAttempts: number = options?.maxAttempts ?? 3;
  const baseDelayMs: number = options?.baseDelayMs ?? 750;

  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!shouldRetry(response.status) || attempt === maxAttempts) {
        return response;
      }
      lastResponse = response;
    } catch (error: unknown) {
      lastError = error;
      if (attempt === maxAttempts) {
        throw error;
      }
    }

    await sleep(baseDelayMs * attempt);
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed after retries.');
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
