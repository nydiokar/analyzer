import {
  SovaIntelClient,
  type HolderProfile as SdkHolderProfile,
  type HolderProfilesResult as SdkHolderProfilesResult,
} from '@sova-intel/sdk';
import type { HolderProfilesResult } from '../types/holder-profiles';

export interface IntelClient {
  pollHolderProfiles(mint: string, topN: number): Promise<HolderProfilesResult>;
}

export class FixtureIntelClient implements IntelClient {
  constructor(private readonly fixture: HolderProfilesResult) {}

  async pollHolderProfiles(_mint: string, _topN: number): Promise<HolderProfilesResult> {
    return this.fixture;
  }
}

export class SdkIntelClient implements IntelClient {
  private readonly client: SovaIntelClient;

  constructor(params: {
    baseUrl: string;
    apiKey: string;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
  }) {
    this.client = new SovaIntelClient({
      baseUrl: params.baseUrl,
      auth: {
        kind: 'apikey',
        apiKey: params.apiKey,
      },
      pollIntervalMs: params.pollIntervalMs,
      maxPollAttempts: params.maxPollAttempts,
    });
  }

  async pollHolderProfiles(mint: string, topN: number): Promise<HolderProfilesResult> {
    const result: SdkHolderProfilesResult = await this.client.pollHolderProfiles<SdkHolderProfilesResult>(mint, topN);
    return normalizeHolderProfilesResult(result);
  }
}

function normalizeHolderProfilesResult(result: SdkHolderProfilesResult): HolderProfilesResult {
  return {
    mode: result.mode,
    tokenMint: result.tokenMint,
    profiles: result.profiles.map(normalizeHolderProfile),
    metadata: {
      totalHoldersRequested: result.metadata.totalHoldersRequested,
      totalHoldersAnalyzed: result.metadata.totalHoldersAnalyzed,
      totalProcessingTimeMs: result.metadata.totalProcessingTimeMs,
      avgProcessingTimePerWalletMs: result.metadata.avgProcessingTimePerWalletMs,
      failedHolders: result.metadata.failedHolders,
    },
  };
}

function normalizeHolderProfile(profile: SdkHolderProfile): HolderProfilesResult['profiles'][number] {
  return {
    walletAddress: profile.walletAddress,
    rank: profile.rank,
    supplyPercent: profile.supplyPercent,
    tokenHoldingValueSol: profile.tokenHoldingValueSol ?? null,
    knownType: profile.knownType ?? null,
    knownLabel: profile.knownLabel ?? null,
    analysisSkipped: profile.analysisSkipped ?? false,
    medianHoldTimeHours: profile.medianHoldTimeHours,
    avgHoldTimeHours: profile.avgHoldTimeHours,
    behaviorType: profile.behaviorType,
    exitPattern: profile.exitPattern,
    dataQualityTier: profile.dataQualityTier,
    completedCycleCount: profile.completedCycleCount,
    confidence: profile.confidence,
    walletPnlSol: profile.walletPnlSol ?? null,
    walletRealizedPnlSol: profile.walletRealizedPnlSol ?? null,
    solBalance: profile.solBalance ?? null,
  };
}
