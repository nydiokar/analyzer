/**
 * Unified Strategy Type Color Palette
 *
 * Used across the app for consistent visual identification of trading strategies.
 * Based on the color scheme from holder-profiles cognitive primitives.
 */

import type { StrategyType } from '@/types/api';

export interface StrategyColorScheme {
  /** Badge/pill background and text colors */
  badge: string;
  /** Text-only color classes */
  text: string;
  /** Border color */
  border: string;
  /** Description for tooltip/legend */
  description: string;
}

/**
 * Strategy Type Color Mapping
 *
 * Speed-based (exit timing):
 * - FAST_TRADER (< 30min): Red/Orange (hot, fast)
 * - DAY_TRADER (< 24h): Yellow (intraday)
 * - SWING_TRADER (1-7d): Blue (cooler, patient)
 * - POSITION_TRADER (7+ days): Emerald (long-term, growth)
 *
 * Flow-based (buy/sell pattern):
 * - PURE_HOLDER (no exits): Purple (conviction, accumulation)
 * - ACCUMULATOR (buy-heavy): Teal (building)
 * - DISTRIBUTOR (sell-heavy): Amber (distributing)
 * - BALANCED_TRADER (equal): Gray (neutral)
 */
export const STRATEGY_COLORS: Record<StrategyType, StrategyColorScheme> = {
  FAST_TRADER: {
    badge: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800',
    text: 'text-red-600 dark:text-red-400',
    border: 'border-red-200 dark:border-red-800',
    description: 'Exits in < 30 minutes',
  },
  DAY_TRADER: {
    badge: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-300 dark:border-yellow-800',
    text: 'text-yellow-600 dark:text-yellow-400',
    border: 'border-yellow-200 dark:border-yellow-800',
    description: 'Exits within same day',
  },
  SWING_TRADER: {
    badge: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-200 dark:border-blue-800',
    description: 'Holds for days (1-7 days)',
  },
  POSITION_TRADER: {
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800',
    text: 'text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-200 dark:border-emerald-800',
    description: 'Long-term holds (7+ days)',
  },
  PURE_HOLDER: {
    badge: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-800',
    text: 'text-purple-600 dark:text-purple-400',
    border: 'border-purple-200 dark:border-purple-800',
    description: 'Never exits, only accumulates',
  },
  ACCUMULATOR: {
    badge: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:border-teal-800',
    text: 'text-teal-600 dark:text-teal-400',
    border: 'border-teal-200 dark:border-teal-800',
    description: 'Heavy buy bias',
  },
  DISTRIBUTOR: {
    badge: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-800',
    text: 'text-amber-600 dark:text-amber-400',
    border: 'border-amber-200 dark:border-amber-800',
    description: 'Heavy sell bias',
  },
  BALANCED_TRADER: {
    badge: 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800/30 dark:text-slate-300 dark:border-slate-700',
    text: 'text-slate-600 dark:text-slate-400',
    border: 'border-slate-200 dark:border-slate-700',
    description: 'Equal buy/sell activity',
  },
  LOW_ACTIVITY: {
    badge: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-900/30 dark:text-gray-400 dark:border-gray-800',
    text: 'text-gray-500 dark:text-gray-500',
    border: 'border-gray-200 dark:border-gray-800',
    description: 'Insufficient data',
  },
};

/**
 * Get color scheme for a strategy type
 */
export function getStrategyColors(strategyType: StrategyType | null | undefined): StrategyColorScheme {
  if (!strategyType || !(strategyType in STRATEGY_COLORS)) {
    return STRATEGY_COLORS.LOW_ACTIVITY;
  }
  return STRATEGY_COLORS[strategyType];
}

/**
 * Speed Category Colors (based on exit timing)
 * Matches holder-profiles cognitive primitives color scheme
 */
export const SPEED_COLORS: Record<string, string> = {
  'SNIPER': 'text-red-500',      // Ultra-fast (< 5 min)
  'SCALPER': 'text-red-500',     // Ultra-fast (< 5 min)
  'MOMENTUM': 'text-orange-500', // Fast (< 30 min)
  'INTRADAY': 'text-yellow-500', // Intraday (< 6h)
  'DAY_TRADER': 'text-yellow-500', // Intraday (< 24h)
  'SWING': 'text-blue-500',      // Multi-day (1-7 days)
  'POSITION': 'text-emerald-500', // Long-term (7+ days)
  'HODLER': 'text-emerald-500',  // Long-term (never exits)
};

/**
 * Flow Pattern Colors (based on buy/sell behavior - conviction theme)
 * Matches holder-profiles conviction: High (green), Mixed (yellow), Low/Chaotic (red)
 */
export const FLOW_COLORS: Record<string, string> = {
  'BUY_ONLY': 'text-emerald-500',      // High conviction - pure accumulation
  'ACCUMULATOR': 'text-emerald-500',   // High conviction - buy-heavy
  'BALANCED': 'text-blue-500',         // Neutral - disciplined trading
  'MIXED': 'text-yellow-500',          // Mixed - chaotic pattern
  'DISTRIBUTOR': 'text-orange-500',    // Distribution phase
  'SELL_ONLY': 'text-red-500',         // Exit phase
};

export function getSpeedColor(speedCategory: string | null | undefined): string {
  if (!speedCategory) return 'text-foreground';
  return SPEED_COLORS[speedCategory] || 'text-foreground';
}

export function getFlowColor(flowPattern: string | null | undefined): string {
  if (!flowPattern) return 'text-foreground';
  return FLOW_COLORS[flowPattern] || 'text-foreground';
}
