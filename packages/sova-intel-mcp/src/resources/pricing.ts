// ---------------------------------------------------------------------------
// sova://pricing — live pricing fetched from GET /pricing (free, no auth)
// ---------------------------------------------------------------------------

export async function pricingResourceHandler(baseUrl: string): Promise<string> {
  try {
    const res = await fetch(`${baseUrl}/pricing`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return JSON.stringify(data, null, 2);
  } catch {
    // Fallback: static table so the resource is always readable
    return [
      "Live pricing temporarily unavailable. Last known pricing:",
      "",
      "| Endpoint                                      | Credits | USD    |",
      "|:----------------------------------------------|--------:|-------:|",
      "| GET /intel/wallet/:addr/hud                   |       1 | $0.015 |",
      "| GET /intel/wallet/:addr                       |       5 | $0.075 |",
      "| GET /intel/wallet/:addr/tokens                |       3 | $0.045 |",
      "| POST /intel/wallets/batch-hud                 |       5 | $0.075 |",
      "| POST /intel/token/:mint/holders/agent ★       |      20 | $0.30  |",
      "| POST /intel/wallets/similarity/agent ★        |      20 | $0.30  |",
      "| POST /intel/token/:mint/holders/deep          |      35 | $0.525 |",
      "| POST /intel/token/:mint/holders               |      20 | $0.30  |",
      "| POST /intel/wallets/similarity                |      20 | $0.30  |",
      "",
      "1 credit = $0.015 USDC.",
      "Fetch live pricing: GET https://api.sova-intel.com/api/v1/pricing",
    ].join("\n");
  }
}
