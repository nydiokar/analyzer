import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert';
import { SimilarityApiService } from './similarity.service';
import { SimilarityService } from '@/core/analysis/similarity/similarity-service';
import { UnprocessableEntityException } from '@nestjs/common';

function makeSingleSimilarityResult(vectorType: 'binary' | 'capital') {
  const walletA = 'WalletA111111111111111111111111111111111111';
  const walletB = 'WalletB111111111111111111111111111111111111';

  return {
    pairwiseSimilarities: [
      {
        walletA,
        walletB,
        similarityScore: vectorType === 'binary' ? 0.5 : 0.7,
        sharedTokens: [], // OK; API reduces over this for capitalAllocation.
        sharedTokenCount: 0,
        uniqueTokenCountA: 1,
        uniqueTokenCountB: 1,
      },
    ],
    clusters: [],
    globalMetrics: {
      averageSimilarity: 0.0,
      mostSimilarPairs: [],
    },
    jaccardSimilarityMatrix: { [walletA]: { [walletB]: 0.1 }, [walletB]: { [walletA]: 0.1 } },
    sharedTokenCountsMatrix: { [walletA]: { [walletB]: 0 }, [walletB]: { [walletA]: 0 } },
    uniqueTokensPerWallet: { [walletA]: 1, [walletB]: 1 },
    vectorTypeUsed: vectorType,
    holdingsPresenceJaccardMatrix: { [walletA]: { [walletB]: 0.2 }, [walletB]: { [walletA]: 0.2 } },
    holdingsPresenceCosineMatrix: { [walletA]: { [walletB]: 0.3 }, [walletB]: { [walletA]: 0.3 } },
    summary: { walletCount: 2, uniqueTokensTotal: 1 },
  };
}

describe('SimilarityApiService.runAnalysis', () => {
  let origCalc: any;

  beforeEach(() => {
    origCalc = (SimilarityService.prototype as any).calculateWalletSimilarityFromTransactions;
  });

  afterEach(() => {
    (SimilarityService.prototype as any).calculateWalletSimilarityFromTransactions = origCalc;
  });

  it('fetches transactions once and runs binary then capital sequentially', async () => {
    let txFetchCount = 0;
    const walletAddresses = [
      'WalletA111111111111111111111111111111111111',
      'WalletB111111111111111111111111111111111111',
    ];

    const calls: Array<'binary' | 'capital'> = [];
    let binaryFinished = false;

    (SimilarityService.prototype as any).calculateWalletSimilarityFromTransactions = async function (
      _transactionData: any,
      vectorType: 'binary' | 'capital',
      _balances: any,
    ) {
      calls.push(vectorType);
      if (vectorType === 'binary') {
        await new Promise((r) => setTimeout(r, 10));
        binaryFinished = true;
      } else {
        assert.equal(binaryFinished, true, 'capital run should start after binary finished');
      }
      return makeSingleSimilarityResult(vectorType);
    };

    const databaseService = {
      getTransactionsForAnalysis: async () => {
        txFetchCount++;
        // Must include at least 2 wallets with non-empty arrays to pass validation.
        return {
          [walletAddresses[0]]: [{ mint: 'M1', timestamp: 1, direction: 'in', amount: 1, associatedSolValue: 1 }],
          [walletAddresses[1]]: [{ mint: 'M2', timestamp: 2, direction: 'in', amount: 1, associatedSolValue: 1 }],
        };
      },
      getWallets: async () => walletAddresses.map((address) => ({ address })),
    };

    const tokenInfoService = {
      findManyPartial: async () => [],
    };

    const svc = new SimilarityApiService(databaseService as any, tokenInfoService as any);

    const res = await svc.runAnalysis(
      { walletAddresses, includeBalances: false, includeVectors: false, vectorType: 'capital' } as any,
      new Map(),
    );

    assert.equal(txFetchCount, 1);
    assert.deepEqual(calls, ['binary', 'capital']);
    assert.equal(res.vectorTypeUsed, 'combined');
    assert.ok(Array.isArray(res.pairwiseSimilarities));
  });

  it('throws if fewer than 2 wallets have transaction data after filters', async () => {
    const walletAddresses = [
      'WalletA111111111111111111111111111111111111',
      'WalletB111111111111111111111111111111111111',
      'WalletC111111111111111111111111111111111111',
    ];

    const databaseService = {
      getTransactionsForAnalysis: async () => ({
        [walletAddresses[0]]: [{ mint: 'M1', timestamp: 1, direction: 'in', amount: 1, associatedSolValue: 1 }],
        [walletAddresses[1]]: [],
        [walletAddresses[2]]: [],
      }),
      getWallets: async () => walletAddresses.map((address) => ({ address })),
    };

    const tokenInfoService = {
      findManyPartial: async () => [],
    };

    const svc = new SimilarityApiService(databaseService as any, tokenInfoService as any);

    await assert.rejects(
      svc.runAnalysis({ walletAddresses, includeBalances: false, includeVectors: false } as any, new Map()),
      (err: any) => err instanceof UnprocessableEntityException,
    );
  });
});

