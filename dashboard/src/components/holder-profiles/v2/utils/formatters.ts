import type { HolderProfile, HoldTimeSource } from '../../../holder-profiles/types';

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const SOL_FORMATTER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

export function formatAddress(address?: string | null) {
  if (!address) return '—';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return USD_FORMATTER.format(value);
}

export function formatSol(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${SOL_FORMATTER.format(value)} SOL`;
}

export function formatHoldTime(hours: number | null | undefined) {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) {
    const minutes = hours * 60;
    if (minutes < 1) {
      return `${Math.round(minutes * 60)}s`;
    }
    return `${Math.round(minutes)}min`;
  }
  if (hours < 24) {
    const wholeHours = Math.floor(hours);
    const mins = Math.round((hours - wholeHours) * 60);
    return mins ? `${wholeHours}h ${mins}min` : `${wholeHours}h`;
  }
  const days = hours / 24;
  if (days < 30) return `${days.toFixed(1)}d`;
  const months = days / 30;
  return `${months.toFixed(1)}mo`;
}

export function formatPercentage(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(digits)}%`;
}

export function getDominantBehavior(profiles: HolderProfile[]) {
  const counts: Record<string, number> = {};
  profiles.forEach((profile) => {
    if (profile.behaviorType) {
      counts[profile.behaviorType] = (counts[profile.behaviorType] || 0) + 1;
    }
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0];
}

export function getTypicalHoldTimeHours(profile: HolderProfile): number | null {
  return (
    profile.typicalHoldTimeHours ??
    profile.medianHoldTimeHours ??
    profile.currentHoldMedianHours ??
    profile.realizedMedianHoldTimeHours ??
    null
  );
}

export function formatHoldSource(source?: HoldTimeSource) {
  switch (source) {
    case 'EXITED':
      return 'Completed exits';
    case 'CURRENT':
      return 'Active positions';
    case 'MIXED':
      return 'Active + exited';
    default:
      return 'Unknown source';
  }
}
