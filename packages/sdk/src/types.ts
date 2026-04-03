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
  typicalEntryMcapUsd?: number;
  dominantEntryMcapBucket?: string;

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
  avgEntryMcapUsd: number | null;
  typicalEntryMcapUsd: number | null;
  entryMcapP25Usd: number | null;
  entryMcapP75Usd: number | null;
  dominantEntryMcapBucket: string | null;
  dominantEntryMcapBucketShare: number | null;
}

export interface PnlAllTime {
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  netPnlSol: number;
  winRate: number;
}

export interface KolIdentity {
  name: string;
  twitter: string | null;
  telegram: string | null;
}

export interface WalletProfileResponse {
  status: "ok";
  walletAddress: string;
  summary: WalletSummary;
  /** Present when this wallet belongs to a known KOL. null for regular wallets. */
  kol: KolIdentity | null;
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
// Matches BatchWalletHudResponseDto

export type BatchHudResult = Record<string, WalletHud>;

export interface BatchHudQueuedEntry {
  walletAddress: string;
  jobId: string;
  monitoringUrl: string;
}

export interface BatchHudResponse {
  huds: BatchHudResult;
  /** Wallets that were missing/stale and have been queued for analysis. */
  queued: BatchHudQueuedEntry[];
  /** Wallets that were skipped (e.g. invalid or over batch limit). */
  skipped: string[];
  calculatedAt: string;
}

// --- Async job responses --------------------------------------------------

export interface JobAcceptedResponse {
  status: "queued";
  jobId: string;
  requestId: string;
  monitoringUrl: string;
}

export interface HolderProfilesJobAcceptedResponse {
  status: "queued";
  jobId: string;
  requestId: string;
  monitoringUrl: string;
  tokenMint: string;
  topN: number;
  resultKey: string;
  message: string;
}

export interface SimilarityJobAcceptedResponse {
  status: "queued";
  jobId: string;
  requestId: string;
  monitoringUrl: string;
  walletCount: number;
  resultKey: string;
  message: string;
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

/** POST /intel/token/:mint/holders/deep — 202, two job descriptors returned */
export interface DeepJobAcceptedResponse {
  status: "queued";
  tokenMint: string;
  topN: number;
  holderProfiles: JobRef;
  /** similarity.jobId is null — the processor queues it after holder-profiles completes */
  similarity: {
    jobId: null;
    requestId: string;
    /** Poll this key via GET /jobs/result/by-key?key=... once holderProfiles job completes */
    resultKey: string;
    message: string;
  };
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

// --- Agent-optimised job accepted responses --------------------------------
// These 202 shapes are returned by the /agent endpoint variants and include
// an extra `agentResultKey` field for fetching the slim transformed result.

export interface HolderProfilesAgentJobAcceptedResponse {
  status: "queued";
  tokenMint: string;
  topN: number;
  jobId: string;
  requestId: string;
  monitoringUrl: string;
  /** Full developer result key — fetch via GET /jobs/result/by-key?key=... */
  resultKey: string;
  /** Slim agent-optimised result key — fetch via GET /jobs/result/by-key?key=... */
  agentResultKey: string;
  message: string;
}

export interface SimilarityAgentJobAcceptedResponse {
  status: "queued";
  jobId: string;
  requestId: string;
  walletCount: number;
  monitoringUrl: string;
  /** Full developer result key — fetch via GET /jobs/result/by-key?key=... */
  resultKey: string;
  /** Slim agent-optimised result key — fetch via GET /jobs/result/by-key?key=... */
  agentResultKey: string;
  message: string;
}

// --- Agent-optimised result types ------------------------------------------
// Compact shapes returned by the /agent endpoints.
// Same underlying job; result is transformed at read time.

export interface AgentHoldingsSummary {
  totalPositions: number | null;
  /** Sum of SOL value across ALL current holdings */
  totalCurrentHoldingsValueSol: number | null;
  /** Top 5 current holdings by SOL value */
  topHoldings: Array<{ tokenAddress: string; valueSol: number }>;
}

export interface AgentHolderProfile {
  walletAddress: string;
  rank: number;
  supplyPercent: number;
  tokenHoldingValueSol: number | null;
  analysisSkipped?: boolean;
  knownType?: string;
  knownLabel?: string;
  behaviorType: string | null;
  exitPattern: string | null;
  medianHoldTimeHours: number | null;
  dataQualityTier: string;
  confidence: number;
  completedCycleCount: number;
  walletPnlSol: number | null;
  solBalance: number | null;
  /** Replaces the full currentHoldings[] array. */
  holdingsSummary: AgentHoldingsSummary;
}

export interface AgentHolderAggregate {
  totalHolders: number;
  analyzedHolders: number;
  /** Supply % held by rank-1 non-skipped holder */
  top1SupplyPct: number;
  /** Supply % held by top-5 non-skipped holders */
  top5SupplyPct: number;
  /**
   * Count and supply % per behavior type, sorted descending by count.
   * Null behaviorType on analyzed wallets surfaces as "FRESH".
   * Skipped wallets (LP, burn, system) are excluded.
   */
  behaviorDistribution: Array<{ behaviorType: string; count: number; supplyPct: number }>;
  avgWalletPnlSol: number | null;
}

export interface AgentHolderProfilesResult {
  aggregate: AgentHolderAggregate;
  profiles: AgentHolderProfile[];
  metadata: {
    tokenMint: string | undefined;
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
  };
}

export interface AgentSimilarityPair {
  walletA: string;
  walletB: string;
  /** Combined score: binaryScore * 0.6 + capitalScore * 0.4 */
  similarityScore: number;
  sharedTokenCount: number;
  portfolioSizeA: number;
  portfolioSizeB: number;
  /** Fraction of walletA's portfolio shared with walletB */
  overlapPctA: number;
  /** Fraction of walletB's portfolio shared with walletA */
  overlapPctB: number;
  /**
   * Present when the pair crosses a coordination threshold.
   * HIGH_SIMILARITY: combinedScore > 0.7
   * HIGH_OVERLAP: either wallet >50% overlap OR >20 shared tokens
   * HIGH_SIMILARITY_AND_OVERLAP: both conditions met
   */
  flag?: "HIGH_SIMILARITY" | "HIGH_OVERLAP" | "HIGH_SIMILARITY_AND_OVERLAP";
}

export interface AgentSimilarityResult {
  /** Weighted average of meaningful pair scores (rank-1 = weight N). Range 0–1. */
  coordinationScore: number;
  /**
   * Pairs with meaningful signal, sorted descending by similarityScore.
   * Included if combinedScore >= 0.15 OR sharedTokenCount >= 20.
   */
  pairs: AgentSimilarityPair[];
  globalMetrics: {
    averageSimilarity: number;
  };
  metadata: {
    walletsAnalyzed: number;
    /** n*(n-1)/2 — all possible pairs */
    totalPairs: number;
    /** Pairs that cleared the signal filter */
    meaningfulPairs: number;
    flaggedPairs: number;
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
