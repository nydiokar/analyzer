// ---------------------------------------------------------------------------
// Sova Intel SDK — SovaIntelClient
// ---------------------------------------------------------------------------

import { HttpClient } from "./http.js";
import { pollAndFetch } from "./poller.js";
import type {
  SovaIntelClientConfig,
  WalletProfileResponse,
  WalletHudResponse,
  WalletGetQueuedResponse,
  TokenPnlResponse,
  TokenPnlParams,
  BatchHudResponse,
  JobAcceptedResponse,
  DeepJobAcceptedResponse,
  DeepPartialResponse,
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
  async getWalletHud(walletAddress: string): Promise<WalletHudResponse> {
    const path = `/intel/wallet/${walletAddress}/hud`;
    const res = await this.http.request<WalletHudResponse | WalletGetQueuedResponse>({ path });
    if ("status" in res && res.status === "queued") {
      const queued = res as WalletGetQueuedResponse;
      const prepaidJobId = queued.prepaidJobId ?? queued.jobId;
      await this.waitForJob(queued.jobId);
      return this.http.request<WalletHudResponse>({
        path,
        headers: { "X-Prepaid-Job-Id": prepaidJobId },
      });
    }
    return res as WalletHudResponse;
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
  ): Promise<JobAcceptedResponse> {
    return this.http.request<JobAcceptedResponse>({
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
  async queueSimilarity(wallets: string[]): Promise<JobAcceptedResponse> {
    return this.http.request<JobAcceptedResponse>({
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
  // POST /intel/token/:mint/holders/deep — 35cr (async, two jobs)
  // TEMPORARILY UNAVAILABLE: endpoint returns 501 until chain-job fix lands.
  // Use queueHolderProfiles() + pollHolderProfiles() then queueSimilarity() instead.
  // -------------------------------------------------------------------------

  /**
   * @deprecated Endpoint temporarily returns 501. Use the two-step alternative:
   * 1. `queueHolderProfiles` / `pollHolderProfiles` to get holder addresses
   * 2. `queueSimilarity` with those addresses
   */
  async queueDeepAnalysis(
    tokenMint: string,
    wallets: string[],
    topN = 20,
  ): Promise<DeepJobAcceptedResponse | DeepPartialResponse> {
    return this.http.request<DeepJobAcceptedResponse | DeepPartialResponse>({
      method: "POST",
      path: `/intel/token/${tokenMint}/holders/deep`,
      body: { topN, wallets },
    });
  }

  /**
   * Convenience: queue deep analysis and poll both jobs in parallel.
   * Returns { holderProfiles, similarity } — each is the raw result object.
   *
   * @deprecated Endpoint temporarily returns 501. Use the two-step alternative:
   * 1. `queueHolderProfiles` / `pollHolderProfiles` to get holder addresses
   * 2. `queueSimilarity` with those addresses
   */
  async pollDeepAnalysis<TH = unknown, TS = unknown>(
    tokenMint: string,
    wallets: string[],
    topN = 20,
  ): Promise<{ holderProfiles: TH; similarity: TS }> {
    const raw = await this.queueDeepAnalysis(tokenMint, wallets, topN);
    if (raw.status === "partial") {
      throw new Error(
        `Deep analysis partial failure: similarity job failed to queue. ` +
        `holderProfiles jobId=${raw.holderProfiles.jobId}. 0cr charged. ` +
        `Retry or call POST /intel/wallets/similarity separately.`
      );
    }
    const jobs = raw as import("./types.js").DeepJobAcceptedResponse;
    const [holderProfiles, similarity] = await Promise.all([
      pollAndFetch<TH>(
        this.http,
        jobs.holderProfiles.jobId,
        // Processor stores at holder-profiles:result:{jobId} (not requestId)
        `holder-profiles:result:${jobs.holderProfiles.jobId}`,
        { intervalMs: this.pollIntervalMs, maxAttempts: this.maxPollAttempts },
      ),
      pollAndFetch<TS>(
        this.http,
        jobs.similarity.jobId,
        `similarity:result:${jobs.similarity.requestId}`,
        { intervalMs: this.pollIntervalMs, maxAttempts: this.maxPollAttempts },
      ),
    ]);
    return { holderProfiles, similarity };
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
