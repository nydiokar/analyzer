// ---------------------------------------------------------------------------
// MCP output envelope — every tool returns this shape.
// ---------------------------------------------------------------------------

export type ToolMode = "completed" | "queued";

export interface JobRef {
  jobId: string;
  monitoringUrl?: string | null;
  resultKey?: string;
  agentResultKey?: string;
  resumeTool: "job_wait";
  resultType: string;
  input: unknown;
}

export interface ToolResult {
  ok: boolean;
  tool: string;
  mode: ToolMode;
  summary: string;
  data: unknown;
  job: JobRef | null;
  meta: {
    source: "sova-intel-api";
    authMode: string;
  };
}

export function completedResult(
  tool: string,
  summary: string,
  data: unknown,
  authMode: string,
): ToolResult {
  return {
    ok: true,
    tool,
    mode: "completed",
    summary,
    data,
    job: null,
    meta: { source: "sova-intel-api", authMode },
  };
}

export function queuedResult(
  tool: string,
  summary: string,
  job: JobRef,
  authMode: string,
): ToolResult {
  return {
    ok: true,
    tool,
    mode: "queued",
    summary,
    data: null,
    job,
    meta: { source: "sova-intel-api", authMode },
  };
}

export function errorResult(
  tool: string,
  errorCode: string,
  message: string,
  authMode: string,
  detail?: unknown,
): ToolResult {
  return {
    ok: false,
    tool,
    mode: "completed",
    summary: `[${errorCode}] ${message}`,
    data: detail ?? null,
    job: null,
    meta: { source: "sova-intel-api", authMode },
  };
}

/** Serialize a ToolResult to the MCP text content block format. */
export function toMcpContent(result: ToolResult): { type: "text"; text: string } {
  return { type: "text", text: JSON.stringify(result, null, 2) };
}
