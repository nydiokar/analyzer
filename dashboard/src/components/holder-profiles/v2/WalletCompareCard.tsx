import type { HolderProfilesResult } from '../types';
import { formatAddress, formatHoldTime, formatPercentage } from './utils/formatters';
import { getBehaviorColor, getQualityColor } from './utils/behavior';
import { getWalletOutcome } from './utils/outcome-logic';

interface Props {
  result: HolderProfilesResult;
  highlight?: boolean;
}

export function WalletCompareCard({ result, highlight }: Props) {
  const profile = result.profiles[0];
  if (!profile) return null;
  const outcome = getWalletOutcome(profile);

  return (
    <div className={`rounded-2xl border p-4 bg-card ${highlight ? 'ring-2 ring-primary/40' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">{formatAddress(result.targetWallet || profile.walletAddress)}</div>
        <span className={`px-2 py-0.5 rounded-full text-[11px] ${getBehaviorColor(profile.behaviorType)}`}>
          {profile.behaviorType ?? '—'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{outcome.verdict}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border p-2">
          <p className="text-muted-foreground">Speed</p>
          <p className="font-semibold">{formatHoldTime(profile.medianHoldTimeHours)}</p>
        </div>
        <div className="rounded-lg border p-2">
          <p className="text-muted-foreground">Flip</p>
          <p className="font-semibold">{formatPercentage(profile.dailyFlipRatio)}</p>
        </div>
        <div className="rounded-lg border p-2">
          <p className="text-muted-foreground">Quality</p>
          <p className={`font-semibold ${getQualityColor(profile.dataQualityTier)}`}>{profile.dataQualityTier}</p>
        </div>
      </div>
    </div>
  );
}
