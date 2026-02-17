import type { HolderProfile } from '../../../holder-profiles/types';

export interface OutcomeVerdict {
  verdict: string;
  description: string;
  color: 'red' | 'yellow' | 'green' | 'blue';
  /** % of token supply held by wallets with no exit history (includes LP/BURN/fresh). */
  freshSupplyPercent?: number;
}

/**
 * 8-bucket speed score aligned with SPEED_CATEGORY_COLORS.
 * Faster = lower score, slower = higher score (0-10 scale).
 */
function getSpeedScoreFromHours(hours: number): number {
  if (hours <= 1 / 60) return 0.5;    // Sniper (< 1 min)
  if (hours <= 5 / 60) return 1.5;    // Scalper (< 5 min)
  if (hours <= 0.5) return 2.5;       // Momentum (< 30 min)
  if (hours <= 4) return 4.0;         // Intraday (< 4 hours)
  if (hours <= 24) return 5.5;        // Day Trader (< 24 hours)
  if (hours <= 168) return 7.0;       // Swing (< 7 days)
  if (hours <= 720) return 8.5;       // Position (< 30 days)
  return 9.5;                         // Hodler (30d+)
}

/**
 * Weighted outcome classification: speed 85% + diversification 15%.
 * Data quality and hold-data confidence act as confidence modifiers.
 */
function classifyWeightedOutcome(
  speedScore: number,
  dataQualityRatio: number,
  avgTokensHeld: number,
  holdDataConfidence: number
): OutcomeVerdict {
  const speedWeight = 0.85;
  const diversificationWeight = 0.15;

  // Calculate diversification score (more tokens = more stable)
  // 1-3 tokens: low (0.2), 4-10: medium (0.5), 11+: high (1.0)
  let diversificationScore = 0.2;
  if (avgTokensHeld >= 11) diversificationScore = 1.0;
  else if (avgTokensHeld >= 4) diversificationScore = 0.5;

  // Weighted composite score (0-10 scale)
  const compositeScore =
    speedScore * speedWeight +
    diversificationScore * 10 * diversificationWeight;

  // Confidence modifier based on data quality
  const confidenceModifier = dataQualityRatio >= 0.7 ? 1.0 : dataQualityRatio >= 0.4 ? 0.8 : 0.6;
  // Further reduce if most profiles have no exit data (hold-based only)
  const holdConfidenceModifier = holdDataConfidence >= 0.5 ? 1.0 : 0.85;
  const adjustedScore = compositeScore * confidenceModifier * holdConfidenceModifier;

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
  if (totalWeight === 0) return sorted[0]?.value ?? 0;

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

  // Speed score uses ONLY realized exits (proven behavior).
  // Wallets with no exits are not assigned a fake speed — they're excluded from
  // the speed calculation but tracked as "unproven" via holdDataConfidence.
  const holdTimeData = profiles
    .map((p) => ({
      value: p.realizedMedianHoldTimeHours ?? null,
      weight: p.supplyPercent,
    }))
    .filter((item): item is { value: number; weight: number } =>
      item.value !== null && Number.isFinite(item.value)
    );

  // What % of total supply has proven exit data?
  // If 8/10 holders have no exits → holdDataConfidence is low → dampens the verdict
  const totalSupply = profiles.reduce((sum, p) => sum + p.supplyPercent, 0);
  const exitBasedSupply = holdTimeData.reduce((sum, item) => sum + item.weight, 0);
  const holdDataConfidence = totalSupply > 0 ? exitBasedSupply / totalSupply : 0;

  // If almost nobody has exited, we can't make a speed claim
  if (holdTimeData.length === 0 || holdDataConfidence < 0.1) {
    return {
      verdict: 'Insufficient data',
      description: 'Most holders have no exit history yet. Too early to judge.',
      color: 'yellow',
    };
  }

  const supplyWeightedMedianHoldTime = calculateWeightedMedian(holdTimeData);

  // 8-bucket speed score aligned with SPEED_CATEGORY_COLORS
  const speedScore = getSpeedScoreFromHours(supplyWeightedMedianHoldTime);

  // Calculate SUPPLY-weighted average tokens held (diversification indicator)
  const avgTokensHeld = (() => {
    const tokenData = profiles
      .map((p) => ({
        count: p.currentHoldings?.length ?? 0,
        weight: p.supplyPercent * getQualityWeight(p.dataQualityTier),
      }))
      .filter((item) => item.count > 0 && item.weight > 0);

    if (!tokenData.length) return 1;

    const totalWeight = tokenData.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight === 0) return 1;

    return tokenData.reduce((sum, item) => sum + item.count * item.weight, 0) / totalWeight;
  })();

  // Data quality ratio weighted by supply (GOLD + SILVER supply / total supply)
  const highQualitySupply = profiles
    .filter((p) => p.dataQualityTier === 'GOLD' || p.dataQualityTier === 'SILVER')
    .reduce((sum, p) => sum + p.supplyPercent, 0);
  const dataQualityRatio = totalSupply > 0 ? highQualitySupply / totalSupply : 0;

  // Fresh supply = token supply % held by trader wallets with no exit history
  // Excludes system wallets (BURN, LP, etc.) — they're not "fresh", just non-traders
  const freshSupplyPercent = profiles
    .filter((p) => !p.analysisSkipped && (p.realizedMedianHoldTimeHours == null || !Number.isFinite(p.realizedMedianHoldTimeHours)))
    .reduce((sum, p) => sum + p.supplyPercent, 0);

  const result = classifyWeightedOutcome(speedScore, dataQualityRatio, avgTokensHeld, holdDataConfidence);
  result.freshSupplyPercent = freshSupplyPercent;
  return result;
}

export function getWalletOutcome(profile: HolderProfile): OutcomeVerdict {
  // Speed from realized exits only — no fake speed from current hold duration
  const realizedHours = profile.realizedMedianHoldTimeHours;
  const hasExitData = realizedHours != null && Number.isFinite(realizedHours);

  const speedScore = hasExitData ? getSpeedScoreFromHours(realizedHours) : 5; // Neutral if unproven
  const holdDataConfidence = hasExitData ? 1.0 : 0.0;

  const tokensHeld = profile.currentHoldings?.length ?? 1;
  const dataQualityRatio = (profile.dataQualityTier === 'GOLD' || profile.dataQualityTier === 'SILVER') ? 1.0 : 0.3;

  return classifyWeightedOutcome(speedScore, dataQualityRatio, tokensHeld, holdDataConfidence);
}
