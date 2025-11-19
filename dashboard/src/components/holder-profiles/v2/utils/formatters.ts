import type { HolderProfile } from '../../../holder-profiles/types';

export function formatAddress(address?: string | null) {
  if (!address) return '—';
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatHoldTime(hours: number | null | undefined) {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) {
    const minutes = hours * 60;
    if (minutes < 1) {
      return `${Math.round(minutes * 60)}s`;
    }
    return `${Math.round(minutes)}m`;
  }
  if (hours < 24) {
    const wholeHours = Math.floor(hours);
    const mins = Math.round((hours - wholeHours) * 60);
    return mins ? `${wholeHours}h ${mins}m` : `${wholeHours}h`;
  }
  const days = hours / 24;
  if (days < 7) return `${days.toFixed(1)}d`;
  const weeks = days / 7;
  if (weeks < 4) return `${weeks.toFixed(1)}w`;
  const months = weeks / 4;
  return `${months.toFixed(1)}m`; // ~months
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
