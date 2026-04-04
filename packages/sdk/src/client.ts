// ---------------------------------------------------------------------------
// Sova Intel SDK — SovaIntelClient
// ---------------------------------------------------------------------------

import { HttpClient } from "./http.js";
import { pollAndFetch, pollResultKey, JobPollerError } from "./poller.js";
import type {
  SovaIntelClientConfig,
  WalletProfileResponse,
  WalletHud,
  WalletGetQueuedResponse,
  TokenPnlResponse,
  TokenPnlParams,
  BatchHudResponse,
  DeepJobAcceptedResponse,
  HolderProfilesJobAcceptedResponse,
  SimilarityJobAcceptedResponse,
  HolderProfilesAgentJobAcceptedResponse,
  SimilarityAgentJobAcceptedResponse,
  AgentHolderProfilesResult,
  AgentSimilarityResult,
} from "./types.js";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 60;

interface PollOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

export class SovaIntelClient {
  private readonly http: HttpClient;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(config: SovaIntelClientConfig) {
    this.http = new HttpClient(config.baseUrl, config.auth);
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPollAttempts = config.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  }

  // -------------------------------------------------------------------------
  // GET /intel/wallet/:addr — 5cr
  // Warm/fresh: returns 200 directly.
  // Cold/stale: returns WalletGetQueuedResponse (202 shape) immediately.
  // Use getWalletProfile() for a blocking variant that polls internally.
  // -------------------------------------------------------------------------

  /**
   * Raw fetch: returns the HUD immediately if fresh, or a WalletGetQueuedResponse
   * if the wallet is stale and analysis has been queued. Callers handle the queued case.
   */
  async fetchWalletHud(walletAddress: string): Promise<WalletHud | WalletGetQueuedResponse> {
    return this.http.request<WalletHud | WalletGetQueuedResponse>({
      path: `/intel/wallet/${walletAddress}/hud`,
    });
  }

  /**
   * Raw fetch: returns the profile immediately if fresh, or a WalletGetQueuedResponse
   * if the wallet is stale and analysis has been queued. Callers handle the queued case.
   */
  async fetchWalletProfile(walletAddress: string): Promise<WalletProfileResponse | WalletGetQueuedResponse> {
    return this.http.request<WalletProfileResponse | WalletGetQueuedResponse>({
      path: `/intel/wallet/${walletAddress}`,
    });
  }

  /**
   * Re-fetch wallet profile using a prepaid job id after polling completion.
   */
  async fetchWalletProfilePrepaid(walletAddress: string, prepaidJobId: string): Promise<WalletProfileResponse> {
    return this.http.request<WalletProfileResponse>({
      path: `/intel/wallet/${walletAddress}`,
      headers: { "X-Prepaid-Job-Id": prepaidJobId },
    });
  }

  /**
   * Re-fetch wallet HUD using a prepaid job id after polling completion.
   */
  async fetchWalletHudPrepaid(walletAddress: string, prepaidJobId: string): Promise<WalletHud> {
    return this.http.request<WalletHud>({
      path: `/intel/wallet/${walletAddress}/hud`,
      headers: { "X-Prepaid-Job-Id": prepaidJobId },
    });
  }

  /**
   * Blocking: fetch wallet profile, polling if stale. Throws on timeout.
   * For MCP use fetchWalletProfile() + handle queued case explicitly.
   */
  async getWalletProfile(walletAddress: string): Promise<WalletProfileResponse> {
    const res = await this.fetchWalletProfile(walletAddress);
    if ("status" in res && res.status === "queued") {
      const queued = res as WalletGetQueuedResponse;
      const prepaidJobId = queued.prepaidJobId ?? queued.jobId;
      await this.waitForJob(queued.jobId);
      return this.fetchWalletProfilePrepaid(walletAddress, prepaidJobId);
    }
    return res as WalletProfileResponse;
  }

  /**
   * Blocking: fetch wallet HUD, polling if stale. Throws on timeout.
   * For MCP use fetchWalletHud() + handle queued case explicitly.
   */
  async getWalletHud(walletAddress: string): Promise<WalletHud> {
    const res = await this.fetchWalletHud(walletAddress);
    if ("status" in res && res.status === "queued") {
      const queued = res as WalletGetQueuedResponse;
      const prepaidJobId = queued.prepaidJobId ?? queued.jobId;
      await this.waitForJob(queued.jobId);
      return this.fetchWalletHudPrepaid(walletAddress, prepaidJobId);
    }
    return res as WalletHud;
  }

  // -------------------------------------------------------------------------
  // GET /intel/wallet/:addr/tokens — 3cr (paginated, sortable)
  // -------------------------------------------------------------------------
  async getWalletTokens(
    walletAddress: string,
    params?: TokenPnlParams,
  ): Promise<TokenPnlResponse> {
    return this.http.request<TokenPnlResponse>({
      path: `/intel/wallet/${walletAddress}/tokens`,
      query: {
        page: params?.page,
        pageSize: params?.pageSize,
        sortBy: params?.sortBy,
        sortOrder: params?.sortOrder,
      },
    });
  }

  // -------------------------------------------------------------------------
  // POST /intel/wallets/batch-hud — 5cr flat (up to 30 wallets)
  // -------------------------------------------------------------------------
  async batchHud(wallets: string[]): Promise<BatchHudResponse> {
    return this.http.request<BatchHudResponse>({
      method: "POST",
      path: `/intel/wallets/batch-hud`,
      body: { wallets },
    });
  }

  // -------------------------------------------------------------------------
  // POST /intel/token/:mint/holders — 20cr (async)
  // Queues the job and returns the raw accepted response.
  // Use pollHolderProfiles() for a blocking variant.
  // -------------------------------------------------------------------------
  async queueHolderProfiles(
    tokenMint: string,
    topN = 20,
  ): Promise<HolderProfilesJobAcceptedResponse> {
    return this.http.request<HolderProfilesJobAcceptedResponse>({
      method: "POST",
      path: `/intel/token/${tokenMint}/holders`,
      body: { topN },
    });
  }

  /**
   * Convenience: queue holder profiles and poll until result is ready.
   * Returns the raw result object from the job result store.
   */
  async pollHolderProfiles<T = unknown>(
    tokenMint: string,
    topN = 20,
  ): Promise<T> {
    const job = await this.queueHolderProfiles(tokenMint, topN);
    // Processor stores at holder-profiles:result:{jobId} (not requestId)
    return this.pollJobResult<T>(
      job.jobId,
      `holder-profiles:result:${job.jobId}`,
    );
  }

  // -------------------------------------------------------------------------
  // POST /intel/wallets/similarity — 20cr (async)
  // -------------------------------------------------------------------------
  async queueSimilarity(wallets: string[]): Promise<SimilarityJobAcceptedResponse> {
    return this.http.request<SimilarityJobAcceptedResponse>({
      method: "POST",
      path: `/intel/wallets/similarity`,
      body: { wallets },
    });
  }

  /**
   * Convenience: queue similarity and poll until result is ready.
   */
  async pollSimilarity<T = unknown>(wallets: string[]): Promise<T> {
    const job = await this.queueSimilarity(wallets);
    return this.pollJobResult<T>(
      job.jobId,
      `similarity:result:${job.requestId}`,
    );
  }

  // -------------------------------------------------------------------------
  // POST /intel/token/:mint/holders/deep — 35cr (async, chained)
  // Queues holder-profiles; processor auto-chains similarity after completion.
  // -------------------------------------------------------------------------

  /**
   * Queue a bundled holder-profiles + similarity analysis (35cr).
   * The server discovers holder addresses itself — no `wallets[]` needed.
   *
   * Returns immediately with both job descriptors. `similarity.jobId` is null
   * because the similarity job is queued by the processor after holder-profiles
   * completes. Use `pollDeepAnalysis` for a fully blocking variant.
   */
  async queueDeepAnalysis(
    tokenMint: string,
    topN = 20,
  ): Promise<DeepJobAcceptedResponse> {
    return this.http.request<DeepJobAcceptedResponse>({
      method: "POST",
      path: `/intel/token/${tokenMint}/holders/deep`,
      body: { topN },
    });
  }

  /**
   * Convenience: queue deep analysis and poll both results sequentially.
   * Waits for holder-profiles to complete, then polls the similarity result key
   * (which the processor populates automatically after holder-profiles finishes).
   *
   * Returns `{ holderProfiles, similarity }` — each is the raw result object.
   */
  async pollDeepAnalysis<TH = unknown, TS = unknown>(
    tokenMint: string,
    topN = 20,
  ): Promise<{ holderProfiles: TH; similarity: TS }> {
    const jobs = await this.queueDeepAnalysis(tokenMint, topN);

    // Step 1: wait for holder-profiles and fetch its result
    const holderProfiles = await this.pollJobResult<TH>(
      jobs.holderProfiles.jobId,
      `holder-profiles:result:${jobs.holderProfiles.jobId}`,
    );

    // Step 2: poll the similarity result key — processor queues it automatically
    // after holder-profiles completes, so we start polling immediately after step 1.
    const similarity = await this.pollResultByKey<TS>(
      jobs.similarity.resultKey,
    );

    return { holderProfiles, similarity };
  }

  // -------------------------------------------------------------------------
  // POST /intel/token/:mint/holders/agent — 20cr (async, agent-optimised)
  // Same job as /holders but result is transformed to a compact shape with an
  // aggregate block and slim per-holder profiles.
  // -------------------------------------------------------------------------

  /**
   * Queue an agent-optimised holder-profiles analysis (20cr).
   * Returns the raw 202 response including `agentResultKey` for polling.
   * Use `pollTokenHoldersAgent()` for a blocking variant.
   */
  async queueTokenHoldersAgent(
    tokenMint: string,
    topN = 20,
  ): Promise<HolderProfilesAgentJobAcceptedResponse> {
    return this.http.request<HolderProfilesAgentJobAcceptedResponse>({
      method: "POST",
      path: `/intel/token/${tokenMint}/holders/agent`,
      body: { topN },
    });
  }

  /**
   * Convenience: queue agent holder-profiles and poll until the slim result is ready.
   * Fetches from `agentResultKey` (not the full result key).
   */
  async pollTokenHoldersAgent(
    tokenMint: string,
    topN = 20,
  ): Promise<AgentHolderProfilesResult> {
    const job = await this.queueTokenHoldersAgent(tokenMint, topN);
    return this.pollJobResult<AgentHolderProfilesResult>(
      job.jobId,
      job.agentResultKey,
    );
  }

  // -------------------------------------------------------------------------
  // POST /intel/wallets/similarity/agent — 20cr (async, agent-optimised)
  // Same job as /similarity but result is transformed to a compact shape with
  // a coordinationScore, filtered pairs, and flags.
  // -------------------------------------------------------------------------

  /**
   * Queue an agent-optimised similarity analysis (20cr).
   * Returns the raw 202 response including `agentResultKey` for polling.
   * Use `pollWalletSimilarityAgent()` for a blocking variant.
   */
  async queueWalletSimilarityAgent(
    wallets: string[],
  ): Promise<SimilarityAgentJobAcceptedResponse> {
    return this.http.request<SimilarityAgentJobAcceptedResponse>({
      method: "POST",
      path: `/intel/wallets/similarity/agent`,
      body: { wallets },
    });
  }

  /**
   * Convenience: queue agent similarity and poll until the slim result is ready.
   * Fetches from `agentResultKey` (not the full result key).
   */
  async pollWalletSimilarityAgent(wallets: string[]): Promise<AgentSimilarityResult> {
    const job = await this.queueWalletSimilarityAgent(wallets);
    return this.pollJobResult<AgentSimilarityResult>(
      job.jobId,
      job.agentResultKey,
    );
  }

  /**
   * Public resume path for queued jobs with a known job id and result key.
   */
  async pollJobResult<T>(
    jobId: string,
    resultKey: string,
    options: PollOptions = {},
  ): Promise<T> {
    return pollAndFetch<T>(
      this.http,
      jobId,
      resultKey,
      {
        intervalMs: options.intervalMs ?? this.pollIntervalMs,
        maxAttempts: options.maxAttempts ?? this.maxPollAttempts,
      },
    );
  }

  /**
   * Public resume path for chained async flows where only the result key is known.
   */
  async pollResultByKey<T>(
    resultKey: string,
    options: PollOptions = {},
  ): Promise<T> {
    return pollResultKey<T>(
      this.http,
      resultKey,
      {
        intervalMs: options.intervalMs ?? this.pollIntervalMs,
        maxAttempts: options.maxAttempts ?? this.maxPollAttempts,
      },
    );
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Poll a job until it completes or fails (no result fetch).
   * Throws JobPollerError on timeout, Error on job failure.
   * Public so MCP and other callers can use it for the wallet HUD/profile
   * re-fetch pattern (poll status → re-call with X-Prepaid-Job-Id).
   */
  async waitForJob(jobId: string, options: PollOptions = {}): Promise<void> {
    const intervalMs = options.intervalMs ?? this.pollIntervalMs;
    const maxAttempts = options.maxAttempts ?? this.maxPollAttempts;
    for (let i = 0; i < maxAttempts; i++) {
      const status = await this.http.request<{ status: string }>({
        path: `/jobs/${jobId}`,
      });
      if (status.status === "completed") return;
      if (status.status === "failed") throw new Error(`Job ${jobId} failed`);
      await sleep(intervalMs);
    }
    throw new JobPollerError(jobId, `Job ${jobId} did not complete within ${maxAttempts} attempts`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
