import type { HolderProfile } from '../types';
import { formatPercentage, formatHoldTime } from './utils/formatters';

// Thresholds for "approaching" classification
const APPROACHING_THRESHOLD_MIN = 0.8; // 80% of typical hold time
const APPROACHING_THRESHOLD_MAX = 1.0; // 100% of typical hold time

/**
 * Get how long the wallet has held THIS specific token
 * Note: Currently we don't have per-token hold time in the data structure,
 * so this is a placeholder that needs backend support
 */
function getTokenSpecificHoldHours(profile: HolderProfile, tokenMint?: string): number | null {
  if (!tokenMint) return null;

  // Check if wallet holds this token
  const holdsToken = (profile.currentHoldings ?? []).some(
    (holding) => holding.tokenAddress === tokenMint && (holding.uiBalance ?? 0) > 0
  );

  if (!holdsToken) return null;

  // TODO: We need per-token hold time from backend
  // For now, return null to indicate we need this data
  // The backend should provide: how long each wallet has held THIS specific token
  return null;
}

/**
 * Get typical hold time for a holder - prefer median over mean for robustness
 * Falls back to mean if median is not available
 */
function getTypicalHoldTime(profile: HolderProfile): number | null {
  // Prefer realized median (only completed exits) as it's more robust
  if (profile.realizedMedianHoldTimeHours !== null && profile.realizedMedianHoldTimeHours !== undefined) {
    return profile.realizedMedianHoldTimeHours;
  }

  // Fallback to mean hold time if available
  if (profile.avgHoldTimeHours !== null && profile.avgHoldTimeHours !== undefined) {
    return profile.avgHoldTimeHours;
  }

  return null;
}

interface Props {
  profiles: HolderProfile[];
  tokenMint?: string;
}

export function ApproachingHoldTimePanel({ profiles, tokenMint }: Props) {
  // Filter to only wallets that hold this token (if tokenMint provided)
  const relevantProfiles = tokenMint
    ? profiles.filter((profile) =>
        (profile.currentHoldings ?? []).some(
          (holding) => holding.tokenAddress === tokenMint && (holding.uiBalance ?? 0) > 0
        )
      )
    : profiles;

  // Calculate ratios: token hold time / typical hold time
  const ratios = relevantProfiles
    .map((profile) => {
      const typicalHoldTime = getTypicalHoldTime(profile);
      const tokenHoldTime = getTokenSpecificHoldHours(profile, tokenMint);

      if (!typicalHoldTime || !tokenHoldTime || typicalHoldTime <= 0) return null;
      return tokenHoldTime / typicalHoldTime;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));

  // Count holders within the "approaching" threshold (80-100% of typical hold time)
  const approachingCount = ratios.filter(
    (ratio) => ratio >= APPROACHING_THRESHOLD_MIN && ratio <= APPROACHING_THRESHOLD_MAX
  ).length;

  const approachingPercent = relevantProfiles.length > 0 && ratios.length > 0
    ? (approachingCount / relevantProfiles.length) * 100
    : null;

  // Calculate how many profiles have sufficient data
  const profilesWithData = relevantProfiles.filter((profile) => {
    const typicalHoldTime = getTypicalHoldTime(profile);
    const tokenHoldTime = getTokenSpecificHoldHours(profile, tokenMint);
    return typicalHoldTime !== null && tokenHoldTime !== null;
  }).length;

  // Get median typical hold time across all holders
  const typicalHoldTimes = relevantProfiles
    .map((p) => getTypicalHoldTime(p))
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);

  const medianTypical = (() => {
    if (!typicalHoldTimes.length) return null;
    const mid = Math.floor(typicalHoldTimes.length / 2);
    if (typicalHoldTimes.length % 2 !== 0) return typicalHoldTimes[mid];
    return (typicalHoldTimes[mid - 1] + typicalHoldTimes[mid]) / 2;
  })();

  // Check if we have the required data
  const hasTokenHoldTimeData = ratios.length > 0;

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Approaching Typical Hold Time
      </p>
      {!hasTokenHoldTimeData ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {tokenMint
              ? 'Per-token hold time data not available yet.'
              : 'No active holding duration data.'}
          </p>
          {medianTypical !== null && (
            <p className="text-[11px] text-muted-foreground">
              Median typical exit: {formatHoldTime(medianTypical)}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {formatPercentage(approachingPercent, 0)} within exit window
            </p>
            <p className="text-[11px] text-muted-foreground">
              {approachingCount} of {profilesWithData} holders are 80-100% through their typical hold time
            </p>
          </div>
          {medianTypical !== null && (
            <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/50">
              Median typical exit: {formatHoldTime(medianTypical)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
