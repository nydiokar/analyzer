import { HttpClient } from "./http.js";
import type {
  SovaIntelGeneratedClientConfig,
  BatchHudRequestDto,
  IntelBatchHudResponseDto,
  IntelDeepJobAcceptedResponseDto,
  IntelHolderProfilesAgentJobAcceptedResponseDto,
  IntelHolderProfilesJobAcceptedResponseDto,
  IntelSimilarityAgentJobAcceptedResponseDto,
  IntelSimilarityJobAcceptedResponseDto,
  IntelTokenHoldersDeepRequestDto,
  IntelTokenHoldersRequestDto,
  IntelTokenPerformanceResponseDto,
  IntelWalletProfileResponseDto,
  IntelWalletSimilarityRequestDto,
  WalletHudDto,
} from "./index.js";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 60;

export class SovaIntelGeneratedClient {
  private readonly http: HttpClient;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(config: SovaIntelGeneratedClientConfig) {
    this.http = new HttpClient(config.baseUrl, config.auth);
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPollAttempts = config.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  }

  async getWalletProfile(addr: string): Promise<IntelWalletProfileResponseDto> {
      return this.http.request<IntelWalletProfileResponseDto>({
        method: "GET",
        path: `/intel/wallet/${addr}`,
        query: undefined,
        body: undefined,
      });
    }
  
  async getWalletTokens(addr: string, query?: Record<string, string | number | boolean | undefined>): Promise<IntelTokenPerformanceResponseDto> {
      return this.http.request<IntelTokenPerformanceResponseDto>({
        method: "GET",
        path: `/intel/wallet/${addr}/tokens`,
        query: query,
        body: undefined,
      });
    }
  
  async getWalletHud(addr: string): Promise<WalletHudDto> {
      return this.http.request<WalletHudDto>({
        method: "GET",
        path: `/intel/wallet/${addr}/hud`,
        query: undefined,
        body: undefined,
      });
    }
  
  async queueHolderProfiles(mint: string, body?: IntelTokenHoldersRequestDto): Promise<IntelHolderProfilesJobAcceptedResponseDto> {
      return this.http.request<IntelHolderProfilesJobAcceptedResponseDto>({
        method: "POST",
        path: `/intel/token/${mint}/holders`,
        query: undefined,
        body: body,
      });
    }
  
  async queueSimilarity(body: IntelWalletSimilarityRequestDto): Promise<IntelSimilarityJobAcceptedResponseDto> {
      return this.http.request<IntelSimilarityJobAcceptedResponseDto>({
        method: "POST",
        path: `/intel/wallets/similarity`,
        query: undefined,
        body: body,
      });
    }
  
  async queueTokenHoldersAgent(mint: string, body?: IntelTokenHoldersRequestDto): Promise<IntelHolderProfilesAgentJobAcceptedResponseDto> {
      return this.http.request<IntelHolderProfilesAgentJobAcceptedResponseDto>({
        method: "POST",
        path: `/intel/token/${mint}/holders/agent`,
        query: undefined,
        body: body,
      });
    }
  
  async getAgentHolderProfilesResult(jobId: string): Promise<unknown> {
      return this.http.request<unknown>({
        method: "GET",
        path: `/intel/jobs/result/agent/holder-profiles/${jobId}`,
        query: undefined,
        body: undefined,
      });
    }
  
  async queueWalletSimilarityAgent(body: IntelWalletSimilarityRequestDto): Promise<IntelSimilarityAgentJobAcceptedResponseDto> {
      return this.http.request<IntelSimilarityAgentJobAcceptedResponseDto>({
        method: "POST",
        path: `/intel/wallets/similarity/agent`,
        query: undefined,
        body: body,
      });
    }
  
  async getAgentSimilarityResult(requestId: string): Promise<unknown> {
      return this.http.request<unknown>({
        method: "GET",
        path: `/intel/jobs/result/agent/similarity/${requestId}`,
        query: undefined,
        body: undefined,
      });
    }
  
  async queueDeepAnalysis(mint: string, body?: IntelTokenHoldersDeepRequestDto): Promise<IntelDeepJobAcceptedResponseDto> {
      return this.http.request<IntelDeepJobAcceptedResponseDto>({
        method: "POST",
        path: `/intel/token/${mint}/holders/deep`,
        query: undefined,
        body: body,
      });
    }
  
  async batchHud(body: BatchHudRequestDto): Promise<IntelBatchHudResponseDto> {
      return this.http.request<IntelBatchHudResponseDto>({
        method: "POST",
        path: `/intel/wallets/batch-hud`,
        query: undefined,
        body: body,
      });
    }
}
