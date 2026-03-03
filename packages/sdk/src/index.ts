// ---------------------------------------------------------------------------
// @sova/intel-sdk — public API surface
// ---------------------------------------------------------------------------

export { SovaIntelClient } from "./client.js";
export { pollAndFetch, JobPollerError } from "./poller.js";
export { SovaHttpError, X402PaymentError } from "./http.js";
export type {
  // Config
  SovaIntelClientConfig,
  Auth,
  ApiKeyAuth,
  X402Auth,
  // Wallet intel
  WalletProfileResponse,
  WalletHudResponse,
  WalletSummary,
  WalletHud,
  WalletBehavior,
  PnlAllTime,
  // Token PnL
  TokenPnlRow,
  TokenPnlResponse,
  TokenPnlParams,
  // Batch
  BatchHudResponse,
  BatchHudResult,
  BatchQueuedEntry,
  // Async jobs
  JobRef,
  JobStatus,
  JobAcceptedResponse,
  DeepJobAcceptedResponse,
  DeepPartialResponse,
  // X402
  X402Accept,
  X402ErrorBody,
} from "./types.js";
