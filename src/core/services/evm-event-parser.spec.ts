import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { parseTransferLogs, parseUniswapV3SwapLogs } from './evm-event-parser';
import { EvmLog } from '@/types/evm-api';

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const UNIV3_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

function padAddr(addr: string): string {
  return `0x${addr.replace('0x', '').padStart(64, '0')}`;
}

function toHex64(n: bigint): string {
  return n.toString(16).padStart(64, '0');
}

// Two's complement int256 encoding
function encodeInt256(n: bigint): string {
  if (n >= 0n) return n.toString(16).padStart(64, '0');
  const positive = (-n).toString(16).padStart(64, '0');
  const flipped = [...positive].map(c => (parseInt(c, 16) ^ 0xf).toString(16)).join('');
  const result = (BigInt('0x' + flipped) + 1n).toString(16).padStart(64, '0');
  return result;
}

describe('parseTransferLogs', () => {
  it('parses a standard ERC-20 Transfer log', () => {
    const FROM = '0xabcdef1234567890abcdef1234567890abcdef12';
    const TO = '0x1234567890abcdef1234567890abcdef12345678';
    const TOKEN = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const AMOUNT = 100_000_000n;

    const log: EvmLog = {
      address: TOKEN,
      topics: [ERC20_TRANSFER_TOPIC, padAddr(FROM), padAddr(TO)],
      data: '0x' + toHex64(AMOUNT),
      logIndex: 0,
      transactionHash: '0xabc',
      blockNumber: 1,
    };

    const result = parseTransferLogs([log]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].tokenAddress, TOKEN.toLowerCase());
    assert.strictEqual(result[0].from, FROM.toLowerCase());
    assert.strictEqual(result[0].to, TO.toLowerCase());
    assert.strictEqual(result[0].amount, AMOUNT);
  });

  it('ignores logs with wrong topic', () => {
    const log: EvmLog = {
      address: '0x' + '1'.repeat(40),
      topics: ['0xwrong_topic'],
      data: '0x' + toHex64(100n),
      logIndex: 0,
      transactionHash: '0xabc',
      blockNumber: 1,
    };
    assert.strictEqual(parseTransferLogs([log]).length, 0);
  });

  it('ignores logs with insufficient topics', () => {
    const log: EvmLog = {
      address: '0x' + '1'.repeat(40),
      topics: [ERC20_TRANSFER_TOPIC, padAddr('0x' + 'a'.repeat(40))],
      data: '0x' + toHex64(100n),
      logIndex: 0,
      transactionHash: '0xabc',
      blockNumber: 1,
    };
    assert.strictEqual(parseTransferLogs([log]).length, 0);
  });

  it('parses multiple transfer logs', () => {
    const FROM = '0x' + 'a'.repeat(40);
    const TO = '0x' + 'b'.repeat(40);
    const TOKEN1 = '0x' + 'c'.repeat(40);
    const TOKEN2 = '0x' + 'd'.repeat(40);

    const logs: EvmLog[] = [
      {
        address: TOKEN1,
        topics: [ERC20_TRANSFER_TOPIC, padAddr(FROM), padAddr(TO)],
        data: '0x' + toHex64(500n),
        logIndex: 0,
        transactionHash: '0xabc',
        blockNumber: 1,
      },
      {
        address: TOKEN2,
        topics: [ERC20_TRANSFER_TOPIC, padAddr(TO), padAddr(FROM)],
        data: '0x' + toHex64(1000n),
        logIndex: 1,
        transactionHash: '0xabc',
        blockNumber: 1,
      },
    ];

    const result = parseTransferLogs(logs);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].amount, 500n);
    assert.strictEqual(result[1].amount, 1000n);
  });
});

describe('parseUniswapV3SwapLogs', () => {
  it('parses a UniswapV3 Swap event', () => {
    const SENDER = '0x' + 'a'.repeat(40);
    const RECIPIENT = '0x' + 'b'.repeat(40);
    const POOL = '0x' + 'c'.repeat(40);

    const amount1 = 50_000_000_000_000_000n; // positive

    const data = '0x'
      + encodeInt256(-100_000_000n) // amount0 (negative)
      + encodeInt256(amount1)        // amount1 (positive)
      + '0'.repeat(64 * 3);          // sqrtPriceX96, liquidity, tick

    const log: EvmLog = {
      address: POOL,
      topics: [UNIV3_SWAP_TOPIC, padAddr(SENDER), padAddr(RECIPIENT)],
      data,
      logIndex: 0,
      transactionHash: '0xabc',
      blockNumber: 1,
    };

    const result = parseUniswapV3SwapLogs([log]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].poolAddress, POOL.toLowerCase());
    assert.strictEqual(result[0].sender, SENDER.toLowerCase());
    assert.strictEqual(result[0].recipient, RECIPIENT.toLowerCase());
    assert.strictEqual(result[0].amount1, amount1);
  });

  it('returns empty array for non-matching logs', () => {
    const log: EvmLog = {
      address: '0x' + '1'.repeat(40),
      topics: ['0xwrong_topic'],
      data: '0x' + '0'.repeat(320),
      logIndex: 0,
      transactionHash: '0xabc',
      blockNumber: 1,
    };
    assert.strictEqual(parseUniswapV3SwapLogs([log]).length, 0);
  });
});
