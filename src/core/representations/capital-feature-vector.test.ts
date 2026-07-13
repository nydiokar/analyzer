import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAPITAL_VECTOR_SOURCE_DIMENSIONS,
  CAPITAL_VECTOR_STORAGE_DIMENSIONS,
  buildCapitalSourceVector,
  computeCapitalDataQuality,
  computeCapitalPopulationStats,
  standardizeCapitalVector,
  padCapitalVector,
  capitalVectorToSqlLiteral,
} from './capital-feature-vector';

const pnl = {
  realizedPnl: 42.5,
  totalVolume: 1200,
  realizedPnlToTotalVolumeRatio: 0.035,
  averageSwapSize: 3.2,
  currentSolBalance: 8.1,
  unrealizedPnl: 5.0,
};
const advancedStats = {
  tokenWinRatePercent: 61,
  trimmedMeanPnlPerToken: 1.8,
  standardDeviationPnl: 4.2,
};

describe('capital feature vector', () => {
  it('builds a bounded source vector and pads to storage width', () => {
    const source = buildCapitalSourceVector({ pnl, advancedStats, confidenceScore: 0.9 });
    const padded = padCapitalVector(source);

    assert.equal(source.length, CAPITAL_VECTOR_SOURCE_DIMENSIONS);
    assert.equal(padded.length, CAPITAL_VECTOR_STORAGE_DIMENSIONS);
    // Every dim MUST be bounded — no unbounded money magnitude leaks in.
    for (const v of source) {
      assert.ok(v >= -1 && v <= 1, `dim out of [-1,1]: ${v}`);
    }
  });

  it('uses realized (not net) PnL — a whale unrealized gain does not move the profit dim', () => {
    const a = buildCapitalSourceVector({ pnl, advancedStats, confidenceScore: 0.9 });
    const b = buildCapitalSourceVector({
      pnl: { ...pnl, unrealizedPnl: 1_000_000 }, // huge paper gain
      advancedStats,
      confidenceScore: 0.9,
    });
    // profitability dim (index 1) is realized-only -> unchanged by unrealized.
    assert.equal(a[1], b[1]);
    // but the realized-share honesty dim (index 7) drops sharply.
    assert.ok(b[7] < a[7]);
  });

  it('winsorizes magnitude — a 1000x volume does not produce a 1000x dim', () => {
    const small = buildCapitalSourceVector({ pnl: { ...pnl, totalVolume: 10 }, advancedStats, confidenceScore: 0.9 });
    const whale = buildCapitalSourceVector({ pnl: { ...pnl, totalVolume: 10_000_000 }, advancedStats, confidenceScore: 0.9 });
    assert.ok(whale[0] <= 1);
    assert.ok(whale[0] - small[0] < 1, 'magnitude dim compresses via winsor-log');
  });

  it('dataQuality penalizes paper-gain-dominated and dust-volume wallets', () => {
    const clean = computeCapitalDataQuality({ pnl, advancedStats, confidenceScore: 0.95 });
    const paper = computeCapitalDataQuality({
      pnl: { ...pnl, realizedPnl: 1, unrealizedPnl: 100 },
      advancedStats,
      confidenceScore: 0.95,
    });
    const dust = computeCapitalDataQuality({
      pnl: { ...pnl, totalVolume: 0.01 },
      advancedStats,
      confidenceScore: 0.95,
    });
    assert.ok(clean > paper, 'paper-gain wallet is lower quality');
    assert.ok(clean > dust, 'dust-volume wallet is lower quality');
    for (const q of [clean, paper, dust]) assert.ok(q >= 0 && q <= 1);
  });

  it('consistency dim is neutral (not max) for a wallet with no completed trades', () => {
    const noTrades = buildCapitalSourceVector({
      pnl: { ...pnl, realizedPnl: 0, unrealizedPnl: 0 },
      advancedStats: { ...advancedStats, standardDeviationPnl: 0 },
      confidenceScore: 0.9,
    });
    // consistency is source index 5 — sd==0 must map to 0.5, not 1.0.
    assert.equal(noTrades[5], 0.5);
    const consistent = buildCapitalSourceVector({
      pnl,
      advancedStats: { ...advancedStats, standardDeviationPnl: 0.2 },
      confidenceScore: 0.9,
    });
    assert.ok(consistent[5] > 0.5, 'low-volatility real trader scores above neutral');
  });

  it('standardizes to storage width and emits a pgvector literal', () => {
    const a = buildCapitalSourceVector({ pnl, advancedStats, confidenceScore: 0.9 });
    const b = buildCapitalSourceVector({
      pnl: { ...pnl, realizedPnl: -10, totalVolume: 50 },
      advancedStats: { ...advancedStats, tokenWinRatePercent: 20 },
      confidenceScore: 0.4,
    });
    const stats = computeCapitalPopulationStats([a, b]);
    const standardized = standardizeCapitalVector(a, stats);
    const literal = capitalVectorToSqlLiteral(standardized);

    assert.equal(stats.walletCount, 2);
    assert.equal(standardized.length, CAPITAL_VECTOR_STORAGE_DIMENSIONS);
    assert.match(literal, /^\[[\d.,-]+\]$/);
  });
});
