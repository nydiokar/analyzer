import { z } from "zod";
import type { SovaIntelClient } from "@sova-intel/sdk";
import { completedResult, toMcpContent } from "../core/result.js";
import { handleToolError } from "../core/handle-error.js";
import type { ToolCostMap } from "../core/pricing.js";
import { summarizeWalletProfile } from "../core/summary.js";

export const walletProfileSchema = z.object({
  walletAddress: z.string().min(32).max(44).describe("Solana wallet address (base58)"),
});

export async function walletProfileHandler(
  args: z.infer<typeof walletProfileSchema>,
  client: SovaIntelClient,
  authMode: string,
  toolCosts: ToolCostMap,
) {
  try {
    const profile = await client.getWalletProfile(args.walletAddress);
    const result = completedResult(
      "wallet_profile",
      summarizeWalletProfile(profile),
      profile,
      authMode,
    );
    return { content: [toMcpContent(result)] };
  } catch (err) {
    return handleToolError("wallet_profile", err, authMode, toolCosts);
  }
}
