import type { HolderProfile } from '../../../holder-profiles/types';
import { formatHoldTime } from './formatters';
import { SPEED_CATEGORY_COLORS } from '@/lib/strategy-colors';

export interface CognitivePrimitive {
  id: 'speed' | 'conviction' | 'consistency' | 'quality' | 'similarity' | 'fresh';
  label: string;
  value: string;
  category: string;
  description: string;
  color: string;
}

// Speed buckets now use centralized color palette
const SPEED_BUCKETS = [
  { threshold: 1 / 60, label: 'Instant', color: SPEED_CATEGORY_COLORS.SNIPER.text },      // < 1 min
  { threshold: 5 / 60, label: 'Ultra-fast', color: SPEED_CATEGORY_COLORS.SCALPER.text },  // < 5 min
  { threshold: 0.5, label: 'Fast', color: SPEED_CATEGORY_COLORS.MOMENTUM.text },           // < 30 min
  { threshold: 6, label: 'Intraday', color: SPEED_CATEGORY_COLORS.INTRADAY.text },         // < 6 h
  { threshold: 24, label: 'Multi-day', color: SPEED_CATEGORY_COLORS.SWING.text },          // < 1 d
];

function calculateMedian(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function getSpeedPrimitive(profiles: HolderProfile[]): CognitivePrimitive {
  // Use only realized median (completed exits) to show actual exit behavior
  // Not mixed values that include current holdings
  // Note: Known wallets have null metrics, so they're naturally excluded by the filter
  const holds = profiles
    .map((profile) => {
      return profile.realizedMedianHoldTimeHours ?? null;
    })
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const median = holds.length ? calculateMedian(holds) : 0;
  const bucket = SPEED_BUCKETS.find((b) => median <= b.threshold);
  const category = bucket ? bucket.label : 'Long-term';
  const color = bucket ? bucket.color : SPEED_CATEGORY_COLORS.HODLER.text;

  return {
    id: 'speed',
    label: 'Speed',
    value: holds.length ? formatHoldTime(median) : '—',
    category,
    description: holds.length
      ? `${category} exits (median ${formatHoldTime(median)})`
      : 'Not enough data',
    color,
  };
}

export function getConvictionPrimitive(profiles: HolderProfile[]): CognitivePrimitive {
  // Note: Known wallets have null metrics, so they're naturally excluded by the filter
  const flips = profiles
    .map((p) => (typeof p.dailyFlipRatio === 'number' ? p.dailyFlipRatio : null))
    .filter((v): v is number => v !== null);
  const avg = flips.length ? flips.reduce((sum, val) => sum + val, 0) / flips.length : null;
  let category = 'Unknown';
  let color = 'text-muted-foreground';
  if (avg !== null) {
    if (avg >= 70) {
      category = 'Low conviction';
      color = 'text-red-500';
    } else if (avg >= 40) {
      category = 'Mixed conviction';
      color = 'text-yellow-500';
    } else {
      category = 'High conviction';
      color = 'text-emerald-500';
    }
  }

  return {
    id: 'conviction',
    label: 'Conviction',
    value: avg !== null ? `${avg.toFixed(0)}% flips` : '—',
    category,
    description: avg !== null ? category : 'Not enough data',
    color,
  };
}

export function getConsistencyPrimitive(profiles: HolderProfile[]): CognitivePrimitive {
  // Note: Known wallets have dataQualityTier='INSUFFICIENT', naturally excluded from high quality count
  if (!profiles.length) {
    return {
      id: 'consistency',
      label: 'Consistency',
      value: '—',
      category: 'Unknown',
      description: 'No data',
      color: 'text-muted-foreground',
    };
  }

  const highQuality = profiles.filter((p) => p.dataQualityTier === 'GOLD' || p.dataQualityTier === 'SILVER').length;
  const ratio = highQuality / profiles.length;
  let category = 'Chaotic';
  let color = 'text-red-500';
  if (ratio >= 0.7) {
    category = 'Consistent';
    color = 'text-emerald-500';
  } else if (ratio >= 0.4) {
    category = 'Moderate';
    color = 'text-yellow-500';
  }

  return {
    id: 'consistency',
    label: 'Consistency',
    value: `${highQuality}/${profiles.length} HQ`,
    category,
    description: `${Math.round(ratio * 100)}% high quality data`,
    color,
  };
}

export function getCognitivePrimitives(profiles: HolderProfile[]) {
  return [
    getSpeedPrimitive(profiles),
    getConvictionPrimitive(profiles),
    getConsistencyPrimitive(profiles),
  ];
}
