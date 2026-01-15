import type { HolderProfile } from '../../../holder-profiles/types';
import { getCognitivePrimitives, getSpeedPrimitive, getConvictionPrimitive, getConsistencyPrimitive } from './cognitive-primitives';
import { getDominantBehavior } from './formatters';

export interface OutcomeVerdict {
  verdict: string;
  description: string;
  color: 'red' | 'yellow' | 'green' | 'blue';
}

/**
 * Weighted outcome classification that emphasizes speed (60-70%) with adjustments
 * for PnL variance, data quality, and portfolio diversification.
 */
function classifyWeightedOutcome(
  speedScore: number,
  pnlVarianceScore: number,
  dataQualityRatio: number,
  avgTokensHeld: number
): OutcomeVerdict {
  // Speed contributes 65% of the final score
  const speedWeight = 0.65;
  // PnL variance contributes 25%
  const varianceWeight = 0.25;
  // Diversification contributes 10%
  const diversificationWeight = 0.1;

  // Calculate diversification score (more tokens = more stable)
  // 1-3 tokens: low (0.2), 4-10: medium (0.5), 11+: high (1.0)
  let diversificationScore = 0.2;
  if (avgTokensHeld >= 11) diversificationScore = 1.0;
  else if (avgTokensHeld >= 4) diversificationScore = 0.5;

  // Weighted composite score (0-10 scale)
  const compositeScore =
    speedScore * speedWeight +
    pnlVarianceScore * varianceWeight +
    diversificationScore * 10 * diversificationWeight;

  // Confidence modifier based on data quality
  // High quality data increases confidence in the verdict
  const confidenceModifier = dataQualityRatio >= 0.7 ? 1.0 : dataQualityRatio >= 0.4 ? 0.8 : 0.6;

  // Adjust thresholds based on confidence
  const adjustedScore = compositeScore * confidenceModifier;

  // Classification thresholds
  if (adjustedScore < 2.5) {
    return {
      verdict: 'High churn, likely short-lived',
      description: 'Top holders exit within minutes to hours. High volatility expected.',
      color: 'red',
    };
  }
  if (adjustedScore < 4.5) {
    return {
      verdict: 'Volatile, mixed conviction',
      description: 'Fast-moving holders with inconsistent patterns. Expect rapid price swings.',
      color: 'yellow',
    };
  }
  if (adjustedScore < 6.5) {
    return {
      verdict: 'Moderately stable',
      description: 'Mix of short and medium-term holders. Some conviction building.',
      color: 'blue',
    };
  }
  return {
    verdict: 'Stable accumulation',
    description: 'Patient holders with longer time horizons. Strong conviction signals.',
    color: 'green',
  };
}

/**
 * Get weight for a data quality tier
 * GOLD = 1.0 (full weight), SILVER = 0.8, BRONZE = 0.3, others = 0.1
 */
function getQualityWeight(tier?: string | null): number {
  if (tier === 'GOLD') return 1.0;
  if (tier === 'SILVER') return 0.8;
  if (tier === 'BRONZE') return 0.3;
  return 0.1; // Unknown or no tier
}

/**
 * Calculate weighted median using quality tier weights
 */
function calculateWeightedMedian(values: Array<{ value: number; weight: number }>): number {
  if (!values.length) return 0;

  // Sort by value
  const sorted = [...values].sort((a, b) => a.value - b.value);

  // Calculate total weight
  const totalWeight = sorted.reduce((sum, item) => sum + item.weight, 0);

  // Find weighted median
  let cumulativeWeight = 0;
  const halfWeight = totalWeight / 2;

  for (let i = 0; i < sorted.length; i++) {
    cumulativeWeight += sorted[i].weight;
    if (cumulativeWeight >= halfWeight) {
      return sorted[i].value;
    }
  }

  return sorted[sorted.length - 1].value;
}

export function getTokenOutcome(profiles: HolderProfile[]): OutcomeVerdict {
  // Note: Known wallets have null metrics, so they're naturally excluded by downstream filters
  if (!profiles.length) {
    return {
      verdict: 'Insufficient data',
      description: 'Not enough holder data to analyze.',
      color: 'yellow',
    };
  }

  const speed = getSpeedPrimitive(profiles);
  const consistency = getConsistencyPrimitive(profiles);

  // Calculate speed score (0-10 scale based on median hold time)
  // Faster = lower score, slower = higher score
  const speedScore = (() => {
    if (['Instant', 'Ultra-fast'].includes(speed.category)) return 1;
    if (speed.category === 'Fast') return 2.5;
    if (speed.category === 'Intraday') return 4.5;
    if (speed.category === 'Multi-day') return 7;
    return 9; // Long-term
  })();

  // Calculate PnL variance score (0-10 scale) with quality weighting
  // Lower variance = more stable = higher score
  // Note: Known wallets have null PnL, naturally excluded by the filter
  const pnlData = profiles
    .map((p) => ({
      value: p.walletPnlSol ?? null,
      weight: getQualityWeight(p.dataQualityTier),
    }))
    .filter((item): item is { value: number; weight: number } =>
      item.value !== null && Number.isFinite(item.value)
    );

  const pnlVarianceScore = (() => {
    if (pnlData.length < 3) return 5; // Default neutral score

    // Calculate weighted mean
    const totalWeight = pnlData.reduce((sum, item) => sum + item.weight, 0);
    const weightedMean = pnlData.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;

    // Calculate weighted variance
    const weightedVariance = pnlData.reduce((sum, item) =>
      sum + item.weight * Math.pow(item.value - weightedMean, 2), 0
    ) / totalWeight;

    const stdDev = Math.sqrt(weightedVariance);
    const coefficientOfVariation = Math.abs(weightedMean) > 0.01 ? stdDev / Math.abs(weightedMean) : stdDev;

    // High CV = high variance = low stability = low score
    // CV < 0.5: stable (8), 0.5-1.0: moderate (5), 1.0-2.0: volatile (3), >2.0: chaotic (1)
    if (coefficientOfVariation < 0.5) return 8;
    if (coefficientOfVariation < 1.0) return 5;
    if (coefficientOfVariation < 2.0) return 3;
    return 1;
  })();

  // Calculate weighted average tokens held (diversification indicator)
  // Note: Known wallets have INSUFFICIENT tier (weight=0.1), minimal impact on weighted avg
  const avgTokensHeld = (() => {
    const tokenData = profiles
      .map((p) => ({
        count: p.currentHoldings?.length ?? 0,
        weight: getQualityWeight(p.dataQualityTier),
      }))
      .filter((item) => item.count > 0);

    if (!tokenData.length) return 1;

    const totalWeight = tokenData.reduce((sum, item) => sum + item.weight, 0);
    const weightedSum = tokenData.reduce((sum, item) => sum + item.count * item.weight, 0);

    return weightedSum / totalWeight;
  })();

  // Data quality ratio (GOLD + SILVER / total)
  const highQuality = profiles.filter((p) => p.dataQualityTier === 'GOLD' || p.dataQualityTier === 'SILVER').length;
  const dataQualityRatio = highQuality / profiles.length;

  return classifyWeightedOutcome(speedScore, pnlVarianceScore, dataQualityRatio, avgTokensHeld);
}

export function getWalletOutcome(profile: HolderProfile): OutcomeVerdict {
  const speed = getSpeedPrimitive([profile]);

  // Calculate speed score (0-10 scale)
  const speedScore = (() => {
    if (['Instant', 'Ultra-fast'].includes(speed.category)) return 1;
    if (speed.category === 'Fast') return 2.5;
    if (speed.category === 'Intraday') return 4.5;
    if (speed.category === 'Multi-day') return 7;
    return 9; // Long-term
  })();

  // For single wallet, use realized vs total PnL ratio to estimate stability
  // Higher realized ratio = more stable (takes profits/losses rather than holding bags)
  const pnlVarianceScore = (() => {
    const total = profile.walletPnlSol;
    const realized = profile.walletRealizedPnlSol;

    if (total === null || total === undefined || realized === null || realized === undefined) {
      return 5; // Neutral
    }

    if (Math.abs(total) < 0.01) return 5; // Very small total, neutral

    const realizedRatio = Math.abs(realized / total);
    // Most PnL is realized (>0.7): stable (8) - takes profits/losses
    // Balanced (0.3-0.7): moderate (5)
    // Most unrealized (<0.3): volatile (3) - holds bags
    if (realizedRatio > 0.7) return 8;
    if (realizedRatio > 0.3) return 5;
    return 3;
  })();

  // Number of tokens held
  const tokensHeld = profile.currentHoldings?.length ?? 1;

  // Data quality
  const dataQualityRatio = (profile.dataQualityTier === 'GOLD' || profile.dataQualityTier === 'SILVER') ? 1.0 : 0.3;

  return classifyWeightedOutcome(speedScore, pnlVarianceScore, dataQualityRatio, tokensHeld);
}
