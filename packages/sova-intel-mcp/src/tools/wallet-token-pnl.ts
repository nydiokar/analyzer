import { z } from "zod";
import type { SovaIntelClient } from "@sova-intel/sdk";
import { completedResult, toMcpContent } from "../core/result.js";
import { handleToolError } from "../core/handle-error.js";
import type { ToolCostMap } from "../core/pricing.js";
import { summarizeTokenPnl } from "../core/summary.js";

export const walletTokenPnlSchema = z.object({
  walletAddress: z.string().min(32).max(44).describe("Solana wallet address (base58)"),
  page: z.number().int().min(1).default(1).optional().describe("Page number (default 1)"),
  pageSize: z.number().int().min(1).max(100).default(20).optional().describe("Results per page (default 20)"),
  sortBy: z.enum(["netSolProfitLoss", "realizedPnlSol", "roi", "totalSolSpent"]).default("realizedPnlSol").optional(),
  sortOrder: z.enum(["ASC", "DESC"]).default("DESC").optional(),
});

export async function walletTokenPnlHandler(
  args: z.infer<typeof walletTokenPnlSchema>,
  client: SovaIntelClient,
  authMode: string,
  toolCosts: ToolCostMap,
) {
  try {
    const res = await client.getWalletTokens(args.walletAddress, {
      page: args.page,
      pageSize: args.pageSize,
      sortBy: args.sortBy,
      sortOrder: args.sortOrder,
    });
    const result = completedResult(
      "wallet_token_pnl",
      summarizeTokenPnl(res, args.walletAddress),
      res,
      authMode,
    );
    return { content: [toMcpContent(result)] };
  } catch (err) {
    return handleToolError("wallet_token_pnl", err, authMode, toolCosts);
  }
}
