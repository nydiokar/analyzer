import { z } from "zod";
import type { SovaIntelClient } from "@sova-intel/sdk";
import { completedResult, errorResult, toMcpContent } from "../core/result.js";
import { classifyError } from "../core/errors.js";
import { summarizeWalletHud } from "../core/summary.js";

export const walletHudSchema = z.object({
  walletAddress: z.string().min(32).max(44).describe("Solana wallet address (base58)"),
});

export async function walletHudHandler(
  args: z.infer<typeof walletHudSchema>,
  client: SovaIntelClient,
  authMode: string,
) {
  try {
    const hud = await client.getWalletHud(args.walletAddress);
    const result = completedResult(
      "wallet_hud",
      summarizeWalletHud(hud),
      hud,
      authMode,
    );
    return { content: [toMcpContent(result)] };
  } catch (err) {
    const { code, message } = classifyError(err);
    const result = errorResult("wallet_hud", code, message, authMode);
    return { content: [toMcpContent(result)], isError: true };
  }
}
