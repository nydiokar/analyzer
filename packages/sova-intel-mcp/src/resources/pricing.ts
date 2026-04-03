// ---------------------------------------------------------------------------
// sova://pricing â€” live pricing fetched from GET /pricing (free, no auth)
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
    return [
      "Live pricing temporarily unavailable.",
      "",
      "Pricing is authoritative only from the live API response.",
      `Retry this resource or fetch directly: GET ${baseUrl}/pricing`,
    ].join("\n");
  }
}
