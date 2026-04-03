// ---------------------------------------------------------------------------
// Resolve the effective auth mode and build the SDK Auth object.
// ---------------------------------------------------------------------------

import type { Auth } from "@sova-intel/sdk";
import type { McpConfig } from "../config.js";
import { buildApiKeyAuth } from "./api-key-auth.js";

export type ResolvedAuth =
  | { mode: "apikey"; auth: Auth }
  | { mode: "x402"; auth: Auth }
  | { mode: "limited" };

export function resolveAuth(config: McpConfig): ResolvedAuth {
  const { authMode, apiKey, solanaPrivateKey } = config;

  if (authMode === "apikey") {
    // loadConfig already validated apiKey is present
    return { mode: "apikey", auth: buildApiKeyAuth(apiKey!) };
  }

  if (authMode === "x402") {
    // loadConfig already validated solanaPrivateKey is present
    return { mode: "x402", auth: buildX402Auth(solanaPrivateKey!) };
  }

  // auto: prefer apikey > x402 > limited
  if (apiKey) {
    return { mode: "apikey", auth: buildApiKeyAuth(apiKey) };
  }
  if (solanaPrivateKey) {
    return { mode: "x402", auth: buildX402Auth(solanaPrivateKey) };
  }
  return { mode: "limited" };
}

function buildX402Auth(privateKeyBase58: string): Auth {
  return {
    kind: "x402",
    buildPayment: async (payTo: string, amountBaseUnits: bigint): Promise<string> => {
      // Dynamically import to avoid loading @solana/web3.js in apikey-only deployments
      const { buildSolanaX402Payment } = await import("./x402-auth.js");
      return buildSolanaX402Payment(privateKeyBase58, payTo, amountBaseUnits);
    },
  };
}
