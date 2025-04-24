/**
 * Type definitions for Helius API integration
 */

export interface HeliusApiConfig {
  apiKey: string;
  network?: 'mainnet' | 'devnet';
  baseUrl?: string;
}

export interface HeliusTransaction {
  description: string;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  signature: string;
  slot: number;
  timestamp: number;
  nativeTransfers: NativeTransfer[];
  tokenTransfers: TokenTransfer[];
  accountData: AccountData[];
  transactionError?: {
    error: string;
  };
  instructions: Instruction[];
  events?: TransactionEvents;
}

export interface NativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number;
}

export interface TokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  fromTokenAccount: string;
  toTokenAccount: string;
  tokenAmount: number;
  mint: string;
}

export interface AccountData {
  account: string;
  nativeBalanceChange: number;
  tokenBalanceChanges: TokenBalanceChange[];
}

export interface TokenBalanceChange {
  userAccount: string;
  tokenAccount: string;
  mint: string;
  rawTokenAmount: {
    tokenAmount: string;
    decimals: number;
  };
}

export interface Instruction {
  accounts: string[];
  data: string;
  programId: string;
  innerInstructions?: InnerInstruction[];
}

export interface InnerInstruction {
  accounts: string[];
  data: string;
  programId: string;
}

export interface TransactionEvents {
  nft?: NftEvent;
  swap?: SwapEvent;
  compressed?: CompressedNftEvent;
  distributeCompressionRewards?: {
    amount: number;
  };
  setAuthority?: {
    account: string;
    from: string;
    to: string;
    instructionIndex: number;
    innerInstructionIndex: number;
  };
}

export interface NftEvent {
  description: string;
  type: string;
  source: string;
  amount: number;
  fee: number;
  feePayer: string;
  signature: string;
  slot: number;
  timestamp: number;
  saleType: string;
  buyer: string;
  seller: string;
  staker: string;
  nfts: Array<{
    mint: string;
    tokenStandard: string;
  }>;
}

export interface SwapEvent {
  nativeInput?: {
    account: string;
    amount: string;
  };
  nativeOutput?: {
    account: string;
    amount: string;
  };
  tokenInputs?: Array<{
    userAccount: string;
    tokenAccount: string;
    mint: string;
    rawTokenAmount: {
      tokenAmount: string;
      decimals: number;
    };
  }>;
  tokenOutputs?: Array<{
    userAccount: string;
    tokenAccount: string;
    mint: string;
    rawTokenAmount: {
      tokenAmount: string;
      decimals: number;
    };
  }>;
  tokenFees?: Array<{
    userAccount: string;
    tokenAccount: string;
    mint: string;
    rawTokenAmount: {
      tokenAmount: string;
      decimals: number;
    };
  }>;
  nativeFees?: Array<{
    account: string;
    amount: string;
  }>;
  innerSwaps?: Array<any>; // Complex nested structure, simplified for now
  programInfo?: {
    source: string;
    account: string;
    programName: string;
    instructionName: string;
  };
}

export interface CompressedNftEvent {
  type: string;
  treeId: string;
  assetId: string;
  leafIndex: number;
  instructionIndex: number;
  innerInstructionIndex: number;
  newLeafOwner: string;
  oldLeafOwner: string;
}

/**
 * Intermediate format focusing on token transfers within swaps.
 */
export interface IntermediateSwapRecord {
  signature: string;      // Transaction signature
  timestamp: number;      // Unix timestamp of the transaction
  mint: string;           // Token mint address
  amount: number;         // Raw token amount (smallest unit, e.g., lamports for SPL tokens)
  decimals: number;       // Token decimals
  direction: 'in' | 'out'; // Direction relative to the analyzed wallet
}

/**
 * Results structure for Phase 1 SOL P/L Analysis.
 */
export interface SolPnlAnalysisResult {
  splMint: string;         // The SPL token mint address
  totalSplAmountIn: number; // Total SPL received (adjusted for decimals)
  totalSplAmountOut: number;// Total SPL sent (adjusted for decimals)
  netSplAmountChange: number;// Net SPL change (adjusted for decimals)
  totalSolSpent: number;    // Total SOL paid (when receiving SPL)
  totalSolReceived: number; // Total SOL received (when sending SPL)
  netSolProfitLoss: number; // Net SOL P/L (SOL Received - SOL Spent)
  swapCountIn: number;      // Number of times SPL was received
  swapCountOut: number;     // Number of times SPL was sent
  firstSwapTimestamp: number; // Unix timestamp of first swap involving this SPL
  lastSwapTimestamp: number;  // Unix timestamp of last swap involving this SPL
}

// Remove old interfaces no longer needed for Phase 1
// export interface TransferRecord { ... } 
// export interface AnalysisResults { ... } 