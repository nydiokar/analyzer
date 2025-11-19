import type { HolderProfile } from '../../../holder-profiles/types';
import { getCognitivePrimitives, getSpeedPrimitive, getConvictionPrimitive, getConsistencyPrimitive } from './cognitive-primitives';
import { getDominantBehavior } from './formatters';

export interface OutcomeVerdict {
  verdict: string;
  description: string;
  color: 'red' | 'yellow' | 'green' | 'blue';
}

function classifyScore(score: number): OutcomeVerdict {
  if (score <= 1) {
    return {
      verdict: 'High churn, likely short-lived',
      description: 'Top holders exit minutes after entry. Treat with caution.',
      color: 'red',
    };
  }
  if (score === 2) {
    return {
      verdict: 'Mixed behavior, unstable',
      description: 'Bots and humans are both active. Expect volatility.',
      color: 'yellow',
    };
  }
  if (score === 3) {
    return {
      verdict: 'Still breathing',
      description: 'Some conviction remains but churn is rising.',
      color: 'blue',
    };
  }
  return {
    verdict: 'Relatively stable',
    description: 'Holders show patience and conviction.',
    color: 'green',
  };
}

export function getTokenOutcome(profiles: HolderProfile[]): OutcomeVerdict {
  const primitives = getCognitivePrimitives(profiles);
  const speed = primitives.find((p) => p.id === 'speed');
  const conviction = primitives.find((p) => p.id === 'conviction');
  const consistency = primitives.find((p) => p.id === 'consistency');
  const dominantBehavior = getDominantBehavior(profiles)?.[0];

  let score = 0;
  if (speed && ['Instant', 'Ultra-fast'].includes(speed.category)) score += 0;
  else if (speed && ['Fast', 'Intraday'].includes(speed.category)) score += 1;
  else score += 2;

  if (conviction?.category === 'High conviction') score += 2;
  else if (conviction?.category === 'Mixed conviction') score += 1;
  else score += 0;

  if (consistency?.category === 'Consistent') score += 2;
  else if (consistency?.category === 'Moderate') score += 1;

  if (dominantBehavior === 'SNIPER' || dominantBehavior === 'SCALPER') {
    score -= 1;
  } else if (dominantBehavior === 'HOLDER' || dominantBehavior === 'POSITION') {
    score += 1;
  }

  return classifyScore(Math.max(0, score));
}

export function getWalletOutcome(profile: HolderProfile): OutcomeVerdict {
  const speed = getSpeedPrimitive([profile]);
  const conviction = getConvictionPrimitive([profile]);
  const consistency = getConsistencyPrimitive([profile]);

  let score = 0;
  if (['Instant', 'Ultra-fast'].includes(speed.category)) score += 0;
  else if (['Fast', 'Intraday'].includes(speed.category)) score += 1;
  else score += 2;

  if (conviction.category === 'High conviction') score += 2;
  else if (conviction.category === 'Mixed conviction') score += 1;

  if (consistency.category === 'Consistent') score += 2;
  else if (consistency.category === 'Moderate') score += 1;

  if (profile.behaviorType === 'SNIPER' || profile.behaviorType === 'SCALPER') {
    score -= 1;
  } else if (profile.behaviorType === 'HOLDER' || profile.behaviorType === 'POSITION') {
    score += 1;
  }

  return classifyScore(Math.max(0, score));
}
