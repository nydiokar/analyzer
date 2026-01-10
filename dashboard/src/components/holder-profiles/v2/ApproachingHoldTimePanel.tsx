import type { HolderProfile } from '../types';
import { formatPercentage, formatHoldTime, getTypicalHoldTimeHours } from './utils/formatters';

const APPROACHING_THRESHOLD = 1;

function getCurrentHoldHours(profile: HolderProfile) {
  return profile.currentHoldMedianHours ?? profile.currentHoldAverageHours ?? null;
}

interface Props {
  profiles: HolderProfile[];
}

export function ApproachingHoldTimePanel({ profiles }: Props) {
  const typicalHoldTimes = profiles
    .map((profile) => getTypicalHoldTimeHours(profile))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const ratios = profiles
    .map((profile) => {
      const typical = getTypicalHoldTimeHours(profile);
      const current = getCurrentHoldHours(profile);
      if (!typical || !current || typical <= 0) return null;
      return current / typical;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const approachingCount = ratios.filter((ratio) => ratio >= APPROACHING_THRESHOLD).length;
  const approachingPercent = profiles.length ? (approachingCount / profiles.length) * 100 : null;
  const averageRatio = ratios.length
    ? (ratios.reduce((sum, value) => sum + value, 0) / ratios.length) * 100
    : null;
  const medianTypical = typicalHoldTimes.length
    ? [...typicalHoldTimes].sort((a, b) => a - b)[Math.floor(typicalHoldTimes.length / 2)]
    : null;

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Approaching Typical Hold Time
      </p>
      {ratios.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No active holding duration data yet.
        </p>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="font-medium">
            {formatPercentage(approachingPercent, 0)} of holders nearing their typical hold time
          </p>
          <p className="text-xs text-muted-foreground">
            vs {formatPercentage(averageRatio, 0)} of current hold duration
          </p>
        </div>
      )}
      {profiles.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Based on {profiles.length} holders
          {medianTypical !== null ? `; median typical hold ${formatHoldTime(medianTypical)}` : ''}
        </p>
      )}
    </div>
  );
}
