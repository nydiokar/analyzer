import type { HolderProfile, WalletGroupInsight } from '../../../holder-profiles/types';
import { formatAddress, formatHoldTime } from './formatters';
import { BEHAVIOR_COLORS } from './behavior';

export function buildWalletGroupInsights(profiles: HolderProfile[]): WalletGroupInsight[] {
  if (profiles.length < 2) return [];

  const comparable = profiles.filter((p) => !!p.behaviorType);
  const behaviorCounts: Record<string, number> = {};
  comparable.forEach((p) => {
    const key = p.behaviorType as string;
    behaviorCounts[key] = (behaviorCounts[key] || 0) + 1;
  });
  const sortedBehaviors = Object.entries(behaviorCounts).sort((a, b) => b[1] - a[1]);
  const dominantBehavior = sortedBehaviors[0]?.[0];

  const bySpeed = [...profiles]
    .filter((p) => typeof p.medianHoldTimeHours === 'number')
    .sort((a, b) => (a.medianHoldTimeHours ?? Infinity) - (b.medianHoldTimeHours ?? Infinity));
  const byConviction = [...profiles]
    .filter((p) => typeof p.dailyFlipRatio === 'number')
    .sort((a, b) => (a.dailyFlipRatio ?? 0) - (b.dailyFlipRatio ?? 0));
  const weakestQuality = profiles.find((p) => p.dataQualityTier !== 'HIGH');

  return [
    {
      label: 'Dominant behavior',
      value: dominantBehavior ?? 'Mixed',
      description: dominantBehavior ? `${behaviorCounts[dominantBehavior]} of ${profiles.length}` : 'No clear leader',
      color: dominantBehavior ? BEHAVIOR_COLORS[dominantBehavior]?.badge || 'bg-muted text-muted-foreground' : 'bg-muted text-muted-foreground',
    },
    {
      label: 'Fastest exit',
      value: bySpeed[0]?.walletAddress ? formatAddress(bySpeed[0].walletAddress) : 'N/A',
      description: bySpeed[0]?.medianHoldTimeHours
        ? `${formatHoldTime(bySpeed[0].medianHoldTimeHours)} median hold`
        : 'Insufficient data',
      color: 'bg-red-500/15 text-red-500',
    },
    {
      label: 'Highest conviction',
      value: byConviction[0]?.walletAddress ? formatAddress(byConviction[0].walletAddress) : 'N/A',
      description: byConviction[0]?.dailyFlipRatio !== undefined
        ? `${byConviction[0].dailyFlipRatio?.toFixed(0)}% flip ratio`
        : 'Insufficient data',
      color: 'bg-emerald-500/15 text-emerald-500',
    },
    {
      label: 'Data warning',
      value: weakestQuality ? formatAddress(weakestQuality.walletAddress) : 'All solid',
      description: weakestQuality ? `${weakestQuality.dataQualityTier} quality` : 'No issues',
      color: weakestQuality ? 'bg-yellow-500/15 text-yellow-500' : 'bg-emerald-500/15 text-emerald-500',
    },
  ];
}
