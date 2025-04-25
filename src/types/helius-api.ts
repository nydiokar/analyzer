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
  direction: 'in' | 'out'; // Direction relative to the analyzed wallet
}

/**
 * Results structure for On-Chain Swap Analysis, including SOL P/L.
 */
export interface OnChainAnalysisResult {
  tokenAddress: string;         // SPL Token mint address
  totalAmountIn: number;        // Total SPL received (adjusted for decimals)
  totalAmountOut: number;       // Total SPL sent (adjusted for decimals)
  netAmountChange: number;      // Net SPL change (adjusted for decimals)
  totalSolSpent: number;        // Total SOL paid (when receiving SPL)
  totalSolReceived: number;     // Total SOL received (when sending SPL)
  netSolProfitLoss: number;     // Net SOL P/L (SOL Received - SOL Spent)
  transferCountIn: number;      // Number of times SPL was received
  transferCountOut: number;     // Number of times SPL was sent
  firstTransferTimestamp: number; // Unix timestamp of first swap involving this SPL
  lastTransferTimestamp: number;  // Unix timestamp of last swap involving this SPL
}

/**
 * Represents the overall summary returned by the analysis service.
 */
export interface SwapAnalysisSummary {
  results: OnChainAnalysisResult[];
  totalSignaturesProcessed: number;
  overallFirstTimestamp: number;
  overallLastTimestamp: number;
}
