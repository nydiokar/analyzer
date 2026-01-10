import type { HolderProfile } from '../types';
import { formatPercentage, formatHoldTime } from './utils/formatters';

const APPROACHING_THRESHOLD = 1;

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

  // Calculate ratios: token hold time / median exit time
  const ratios = relevantProfiles
    .map((profile) => {
      // Use realized median (only completed exits) as the typical hold time
      const typicalExitTime = profile.realizedMedianHoldTimeHours;
      
      // Get how long they've held THIS token
      const tokenHoldTime = getTokenSpecificHoldHours(profile, tokenMint);
      
      if (!typicalExitTime || !tokenHoldTime || typicalExitTime <= 0) return null;
      return tokenHoldTime / typicalExitTime;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const approachingCount = ratios.filter((ratio) => ratio >= APPROACHING_THRESHOLD).length;
  const approachingPercent = relevantProfiles.length 
    ? (approachingCount / relevantProfiles.length) * 100 
    : null;
  
  const averageRatio = ratios.length
    ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length
    : null;

  const medianTypicalExitTime = relevantProfiles
    .map((p) => p.realizedMedianHoldTimeHours)
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);
  const medianTypical = medianTypicalExitTime.length
    ? medianTypicalExitTime[Math.floor(medianTypicalExitTime.length / 2)]
    : null;

  // Check if we have the required data
  const hasTokenHoldTimeData = ratios.length > 0;

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Approaching Typical Hold Time
      </p>
      {!hasTokenHoldTimeData ? (
        <p className="text-xs text-muted-foreground">
          {tokenMint 
            ? 'Per-token hold time data not available. Requires backend support for token-specific hold duration.'
            : 'No active holding duration data yet.'}
        </p>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="font-medium">
            {formatPercentage(approachingPercent, 0)} of holders approaching their typical exit time
          </p>
          <p className="text-xs text-muted-foreground">
            Avg ratio: {averageRatio ? `${averageRatio.toFixed(2)}x` : '—'} (token hold / median exit)
          </p>
        </div>
      )}
      {relevantProfiles.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {tokenMint 
            ? `${relevantProfiles.length} holders of this token`
            : `Based on ${relevantProfiles.length} holders`}
          {medianTypical !== null ? `; median exit time ${formatHoldTime(medianTypical)}` : ''}
        </p>
      )}
    </div>
  );
}
