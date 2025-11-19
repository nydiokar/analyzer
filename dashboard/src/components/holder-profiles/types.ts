export type DataQualityTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface HolderProfile {
  walletAddress: string;
  rank: number;
  supplyPercent: number;
  medianHoldTimeHours: number | null;
  avgHoldTimeHours: number | null;
  dailyFlipRatio: number | null;
  behaviorType: string | null;
  exitPattern: string | null;
  dataQualityTier: DataQualityTier;
  completedCycleCount: number;
  confidence: number;
  insufficientDataReason?: string;
  processingTimeMs: number;
}

export interface HolderProfilesResult {
  mode: 'token' | 'wallet';
  tokenMint?: string;
  targetWallet?: string;
  profiles: HolderProfile[];
  metadata: {
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
    totalProcessingTimeMs: number;
    avgProcessingTimePerWalletMs: number;
  };
}

export interface WalletGroupInsight {
  label: string;
  value: string;
  description: string;
  color: string;
}
