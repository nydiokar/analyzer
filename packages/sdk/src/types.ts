// ---------------------------------------------------------------------------
// Sova Intel SDK — shared types
// ---------------------------------------------------------------------------

// --- Auth -----------------------------------------------------------------

export interface ApiKeyAuth {
  kind: "apikey";
  apiKey: string;
}

export interface X402Auth {
  kind: "x402";
  /** Called by the SDK when a 402 is received. Must return a base64-encoded payment-signature header value. */
  buildPayment: (payTo: string, amountBaseUnits: bigint) => Promise<string>;
}

export type Auth = ApiKeyAuth | X402Auth;

// --- Shared ---------------------------------------------------------------

export interface JobRef {
  jobId: string;
  requestId: string;
  monitoringUrl: string;
}

export interface JobStatus {
  status: "waiting" | "active" | "delayed" | "completed" | "failed" | string;
  progress?: number;
}

// --- Wallet Intel ---------------------------------------------------------

export interface WalletSummary {
  lastAnalyzedAt: string;
  realizedPnl: number;
  profitableTradesCount: number;
  totalTradesCount: number;
  currentSolBalance: number | null;
  knownType: string | null;
  knownLabel: string | null;
}

export interface WalletHud {
  pnlSignal: "positive" | "negative" | "neutral";
  behaviorCode: string;
  winRate: number;
  dataQualityTier: "high" | "medium" | "low";
  isBotFlagged: boolean;
  isWhaleFlagged: boolean;
  medianPnlPerToken?: number;
}

export interface WalletBehavior {
  tradingStyle: string;
  speedCategory: string;
  avgHoldTimeHours: number;
  medianHoldTimeHours: number;
  buySellRatio: number;
  exitPattern: string;
}

export interface PnlAllTime {
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  netPnlSol: number;
  winRate: number;
}

export interface WalletProfileResponse {
  status: "ok";
  walletAddress: string;
  summary: WalletSummary;
  hud: WalletHud | null;
  behavior: WalletBehavior | null;
  pnl: { allTime: PnlAllTime | null; period: unknown | null } | null;
}

export interface WalletHudResponse {
  pnlSignal: "positive" | "negative" | "neutral";
  behaviorCode: string;
  winRate: number;
  isBotFlagged: boolean;
  isWhaleFlagged: boolean;
  medianPnlPerToken?: number;
}

export interface TokenPnlRow {
  tokenAddress: string;
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  roi: number;
  totalSolSpent: number;
  winRate: number;
}

export interface TokenPnlResponse {
  data: TokenPnlRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TokenPnlParams {
  page?: number;
  pageSize?: number;
  sortBy?: "netSolProfitLoss" | "realizedPnlSol" | "roi" | "totalSolSpent";
  sortOrder?: "ASC" | "DESC";
}

// --- Batch HUD ------------------------------------------------------------

export type BatchHudResult = Record<string, WalletHudResponse>;

export interface BatchQueuedEntry {
  walletAddress: string;
  jobId: string;
  monitoringUrl: string;
}

export interface BatchHudResponse {
  huds: BatchHudResult;
  queued: BatchQueuedEntry[];
  skipped: string[];
  calculatedAt: string;
}

// --- Async job responses --------------------------------------------------

/**
 * Returned by POST async endpoints (202).
 * GET /intel/wallet/:addr 202 omits requestId and includes walletAddress + message instead.
 */
export interface JobAcceptedResponse {
  status: "queued";
  jobId: string;
  requestId: string;
  monitoringUrl: string;
}

/** Returned by GET /intel/wallet/:addr and GET /intel/wallet/:addr/hud on timeout fallback (202). */
export interface WalletGetQueuedResponse {
  status: "queued";
  walletAddress: string;
  jobId: string;
  prepaidJobId?: string;
  monitoringUrl: string | null;
  message: string;
}

/** POST /intel/token/:mint/holders/deep — two jobs returned (202) */
export interface DeepJobAcceptedResponse {
  status: "queued";
  holderProfiles: JobRef;
  similarity: JobRef;
}

/**
 * POST /intel/token/:mint/holders/deep partial failure (206).
 * holderProfiles job was queued but similarity failed. 0cr charged.
 */
export interface DeepPartialResponse {
  status: "partial";
  tokenMint: string;
  topN: number;
  holderProfiles: JobRef;
  similarity: null;
  message: string;
}

// --- X402 wire format -----------------------------------------------------

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

// --- SDK config -----------------------------------------------------------

export interface SovaIntelClientConfig {
  /** Base URL of the Sova Intel API, e.g. "https://api.sova.io/api/v1" */
  baseUrl: string;
  auth: Auth;
  /** ms between job poll attempts (default: 5000) */
  pollIntervalMs?: number;
  /** maximum poll attempts before giving up (default: 60) */
  maxPollAttempts?: number;
}
