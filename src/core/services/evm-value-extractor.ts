import { EvmLog, ParsedTransferLog, ParsedUniswapV2SwapLog, ParsedUniswapV3SwapLog } from '@/types/evm-api';
import { parseUniswapV2SwapLogs, parseUniswapV3SwapLogs, isWethAddress } from './evm-event-parser';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('EvmValueExtractor');

export interface ExtractedValue {
  nativeValue: number; // ETH/ARB/etc (denominated in the native token, NOT wei)
  source: 'weth-transfer' | 'uniswap-v3' | 'uniswap-v2' | 'native-tx-value' | 'unknown';
}

// 1e18 divisor for wei -> ETH
const WEI_PER_ETH = 1_000_000_000_000_000_000n;

function bigIntToFloat(value: bigint, decimals: number): number {
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  return Number(whole) + Number(remainder) / Number(divisor);
}

/**
 * Extracts native value (ETH denominated) associated with the given token
 * in a transaction involving the wallet.
 *
 * Strategy (in priority order):
 *  1. WETH Transfer events — most direct: token sold FOR weth, or bought WITH weth
 *  2. UniswapV3 Swap events — amount0/amount1 signed ints give the exact exchange
 *  3. UniswapV2 Swap events — amount0In/amount0Out pattern
 *  4. Native tx.value — last resort for ETH → token buys (no WETH wrap)
 */
export function extractNativeValue(
  tokenAddress: string,
  tokenAmountRaw: bigint,
  tokenDecimals: number,
  logs: EvmLog[],
  walletAddress: string,
  txNativeValueWei: bigint,
  chain: string,
): ExtractedValue {
  const walletLower = walletAddress.toLowerCase();
  const tokenLower = tokenAddress.toLowerCase();

  // --- 1. WETH transfer pattern ---
  // Find WETH transfers involving the wallet in the same tx
  // If wallet received WETH, that's the "sold token → got ETH" side
  // If wallet sent WETH, that's the "sent ETH → got token" side
  const WETH_ADDRESSES: Record<string, string> = {
    ethereum: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    arbitrum: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    base: '0x4200000000000000000000000000000000000006',
  };

  const wethAddress = WETH_ADDRESSES[chain];

  if (wethAddress) {
    const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    let wethTotal = 0n;

    for (const log of logs) {
      if (log.address.toLowerCase() !== wethAddress) continue;
      if (log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
      if (log.topics.length < 3) continue;

      const from = `0x${log.topics[1].slice(26).toLowerCase()}`;
      const to = `0x${log.topics[2].slice(26).toLowerCase()}`;
      const raw = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
      const amount = BigInt('0x' + raw.slice(0, 64));

      if (to === walletLower || from === walletLower) {
        wethTotal += amount;
      }
    }

    if (wethTotal > 0n) {
      return {
        nativeValue: bigIntToFloat(wethTotal, 18),
        source: 'weth-transfer',
      };
    }
  }

  // --- 2. UniswapV3 Swap event ---
  const v3Swaps = parseUniswapV3SwapLogs(logs);
  if (v3Swaps.length > 0) {
    // amount0/amount1 are signed: positive = pool received, negative = pool gave out
    // Find the swap where one side matches our token (by checking magnitude vs token amount)
    for (const swap of v3Swaps) {
      const a0Abs = swap.amount0 < 0n ? -swap.amount0 : swap.amount0;
      const a1Abs = swap.amount1 < 0n ? -swap.amount1 : swap.amount1;

      // Heuristic: native value is likely the leg NOT matching our token
      // We can't know which side is the native token without pool metadata, but
      // if one side is ~18 decimals (ETH-like magnitude), use it
      const useAmount0AsNative = a0Abs > 0n && a1Abs > 0n;
      if (useAmount0AsNative) {
        // Prefer whichever side produces smaller float (likely native / ETH)
        const v0 = bigIntToFloat(a0Abs, 18);
        const v1 = bigIntToFloat(a1Abs, 18);
        const nativeValue = Math.min(v0, v1);
        if (nativeValue > 0) {
          return { nativeValue, source: 'uniswap-v3' };
        }
      }
    }
  }

  // --- 3. UniswapV2 Swap event ---
  const v2Swaps = parseUniswapV2SwapLogs(logs);
  if (v2Swaps.length > 0) {
    for (const swap of v2Swaps) {
      const amountIn = swap.amount0In > 0n ? swap.amount0In : swap.amount1In;
      const amountOut = swap.amount0Out > 0n ? swap.amount0Out : swap.amount1Out;
      const total = amountIn > amountOut ? amountIn : amountOut;
      if (total > 0n) {
        const nativeValue = bigIntToFloat(total, 18);
        if (nativeValue > 0 && nativeValue < 1000) {
          return { nativeValue, source: 'uniswap-v2' };
        }
      }
    }
  }

  // --- 4. Native tx.value fallback ---
  if (txNativeValueWei > 0n) {
    return {
      nativeValue: bigIntToFloat(txNativeValueWei, 18),
      source: 'native-tx-value',
    };
  }

  return { nativeValue: 0, source: 'unknown' };
}

/**
 * Compute gas fee in native token units.
 */
export function extractFeeNative(gasUsed: bigint, gasPrice: bigint): number {
  const feeWei = gasUsed * gasPrice;
  return bigIntToFloat(feeWei, 18);
}
