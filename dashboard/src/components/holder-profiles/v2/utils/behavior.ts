interface BehaviorColorSet {
  badge: string;
  bar: string;
}

export const BEHAVIOR_COLORS: Record<string, BehaviorColorSet> = {
  SNIPER: { badge: 'bg-rose-600/15 text-rose-600', bar: 'bg-rose-600' },
  SCALPER: { badge: 'bg-orange-500/15 text-orange-600', bar: 'bg-orange-500' },
  MOMENTUM: { badge: 'bg-amber-400/20 text-amber-600', bar: 'bg-amber-500' },
  INTRADAY: { badge: 'bg-lime-400/20 text-lime-700', bar: 'bg-lime-500' },
  DAY_TRADER: { badge: 'bg-sky-400/20 text-sky-700', bar: 'bg-sky-500' },
  SWING: { badge: 'bg-indigo-400/20 text-indigo-700', bar: 'bg-indigo-500' },
  POSITION: { badge: 'bg-emerald-400/20 text-emerald-700', bar: 'bg-emerald-500' },
  HOLDER: { badge: 'bg-teal-400/20 text-teal-700', bar: 'bg-teal-500' },
};

export const QUALITY_COLORS: Record<string, string> = {
  GOLD: 'bg-yellow-500/15 text-yellow-600',
  SILVER: 'bg-gray-400/15 text-gray-500',
  BRONZE: 'bg-orange-700/15 text-orange-800',
  INSUFFICIENT: 'bg-red-500/15 text-red-500',
};

export function getBehaviorColor(type?: string | null) {
  if (!type) return 'bg-muted text-muted-foreground';
  return BEHAVIOR_COLORS[type]?.badge || 'bg-muted text-muted-foreground';
}

export function getBehaviorBarColor(type?: string | null) {
  if (!type) return 'bg-muted';
  return BEHAVIOR_COLORS[type]?.bar || 'bg-muted';
}

export function getQualityColor(tier?: string | null) {
  if (!tier) return 'bg-muted text-muted-foreground';
  return QUALITY_COLORS[tier] || 'bg-muted text-muted-foreground';
}
