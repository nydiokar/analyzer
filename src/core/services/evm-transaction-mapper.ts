import { Prisma } from '@prisma/client';
import { EvmTransaction, EvmChain, ParsedTransferLog } from '@/types/evm-api';
import { classifyEvmTransaction } from './evm-transaction-classifier';
import { extractNativeValue, extractFeeNative } from './evm-value-extractor';
import { isStablecoin } from '@config/evm-stablecoins';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('EvmTransactionMapper');

// Token decimals for common tokens (for amount normalization)
// In a real implementation, this would be fetched from the token contract
const TOKEN_DECIMALS_CACHE: Record<string, number> = {
  // USDC variants (6 decimals)
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,
  '0xff970a61a04b1ca14834a43f5de4533ebddb5f86': 6,
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6,
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,
  // USDT (6 decimals)
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6,
  // DAI / most ERC20s (18 decimals)
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18,
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 18,
  // WETH variants (18 decimals)
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18,
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 18,
  '0x4200000000000000000000000000000000000006': 18,
};

function getTokenDecimals(tokenAddress: string): number {
  return TOKEN_DECIMALS_CACHE[tokenAddress.toLowerCase()] ?? 18;
}

function bigIntToUiAmount(raw: bigint, decimals: number): number {
  if (raw === 0n) return 0;
  const divisor = 10 ** decimals;
  return Number(raw) / divisor;
}

export interface MappingStats {
  transactionsReceived: number;
  transactionsSkipped: number;
  transactionsProcessed: number;
  inputsGenerated: number;
  swapsDetected: number;
  transfersDetected: number;
  unknownSkipped: number;
}

export interface EvmMappingResult {
  records: Prisma.SwapAnalysisInputCreateManyInput[];
  stats: MappingStats;
}

/**
 * Maps a list of normalized EVM transactions to SwapAnalysisInput records.
 * This is the EVM equivalent of HeliusTransactionMapper.
 */
export function mapEvmTransactionsToSwapInputs(
  transactions: EvmTransaction[],
  walletAddress: string,
  chain: EvmChain,
): EvmMappingResult {
  const records: Prisma.SwapAnalysisInputCreateManyInput[] = [];
  const stats: MappingStats = {
    transactionsReceived: transactions.length,
    transactionsSkipped: 0,
    transactionsProcessed: 0,
    inputsGenerated: 0,
    swapsDetected: 0,
    transfersDetected: 0,
    unknownSkipped: 0,
  };

  const walletLower = walletAddress.toLowerCase();

  for (const tx of transactions) {
    // Skip failed transactions
    if (!tx.success) {
      stats.transactionsSkipped++;
      continue;
    }

    try {
      const { classification, transfers } = classifyEvmTransaction(
        tx.to,
        tx.logs,
        walletLower,
        chain,
      );

      if (classification === 'UNKNOWN') {
        stats.unknownSkipped++;
        stats.transactionsSkipped++;
        continue;
      }

      if (classification === 'TRANSFER') {
        stats.transfersDetected++;
        const transferRecords = mapTransferTransaction(tx, transfers, walletLower, chain);
        records.push(...transferRecords);
        stats.inputsGenerated += transferRecords.length;
        stats.transactionsProcessed++;
        continue;
      }

      // SWAP
      stats.swapsDetected++;
      const swapRecords = mapSwapTransaction(tx, transfers, walletLower, chain);
      records.push(...swapRecords);
      stats.inputsGenerated += swapRecords.length;
      stats.transactionsProcessed++;
    } catch (err) {
      logger.warn(`Error mapping tx ${tx.hash}: ${err}`);
      stats.transactionsSkipped++;
    }
  }

  return { records, stats };
}

function mapSwapTransaction(
  tx: EvmTransaction,
  transfers: ParsedTransferLog[],
  walletAddress: string,
  chain: EvmChain,
): Prisma.SwapAnalysisInputCreateManyInput[] {
  const records: Prisma.SwapAnalysisInputCreateManyInput[] = [];
  const walletLower = walletAddress.toLowerCase();

  // Collect token flows from wallet's perspective
  const tokenFlows = new Map<string, { amountIn: bigint; amountOut: bigint }>();

  for (const transfer of transfers) {
    const isWalletSender = transfer.from === walletLower;
    const isWalletReceiver = transfer.to === walletLower;

    if (!isWalletSender && !isWalletReceiver) continue;

    const key = transfer.tokenAddress;
    if (!tokenFlows.has(key)) {
      tokenFlows.set(key, { amountIn: 0n, amountOut: 0n });
    }

    const flow = tokenFlows.get(key)!;
    if (isWalletReceiver) {
      flow.amountIn += transfer.amount;
    }
    if (isWalletSender) {
      flow.amountOut += transfer.amount;
    }
  }

  const feeNative = extractFeeNative(tx.gasUsed, tx.gasPrice);

  for (const [tokenAddress, flow] of tokenFlows) {
    const decimals = getTokenDecimals(tokenAddress);
    const isStable = isStablecoin(tokenAddress, chain);

    if (flow.amountOut > 0n) {
      const amount = bigIntToUiAmount(flow.amountOut, decimals);
      const nativeValue = extractNativeValue(
        tokenAddress, flow.amountOut, decimals,
        tx.logs, walletAddress, tx.nativeValue, chain,
      ).nativeValue;

      records.push({
        walletAddress,
        signature: tx.hash,
        timestamp: tx.timestamp,
        mint: tokenAddress,
        amount,
        direction: 'out',
        associatedSolValue: nativeValue,
        interactionType: isStable ? 'SWAP_STABLE' : 'SWAP',
        feeAmount: feeNative,
        feePercentage: nativeValue > 0 ? (feeNative / nativeValue) * 100 : null,
      });
    }

    if (flow.amountIn > 0n) {
      const amount = bigIntToUiAmount(flow.amountIn, decimals);
      const nativeValue = extractNativeValue(
        tokenAddress, flow.amountIn, decimals,
        tx.logs, walletAddress, tx.nativeValue, chain,
      ).nativeValue;

      records.push({
        walletAddress,
        signature: tx.hash,
        timestamp: tx.timestamp,
        mint: tokenAddress,
        amount,
        direction: 'in',
        associatedSolValue: nativeValue,
        interactionType: isStable ? 'SWAP_STABLE' : 'SWAP',
        feeAmount: feeNative,
        feePercentage: nativeValue > 0 ? (feeNative / nativeValue) * 100 : null,
      });
    }
  }

  return records;
}

function mapTransferTransaction(
  tx: EvmTransaction,
  transfers: ParsedTransferLog[],
  walletAddress: string,
  chain: EvmChain,
): Prisma.SwapAnalysisInputCreateManyInput[] {
  const records: Prisma.SwapAnalysisInputCreateManyInput[] = [];
  const walletLower = walletAddress.toLowerCase();

  for (const transfer of transfers) {
    const isWalletSender = transfer.from === walletLower;
    const isWalletReceiver = transfer.to === walletLower;

    if (!isWalletSender && !isWalletReceiver) continue;

    const decimals = getTokenDecimals(transfer.tokenAddress);
    const amount = bigIntToUiAmount(transfer.amount, decimals);
    const direction = isWalletSender ? 'out' : 'in';

    records.push({
      walletAddress,
      signature: tx.hash,
      timestamp: tx.timestamp,
      mint: transfer.tokenAddress,
      amount,
      direction,
      associatedSolValue: 0, // Transfers have no economic exchange value
      interactionType: 'TRANSFER',
      feeAmount: null,
      feePercentage: null,
    });
  }

  return records;
}
