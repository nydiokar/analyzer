import axios, { AxiosInstance } from 'axios';

// --- Analyzer API types ---

export interface TopHolder {
  tokenAccount: string;
  ownerAccount?: string;
  amount: string;
  decimals: number;
  uiAmount: number | null;
  uiAmountString: string;
  rank: number;
  knownType?: string;
  knownLabel?: string;
}

export interface TopHoldersResponse {
  mint: string;
  holders: TopHolder[];
  supply?: {
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString: string;
  };
}

export interface WalletHud {
  walletAddress: string;
  signalType: string;
  // PnL & Transaction metrics
  trimmedMeanPnl: number;       // outlier-trimmed mean P/L per token (in SOL)
  avgTxValueSol: number;        // average transaction value in SOL (total SOL volume / total trades)
  // Behavior
  behaviorCategory?: string;    // e.g. 'MOMENTUM_TRADER', 'DAY_TRADER'
  behaviorCode: string;         // single-letter: M/D/S/R/W/P/H/A/B/L/?
  medianHoldTimeHours?: number;
  avgTradesPerDay: number;
  uniqueTokensPerDay: number;
  winRate: number;              // decimal 0-1 (0.68 = 68%)
  // Badges
  isBot: boolean;
  isWhale: boolean;
  // Holdings (live portfolio value, not unrealized P/L)
  currentHoldingsSol: number;
  currentHoldingsUsd?: number;
  // Meta
  dataQualityTier: string;      // GOLD | SILVER | BRONZE | INSUFFICIENT
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

export interface BatchHudResponse {
  huds: Record<string, WalletHud>;
  notFound: string[];
  calculatedAt: string;
}

export interface WalletSummary {
  status: 'ok' | 'unanalyzed' | 'restricted';
  walletAddress: string;
  knownType?: string | null;
  knownLabel?: string | null;
  lastAnalyzedAt?: string | null;
  lastActiveTimestamp?: number | null;
  daysActive?: number | string;
  latestPnl?: number | null;
  latestPnlUsd?: number | null;
  realizedPnl?: number | null;
  unrealizedPnl?: number | null;
  netPnl?: number | null;
  tokenWinRate?: number | null;
  behaviorClassification?: string | null;
  classification?: string | null;
  currentSolBalance?: number | null;
  currentSolBalanceUsd?: number | null;
  profitableTradesCount?: number | null;
  totalTradesCount?: number | null;
}

export interface PnlOverview {
  allTimeData: {
    realizedPnl: number;
    unrealizedPnl?: number;
    swapWinRate?: number;
    winLossCount?: string;
    avgPLTrade?: number;
    totalVolume?: number;
    totalSolSpent: number;
    totalSolReceived: number;
    medianPLToken?: number;
    trimmedMeanPnlPerToken?: number;
    tokenWinRate?: number;
    profitableTokensCount?: number;
    unprofitableTokensCount?: number;
  };
  periodData: PnlOverview['allTimeData'] | null;
}

export interface BehaviorAnalysis {
  tradingStyle: string;
  speedCategory?: string;
  strategyType?: string;
  uniqueTokensTraded: number;
  totalTradeCount: number;
  totalBuyCount: number;
  totalSellCount: number;
  medianHoldTime: number;
  tradingFrequency: {
    tradesPerDay: number;
    tradesPerWeek: number;
  };
  riskMetrics: {
    averageTransactionValueSol: number;
    largestTransactionValueSol: number;
  };
  tradingInterpretation?: {
    speedCategory: string;
    typicalHoldTimeHours: number;
    economicRisk: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    behavioralPattern: string;
    interpretation: string;
  };
  historicalPattern?: {
    behaviorType: string;
    exitPattern: string;
    dataQuality: number;
    medianCompletedHoldTimeHours: number;
  };
  confidenceScore: number;
}

export interface AnalysisJobResponse {
  jobId: string | null;
  requestId: string;
  status: 'queued' | 'running' | 'skipped';
  analysisScope: string;
  estimatedProcessingTime: string;
  skipped?: boolean;
  skipReason?: string;
  alreadyRunning?: boolean;
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

// Shape stored in Redis under holder-profiles:result:{jobId}
// Resolved automatically by GET /jobs/{jobId}/result via the pointer pattern.
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

export interface SimilarityJobResponse {
  jobId: string;
  requestId: string;
  status: 'queued';
  walletCount: number;
  estimatedProcessingTime: string;
}

export interface JobResult {
  jobId: string;
  status: 'completed' | 'failed' | 'active' | 'waiting';
  result?: unknown;
  error?: string;
}

export interface TokenInfo {
  tokenAddress: string;
  name?: string;
  symbol?: string;
  imageUrl?: string;
  marketCap?: number;
}

export class AnalyzerClient {
  private http: AxiosInstance;

  constructor(baseUrl: string, apiKey: string) {
    this.http = axios.create({
      baseURL: baseUrl,
      headers: { 'x-api-key': apiKey },
      timeout: 30000,
    });
  }

  async getTopHolders(mint: string): Promise<TopHoldersResponse> {
    const { data } = await this.http.get<TopHoldersResponse>(`/token-info/${mint}/top-holders`);
    return data;
  }

  async getHudBatch(addresses: string[]): Promise<BatchHudResponse> {
    const { data } = await this.http.post<BatchHudResponse>('/wallets/hud/batch', {
      walletAddresses: addresses,
    });
    return data;
  }

  async getWalletHud(address: string): Promise<WalletHud | null> {
    try {
      const { data } = await this.http.get<WalletHud>(`/wallets/${address}/hud`);
      return data;
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    }
  }

  async getWalletSummary(address: string): Promise<WalletSummary> {
    const { data } = await this.http.get<WalletSummary>(`/wallets/${address}/summary`);
    return data;
  }

  async getPnlOverview(address: string): Promise<PnlOverview> {
    const { data } = await this.http.get<PnlOverview>(`/wallets/${address}/pnl-overview`);
    return data;
  }

  async getBehaviorAnalysis(address: string): Promise<BehaviorAnalysis> {
    const { data } = await this.http.get<BehaviorAnalysis>(`/wallets/${address}/behavior-analysis`);
    return data;
  }

  async queueDashboardAnalysis(
    address: string,
    scope?: 'flash' | 'working' | 'deep',
  ): Promise<AnalysisJobResponse> {
    const { data } = await this.http.post<AnalysisJobResponse>('/analyses/wallets/dashboard-analysis', {
      walletAddress: address,
      analysisScope: scope || 'working',
    });
    return data;
  }

  async queueHolderProfilesAnalysis(tokenMint: string, topN = 10): Promise<HolderProfilesJobResponse> {
    const { data } = await this.http.post<HolderProfilesJobResponse>('/analyses/holder-profiles', {
      tokenMint,
      topN,
    });
    return data;
  }

  async queueSimilarityAnalysis(addresses: string[]): Promise<SimilarityJobResponse> {
    const { data } = await this.http.post<SimilarityJobResponse>('/analyses/similarity/queue', {
      walletAddresses: addresses,
    });
    return data;
  }

  async getJobResult(jobId: string): Promise<JobResult> {
    const { data } = await this.http.get<JobResult>(`/jobs/${jobId}/result`);
    return data;
  }

  async getTokenInfo(mints: string[]): Promise<TokenInfo[]> {
    const { data } = await this.http.post<TokenInfo[]>('/token-info', {
      tokenAddresses: mints,
    });
    return data;
  }
}
