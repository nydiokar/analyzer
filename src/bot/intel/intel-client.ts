import axios, { AxiosInstance } from 'axios';

// ── Type definitions (copied from pft-bot_v2/src/analyzer.ts) ────────────────

export interface WalletHud {
  walletAddress: string;
  signalType: string;
  trimmedMeanPnl: number;
  avgTxValueSol: number;
  behaviorCategory?: string;
  behaviorCode: string;
  medianHoldTimeHours?: number;
  avgTradesPerDay: number;
  uniqueTokensPerDay: number;
  winRate: number;
  isBot: boolean;
  isWhale: boolean;
  currentHoldingsSol: number;
  currentHoldingsUsd?: number;
  dataQualityTier: string;
  calculatedAt: string;
  provenance?: {
    provider: string;
    schemaVersion: string;
    generatedAt: string;
    dataRange?: {
      from: string;
      to: string;
    };
    source?: string;
  };
}

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
  dataQualityTier: string;
  completedCycleCount: number;
  confidence: number;
  walletPnlSol?: number | null;
  walletRealizedPnlSol?: number | null;
  solBalance?: number | null;
}

export interface HolderProfilesResult {
  mode: 'token' | 'wallet';
  tokenMint?: string;
  profiles: HolderProfile[];
  metadata: {
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
    totalProcessingTimeMs: number;
    avgProcessingTimePerWalletMs: number;
    failedHolders?: number;
  };
  success: boolean;
}

export interface HolderProfilesJobResponse {
  jobId: string;
  requestId: string;
  status: 'queued';
  queueName: string;
  tokenMint: string;
  topN: number;
  estimatedProcessingTime: string;
  monitoringUrl: string;
}

export interface JobResult {
  jobId: string;
  status: 'completed' | 'failed' | 'active' | 'waiting';
  result?: unknown;
  error?: string;
}

// ── Client ────────────────────────────────────────────────────────────────────

export class IntelClient {
  private readonly http: AxiosInstance;
  private readonly pollHttp: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: { 'x-api-key': apiKey },
      timeout: 35000, // 5s above the API's 30s synchronous hold
    });
    this.pollHttp = axios.create({
      baseURL: baseUrl,
      headers: { 'x-api-key': apiKey },
      timeout: 5000,
    });
  }

  async getHud(address: string): Promise<WalletHud> {
    const { data } = await this.http.get<WalletHud>(`/intel/wallet/${address}/hud`);
    return data;
  }

  async getProfile(address: string): Promise<WalletHud> {
    const { data } = await this.http.get<WalletHud>(`/intel/wallet/${address}`);
    return data;
  }

  async postHolders(mint: string): Promise<HolderProfilesJobResponse> {
    const { data } = await this.http.post<HolderProfilesJobResponse>(
      `/intel/token/${mint}/holders`,
    );
    return data;
  }

  async pollJob(jobId: string): Promise<JobResult> {
    const { data } = await this.pollHttp.get<JobResult>(`/jobs/${jobId}/result`);
    return data;
  }
}
