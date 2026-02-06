import { memo } from 'react';
import { DataQualityTier, type WalletHudDto } from '@/types/api';

const BEHAVIOR_COLORS: Record<string, { bg: string; text: string }> = {
  S: { bg: 'bg-red-600 dark:bg-red-500', text: 'text-white' },
  R: { bg: 'bg-orange-600 dark:bg-orange-500', text: 'text-white' },
  M: { bg: 'bg-yellow-600 dark:bg-yellow-500', text: 'text-white' },
  I: { bg: 'bg-amber-600 dark:bg-amber-500', text: 'text-white' },
  D: { bg: 'bg-cyan-600 dark:bg-cyan-500', text: 'text-white' },
  W: { bg: 'bg-blue-600 dark:bg-blue-500', text: 'text-white' },
  P: { bg: 'bg-emerald-600 dark:bg-emerald-500', text: 'text-white' },
  H: { bg: 'bg-green-600 dark:bg-green-500', text: 'text-white' },
  F: { bg: 'bg-red-600 dark:bg-red-500', text: 'text-white' },
  A: { bg: 'bg-teal-600 dark:bg-teal-500', text: 'text-white' },
  T: { bg: 'bg-purple-600 dark:bg-purple-500', text: 'text-white' },
  B: { bg: 'bg-slate-600 dark:bg-slate-500', text: 'text-white' },
  L: { bg: 'bg-gray-500 dark:bg-gray-600', text: 'text-white' },
  '?': { bg: 'bg-gray-500 dark:bg-gray-600', text: 'text-white' },
};

const DATA_QUALITY_DISPLAY: Record<DataQualityTier, { emoji: string }> = {
  [DataQualityTier.GOLD]: { emoji: '🥇' },
  [DataQualityTier.SILVER]: { emoji: '🥈' },
  [DataQualityTier.BRONZE]: { emoji: '🥉' },
  [DataQualityTier.INSUFFICIENT]: { emoji: '❓' },
};

interface WalletHudBadgeProps {
  data: WalletHudDto | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Poker-style HUD badges - always-visible compact indicators
 * Shows: Quality tier emoji, colored behavior code, bot/whale badges
 * NO TOOLTIPS - parent component handles tooltip on hover
 */
export const WalletHudBadge = memo(function WalletHudBadge({
  data,
  size = 'sm',
  className = '',
}: WalletHudBadgeProps) {
  if (!data) return null;

  const qualityConfig = DATA_QUALITY_DISPLAY[data.dataQualityTier];
  const behaviorColor = BEHAVIOR_COLORS[data.behaviorCode] || BEHAVIOR_COLORS['?'];

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      {/* Quality Tier Emoji */}
      <span className={size === 'sm' ? 'text-sm' : 'text-base'}>
        {qualityConfig.emoji}
      </span>

      {/* Behavior Code Circle */}
      <span
        className={`inline-flex items-center justify-center rounded-full font-bold ${behaviorColor.bg} ${behaviorColor.text} ${
          size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-6 w-6 text-xs'
        }`}
      >
        {data.behaviorCode}
      </span>

      {/* Bot Badge */}
      {data.isBot && (
        <span className={size === 'sm' ? 'text-sm' : 'text-base'}>
          🤖
        </span>
      )}

      {/* Whale Badge */}
      {data.isWhale && (
        <span className={size === 'sm' ? 'text-sm' : 'text-base'}>
          🐋
        </span>
      )}
    </div>
  );
});
