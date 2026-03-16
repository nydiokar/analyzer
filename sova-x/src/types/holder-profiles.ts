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
  behaviorType: HolderBehaviorType;
  analysisSkipped?: boolean;
  knownType?: KnownWalletType | null;
  currentHoldingsCount?: number | null;
  completedCycleCount?: number | null;
  realizedMedianHoldTimeHours?: number | null;
};

export type HolderProfilesResult = {
  tokenMint?: string;
  profiles: HolderProfile[];
  metadata: {
    totalHoldersRequested?: number;
    totalHoldersAnalyzed?: number;
    totalProcessingTimeMs?: number;
  };
};

export type TokenMetadata = {
  mint: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
};
