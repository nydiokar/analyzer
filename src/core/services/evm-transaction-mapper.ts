import { Prisma } from '@prisma/client';
import { EvmTransaction, EvmChain, ParsedTransferLog } from '@/types/evm-api';
import { classifyEvmTransaction } from './evm-transaction-classifier';
import { extractNativeValue, extractFeeNative } from './evm-value-extractor';
import { isStablecoin } from '@config/evm-stablecoins';
import { parseTransferLogs } from './evm-event-parser';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('EvmTransactionMapper');

// Static fallback decimals for well-known tokens — used when Alchemy metadata
// and eth_call both fail. Unknown tokens default to 18.
export const TOKEN_DECIMALS_CACHE: Record<string, number> = {
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,  // USDC
  '0xff970a61a04b1ca14834a43f5de4533ebddb5f86': 6,  // USDC.e Arbitrum
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6,  // USDC Arbitrum
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,  // USDC Base
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,  // USDT
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6,  // USDT Arbitrum
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 18, // DAI Arbitrum
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18, // WETH
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 18, // WETH Arbitrum
  '0x4200000000000000000000000000000000000006': 18, // WETH Base
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,  // WBTC
};

function getDecimals(tokenAddress: string, tokenDecimalsMap?: Map<string, number>): number {
  const addr = tokenAddress.toLowerCase();
  return tokenDecimalsMap?.get(addr) ?? TOKEN_DECIMALS_CACHE[addr] ?? 18;
}

function rawToUiAmount(raw: bigint, decimals: number): number {
  if (raw === 0n) return 0;
  // Avoid Number(bigint) precision loss for large amounts — divide in bigint space first.
  // Same pattern as weiToEth: split at the decimal point, convert each half separately.
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const remainder = raw % divisor;
  return Number(whole) + Number(remainder) / 10 ** decimals;
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
 * Maps EVM transactions to SwapAnalysisInput records.
 *
 * Canonical approach (matching how EVM indexers like Etherscan work):
 * - Parse ERC-20 Transfer events from logs
 * - Group by wallet perspective (in vs out)
 * - Classify by presence of swap events (UniswapV2/V3 Swap topic) or DEX interaction
 * - Extract native value from WETH events or Uniswap Swap amounts
 */
export function mapEvmTransactionsToSwapInputs(
  transactions: EvmTransaction[],
  walletAddress: string,
  chain: EvmChain,
  tokenDecimalsMap?: Map<string, number>,
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
    if (!tx.success) { stats.transactionsSkipped++; continue; }

    try {
      const { classification, transfers } = classifyEvmTransaction(
        tx.to, tx.logs, walletLower, chain,
      );

      if (classification === 'UNKNOWN') {
        stats.unknownSkipped++;
        stats.transactionsSkipped++;
        continue;
      }

      const feeNative = tx.gasUsed > 0n ? extractFeeNative(tx.gasUsed, tx.gasPrice) : 0;
      const newRecords = buildRecords(tx, transfers, walletLower, chain, classification, feeNative, tokenDecimalsMap);

      records.push(...newRecords);
      stats.inputsGenerated += newRecords.length;
      stats.transactionsProcessed++;

      if (classification === 'SWAP') stats.swapsDetected++;
      else stats.transfersDetected++;

    } catch (err) {
      logger.warn(`Error mapping tx ${tx.hash}: ${err}`);
      stats.transactionsSkipped++;
    }
  }

  return { records, stats };
}

function buildRecords(
  tx: EvmTransaction,
  transfers: ParsedTransferLog[],
  walletAddress: string,
  chain: EvmChain,
  classification: string,
  feeNative: number,
  tokenDecimalsMap?: Map<string, number>,
): Prisma.SwapAnalysisInputCreateManyInput[] {
  const records: Prisma.SwapAnalysisInputCreateManyInput[] = [];

  // Collect net token flows from wallet's perspective
  const flows = new Map<string, { amountIn: bigint; amountOut: bigint }>();

  for (const t of transfers) {
    const isOut = t.from === walletAddress;
    const isIn = t.to === walletAddress;
    if (!isOut && !isIn) continue;

    if (!flows.has(t.tokenAddress)) flows.set(t.tokenAddress, { amountIn: 0n, amountOut: 0n });
    const flow = flows.get(t.tokenAddress)!;
    if (isIn) flow.amountIn += t.amount;
    if (isOut) flow.amountOut += t.amount;
  }

  const isSwap = classification === 'SWAP';
  const interactionType = isSwap ? 'SWAP' : 'TRANSFER';

  for (const [tokenAddress, flow] of flows) {
    const decimals = getDecimals(tokenAddress, tokenDecimalsMap);
    const isStable = isStablecoin(tokenAddress, chain);
    const type = isStable && isSwap ? 'SWAP_STABLE' : interactionType;

    if (flow.amountOut > 0n) {
      const amount = rawToUiAmount(flow.amountOut, decimals);
      const nativeValue = isSwap
        ? extractNativeValue(tokenAddress, flow.amountOut, decimals, tx.logs, walletAddress, tx.nativeValue, chain).nativeValue
        : 0;

      records.push({
        walletAddress,
        signature: tx.hash,
        timestamp: tx.timestamp,
        mint: tokenAddress,
        amount,
        direction: 'out',
        associatedSolValue: nativeValue,
        interactionType: type,
        feeAmount: feeNative || null,
        feePercentage: feeNative && nativeValue > 0 ? (feeNative / nativeValue) * 100 : null,
      });
    }

    if (flow.amountIn > 0n) {
      const amount = rawToUiAmount(flow.amountIn, decimals);
      const nativeValue = isSwap
        ? extractNativeValue(tokenAddress, flow.amountIn, decimals, tx.logs, walletAddress, tx.nativeValue, chain).nativeValue
        : 0;

      records.push({
        walletAddress,
        signature: tx.hash,
        timestamp: tx.timestamp,
        mint: tokenAddress,
        amount,
        direction: 'in',
        associatedSolValue: nativeValue,
        interactionType: type,
        feeAmount: feeNative || null,
        feePercentage: feeNative && nativeValue > 0 ? (feeNative / nativeValue) * 100 : null,
      });
    }
  }

  return records;
}
