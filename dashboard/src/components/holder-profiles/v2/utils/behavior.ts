export interface BehaviorMeta {
  key: string;
  label: string;
  description: string;
  timeframe: string;
  palette: {
    badge: string;
    bar: string;
  };
}

const BEHAVIOR_META: Record<string, BehaviorMeta> = {
  SNIPER: {
    key: 'SNIPER',
    label: 'Sniper',
    description: 'Instant exits executed in seconds; often bot-driven or arb focused.',
    timeframe: '< 10 seconds',
    palette: {
      badge: 'bg-rose-500/15 text-rose-800 dark:text-rose-100',
      bar: 'bg-rose-600',
    },
  },
  SCALPER: {
    key: 'SCALPER',
    label: 'Scalper',
    description: 'High-frequency flips targeting tiny moves with tight stops.',
    timeframe: '< 1 minute',
    palette: {
      badge: 'bg-orange-500/15 text-orange-800 dark:text-orange-100',
      bar: 'bg-orange-600',
    },
  },
  MOMENTUM: {
    key: 'MOMENTUM',
    label: 'Momentum',
    description: 'Rides short bursts of momentum; exits quickly when trend cools.',
    timeframe: '5-30 minutes',
    palette: {
      badge: 'bg-amber-400/20 text-amber-900 dark:text-amber-100',
      bar: 'bg-amber-500',
    },
  },
  INTRADAY: {
    key: 'INTRADAY',
    label: 'Intraday',
    description: 'Holds through the session but flattens out before day end.',
    timeframe: '30 min - 4 hours',
    palette: {
      badge: 'bg-emerald-200/30 text-emerald-900 dark:text-emerald-100',
      bar: 'bg-emerald-500',
    },
  },
  DAY_TRADER: {
    key: 'DAY_TRADER',
    label: 'Day Trader',
    description: 'Keeps positions open for up to a day; may hold overnight occasionally.',
    timeframe: '4-24 hours',
    palette: {
      badge: 'bg-teal-300/25 text-teal-900 dark:text-teal-100',
      bar: 'bg-teal-500',
    },
  },
  SWING: {
    key: 'SWING',
    label: 'Swing',
    description: 'Carries trades across days to capture larger moves.',
    timeframe: '1-7 days',
    palette: {
      badge: 'bg-sky-300/25 text-sky-900 dark:text-sky-100',
      bar: 'bg-sky-500',
    },
  },
  POSITION: {
    key: 'POSITION',
    label: 'Position',
    description: 'Conviction trades held for weeks; tolerant of volatility.',
    timeframe: '7+ days',
    palette: {
      badge: 'bg-indigo-300/25 text-indigo-900 dark:text-indigo-100',
      bar: 'bg-indigo-600',
    },
  },
  HOLDER: {
    key: 'HOLDER',
    label: 'Holder',
    description: 'Long-term conviction; accumulates and rarely exits.',
    timeframe: 'Weeks to months',
    palette: {
      badge: 'bg-purple-300/25 text-purple-900 dark:text-purple-100',
      bar: 'bg-purple-600',
    },
  },
};

export function getBehaviorMeta(type?: string | null): BehaviorMeta | null {
  if (!type) return null;
  return BEHAVIOR_META[type] ?? null;
}

export const QUALITY_COLORS: Record<string, string> = {
  GOLD: 'bg-yellow-500/15 text-yellow-600',
  SILVER: 'bg-gray-400/15 text-gray-500',
  BRONZE: 'bg-orange-700/15 text-orange-800',
  INSUFFICIENT: 'bg-red-500/15 text-red-500',
};

export function getBehaviorColor(type?: string | null) {
  const meta = getBehaviorMeta(type);
  if (!meta) return 'bg-muted text-muted-foreground';
  return meta.palette.badge;
}

export function getBehaviorBarColor(type?: string | null) {
  const meta = getBehaviorMeta(type);
  if (!meta) return 'bg-muted';
  return meta.palette.bar;
}

export function getQualityColor(tier?: string | null) {
  if (!tier) return 'bg-muted text-muted-foreground';
  return QUALITY_COLORS[tier] || 'bg-muted text-muted-foreground';
}

export function getBehaviorDescription(type?: string | null) {
  const meta = getBehaviorMeta(type || undefined);
  if (!meta) return null;
  return {
    title: meta.label,
    description: meta.description,
    timeframe: meta.timeframe,
  };
}
