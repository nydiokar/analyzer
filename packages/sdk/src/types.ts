// ---------------------------------------------------------------------------
// Sova Intel SDK — shared types
// Source of truth: WalletHudDto / intel.controller.ts in the analyzer API
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

// --- Wallet HUD -----------------------------------------------------------
// Matches WalletHudDto (src/api/shared/dto/wallet-hud.dto.ts)

export type DataQualityTier = "GOLD" | "SILVER" | "BRONZE" | "INSUFFICIENT";

export interface WalletHud {
  walletAddress: string;
  signalType: string;

  // Core metrics
  trimmedMeanPnl: number;
  avgTxValueSol: number;
  behaviorCategory?: string;
  behaviorCode: string;
  medianHoldTimeHours?: number;
  avgTradesPerDay: number;
  winRate: number;
  dataQualityTier: DataQualityTier;

  // Conditional badges
  isBot: boolean;
  isWhale: boolean;

  // Supporting data
  uniqueTokensPerDay: number;
  currentHoldingsSol: number;
  currentHoldingsUsd?: number;

  // Metadata
  calculatedAt: string;
  provenance?: {
    provider: string;
    nodeId?: string;
    schemaVersion: string;
    generatedAt: string;
    dataRange?: {
      from: string;
      to: string;
    };
    source?: "onchain" | "indexed_db" | "hybrid";
  };
}

// --- Wallet Profile -------------------------------------------------------
// Matches buildIntelResponse() in intel.controller.ts

export interface WalletSummary {
  lastAnalyzedAt: string;
  realizedPnl: number;
  profitableTradesCount: number;
  totalTradesCount: number;
  currentSolBalance: number | null;
  knownType: string | null;
  knownLabel: string | null;
}

export interface WalletBehavior {
  tradingStyle: string | null;
  speedCategory: string | null;
  avgHoldTimeHours: number | null;
  medianHoldTimeHours: number | null;
  buySellRatio: number | null;
  exitPattern: string | null;
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

// --- Token PnL ------------------------------------------------------------

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
// Matches BatchWalletHudResponseDto — note: notFound (not skipped), no queued array

export type BatchHudResult = Record<string, WalletHud>;

export interface BatchHudResponse {
  huds: BatchHudResult;
  notFound: string[];
  calculatedAt: string;
}

// --- Async job responses --------------------------------------------------

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

// --- Similarity -----------------------------------------------------------
// Matches CombinedSimilarityResult returned by similarity-operations.processor.ts
// Source of truth: src/api/services/similarity.service.ts → runAnalysis()

export interface SimilarityPairResult {
  walletA: string;
  walletB: string;
  /** Jaccard (binary token overlap) similarity score */
  binaryScore: number;
  /** Capital-weighted similarity score */
  capitalScore: number;
  sharedTokens: { mint: string }[];
  capitalAllocation: Record<string, { weightA: number; weightB: number }>;
  binarySharedTokenCount: number;
  binaryUniqueTokenCountA: number;
  binaryUniqueTokenCountB: number;
  capitalSharedTokenCount: number;
  capitalUniqueTokenCountA: number;
  capitalUniqueTokenCountB: number;
}

export interface SimilarityGlobalMetrics {
  averageSimilarity: number;
  mostSimilarPairs: {
    walletA: string;
    walletB: string;
    similarityScore: number;
    sharedTokenCount: number;
  }[];
}

export interface SimilarityResult {
  vectorTypeUsed: "combined";
  pairwiseSimilarities: SimilarityPairResult[];
  globalMetrics: SimilarityGlobalMetrics;
  uniqueTokensPerWallet: Record<string, { binary: number; capital: number }>;
  walletLabels?: Record<string, { knownType?: string; knownLabel?: string }>;
  summary?: { walletCount: number; uniqueTokensTotal: number };
}

// --- Holder Profiles ------------------------------------------------------
// Matches HolderProfile / HolderProfilesResult in queues/jobs/types/index.ts

export interface HolderProfile {
  walletAddress: string;
  rank: number;
  supplyPercent: number;
  tokenHoldingValueSol?: number | null;
  knownType?: string;
  knownLabel?: string;
  analysisSkipped?: boolean;
  medianHoldTimeHours: number | null;
  avgHoldTimeHours: number | null;
  behaviorType: string | null;
  exitPattern: string | null;
  dataQualityTier: DataQualityTier;
  completedCycleCount: number;
  confidence: number;
  walletPnlSol?: number | null;
  walletRealizedPnlSol?: number | null;
  solBalance?: number | null;
}

export interface HolderProfilesResult {
  mode: "token" | "wallet";
  tokenMint?: string;
  profiles: HolderProfile[];
  metadata: {
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
    totalProcessingTimeMs: number;
    avgProcessingTimePerWalletMs: number;
    failedHolders?: number;
  };
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
