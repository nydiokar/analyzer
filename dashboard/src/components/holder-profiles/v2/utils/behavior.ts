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
      badge: 'bg-rose-500/10 text-rose-700 dark:text-rose-200',
      bar: 'bg-rose-500',
    },
  },
  SCALPER: {
    key: 'SCALPER',
    label: 'Scalper',
    description: 'High-frequency flips targeting tiny moves with tight stops.',
    timeframe: '< 1 minute',
    palette: {
      badge: 'bg-orange-500/10 text-orange-700 dark:text-orange-200',
      bar: 'bg-orange-500',
    },
  },
  MOMENTUM: {
    key: 'MOMENTUM',
    label: 'Momentum',
    description: 'Rides short bursts of momentum; exits quickly when trend cools.',
    timeframe: '5-30 minutes',
    palette: {
      badge: 'bg-amber-400/15 text-amber-800 dark:text-amber-200',
      bar: 'bg-amber-500',
    },
  },
  INTRADAY: {
    key: 'INTRADAY',
    label: 'Intraday',
    description: 'Holds through the session but flattens out before day end.',
    timeframe: '30 min - 4 hours',
    palette: {
      badge: 'bg-yellow-400/15 text-yellow-800 dark:text-yellow-200',
      bar: 'bg-yellow-400',
    },
  },
  DAY_TRADER: {
    key: 'DAY_TRADER',
    label: 'Day Trader',
    description: 'Keeps positions open for up to a day; may hold overnight occasionally.',
    timeframe: '4-24 hours',
    palette: {
      badge: 'bg-lime-400/15 text-lime-800 dark:text-lime-200',
      bar: 'bg-lime-500',
    },
  },
  SWING: {
    key: 'SWING',
    label: 'Swing',
    description: 'Carries trades across days to capture larger moves.',
    timeframe: '1-7 days',
    palette: {
      badge: 'bg-emerald-400/15 text-emerald-800 dark:text-emerald-200',
      bar: 'bg-emerald-500',
    },
  },
  POSITION: {
    key: 'POSITION',
    label: 'Position',
    description: 'Conviction trades held for weeks; tolerant of volatility.',
    timeframe: '7+ days',
    palette: {
      badge: 'bg-teal-400/15 text-teal-800 dark:text-teal-200',
      bar: 'bg-teal-500',
    },
  },
  HOLDER: {
    key: 'HOLDER',
    label: 'Holder',
    description: 'Long-term conviction; accumulates and rarely exits.',
    timeframe: 'Weeks to months',
    palette: {
      badge: 'bg-indigo-500/12 text-indigo-800 dark:text-indigo-200',
      bar: 'bg-indigo-500',
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
