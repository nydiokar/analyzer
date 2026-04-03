// ---------------------------------------------------------------------------
// @sova/intel-sdk — public API surface
// ---------------------------------------------------------------------------

export { SovaIntelClient } from "./client.js";
export { pollAndFetch, pollResultKey, JobPollerError } from "./poller.js";
export { SovaHttpError, X402PaymentError } from "./http.js";
export type {
  // Config
  SovaIntelClientConfig,
  Auth,
  ApiKeyAuth,
  X402Auth,
  // Wallet intel
  WalletProfileResponse,
  WalletSummary,
  WalletHud,
  WalletBehavior,
  KolIdentity,
  PnlAllTime,
  DataQualityTier,
  // Token PnL
  TokenPnlRow,
  TokenPnlResponse,
  TokenPnlParams,
  // Batch
  BatchHudResponse,
  BatchHudResult,
  BatchHudQueuedEntry,
  // Similarity
  SimilarityPairResult,
  SimilarityGlobalMetrics,
  SimilarityResult,
  // Holder profiles
  HolderProfile,
  HolderProfilesResult,
  // Async jobs
  JobRef,
  JobStatus,
  JobAcceptedResponse,
  HolderProfilesJobAcceptedResponse,
  SimilarityJobAcceptedResponse,
  WalletGetQueuedResponse,
  DeepJobAcceptedResponse,
  // Agent-optimised job accepted responses
  HolderProfilesAgentJobAcceptedResponse,
  SimilarityAgentJobAcceptedResponse,
  // Agent-optimised result types
  AgentHoldingsSummary,
  AgentHolderProfile,
  AgentHolderAggregate,
  AgentHolderProfilesResult,
  AgentSimilarityPair,
  AgentSimilarityResult,
  // X402
  X402Accept,
  X402ErrorBody,
} from "./types.js";
