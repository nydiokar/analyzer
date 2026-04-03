import { z } from "zod";
import type { SovaIntelClient } from "@sova-intel/sdk";
import { completedResult, errorResult, toMcpContent } from "../core/result.js";
import { classifyError } from "../core/errors.js";
import { summarizeWalletProfile } from "../core/summary.js";

export const walletProfileSchema = z.object({
  walletAddress: z.string().min(32).max(44).describe("Solana wallet address (base58)"),
});

export async function walletProfileHandler(
  args: z.infer<typeof walletProfileSchema>,
  client: SovaIntelClient,
  authMode: string,
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
    const { code, message } = classifyError(err);
    const result = errorResult("wallet_profile", code, message, authMode);
    return { content: [toMcpContent(result)], isError: true };
  }
}
