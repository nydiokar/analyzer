import type { HolderProfile } from '../types';
import { formatHoldTime } from './formatters';

export interface CognitivePrimitive {
  id: 'speed' | 'conviction' | 'consistency';
  label: string;
  value: string;
  category: string;
  description: string;
  color: string;
}

const SPEED_BUCKETS = [
  { threshold: 1 / 60, label: 'Instant', color: 'text-red-500' },      // < 1 min
  { threshold: 5 / 60, label: 'Ultra-fast', color: 'text-red-500' },    // < 5 min
  { threshold: 0.5, label: 'Fast', color: 'text-orange-500' },          // < 30 min
  { threshold: 6, label: 'Intraday', color: 'text-yellow-500' },        // < 6 h
  { threshold: 24, label: 'Multi-day', color: 'text-blue-500' },        // < 1 d
];

function calculateMedian(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function getSpeedPrimitive(profiles: HolderProfile[]): CognitivePrimitive {
  const holds = profiles
    .map((p) => (typeof p.medianHoldTimeHours === 'number' ? p.medianHoldTimeHours : null))
    .filter((v): v is number => v !== null);
  const median = holds.length ? calculateMedian(holds) : 0;
  const bucket = SPEED_BUCKETS.find((b) => median <= b.threshold);
  const category = bucket ? bucket.label : 'Long-term';
  const color = bucket ? bucket.color : 'text-emerald-500';

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

  const highQuality = profiles.filter((p) => p.dataQualityTier === 'HIGH').length;
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
