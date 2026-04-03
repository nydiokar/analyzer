// ---------------------------------------------------------------------------
// Sova Intel SDK — SovaIntelClient
// ---------------------------------------------------------------------------

import { HttpClient } from "./http.js";
import { pollAndFetch, pollResultKey } from "./poller.js";
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
  // Cold/stale: server holds request up to ~30s. On timeout fallback (202),
  // this method polls job completion and re-calls with X-Prepaid-Job-Id.
  // -------------------------------------------------------------------------
  async getWalletProfile(walletAddress: string): Promise<WalletProfileResponse> {
    const path = `/intel/wallet/${walletAddress}`;
    const res = await this.http.request<WalletProfileResponse | WalletGetQueuedResponse>({
      path,
    });

    if ("status" in res && res.status === "queued") {
      const queued = res as WalletGetQueuedResponse;
      const prepaidJobId = queued.prepaidJobId ?? queued.jobId;
      await this.waitForJob(queued.jobId);
      return this.http.request<WalletProfileResponse>({
        path,
        headers: { "X-Prepaid-Job-Id": prepaidJobId },
      });
    }

    return res as WalletProfileResponse;
  }

  // -------------------------------------------------------------------------
  // GET /intel/wallet/:addr/hud — 1cr
  // Same timeout fallback contract as getWalletProfile.
  // -------------------------------------------------------------------------
  async getWalletHud(walletAddress: string): Promise<WalletHud> {
    const path = `/intel/wallet/${walletAddress}/hud`;
    const res = await this.http.request<WalletHud | WalletGetQueuedResponse>({ path });
    if ("status" in res && res.status === "queued") {
      const queued = res as WalletGetQueuedResponse;
      const prepaidJobId = queued.prepaidJobId ?? queued.jobId;
      await this.waitForJob(queued.jobId);
      return this.http.request<WalletHud>({
        path,
        headers: { "X-Prepaid-Job-Id": prepaidJobId },
      });
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
    return pollAndFetch<T>(
      this.http,
      job.jobId,
      `holder-profiles:result:${job.jobId}`,
      { intervalMs: this.pollIntervalMs, maxAttempts: this.maxPollAttempts },
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
    return pollAndFetch<T>(
      this.http,
      job.jobId,
      `similarity:result:${job.requestId}`,
      { intervalMs: this.pollIntervalMs, maxAttempts: this.maxPollAttempts },
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
    const holderProfiles = await pollAndFetch<TH>(
      this.http,
      jobs.holderProfiles.jobId,
      `holder-profiles:result:${jobs.holderProfiles.jobId}`,
      { intervalMs: this.pollIntervalMs, maxAttempts: this.maxPollAttempts },
    );

    // Step 2: poll the similarity result key — processor queues it automatically
    // after holder-profiles completes, so we start polling immediately after step 1.
    const similarity = await pollResultKey<TS>(
      this.http,
      jobs.similarity.resultKey,
      { intervalMs: this.pollIntervalMs, maxAttempts: this.maxPollAttempts },
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
    return pollAndFetch<AgentHolderProfilesResult>(
      this.http,
      job.jobId,
      job.agentResultKey,
      { intervalMs: this.pollIntervalMs, maxAttempts: this.maxPollAttempts },
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
    return pollAndFetch<AgentSimilarityResult>(
      this.http,
      job.jobId,
      job.agentResultKey,
      { intervalMs: this.pollIntervalMs, maxAttempts: this.maxPollAttempts },
    );
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Poll a job until it completes or fails (no result fetch). */
  private async waitForJob(jobId: string): Promise<void> {
    const { pollIntervalMs, maxPollAttempts } = this;
    for (let i = 0; i < maxPollAttempts; i++) {
      const status = await this.http.request<{ status: string }>({
        path: `/jobs/${jobId}`,
      });
      if (status.status === "completed") return;
      if (status.status === "failed") throw new Error(`Job ${jobId} failed`);
      await sleep(pollIntervalMs);
    }
    throw new Error(`Job ${jobId} timed out`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
