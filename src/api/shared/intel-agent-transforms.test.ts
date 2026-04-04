import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { buildAgentSimilarityResult } from './intel-agent-transforms';
import type { CombinedSimilarityResult } from '../../types/similarity';

function makeResult(overrides: Partial<CombinedSimilarityResult['pairwiseSimilarities'][number]>): CombinedSimilarityResult {
  return {
    vectorTypeUsed: 'combined',
    pairwiseSimilarities: [
      {
        walletA: 'So8fSnLT',
        walletB: 'ACp9B9',
        binaryScore: 0.083,
        capitalScore: 0.083,
        sharedTokens: [],
        capitalAllocation: {},
        binarySharedTokenCount: 38,
        binaryUniqueTokenCountA: 702,
        binaryUniqueTokenCountB: 1016,
        capitalSharedTokenCount: 38,
        capitalUniqueTokenCountA: 702,
        capitalUniqueTokenCountB: 1016,
        ...overrides,
      },
    ],
    globalMetrics: {
      averageSimilarity: 0.083,
      mostSimilarPairs: [],
    },
    uniqueTokensPerWallet: {
      So8fSnLT: { binary: 740, capital: 740 },
      ACp9B9: { binary: 1054, capital: 1054 },
    },
  };
}

describe('buildAgentSimilarityResult', () => {
  it('does not mark dilute large-portfolio intersections as HIGH_OVERLAP from count alone', () => {
    const result = buildAgentSimilarityResult(makeResult({}));

    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0]?.flag, undefined);
    assert.equal(result.metadata.flaggedPairs, 0);
    assert.equal(result.pairs[0]?.overlapPctA, 0.051);
    assert.equal(result.pairs[0]?.overlapPctB, 0.036);
  });

  it('marks count-driven overlap only when the overlap ratio reaches 20%', () => {
    const result = buildAgentSimilarityResult(
      makeResult({
        binarySharedTokenCount: 24,
        binaryUniqueTokenCountA: 96,
        binaryUniqueTokenCountB: 216,
        capitalSharedTokenCount: 24,
        capitalUniqueTokenCountA: 96,
        capitalUniqueTokenCountB: 216,
      }),
    );

    assert.equal(result.pairs[0]?.flag, 'HIGH_OVERLAP');
    assert.equal(result.metadata.flaggedPairs, 1);
    assert.equal(result.pairs[0]?.overlapPctA, 0.2);
    assert.equal(result.pairs[0]?.overlapPctB, 0.1);
  });
});
