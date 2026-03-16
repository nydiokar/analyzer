export type KnownWalletType = 'BURN' | 'LP' | 'PROTOCOL' | 'EXCHANGE' | 'SYSTEM' | string;

export type HolderBehaviorType =
  | 'SNIPER'
  | 'SCALPER'
  | 'MOMENTUM'
  | 'INTRADAY'
  | 'DAY_TRADER'
  | 'SWING'
  | 'POSITION'
  | 'HODLER'
  | 'HOLDER'
  | string
  | null;

export type HolderProfile = {
  walletAddress: string;
  rank: number;
  supplyPercent: number;
  tokenHoldingValueSol?: number | null;
  behaviorType: HolderBehaviorType;
  exitPattern?: string | null;
  dataQualityTier?: 'GOLD' | 'SILVER' | 'BRONZE' | 'INSUFFICIENT';
  confidence?: number;
  analysisSkipped?: boolean;
  knownType?: KnownWalletType | null;
  knownLabel?: string | null;
  currentHoldingsCount?: number | null;
  completedCycleCount?: number | null;
  realizedMedianHoldTimeHours?: number | null;
  medianHoldTimeHours?: number | null;
  avgHoldTimeHours?: number | null;
  walletPnlSol?: number | null;
  walletRealizedPnlSol?: number | null;
  solBalance?: number | null;
};

export type HolderProfilesResult = {
  tokenMint?: string;
  mode?: 'token' | 'wallet';
  profiles: HolderProfile[];
  metadata: {
    totalHoldersRequested?: number;
    totalHoldersAnalyzed?: number;
    totalProcessingTimeMs?: number;
    avgProcessingTimePerWalletMs?: number;
    failedHolders?: number;
  };
};

export type TokenMetadata = {
  mint: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
};
