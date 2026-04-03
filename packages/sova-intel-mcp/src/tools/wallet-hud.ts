import { z } from "zod";
import type { SovaIntelClient } from "@sova-intel/sdk";
import { completedResult, toMcpContent } from "../core/result.js";
import { handleToolError } from "../core/handle-error.js";
import type { ToolCostMap } from "../core/pricing.js";
import { summarizeWalletHud } from "../core/summary.js";

export const walletHudSchema = z.object({
  walletAddress: z.string().min(32).max(44).describe("Solana wallet address (base58)"),
});

export async function walletHudHandler(
  args: z.infer<typeof walletHudSchema>,
  client: SovaIntelClient,
  authMode: string,
  toolCosts: ToolCostMap,
) {
  try {
    const hud = await client.getWalletHud(args.walletAddress);
    return { content: [toMcpContent(completedResult("wallet_hud", summarizeWalletHud(hud), hud, authMode))] };
  } catch (err) {
    return handleToolError("wallet_hud", err, authMode, toolCosts);
  }
}
