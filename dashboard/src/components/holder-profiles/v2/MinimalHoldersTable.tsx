import type { HolderProfile } from '../types';
import { formatAddress, formatHoldTime, formatPercentage } from './utils/formatters';
import { getBehaviorColor, getQualityColor } from './utils/behavior';

interface Props {
  profiles: HolderProfile[];
  mode: 'token' | 'wallet';
}

export function MinimalHoldersTable({ profiles, mode }: Props) {
  return (
    <div className="rounded-2xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            {mode === 'token' && <th className="text-left px-4 py-2">Rank</th>}
            <th className="text-left px-4 py-2">Wallet</th>
            <th className="text-left px-4 py-2">Behavior</th>
            <th className="text-left px-4 py-2">Speed</th>
            <th className="text-left px-4 py-2">Flip</th>
            <th className="text-left px-4 py-2">Quality</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => (
            <tr key={profile.walletAddress} className="border-t border-border/60">
              {mode === 'token' && <td className="px-4 py-2 text-muted-foreground">#{profile.rank}</td>}
              <td className="px-4 py-2 font-mono text-xs">{formatAddress(profile.walletAddress)}</td>
              <td className="px-4 py-2">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getBehaviorColor(profile.behaviorType)}`}>
                  {profile.behaviorType ?? '—'}
                </span>
              </td>
              <td className="px-4 py-2">{formatHoldTime(profile.medianHoldTimeHours)}</td>
              <td className="px-4 py-2">{formatPercentage(profile.dailyFlipRatio)}</td>
              <td className="px-4 py-2">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getQualityColor(profile.dataQualityTier)}`}>
                  {profile.dataQualityTier}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
