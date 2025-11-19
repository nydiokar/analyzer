import type { HolderProfile, WalletGroupInsight } from '../../../holder-profiles/types';
import { formatAddress, formatHoldTime, getTypicalHoldTimeHours } from './formatters';

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
    .filter((profile) => typeof getTypicalHoldTimeHours(profile) === 'number')
    .sort(
      (a, b) =>
        (getTypicalHoldTimeHours(a) ?? Infinity) - (getTypicalHoldTimeHours(b) ?? Infinity),
    );
  const byConviction = [...profiles]
    .filter((p) => typeof p.dailyFlipRatio === 'number')
    .sort((a, b) => (a.dailyFlipRatio ?? 0) - (b.dailyFlipRatio ?? 0));
  const weakestQuality = profiles.find((p) => p.dataQualityTier !== 'HIGH');

  return [
    {
      label: 'Dominant behavior',
      value: dominantBehavior ?? 'Mixed',
      description: dominantBehavior ? `${behaviorCounts[dominantBehavior]} of ${profiles.length}` : 'No clear leader',
      accentClass: 'bg-amber-500/80',
      textClass: 'text-amber-200',
    },
    {
      label: 'Fastest exit',
      value: bySpeed[0]?.walletAddress ? formatAddress(bySpeed[0].walletAddress) : 'N/A',
      description: bySpeed[0] && getTypicalHoldTimeHours(bySpeed[0]) !== null
        ? `${formatHoldTime(getTypicalHoldTimeHours(bySpeed[0]))} typical hold`
        : 'Insufficient data',
      accentClass: 'bg-rose-500/80',
      textClass: 'text-rose-200',
    },
    {
      label: 'Highest conviction',
      value: byConviction[0]?.walletAddress ? formatAddress(byConviction[0].walletAddress) : 'N/A',
      description: byConviction[0]?.dailyFlipRatio !== undefined
        ? `${byConviction[0].dailyFlipRatio?.toFixed(0)}% flip ratio`
        : 'Insufficient data',
      accentClass: 'bg-emerald-500/80',
      textClass: 'text-emerald-200',
    },
    {
      label: 'Data warning',
      value: weakestQuality ? formatAddress(weakestQuality.walletAddress) : 'All solid',
      description: weakestQuality ? `${weakestQuality.dataQualityTier} quality` : 'No issues',
      accentClass: weakestQuality ? 'bg-amber-500/80' : 'bg-emerald-500/80',
      textClass: weakestQuality ? 'text-amber-200' : 'text-emerald-200',
    },
  ];
}
