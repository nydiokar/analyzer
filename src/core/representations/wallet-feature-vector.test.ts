import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  WALLET_VECTOR_SOURCE_DIMENSIONS,
  WALLET_VECTOR_STORAGE_DIMENSIONS,
  WALLET_VECTOR_AXIS_WEIGHTS,
  buildWalletSourceVector,
  computePopulationStats,
  computeWalletVectorDrift,
  padWalletVector,
  standardizeWalletVector,
  vectorToSqlLiteral,
} from './wallet-feature-vector';

const behavior = {
  buySellSymmetry: 0.8,
  medianHoldTime: 4,
  averageFlipDurationHours: 2,
  buySellRatio: 3,
  sequenceConsistency: 0.5,
  percentTradesUnder1Hour: 0.25,
  reentryRate: 0.2,
  sessionCount: 10,
  avgTradesPerSession: 3,
  uniqueTokensTraded: 20,
  tokensWithBothBuyAndSell: 5,
  averageTradesPerToken: 2,
  percentageOfUnpairedTokens: 0.3,
  averageSessionDurationMinutes: 90,
  percentOfValueInCurrentHoldings: 0.4,
  dominantEntryMcapBucketShare: 0.6,
  avgEntryMcap: 100000,
  tokensWithOnlyBuys: 8,
  activeTradingDays: 14,
  medianActiveHoldingHours: 24,
  medianCompletedHoldTimeHours: 6,
  totalBuyCount: 30,
  totalSellCount: 20,
  averageSessionStartHour: 14,
  mcapDistribution: {
    '0-10k': 0.1,
    '10-20k': 0.2,
    '20-30k': 0.3,
    '50-100k': 0.2,
    '100-200k': 0.1,
    '1m+': 0.1,
  },
};

describe('wallet feature vector', () => {
  it('builds the v2 source vector and pads to the storage width', () => {
    const source = buildWalletSourceVector({ behavior, advancedStats: { tokenWinRatePercent: 55 } });
    const padded = padWalletVector(source);

    assert.equal(source.length, WALLET_VECTOR_SOURCE_DIMENSIONS);
    assert.equal(padded.length, WALLET_VECTOR_STORAGE_DIMENSIONS);
    assert.deepEqual(
      padded.slice(WALLET_VECTOR_SOURCE_DIMENSIONS),
      Array.from({ length: WALLET_VECTOR_STORAGE_DIMENSIONS - WALLET_VECTOR_SOURCE_DIMENSIONS }, () => 0),
    );
  });

  it('reads the real dollar-range mcap keys, not the legacy word keys (MCAP-VEC-BUG)', () => {
    // The whole v2 mcap fix: a dollar-range distribution must produce a nonzero
    // weighted-median mcap dim (index 12). Legacy word keys must produce zero, so
    // a regression back to the old reader is caught here.
    const dollarKeyed = buildWalletSourceVector({ behavior, advancedStats: { tokenWinRatePercent: 55 } });
    assert.ok(dollarKeyed[12] > 0, 'dollar-range keys must yield a nonzero mcap dim');

    const legacyKeyed = buildWalletSourceVector({
      behavior: { ...behavior, mcapDistribution: { nano: 0.5, micro: 0.3, mid: 0.2 } },
      advancedStats: { tokenWinRatePercent: 55 },
    });
    assert.equal(legacyKeyed[12], 0, 'legacy word keys are not recognized and must yield 0');
  });

  it('applies per-axis weights on top of standardization', () => {
    const a = buildWalletSourceVector({ behavior, advancedStats: { tokenWinRatePercent: 55 } });
    const b = buildWalletSourceVector({
      behavior: { ...behavior, percentOfValueInCurrentHoldings: 0.1, totalSellCount: 40 },
      advancedStats: { tokenWinRatePercent: 10 },
    });
    const stats = computePopulationStats([a, b]);
    const std = standardizeWalletVector(a, stats);
    // holdingConviction (source index 26, weight 1.8) must not equal a raw z-score:
    // its standardized value should be scaled by its weight. Compare to the
    // unweighted z of that dim.
    const convictionIdx = WALLET_VECTOR_SOURCE_DIMENSIONS - 1;
    const rawZ = (a[convictionIdx] - stats.means[convictionIdx]) / (stats.scales[convictionIdx] || 1);
    assert.ok(Math.abs(std[convictionIdx] - rawZ * WALLET_VECTOR_AXIS_WEIGHTS[convictionIdx]) < 1e-6);
    assert.ok(WALLET_VECTOR_AXIS_WEIGHTS[convictionIdx] !== 1, 'conviction dim is intentionally up-weighted');
  });

  it('encodes never-seller presence flag as 0 (GAP A)', () => {
    const holder = buildWalletSourceVector({
      behavior: { ...behavior, medianCompletedHoldTimeHours: null },
      advancedStats: { tokenWinRatePercent: 55 },
    });
    // completed-hold dim (index 21) must be 0, not a spurious "fast exit", and
    // the presence flag dim (index 22) must be 0 for a never-seller.
    assert.equal(holder[21], 0);
    assert.equal(holder[22], 0);
  });

  it('standardizes with stable scales and emits a pgvector literal', () => {
    const a = buildWalletSourceVector({ behavior, advancedStats: { tokenWinRatePercent: 55 } });
    const b = buildWalletSourceVector({
      behavior: { ...behavior, uniqueTokensTraded: 3, totalSellCount: 5 },
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
