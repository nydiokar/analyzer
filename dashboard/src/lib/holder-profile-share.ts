import type {
  DataQualityTier,
  HolderProfile,
  HolderProfilesResult,
  TokenSnapshot,
} from '@/components/holder-profiles/types';
import type { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';
import type { KnownWalletType } from '@/types/api';

export interface ShareProfile extends Pick<
  HolderProfile,
  | 'walletAddress'
  | 'rank'
  | 'supplyPercent'
  | 'behaviorType'
  | 'medianHoldTimeHours'
  | 'avgHoldTimeHours'
  | 'walletRealizedPnlSol'
  | 'solBalance'
  | 'dataQualityTier'
  | 'completedCycleCount'
  | 'exitPattern'
  | 'tokenHoldingValueSol'
  | 'knownType'
  | 'knownLabel'
  | 'analysisSkipped'
> {}

export interface ShareSnapshot {
  mode: string;
  tokenMint?: string;
  tokenSymbol?: string | null;
  topN?: number;
  tokenSnapshot?: TokenSnapshot | null;
  similarityResult?: CombinedSimilarityResult | null;
  profiles: ShareProfile[];
  metadata: {
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
    totalProcessingTimeMs: number;
    avgProcessingTimePerWalletMs: number;
  };
}

export interface ShareRecord {
  id: string;
  snapshot: ShareSnapshot;
  tokenMint: string | null;
  tokenSymbol: string | null;
  topN: number | null;
  createdAt: string;
  expiresAt?: string | null;
  viewCount: number;
}

export function mapShareSnapshotToHolderProfilesResult(snapshot: ShareSnapshot): HolderProfilesResult {
  const mode: 'token' | 'wallet' = snapshot.mode === 'wallet' ? 'wallet' : 'token';

  return {
    mode,
    tokenMint: snapshot.tokenMint,
    tokenSnapshot: snapshot.tokenSnapshot ?? null,
    profiles: snapshot.profiles.map((profile): HolderProfile => ({
      walletAddress: profile.walletAddress,
      rank: profile.rank,
      supplyPercent: profile.supplyPercent,
      tokenHoldingValueSol: profile.tokenHoldingValueSol ?? null,
      knownType: profile.knownType as KnownWalletType | undefined,
      knownLabel: profile.knownLabel,
      analysisSkipped: profile.analysisSkipped,
      medianHoldTimeHours: profile.medianHoldTimeHours,
      avgHoldTimeHours: profile.avgHoldTimeHours,
      dailyFlipRatio: null,
      behaviorType: profile.behaviorType,
      exitPattern: profile.exitPattern,
      dataQualityTier: profile.dataQualityTier as DataQualityTier,
      completedCycleCount: profile.completedCycleCount,
      confidence: 0,
      processingTimeMs: 0,
      realizedMedianHoldTimeHours: profile.medianHoldTimeHours,
      realizedAverageHoldTimeHours: profile.avgHoldTimeHours,
      walletPnlSol: profile.walletRealizedPnlSol ?? null,
      walletRealizedPnlSol: profile.walletRealizedPnlSol ?? null,
      solBalance: profile.solBalance ?? null,
    })),
    metadata: snapshot.metadata,
  };
}
