import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { JobsService } from './jobs.service';

describe('JobsService.getResultByKey', () => {
  it('derives holder agent result from the full result key on first by-key fetch', async () => {
    const derivedKey = 'holder-profiles:agent:result:job-123';
    const fullKey = 'holder-profiles:result:job-123';

    const fullResult = {
      tokenMint: 'Mint111111111111111111111111111111111111111',
      profiles: [
        {
          walletAddress: 'Wallet111111111111111111111111111111111111',
          rank: 1,
          supplyPercent: 12.5,
          tokenHoldingValueSol: 42,
          behaviorType: 'SWING',
          exitPattern: 'STAGGERED',
          medianHoldTimeHours: 24,
          dataQualityTier: 'HIGH',
          confidence: 0.91,
          completedCycleCount: 3,
          walletPnlSol: 15.2,
          solBalance: 8.4,
          currentHoldingsCount: 1,
          currentHoldings: [
            {
              tokenAddress: 'Token1111111111111111111111111111111111111',
              valueSol: 3.5,
            },
          ],
        },
      ],
      metadata: {
        totalHoldersRequested: 20,
        totalHoldersAnalyzed: 1,
      },
    };

    const redisStore = new Map<string, string>([[fullKey, JSON.stringify(fullResult)]]);
    const setCalls: Array<{ key: string; value: string; mode: string; ttl: number }> = [];

    const redisClient = {
      get: async (key: string) => redisStore.get(key) ?? null,
      ttl: async (key: string) => (key === fullKey ? 321 : -1),
      set: async (key: string, value: string, mode: string, ttl: number) => {
        redisStore.set(key, value);
        setCalls.push({ key, value, mode, ttl });
        return 'OK';
      },
    };

    const service = new JobsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      redisClient as any,
    );

    const result = await service.getResultByKey(derivedKey);

    assert.equal(setCalls.length, 1);
    assert.equal(setCalls[0]?.key, derivedKey);
    assert.equal(setCalls[0]?.mode, 'EX');
    assert.equal(setCalls[0]?.ttl, 321);
    assert.equal((result as any).aggregate.totalHolders, 1);
    assert.equal((result as any).metadata.totalHoldersAnalyzed, 1);
    assert.equal((result as any).profiles[0].holdingsSummary.totalCurrentHoldingsValueSol, 3.5);
    assert.ok(redisStore.has(derivedKey));
  });
});
