import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WALLET_VECTOR_SOURCE_DIMENSIONS,
  WALLET_VECTOR_STORAGE_DIMENSIONS,
  buildWalletSourceVector,
  computePopulationStats,
  computeWalletVectorDrift,
  padWalletVector,
  standardizeWalletVector,
  vectorToSqlLiteral,
} from './wallet-feature-vector';

const behavior = {
  buySellSymmetry: 0.8,
  flipperScore: 0.7,
  medianHoldTime: 4,
  averageFlipDurationHours: 2,
  buySellRatio: 3,
  sequenceConsistency: 0.5,
  percentTradesUnder1Hour: 0.25,
  percentTradesUnder4Hours: 0.5,
  reentryRate: 0.2,
  sessionCount: 10,
  avgTradesPerSession: 3,
  uniqueTokensTraded: 20,
  tokensWithBothBuyAndSell: 5,
  completePairsCount: 4,
  averageTradesPerToken: 2,
  velocityScore: 60,
  percentageOfUnpairedTokens: 0.3,
  averageSessionDurationMinutes: 90,
  percentOfValueInCurrentHoldings: 0.4,
  dominantEntryMcapBucketShare: 0.6,
  avgEntryMcap: 100000,
  tokensWithOnlyBuys: 8,
  activeTradingDays: 14,
  medianActiveHoldingHours: 24,
  mcapDistribution: {
    nano: 0.1,
    'ultra-micro': 0.2,
    micro: 0.3,
    small: 0.2,
    mid: 0.1,
    large: 0.1,
  },
};

describe('wallet feature vector', () => {
  it('builds the frozen 32-dim source vector and 64-dim storage vector', () => {
    const source = buildWalletSourceVector({ behavior, advancedStats: { tokenWinRatePercent: 55 } });
    const padded = padWalletVector(source);

    assert.equal(source.length, WALLET_VECTOR_SOURCE_DIMENSIONS);
    assert.equal(padded.length, WALLET_VECTOR_STORAGE_DIMENSIONS);
    assert.deepEqual(padded.slice(WALLET_VECTOR_SOURCE_DIMENSIONS), Array.from({ length: 32 }, () => 0));
  });

  it('standardizes with stable scales and emits a pgvector literal', () => {
    const a = buildWalletSourceVector({ behavior, advancedStats: { tokenWinRatePercent: 55 } });
    const b = buildWalletSourceVector({
      behavior: { ...behavior, flipperScore: 0.1, uniqueTokensTraded: 3 },
      advancedStats: { tokenWinRatePercent: 10 },
    });
    const stats = computePopulationStats([a, b]);
    const standardized = standardizeWalletVector(a, stats);
    const literal = vectorToSqlLiteral(standardized);

    assert.equal(stats.walletCount, 2);
    assert.equal(standardized.length, WALLET_VECTOR_STORAGE_DIMENSIONS);
    assert.match(literal, /^\[[\d.,-]+\]$/);
  });

  it('computes deterministic euclidean drift for same-schema vectors', () => {
    assert.equal(computeWalletVectorDrift(null, [1, 2]), null);
    assert.equal(computeWalletVectorDrift([1, 2, 3], [1, 2, 3]), 0);
    assert.equal(computeWalletVectorDrift([1, 2], [4, 6]), 5);
    assert.throws(() => computeWalletVectorDrift([1], [1, 2]), /different dimensions/);
  });
});
