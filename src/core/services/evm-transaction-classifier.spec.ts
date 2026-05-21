import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { classifyEvmTransaction } from './evm-transaction-classifier';
import { EvmLog } from '@/types/evm-api';

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const WALLET = '0xabcdef1234567890abcdef1234567890abcdef12';
const ROUTER = '0xe592427a0aece92de3edee1f18e0157c05861564'; // UniswapV3SwapRouter

function makeTransferLog(from: string, to: string, token: string): EvmLog {
  const padAddr = (a: string) => `0x${a.replace('0x', '').padStart(64, '0')}`;
  return {
    address: token,
    topics: [ERC20_TRANSFER_TOPIC, padAddr(from), padAddr(to)],
    data: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
    logIndex: 0,
    transactionHash: '0xabc',
    blockNumber: 1,
  };
}

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

describe('classifyEvmTransaction', () => {
  it('classifies tx to known DEX router as SWAP (high confidence)', () => {
    const result = classifyEvmTransaction(ROUTER, [], WALLET, 'ethereum');
    assert.strictEqual(result.classification, 'SWAP');
    assert.strictEqual(result.confidence, 'high');
  });

  it('classifies multi-token logs as SWAP (medium confidence)', () => {
    const logs: EvmLog[] = [
      makeTransferLog(WALLET, ROUTER, USDC),
      makeTransferLog(ROUTER, WALLET, WETH),
    ];
    const result = classifyEvmTransaction('0x0000000000000000000000000000000000000001', logs, WALLET, 'ethereum');
    assert.strictEqual(result.classification, 'SWAP');
  });

  it('classifies single token transfer as TRANSFER', () => {
    const logs: EvmLog[] = [
      makeTransferLog(WALLET, '0xfriend1234567890abcdef1234567890abcdef12', USDC),
    ];
    const result = classifyEvmTransaction('0xfriend1234567890abcdef1234567890abcdef12', logs, WALLET, 'ethereum');
    assert.strictEqual(result.classification, 'TRANSFER');
  });

  it('classifies transaction with no logs as TRANSFER (low confidence)', () => {
    const result = classifyEvmTransaction('0x0000000000000000000000000000000000000001', [], WALLET, 'ethereum');
    assert.strictEqual(result.classification, 'TRANSFER');
    assert.strictEqual(result.confidence, 'low');
  });

  it('returns parsed transfers in result', () => {
    const logs: EvmLog[] = [
      makeTransferLog(WALLET, ROUTER, USDC),
      makeTransferLog(ROUTER, WALLET, WETH),
    ];
    const result = classifyEvmTransaction(ROUTER, logs, WALLET, 'ethereum');
    assert.strictEqual(result.transfers.length, 2);
  });

  it('classifies tx with DEX contract in logs as SWAP', () => {
    const logs: EvmLog[] = [
      {
        address: ROUTER,
        topics: ['0xsome_event'],
        data: '0x',
        logIndex: 0,
        transactionHash: '0xabc',
        blockNumber: 1,
      },
    ];
    const result = classifyEvmTransaction('0x0000000000000000000000000000000000000001', logs, WALLET, 'ethereum');
    assert.strictEqual(result.classification, 'SWAP');
    assert.strictEqual(result.confidence, 'high');
  });
});
