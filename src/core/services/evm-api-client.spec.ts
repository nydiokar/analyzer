import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert';
import { EvmApiClient, AlchemyTransferItem } from './evm-api-client';

function makeTransfer(address: string | null, decimal: string | null, uniqueId?: string): AlchemyTransferItem {
  return {
    blockNum: '0x1',
    uniqueId: uniqueId ?? `${address}-1`,
    hash: '0xabc',
    from: '0xfrom',
    to: '0xto',
    value: null,
    asset: null,
    category: 'erc20',
    rawContract: { value: '0x100', address, decimal },
    metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
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

describe('EvmApiClient.getTransfersForAddress pagination', () => {
  it('follows pageKey until exhausted, deduplicates by uniqueId', async () => {
    const client = new EvmApiClient({ alchemyApiKey: 'test' });

    // Page 1 returns 2 transfers + a pageKey; page 2 returns 1 transfer + no pageKey.
    // Both toAddress and fromAddress directions are called — stub rpcCall to serve
    // deterministic pages per call index.
    let callCount = 0;
    // @ts-ignore — stub private method for test
    client['rpcCall'] = async (_chain: string, _method: string, [params]: any[]) => {
      callCount++;
      if ('toAddress' in params) {
        if (!params.pageKey) {
          return { transfers: [makeTransfer('0xtok1', '0x12', 'uid-to-1'), makeTransfer('0xtok2', '0x12', 'uid-to-2')], pageKey: 'page2' };
        }
        return { transfers: [makeTransfer('0xtok3', '0x12', 'uid-to-3')], pageKey: undefined };
      }
      // fromAddress — single page, one transfer that overlaps with toAddress (uid-to-1)
      return { transfers: [makeTransfer('0xtok1', '0x12', 'uid-to-1'), makeTransfer('0xtok4', '0x12', 'uid-from-1')], pageKey: undefined };
    };

    const result = await client.getTransfersForAddress('0xwallet', 'ethereum');

    // Expected unique transfers: uid-to-1, uid-to-2, uid-to-3, uid-from-1 (4 total, not 5)
    assert.strictEqual(result.length, 4);
    const ids = result.map(t => t.uniqueId);
    assert.ok(ids.includes('uid-to-1'));
    assert.ok(ids.includes('uid-to-2'));
    assert.ok(ids.includes('uid-to-3'));
    assert.ok(ids.includes('uid-from-1'));
    // toAddress made 2 calls (page1 + page2), fromAddress made 1 — total 3
    assert.strictEqual(callCount, 3);
  });

  it('stops at hardLimit and does not fetch further pages', async () => {
    const client = new EvmApiClient({ alchemyApiKey: 'test' });

    let callCount = 0;
    // @ts-ignore
    client['rpcCall'] = async (_chain: string, _method: string, [params]: any[]) => {
      callCount++;
      // Always return 3 transfers with a pageKey — would loop forever without hardLimit
      return {
        transfers: [
          makeTransfer('0xtok', '0x12', `uid-${callCount}-a`),
          makeTransfer('0xtok', '0x12', `uid-${callCount}-b`),
          makeTransfer('0xtok', '0x12', `uid-${callCount}-c`),
        ],
        pageKey: 'always-more',
      };
    };

    const result = await client.getTransfersForAddress('0xwallet', 'ethereum', { hardLimit: 5 });

    // Should stop collecting once >= hardLimit unique transfers seen per direction
    assert.ok(result.length <= 5, `Expected ≤5 results, got ${result.length}`);
    // Should not have looped indefinitely
    assert.ok(callCount < 20, `Too many RPC calls: ${callCount}`);
  });
});
