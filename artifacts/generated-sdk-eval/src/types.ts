// Shared non-OpenAPI SDK types

export interface ApiKeyAuth {
  kind: "apikey";
  apiKey: string;
}

export interface X402Auth {
  kind: "x402";
  buildPayment: (payTo: string, amountBaseUnits: bigint) => Promise<string>;
}

export type Auth = ApiKeyAuth | X402Auth;

export interface JobStatus {
  status: "waiting" | "active" | "delayed" | "completed" | "failed" | string;
  progress?: number;
}

export interface X402Accept {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
}

export interface X402ErrorBody {
  error: string;
  required: number;
  x402Version?: number;
  accepts?: X402Accept[];
}

export interface SovaIntelGeneratedClientConfig {
  baseUrl: string;
  auth: Auth;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}
