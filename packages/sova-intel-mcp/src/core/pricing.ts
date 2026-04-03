// ---------------------------------------------------------------------------
// Pricing — fetched once at startup from GET /pricing (free, no auth).
// Maps API endpoint paths to MCP tool names for use in error messages.
// ---------------------------------------------------------------------------

export interface ToolCost {
  credits: number;
  usd: string;
}

export type ToolCostMap = Record<string, ToolCost>;

// Maps API endpoint path patterns to MCP tool names.
// Order matters — more specific paths first.
const PATH_TO_TOOL: Array<{ path: string; method: string; tool: string }> = [
  { path: "/intel/wallet/:addr/hud",        method: "GET",  tool: "wallet_hud" },
  { path: "/intel/wallet/:addr/tokens",     method: "GET",  tool: "wallet_token_pnl" },
  { path: "/intel/wallet/:addr",            method: "GET",  tool: "wallet_profile" },
  { path: "/intel/wallets/batch-hud",       method: "POST", tool: "batch_wallet_hud" },
  { path: "/intel/token/:mint/holders/agent", method: "POST", tool: "token_holder_profiles" },
  { path: "/intel/wallets/similarity/agent",  method: "POST", tool: "wallet_similarity" },
  { path: "/intel/token/:mint/holders/deep",  method: "POST", tool: "deep_token_analysis" },
];

interface PricingEndpoint {
  path: string;
  method: string;
  credits: number;
  usdEquivalent: number;
}

interface PricingResponse {
  endpoints: PricingEndpoint[];
}

export async function fetchToolCosts(baseUrl: string): Promise<ToolCostMap> {
  const res = await fetch(`${baseUrl}/pricing`);
  if (!res.ok) throw new Error(`GET /pricing returned HTTP ${res.status}`);
  const data = await res.json() as PricingResponse;

  const map: ToolCostMap = {};
  for (const mapping of PATH_TO_TOOL) {
    const endpoint = data.endpoints.find(
      (e) => e.path === mapping.path && e.method.toUpperCase() === mapping.method,
    );
    if (endpoint) {
      map[mapping.tool] = {
        credits: endpoint.credits,
        usd: `$${endpoint.usdEquivalent.toFixed(3).replace(/\.?0+$/, "")}`,
      };
    }
  }
  return map;
}
