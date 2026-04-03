// ---------------------------------------------------------------------------
// API key auth — builds the Auth object for apikey mode.
// ---------------------------------------------------------------------------

import type { Auth } from "@sova-intel/sdk";

export function buildApiKeyAuth(apiKey: string): Auth {
  return { kind: "apikey", apiKey };
}
