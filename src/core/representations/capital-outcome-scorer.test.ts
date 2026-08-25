import assert from 'node:assert';
import { test } from 'node:test';
import {
  scoreCapitalOutcome,
  wilsonInterval,
  deriveReasonCodes,
  type OutcomeNeighbor,
} from './capital-outcome-scorer';

function nbr(pnl: number, dq: number = 1): OutcomeNeighbor {
  return { walletAddress: `w${Math.random()}`, realizedPnl: pnl, dataQuality: dq, distance: 0.1 };
}

test('wilson interval is bounded and centered sensibly', () => {
  const [lo, hi] = wilsonInterval(10, 20);
  assert.ok(lo > 0 && hi < 1, 'inside (0,1)');
  assert.ok(lo < 0.5 && hi > 0.5, 'straddles 0.5 for 10/20');
  // small-n interval is wider than large-n for the same proportion
  const wideN = wilsonInterval(2, 4);
  const narrowN = wilsonInterval(50, 100);
  assert.ok(wideN[1] - wideN[0] > narrowN[1] - narrowN[0], 'small n → wider CI');
});

test('all-profitable neighborhood → high fraction, tight CI, high confidence', () => {
  const neighbors = Array.from({ length: 20 }, () => nbr(100, 1));
  const s = scoreCapitalOutcome({
    walletAddress: 'seed',
    neighbors,
    standardizedSourceVector: null,
    populationBaseRate: 0.39,
  });
  assert.equal(s.profitableFraction, 1);
  assert.equal(s.confidence, 'high');
  assert.ok(s.liftOverBaseRate !== null && s.liftOverBaseRate > 0.5, 'positive lift over base rate');
  assert.equal(s.neighborsBelowQuality, 0);
});

test('dq gate excludes low-quality neighbors from the estimate', () => {
  const neighbors = [
    ...Array.from({ length: 10 }, () => nbr(100, 1)),
    ...Array.from({ length: 10 }, () => nbr(-100, 0.5)), // below gate → excluded
  ];
  const s = scoreCapitalOutcome({ walletAddress: 'seed', neighbors, standardizedSourceVector: null });
  assert.equal(s.neighborCount, 10, 'only high-dq neighbors used');
  assert.equal(s.neighborsBelowQuality, 10);
  assert.equal(s.profitableFraction, 1, 'excluded losers do not drag the estimate');
});

test('insufficient high-quality neighbors → insufficient tier, no false estimate', () => {
  const neighbors = Array.from({ length: 5 }, () => nbr(100, 1));
  const s = scoreCapitalOutcome({ walletAddress: 'seed', neighbors, standardizedSourceVector: null });
  assert.equal(s.confidence, 'insufficient');
  assert.match(s.expectation, /Insufficient/);
});

test('reason codes surface the most unusual axes, direction-aware', () => {
  // axis 1 = realized profitability (high), axis 5 = consistency (low)
  const sv = [0.1, 2.5, 0.2, 0.0, 0.3, -1.8, 0.1, 0.0];
  const codes = deriveReasonCodes(sv);
  assert.equal(codes[0].axis, 'realized profitability');
  assert.equal(codes[0].direction, 'high');
  assert.ok(codes.some((c) => c.axis === 'outcome consistency' && c.direction === 'low'));
  assert.ok(codes.length <= 3);
});

test('mixed neighborhood → fraction between, lift can be negative', () => {
  const neighbors = [
    ...Array.from({ length: 4 }, () => nbr(50, 1)),
    ...Array.from({ length: 16 }, () => nbr(-50, 1)),
  ];
  const s = scoreCapitalOutcome({
    walletAddress: 'seed',
    neighbors,
    standardizedSourceVector: null,
    populationBaseRate: 0.39,
  });
  assert.equal(s.profitableFraction, 0.2);
  assert.ok(s.liftOverBaseRate !== null && s.liftOverBaseRate < 0, 'below base rate → negative lift');
  assert.ok(s.medianNeighborPnl < 0);
});
