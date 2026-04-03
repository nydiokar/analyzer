// ---------------------------------------------------------------------------
// Error taxonomy — stable codes for all tool failure paths.
// ---------------------------------------------------------------------------

export type ErrorCode =
  | "validation_error"
  | "auth_error"
  | "config_error"
  | "payment_error"
  | "rate_limit_error"
  | "job_failed"
  | "upstream_error"
  | "limited_mode_unavailable";

export function classifyError(err: unknown): { code: ErrorCode; message: string } {
  if (!(err instanceof Error)) {
    return { code: "upstream_error", message: String(err) };
  }

  const msg = err.message;

  if (msg.includes("402") || msg.toLowerCase().includes("payment")) {
    return { code: "payment_error", message: msg };
  }
  if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
    return { code: "auth_error", message: msg };
  }
  if (msg.includes("429") || msg.toLowerCase().includes("rate limit")) {
    return { code: "rate_limit_error", message: msg };
  }
  if (msg.includes("HTTP 400") || msg.includes("status 400")) {
    return { code: "validation_error", message: msg };
  }
  if (msg.toLowerCase().includes("failed")) {
    return { code: "job_failed", message: msg };
  }

  return { code: "upstream_error", message: msg };
}
