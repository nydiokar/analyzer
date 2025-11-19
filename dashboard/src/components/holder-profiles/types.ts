export type DataQualityTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
export type HoldTimeSource = 'CURRENT' | 'EXITED' | 'MIXED';

export interface HoldTimeDistribution {
  instant: number;
  ultraFast: number;
  fast: number;
  momentum: number;
  intraday: number;
  day: number;
  swing: number;
  position: number;
}

export interface HolderProfile {
  walletAddress: string;
  rank: number;
  supplyPercent: number;
  medianHoldTimeHours: number | null;
  avgHoldTimeHours: number | null;
  dailyFlipRatio: number | null;
  dailyFlipRatioConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  behaviorType: string | null;
  exitPattern: string | null;
  dataQualityTier: DataQualityTier;
  completedCycleCount: number;
  confidence: number;
  insufficientDataReason?: string;
  processingTimeMs: number;
  holdTimeDistribution?: HoldTimeDistribution;
  includesCurrentHoldings?: boolean;
  exitRate?: number | null;
  totalTokensTraded?: number;
  typicalHoldTimeHours?: number | null;
  typicalHoldTimeSource?: HoldTimeSource;
  realizedMedianHoldTimeHours?: number | null;
  realizedAverageHoldTimeHours?: number | null;
  currentHoldMedianHours?: number | null;
  currentHoldAverageHours?: number | null;
  percentValueInCurrentHoldings?: number | null;
  currentHoldingsCount?: number | null;
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
  accentClass?: string;
  textClass?: string;
}
