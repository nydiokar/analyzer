interface BehaviorColorSet {
  badge: string;
  bar: string;
}

export const BEHAVIOR_COLORS: Record<string, BehaviorColorSet> = {
  SNIPER: { badge: 'bg-red-500/15 text-red-500', bar: 'bg-red-500' },
  SCALPER: { badge: 'bg-orange-500/15 text-orange-500', bar: 'bg-orange-500' },
  MOMENTUM: { badge: 'bg-yellow-500/15 text-yellow-500', bar: 'bg-yellow-500' },
  INTRADAY: { badge: 'bg-amber-500/15 text-amber-500', bar: 'bg-amber-500' },
  DAY_TRADER: { badge: 'bg-blue-500/15 text-blue-500', bar: 'bg-blue-500' },
  SWING: { badge: 'bg-cyan-500/15 text-cyan-500', bar: 'bg-cyan-500' },
  POSITION: { badge: 'bg-green-500/15 text-green-500', bar: 'bg-green-500' },
  HOLDER: { badge: 'bg-emerald-500/15 text-emerald-500', bar: 'bg-emerald-500' },
};

export const QUALITY_COLORS: Record<string, string> = {
  HIGH: 'bg-emerald-500/15 text-emerald-500',
  MEDIUM: 'bg-blue-500/15 text-blue-500',
  LOW: 'bg-yellow-500/15 text-yellow-500',
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
