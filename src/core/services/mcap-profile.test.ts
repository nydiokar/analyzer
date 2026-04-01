import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  summarizeMcapBucketDistributions,
  summarizeWeightedMcap,
  type WeightedMcapPoint,
} from './market-context-standalone';

describe('mcap-profile', () => {
  it('uses weighted median and percentiles to resist large outliers', () => {
    const points: WeightedMcapPoint[] = [
      { mcapUsd: 20_000, weightUsd: 100 },
      { mcapUsd: 30_000, weightUsd: 100 },
      { mcapUsd: 50_000, weightUsd: 100 },
      { mcapUsd: 30_000_000, weightUsd: 15 },
    ];

    const summary = summarizeWeightedMcap(points);

    assert.ok(summary, 'Expected weighted mcap summary');
    assert.strictEqual(summary.typicalMcapUsd, 30_000);
    assert.strictEqual(summary.p25McapUsd, 20_000);
    assert.strictEqual(summary.p75McapUsd, 50_000);
    assert.ok(
      summary.capitalWeightedAvgMcapUsd > 1_000_000,
      'Expected arithmetic mean to remain visibly skewed by the outlier',
    );
  });

  it('computes dominant bucket and both volume/count distributions', () => {
    const summary = summarizeMcapBucketDistributions(
      [12_000, 18_000, 25_000, 1_500_000],
      [100, 80, 40, 10],
    );

    assert.ok(summary, 'Expected bucket distribution summary');
    assert.strictEqual(summary.dominantBucket, '10-20k');
    assert.strictEqual(summary.dominantBucketShare, 0.783);
    assert.strictEqual(summary.distributionByCount['10-20k'], 0.5);
    assert.strictEqual(summary.distributionByVolume['10-20k'], 0.783);
    assert.strictEqual(summary.distributionByCount['1m+'], 0.25);
  });
});
