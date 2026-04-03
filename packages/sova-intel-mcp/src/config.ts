// ---------------------------------------------------------------------------
// Sova Intel MCP — config
// All configuration is read from environment variables at startup.
// ---------------------------------------------------------------------------

export type AuthMode = "apikey" | "x402" | "auto";

export interface McpConfig {
  baseUrl: string;
  authMode: AuthMode;
  apiKey: string | undefined;
  solanaPrivateKey: string | undefined;
  waitTimeoutMs: number;
  deepWaitTimeoutMs: number;
  pollIntervalMs: number;
  maxPollAttempts: number;
}

export function loadConfig(): McpConfig {
  const authMode = (process.env.SOVA_AUTH_MODE ?? "auto") as AuthMode;
  const apiKey = process.env.SOVA_API_KEY || undefined;
  const solanaPrivateKey = process.env.SOLANA_PRIVATE_KEY || undefined;

  // Fail fast on explicit modes with missing config
  if (authMode === "apikey" && !apiKey) {
    throw new Error(
      "SOVA_AUTH_MODE=apikey requires SOVA_API_KEY to be set.",
    );
  }
  if (authMode === "x402" && !solanaPrivateKey) {
    throw new Error(
      "SOVA_AUTH_MODE=x402 requires SOLANA_PRIVATE_KEY to be set.",
    );
  }

  const pollIntervalMs = parseInt(process.env.SOVA_POLL_INTERVAL_MS ?? "5000", 10);
  // MCP hard timeout is ~60s. Keep all in-process waiting well under that.
  const maxPollAttempts = parseInt(process.env.SOVA_MAX_POLL_ATTEMPTS ?? "9", 10);
  const waitTimeoutMs = parseInt(process.env.SOVA_WAIT_TIMEOUT_MS ?? "45000", 10);
  const deepWaitTimeoutMs = parseInt(process.env.SOVA_DEEP_WAIT_TIMEOUT_MS ?? "45000", 10);

  return {
    baseUrl: process.env.SOVA_BASE_URL ?? "https://api.sova-intel.com/api/v1",
    authMode,
    apiKey,
    solanaPrivateKey,
    waitTimeoutMs,
    deepWaitTimeoutMs,
    pollIntervalMs,
    maxPollAttempts,
  };
}
