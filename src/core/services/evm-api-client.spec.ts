import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { EvmApiClient, AlchemyTransferItem } from './evm-api-client';

function makeTransfer(address: string | null, decimal: string | null): AlchemyTransferItem {
  return {
    blockNum: '0x1',
    uniqueId: `${address}-1`,
    hash: '0xabc',
    from: '0xfrom',
    to: '0xto',
    value: null,
    asset: null,
    category: 'erc20',
    rawContract: { value: '0x100', address, decimal },
  };
}

describe('EvmApiClient.extractDecimalsFromTransfers', () => {
  const client = new EvmApiClient({ alchemyApiKey: 'test' });

  it('reads decimals from hex rawContract.decimal', () => {
    const transfers = [
      makeTransfer('0xtoken1', '0x6'),  // 6 decimals (USDC-like)
      makeTransfer('0xtoken2', '0x12'), // 18 decimals
    ];
    const map = client.extractDecimalsFromTransfers(transfers);
    assert.strictEqual(map.get('0xtoken1'), 6);
    assert.strictEqual(map.get('0xtoken2'), 18);
  });

  it('handles decimal=null by omitting from map', () => {
    const transfers = [makeTransfer('0xtoken3', null)];
    const map = client.extractDecimalsFromTransfers(transfers);
    assert.strictEqual(map.has('0xtoken3'), false);
  });

  it('handles decimal=0x (empty) by omitting from map', () => {
    const transfers = [makeTransfer('0xtoken4', '0x')];
    const map = client.extractDecimalsFromTransfers(transfers);
    assert.strictEqual(map.has('0xtoken4'), false);
  });

  it('deduplicates: first seen decimal wins for repeated token address', () => {
    const transfers = [
      makeTransfer('0xtoken5', '0x6'),
      makeTransfer('0xtoken5', '0x12'), // should be ignored
    ];
    const map = client.extractDecimalsFromTransfers(transfers);
    assert.strictEqual(map.get('0xtoken5'), 6);
  });

  it('normalises token address to lowercase', () => {
    const transfers = [makeTransfer('0xABCDEF', '0x8')]; // WBTC-like
    const map = client.extractDecimalsFromTransfers(transfers);
    assert.strictEqual(map.get('0xabcdef'), 8);
  });
});
