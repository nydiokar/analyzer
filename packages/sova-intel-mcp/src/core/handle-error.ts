// ---------------------------------------------------------------------------
// Unified tool error handler — classify + enrich + return MCP response.
// Import this instead of calling classifyError + errorResult separately.
// ---------------------------------------------------------------------------

import { classifyError, paymentErrorDetail } from "./errors.js";
import type { ToolCostMap } from "./pricing.js";
import { errorResult, toMcpContent } from "./result.js";

export function handleToolError(
  tool: string,
  err: unknown,
  authMode: string,
  toolCosts: ToolCostMap,
): { content: [{ type: "text"; text: string }]; isError: true } {
  const { code, message } = classifyError(err);

  if (code === "payment_error") {
    const detail = paymentErrorDetail(tool, toolCosts);
    return {
      content: [toMcpContent(errorResult(
        tool,
        code,
        `Insufficient credits. ${detail.remedy}`,
        authMode,
        detail,
      ))],
      isError: true,
    };
  }

  return {
    content: [toMcpContent(errorResult(tool, code, message, authMode))],
    isError: true,
  };
}
