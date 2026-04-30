// EVM chain identifier
export type EvmChain = 'ethereum' | 'arbitrum' | 'base';

// Raw EVM transaction as returned by RPC or an indexer like Alchemy/Moralis
export interface EvmRawTransaction {
  hash: string;
  blockNumber: number;
  blockHash: string;
  timestamp: number; // Unix seconds
  from: string;
  to: string | null; // null for contract deployments
  value: string; // Native ETH in wei (hex string or decimal string)
  gasUsed: string;
  gasPrice: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  input: string; // calldata hex
  status: 0 | 1; // 0 = failed, 1 = success
  nonce: number;
  logs: EvmLog[];
}

// A single event log from a transaction receipt
export interface EvmLog {
  address: string; // contract that emitted the event
  topics: string[]; // indexed params; topics[0] is event signature hash
  data: string; // non-indexed params (hex)
  logIndex: number;
  transactionHash: string;
  blockNumber: number;
}

// Parsed ERC-20 Transfer event
export interface ParsedTransferLog {
  tokenAddress: string;
  from: string;
  to: string;
  amount: bigint;
  rawAmount: string; // decimal string
  logIndex: number;
}

// Parsed Uniswap V2/SushiSwap Swap event
export interface ParsedUniswapV2SwapLog {
  pairAddress: string;
  sender: string;
  to: string;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
}

// Parsed Uniswap V3 Swap event
export interface ParsedUniswapV3SwapLog {
  poolAddress: string;
  sender: string;
  recipient: string;
  amount0: bigint; // negative = out, positive = in (from pool perspective)
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
}

// Classification result for a transaction
export type EvmTxClassification = 'SWAP' | 'TRANSFER' | 'UNKNOWN';

// Normalized transfer summary for a wallet in a transaction
export interface WalletTokenFlow {
  tokenAddress: string;
  amountIn: bigint; // tokens received by wallet
  amountOut: bigint; // tokens sent by wallet
  netAmount: bigint; // amountIn - amountOut
}

// Output from the EVM mapper — mirrors SwapAnalysisInput shape
export interface EvmSwapRecord {
  walletAddress: string;
  signature: string; // txHash
  timestamp: number;
  mint: string; // tokenAddress
  amount: number;
  direction: 'in' | 'out';
  associatedSolValue: number; // native ETH/ARB value (renamed conceptually)
  interactionType: string;
  feeAmount?: number;
  feePercentage?: number;
}

// Response from Alchemy getAssetTransfers (simplified)
export interface AlchemyTransfer {
  blockNum: string;
  hash: string;
  from: string;
  to: string;
  value: number | null;
  asset: string;
  category: 'external' | 'erc20' | 'erc721' | 'erc1155' | 'specialnft' | 'internal';
  rawContract?: {
    value: string;
    address: string;
    decimal: string;
  };
  metadata?: {
    blockTimestamp: string;
  };
}

// Response from Alchemy getTransactionReceipts
export interface AlchemyTransactionWithLogs extends EvmRawTransaction {
  // Extended with alchemy-specific fields if needed
}

// Moralis EVM transaction shape (alternative)
export interface MoralisTransaction {
  hash: string;
  nonce: string;
  transaction_index: string;
  from_address: string;
  to_address: string;
  value: string;
  gas: string;
  gas_price: string;
  input: string;
  receipt_cumulative_gas_used: string;
  receipt_gas_used: string;
  receipt_status: string;
  block_timestamp: string;
  block_number: string;
  block_hash: string;
  logs: MoralisLog[];
}

export interface MoralisLog {
  log_index: string;
  transaction_hash: string;
  transaction_index: string;
  address: string;
  data: string;
  topic0: string;
  topic1?: string;
  topic2?: string;
  topic3?: string;
  block_timestamp: string;
  block_number: string;
  block_hash: string;
}

// Unified transaction format used internally
export interface EvmTransaction {
  hash: string;
  blockNumber: number;
  timestamp: number;
  from: string;
  to: string;
  nativeValue: bigint; // wei
  gasUsed: bigint;
  gasPrice: bigint;
  success: boolean;
  logs: EvmLog[];
  chain: EvmChain;
}
