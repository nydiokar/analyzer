import { z } from "zod";
import type { SovaIntelClient } from "@sova-intel/sdk";
import { completedResult, errorResult, toMcpContent } from "../core/result.js";
import { classifyError } from "../core/errors.js";
import { summarizeBatchHud } from "../core/summary.js";

export const batchWalletHudSchema = z.object({
  wallets: z
    .array(z.string().min(32).max(44))
    .min(1)
    .max(30)
    .describe("Array of Solana wallet addresses (base58), 1–30"),
});

export async function batchWalletHudHandler(
  args: z.infer<typeof batchWalletHudSchema>,
  client: SovaIntelClient,
  authMode: string,
) {
  try {
    const res = await client.batchHud(args.wallets);
    const result = completedResult(
      "batch_wallet_hud",
      summarizeBatchHud(res),
      res,
      authMode,
    );
    return { content: [toMcpContent(result)] };
  } catch (err) {
    const { code, message } = classifyError(err);
    const result = errorResult("batch_wallet_hud", code, message, authMode);
    return { content: [toMcpContent(result)], isError: true };
  }
}
