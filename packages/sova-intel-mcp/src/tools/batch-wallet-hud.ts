import { z } from "zod";
import type { SovaIntelClient } from "@sova-intel/sdk";
import { completedResult, toMcpContent } from "../core/result.js";
import { handleToolError } from "../core/handle-error.js";
import type { ToolCostMap } from "../core/pricing.js";
import { summarizeBatchHud } from "../core/summary.js";

const batchWalletsArraySchema = z.preprocess(
  (v) => (typeof v === "string" ? JSON.parse(v) : v),
  z.array(z.string().min(32).max(44)).min(1).max(30),
);

export const batchWalletHudSchema = z.object({
  wallets: batchWalletsArraySchema
    .describe("Array of Solana wallet addresses (base58), 1–30"),
});

export async function batchWalletHudHandler(
  args: z.infer<typeof batchWalletHudSchema>,
  client: SovaIntelClient,
  authMode: string,
  toolCosts: ToolCostMap,
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
    return handleToolError("batch_wallet_hud", err, authMode, toolCosts);
  }
}
