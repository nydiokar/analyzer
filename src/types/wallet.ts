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

export interface TokenBalanceDetails {
  mint: string;
  tokenAccountAddress: string; // Address of the specific token account for this mint and owner
  balance: string; // Raw token amount (considering decimals)
  decimals: number;
  uiBalance: number; // User-friendly balance, already divided by 10^decimals
  uiBalanceString: string; // User-friendly balance as a string
  // Optional fields for enriched data
  name?: string;
  symbol?: string;
  imageUrl?: string;
  priceUsd?: number;
  valueUsd?: number;
}

export interface WalletBalance {
  solBalance: number; // Balance in SOL (not lamports)
  tokenBalances: TokenBalanceDetails[];
  fetchedAt: Date; // Timestamp of when the data was fetched
}

export enum WalletAnalysisStatus {
  READY = 'READY',
  STALE = 'STALE',
  MISSING = 'MISSING',
  IN_PROGRESS = 'IN_PROGRESS',
}

// Additional types for more detailed wallet information, if needed in the future
// ... existing code ...

// Potentially, we might need a type for the raw response from getTokenAccountsByOwner if jsonParsed
// For example:
// export interface ParsedTokenAccountInfo {
//   mint: string;
//   owner: string;
//   tokenAmount: {
//     amount: string;
//     decimals: number;
//     uiAmount: number;
//     uiAmountString: string;
//   };
//   // ... other fields like 'state', 'isNative', etc.
// }

// export interface GetTokenAccountsByOwnerValue {
//   pubkey: string; // The token account's public key
//   account: {
//     data: {
//       parsed: {
//         info: ParsedTokenAccountInfo;
//         type: string; // e.g., 'account'
//       };
//       program: string; // e.g., 'spl-token'
//       space: number;
//     };
//     executable: boolean;
//     lamports: number; // Lamports for the token account itself (rent)
//     owner: string; // Owning program (SPL Token Program)
//     rentEpoch: number;
//   };
// } 