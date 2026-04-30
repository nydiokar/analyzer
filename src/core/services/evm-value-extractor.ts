import { EvmLog } from '@/types/evm-api';
import { parseUniswapV2SwapLogs, parseUniswapV3SwapLogs } from './evm-event-parser';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('EvmValueExtractor');

export interface ExtractedValue {
  nativeValue: number; // ETH in full units (not wei)
  source: 'weth-direct' | 'weth-withdrawal' | 'uniswap-v2' | 'uniswap-v3' | 'tx-value' | 'unknown';
}

const WETH_ADDRESSES: Record<string, string> = {
  ethereum: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  arbitrum: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
  base: '0x4200000000000000000000000000000000000006',
};

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// WETH Withdrawal(address src, uint wad) — emitted when WETH is unwrapped to ETH
const WETH_WITHDRAWAL_TOPIC = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65';
// WETH Deposit(address dst, uint wad) — emitted when ETH is wrapped to WETH
const WETH_DEPOSIT_TOPIC = '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c';

function weiToEth(wei: bigint): number {
  if (wei === 0n) return 0;
  return Number(wei) / 1e18;
}

function parseHexAmount(data: string): bigint {
  const clean = data.startsWith('0x') ? data.slice(2) : data;
  return BigInt('0x' + clean.slice(0, 64));
}

function parseAddress(topic: string): string {
  return `0x${topic.slice(26).toLowerCase()}`;
}

/**
 * Extract the ETH value associated with a swap transaction.
 *
 * Strategy (priority order):
 *  1. WETH Transfer directly to/from wallet — cleanest signal
 *  2. WETH Withdrawal event — aggregator unwrapped WETH, ETH sent to wallet
 *  3. WETH Deposit event — wallet wrapped ETH to buy token
 *  4. UniswapV2 Swap event — extract WETH leg amount
 *  5. UniswapV3 Swap event — extract smaller leg (likely ETH side)
 *  6. tx.value — ETH sent directly with the transaction
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
  const wethAddr = WETH_ADDRESSES[chain];

  // --- 1. WETH Transfer directly involving wallet ---
  if (wethAddr) {
    let wethDirect = 0n;
    for (const log of logs) {
      if (log.address.toLowerCase() !== wethAddr) continue;
      if (log.topics[0]?.toLowerCase() !== ERC20_TRANSFER_TOPIC) continue;
      if (log.topics.length < 3) continue;
      const from = parseAddress(log.topics[1]);
      const to = parseAddress(log.topics[2]);
      if (from === walletLower || to === walletLower) {
        wethDirect += parseHexAmount(log.data);
      }
    }
    if (wethDirect > 0n) {
      return { nativeValue: weiToEth(wethDirect), source: 'weth-direct' };
    }
  }

  // --- 2. WETH Withdrawal event (aggregator sold token → unwrapped WETH → sent ETH to wallet) ---
  // The Withdrawal event: topics[0]=sig, topics[1]=src (who initiated), data=amount
  // We sum all Withdrawal events from the WETH contract in this tx
  if (wethAddr) {
    let withdrawalTotal = 0n;
    for (const log of logs) {
      if (log.address.toLowerCase() !== wethAddr) continue;
      if (log.topics[0]?.toLowerCase() !== WETH_WITHDRAWAL_TOPIC) continue;
      withdrawalTotal += parseHexAmount(log.data);
    }
    if (withdrawalTotal > 0n) {
      return { nativeValue: weiToEth(withdrawalTotal), source: 'weth-withdrawal' };
    }
  }

  // --- 3. WETH Deposit event (wallet wrapped ETH → bought token) ---
  if (wethAddr) {
    let depositTotal = 0n;
    for (const log of logs) {
      if (log.address.toLowerCase() !== wethAddr) continue;
      if (log.topics[0]?.toLowerCase() !== WETH_DEPOSIT_TOPIC) continue;
      depositTotal += parseHexAmount(log.data);
    }
    if (depositTotal > 0n) {
      return { nativeValue: weiToEth(depositTotal), source: 'weth-direct' };
    }
  }

  // --- 4. UniswapV2 Swap — find the WETH leg ---
  if (wethAddr) {
    const v2Swaps = parseUniswapV2SwapLogs(logs);
    for (const swap of v2Swaps) {
      // The WETH leg is whichever side is non-zero and corresponds to the WETH pool token
      // Without pool metadata we pick the larger non-zero leg as the value leg
      const candidates = [swap.amount0In, swap.amount1In, swap.amount0Out, swap.amount1Out]
        .filter(a => a > 0n);
      // Pick smallest non-zero as likely ETH value (tokens have huge raw amounts at 18 dec)
      // Actually: pick the one that when divided by 1e18 gives a reasonable ETH amount (<10000)
      for (const amt of candidates.sort((a, b) => (a < b ? -1 : 1))) {
        const eth = weiToEth(amt);
        if (eth > 0.000001 && eth < 10000) {
          return { nativeValue: eth, source: 'uniswap-v2' };
        }
      }
    }
  }

  // --- 5. UniswapV3 Swap — smaller absolute leg is likely the ETH side ---
  const v3Swaps = parseUniswapV3SwapLogs(logs);
  for (const swap of v3Swaps) {
    const a0 = swap.amount0 < 0n ? -swap.amount0 : swap.amount0;
    const a1 = swap.amount1 < 0n ? -swap.amount1 : swap.amount1;
    if (a0 > 0n && a1 > 0n) {
      const eth = weiToEth(a0 < a1 ? a0 : a1);
      if (eth > 0.000001 && eth < 10000) {
        return { nativeValue: eth, source: 'uniswap-v3' };
      }
    }
  }

  // --- 6. Native tx.value fallback ---
  if (txNativeValueWei > 0n) {
    return { nativeValue: weiToEth(txNativeValueWei), source: 'tx-value' };
  }

  return { nativeValue: 0, source: 'unknown' };
}

export function extractFeeNative(gasUsed: bigint, gasPrice: bigint): number {
  return weiToEth(gasUsed * gasPrice);
}
