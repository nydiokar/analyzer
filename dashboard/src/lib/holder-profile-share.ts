import type {
  DataQualityTier,
  HolderProfile,
  HolderProfilesResult,
  TokenSnapshot,
} from '@/components/holder-profiles/types';
import type { CombinedSimilarityResult } from '@/components/similarity-lab/results/types';
import type { KnownWalletType } from '@/types/api';

export type ShareProfile = Pick<
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
>;

export interface ShareSnapshot {
  mode: string;
  tokenMint?: string;
  tokenSymbol?: string | null;
  topN?: number;
  tokenSnapshot?: TokenSnapshot | null;
  similaritySnapshot?: ShareSimilaritySnapshot | null;
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

export interface ShareSimilarityPair {
  walletA: string;
  walletB: string;
  binaryScore: number;
  capitalScore: number;
  binarySharedTokenCount: number;
  binaryUniqueTokenCountA: number;
  binaryUniqueTokenCountB: number;
}

export interface ShareSimilaritySnapshot {
  version: 1;
  walletCount: number;
  pairs: ShareSimilarityPair[];
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

export function trimSimilarityResultForShare(
  similarityResult: CombinedSimilarityResult | null | undefined,
): ShareSimilaritySnapshot | null {
  if (!similarityResult?.pairwiseSimilarities?.length) {
    return null;
  }

  const wallets = new Set<string>();
  const pairs = similarityResult.pairwiseSimilarities.map((pair): ShareSimilarityPair => {
    wallets.add(pair.walletA);
    wallets.add(pair.walletB);

    return {
      walletA: pair.walletA,
      walletB: pair.walletB,
      binaryScore: pair.binaryScore,
      capitalScore: pair.capitalScore,
      binarySharedTokenCount: pair.binarySharedTokenCount,
      binaryUniqueTokenCountA: pair.binaryUniqueTokenCountA,
      binaryUniqueTokenCountB: pair.binaryUniqueTokenCountB,
    };
  });

  return {
    version: 1,
    walletCount: wallets.size,
    pairs,
  };
}

export function expandShareSimilaritySnapshot(
  snapshot: ShareSimilaritySnapshot | null | undefined,
): CombinedSimilarityResult | null {
  if (!snapshot?.pairs?.length) {
    return null;
  }

  const uniqueTokensPerWallet: Record<string, { binary: number; capital: number }> = {};

  for (const pair of snapshot.pairs) {
    if (!uniqueTokensPerWallet[pair.walletA]) {
      uniqueTokensPerWallet[pair.walletA] = {
        binary: pair.binaryUniqueTokenCountA,
        capital: 0,
      };
    }
    if (!uniqueTokensPerWallet[pair.walletB]) {
      uniqueTokensPerWallet[pair.walletB] = {
        binary: pair.binaryUniqueTokenCountB,
        capital: 0,
      };
    }
  }

  return {
    pairwiseSimilarities: snapshot.pairs.map((pair) => ({
      walletA: pair.walletA,
      walletB: pair.walletB,
      binaryScore: pair.binaryScore,
      capitalScore: pair.capitalScore,
      sharedTokens: [],
      capitalAllocation: {},
      binarySharedTokenCount: pair.binarySharedTokenCount,
      binaryUniqueTokenCountA: pair.binaryUniqueTokenCountA,
      binaryUniqueTokenCountB: pair.binaryUniqueTokenCountB,
      capitalSharedTokenCount: pair.binarySharedTokenCount,
      capitalUniqueTokenCountA: 0,
      capitalUniqueTokenCountB: 0,
    })),
    uniqueTokensPerWallet,
    vectorTypeUsed: 'combined',
    summary: {
      walletCount: snapshot.walletCount,
      uniqueTokensTotal: 0,
    },
  };
}
