import { EvmLog, ParsedTransferLog, ParsedUniswapV2SwapLog, ParsedUniswapV3SwapLog } from '@/types/evm-api';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('EvmEventParser');

// Event topic0 signatures (keccak256 of event signature)
const TOPICS = {
  ERC20_TRANSFER: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  UNISWAP_V2_SWAP: '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
  UNISWAP_V3_SWAP: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  CURVE_TOKEN_EXCHANGE: '0x8b3e96f2b889fa771c53c981b40daf005f63f637f1869f707052d15a3dd97140',
} as const;

function hexToBigInt(hex: string): bigint {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex.startsWith('0x') ? hex : `0x${hex}`);
}

function padTo32Bytes(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  return clean.padStart(64, '0');
}

function decodeAddress(padded: string): string {
  const clean = padded.startsWith('0x') ? padded.slice(2) : padded;
  return `0x${clean.slice(24).toLowerCase()}`;
}

function decodeInt256(hex: string): bigint {
  const value = hexToBigInt(hex);
  // Signed: if top bit set, it's negative
  const MAX_INT256 = 2n ** 255n;
  if (value >= MAX_INT256) {
    return value - 2n ** 256n;
  }
  return value;
}

export function parseTransferLogs(logs: EvmLog[]): ParsedTransferLog[] {
  const transfers: ParsedTransferLog[] = [];

  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() !== TOPICS.ERC20_TRANSFER) continue;
    // ERC20 Transfer: topics[1]=from, topics[2]=to, data=amount
    if (log.topics.length < 3) continue;

    try {
      const from = decodeAddress(log.topics[1]);
      const to = decodeAddress(log.topics[2]);
      const amount = hexToBigInt(log.data);

      transfers.push({
        tokenAddress: log.address.toLowerCase(),
        from,
        to,
        amount,
        rawAmount: amount.toString(),
        logIndex: log.logIndex,
      });
    } catch (err) {
      logger.warn(`Failed to parse Transfer log at index ${log.logIndex}: ${err}`);
    }
  }

  return transfers;
}

export function parseUniswapV2SwapLogs(logs: EvmLog[]): ParsedUniswapV2SwapLog[] {
  const swaps: ParsedUniswapV2SwapLog[] = [];

  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() !== TOPICS.UNISWAP_V2_SWAP) continue;
    if (log.topics.length < 3) continue;

    try {
      const sender = decodeAddress(log.topics[1]);
      const to = decodeAddress(log.topics[2]);

      // data: amount0In, amount1In, amount0Out, amount1Out (each 32 bytes)
      const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
      const amount0In = hexToBigInt('0x' + data.slice(0, 64));
      const amount1In = hexToBigInt('0x' + data.slice(64, 128));
      const amount0Out = hexToBigInt('0x' + data.slice(128, 192));
      const amount1Out = hexToBigInt('0x' + data.slice(192, 256));

      swaps.push({
        pairAddress: log.address.toLowerCase(),
        sender,
        to,
        amount0In,
        amount1In,
        amount0Out,
        amount1Out,
      });
    } catch (err) {
      logger.warn(`Failed to parse UniswapV2 Swap log at index ${log.logIndex}: ${err}`);
    }
  }

  return swaps;
}

export function parseUniswapV3SwapLogs(logs: EvmLog[]): ParsedUniswapV3SwapLog[] {
  const swaps: ParsedUniswapV3SwapLog[] = [];

  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() !== TOPICS.UNISWAP_V3_SWAP) continue;
    if (log.topics.length < 3) continue;

    try {
      const sender = decodeAddress(log.topics[1]);
      const recipient = decodeAddress(log.topics[2]);

      // data: amount0 (int256), amount1 (int256), sqrtPriceX96 (uint160), liquidity (uint128), tick (int24)
      const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
      const amount0 = decodeInt256('0x' + data.slice(0, 64));
      const amount1 = decodeInt256('0x' + data.slice(64, 128));
      const sqrtPriceX96 = hexToBigInt('0x' + data.slice(128, 192));
      const liquidity = hexToBigInt('0x' + data.slice(192, 256));
      const tick = Number(decodeInt256('0x' + data.slice(256, 320)));

      swaps.push({
        poolAddress: log.address.toLowerCase(),
        sender,
        recipient,
        amount0,
        amount1,
        sqrtPriceX96,
        liquidity,
        tick,
      });
    } catch (err) {
      logger.warn(`Failed to parse UniswapV3 Swap log at index ${log.logIndex}: ${err}`);
    }
  }

  return swaps;
}

export function isWethAddress(address: string, chain: string): boolean {
  const WETH: Record<string, string> = {
    ethereum: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    arbitrum: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
    base: '0x4200000000000000000000000000000000000006',
  };
  return WETH[chain]?.toLowerCase() === address.toLowerCase();
}
