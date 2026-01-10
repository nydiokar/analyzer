import type React from 'react';
import { SPEED_CATEGORY_COLORS } from '@/lib/strategy-colors';

export interface BehaviorMeta {
  key: string;
  label: string;
  description: string;
  timeframe: string;
  palette: {
    badge: {
      className: string;
      style: React.CSSProperties;
    };
    bar: {
      className: string;
      style: React.CSSProperties;
    };
  };
}

// Convert hex to rgba for proper opacity
const hexToRgba = (hex: string, alpha: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Create badge and bar styles from centralized colors
// Returns both className and style for proper color matching
const createPaletteFromHex = (hex: string) => ({
  badge: {
    className: 'font-medium',
    style: { backgroundColor: hexToRgba(hex, 0.15), color: hex },
  },
  bar: {
    className: '',
    style: { backgroundColor: hex },
  },
});

const BEHAVIOR_META: Record<string, BehaviorMeta> = {
  SNIPER: {
    key: 'SNIPER',
    label: 'Sniper',
    description: 'Instant exits executed in seconds; often bot-driven or arb focused.',
    timeframe: '< 10 seconds',
    palette: createPaletteFromHex(SPEED_CATEGORY_COLORS.SNIPER.hex),
  },
  SCALPER: {
    key: 'SCALPER',
    label: 'Scalper',
    description: 'High-frequency flips targeting tiny moves with tight stops.',
    timeframe: '< 1 minute',
    palette: createPaletteFromHex(SPEED_CATEGORY_COLORS.SCALPER.hex),
  },
  MOMENTUM: {
    key: 'MOMENTUM',
    label: 'Momentum',
    description: 'Rides short bursts of momentum; exits quickly when trend cools.',
    timeframe: '5-30 minutes',
    palette: createPaletteFromHex(SPEED_CATEGORY_COLORS.MOMENTUM.hex),
  },
  INTRADAY: {
    key: 'INTRADAY',
    label: 'Intraday',
    description: 'Holds through the session but flattens out before day end.',
    timeframe: '30 min - 4 hours',
    palette: createPaletteFromHex(SPEED_CATEGORY_COLORS.INTRADAY.hex),
  },
  DAY_TRADER: {
    key: 'DAY_TRADER',
    label: 'Day Trader',
    description: 'Keeps positions open for up to a day; may hold overnight occasionally.',
    timeframe: '4-24 hours',
    palette: createPaletteFromHex(SPEED_CATEGORY_COLORS.DAY_TRADER.hex),
  },
  SWING: {
    key: 'SWING',
    label: 'Swing',
    description: 'Carries trades across days to capture larger moves.',
    timeframe: '1-7 days',
    palette: createPaletteFromHex(SPEED_CATEGORY_COLORS.SWING.hex),
  },
  POSITION: {
    key: 'POSITION',
    label: 'Position',
    description: 'Conviction trades held for weeks; tolerant of volatility.',
    timeframe: '7+ days',
    palette: createPaletteFromHex(SPEED_CATEGORY_COLORS.POSITION.hex),
  },
  HOLDER: {
    key: 'HOLDER',
    label: 'Holder',
    description: 'Lack of exited tokens; accumulates and waiting.',
    timeframe: 'Holds until it is not',
    palette: createPaletteFromHex(SPEED_CATEGORY_COLORS.HODLER.hex),
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

export function getBehaviorColor(type?: string | null): { className: string; style: React.CSSProperties } {
  const meta = getBehaviorMeta(type);
  if (!meta) return { className: 'bg-muted text-muted-foreground', style: {} };
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
