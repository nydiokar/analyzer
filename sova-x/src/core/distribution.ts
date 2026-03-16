import type { HolderProfile } from '../types/holder-profiles';

export type DistributionBucket = {
  id: string;
  label: string;
  timeframe: string;
  walletCount: number;
  supplyPercent: number;
  color: string;
};

const ORDER: ReadonlyArray<string> = [
  'SNIPER',
  'SCALPER',
  'MOMENTUM',
  'INTRADAY',
  'DAY_TRADER',
  'SWING',
  'POSITION',
  'HODLER',
];

const SYSTEM_WALLET_TYPES: ReadonlySet<string> = new Set([
  'BURN',
  'LP',
  'PROTOCOL',
  'EXCHANGE',
  'SYSTEM',
]);

const META: Record<string, { label: string; timeframe: string; color: string }> = {
  SNIPER: { label: 'Sniper', timeframe: '< 10 seconds', color: '#d7868a' },
  SCALPER: { label: 'Scalper', timeframe: '< 1 minute', color: '#e3a06d' },
  MOMENTUM: { label: 'Momentum', timeframe: '5-30 minutes', color: '#d9c174' },
  INTRADAY: { label: 'Intraday', timeframe: '30 min - 4 hours', color: '#8dd0c8' },
  DAY_TRADER: { label: 'Day Trader', timeframe: '4-24 hours', color: '#7dc4ec' },
  SWING: { label: 'Swing', timeframe: '1-7 days', color: '#8f98f7' },
  POSITION: { label: 'Position', timeframe: '7+ days', color: '#a58cf0' },
  HODLER: { label: 'Fresh', timeframe: '', color: '#8fd17c' },
};

function normalizeBehavior(profile: HolderProfile): string | null {
  let behavior: string | null = profile.behaviorType ?? null;

  if (behavior === 'HOLDER') {
    behavior = 'HODLER';
  }

  if (!behavior && !profile.analysisSkipped) {
    const isHolderOnly: boolean = (profile.currentHoldingsCount ?? 0) > 0;
    const hasNoExits: boolean = (profile.completedCycleCount ?? 0) === 0;
    if (isHolderOnly && hasNoExits) {
      behavior = 'HODLER';
    }
  }

  return behavior;
}

export function buildDistributionBuckets(profiles: HolderProfile[]): DistributionBucket[] {
  const counts: Record<string, number> = {};
  const supply: Record<string, number> = {};

  for (const profile of profiles) {
    if (profile.knownType && SYSTEM_WALLET_TYPES.has(profile.knownType)) {
      continue;
    }

    const behavior: string | null = normalizeBehavior(profile);
    if (!behavior) {
      continue;
    }

    counts[behavior] = (counts[behavior] ?? 0) + 1;
    supply[behavior] = (supply[behavior] ?? 0) + (profile.supplyPercent ?? 0);
  }

  return ORDER.map((id) => ({
    id,
    label: META[id]?.label ?? id,
    timeframe: META[id]?.timeframe ?? '',
    walletCount: counts[id] ?? 0,
    supplyPercent: supply[id] ?? 0,
    color: META[id]?.color ?? '#9ca3af',
  }));
}

export function calculateFreshSupplyPercent(profiles: HolderProfile[]): number {
  let total: number = 0;

  for (const profile of profiles) {
    if (profile.analysisSkipped) {
      continue;
    }
    if (profile.knownType && SYSTEM_WALLET_TYPES.has(profile.knownType)) {
      continue;
    }

    const behavior: string | null = normalizeBehavior(profile);
    if (behavior === 'HODLER') {
      total += profile.supplyPercent ?? 0;
      continue;
    }

    const realizedHours: number | null = profile.realizedMedianHoldTimeHours ?? null;
    const medianHours: number | null = profile.medianHoldTimeHours ?? null;
    const hasExitHistorySignal: boolean =
      (realizedHours != null && Number.isFinite(realizedHours)) ||
      (medianHours != null && Number.isFinite(medianHours) && (profile.completedCycleCount ?? 0) > 0);

    if (!hasExitHistorySignal && !behavior) {
      total += profile.supplyPercent ?? 0;
    }
  }

  return total;
}
