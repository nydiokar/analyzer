export interface WalletInfo {
  address: string;
  label?: string;
  description?: string;
}

export interface WalletTransaction {
  signature: string;
  timestamp: number;
  direction: 'in' | 'out';
  associatedSolValue: number;
  tokenMint?: string;
  tokenAmount?: number;
}

export interface WalletCluster {
  id: string;
  wallets: string[];
  score: number;
  sharedNonObviousTokens: { 
    mint: string;
  }[];
} 