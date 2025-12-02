import type { HolderProfile } from '../types';
import { formatAddress, formatHoldTime, formatHoldSource, getTypicalHoldTimeHours } from './utils/formatters';
import { getBehaviorColor, getQualityColor } from './utils/behavior';

interface Props {
  profiles: HolderProfile[];
  mode: 'token' | 'wallet';
  onSelect?: (profile: HolderProfile) => void;
}

export function MinimalHoldersTable({ profiles, mode, onSelect }: Props) {
  return (
    <div className="rounded-2xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr>
            {mode === 'token' && <th className="text-left px-4 py-2">Rank</th>}
            <th className="text-left px-4 py-2">Wallet</th>
            <th className="text-left px-4 py-2">Behavior</th>
            <th className="text-left px-4 py-2">Exited Hold</th>
            <th className="text-left px-4 py-2">Active + Exited</th>
            <th className="text-left px-4 py-2">Quality</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((profile) => {
            const typicalHold = getTypicalHoldTimeHours(profile);
            const exitedMedian = profile.realizedMedianHoldTimeHours ?? profile.medianHoldTimeHours;
            const exitedAverage = profile.realizedAverageHoldTimeHours ?? profile.avgHoldTimeHours;
            return (
              <tr
                key={profile.walletAddress}
                className={`border-t border-border/60 ${onSelect ? 'cursor-pointer hover:bg-muted/40' : ''}`}
                onClick={onSelect ? () => onSelect(profile) : undefined}
              >
                {mode === 'token' && <td className="px-4 py-2 text-muted-foreground">#{profile.rank}</td>}
                <td className="px-4 py-2 font-mono text-xs">{formatAddress(profile.walletAddress)}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getBehaviorColor(profile.behaviorType)}`}>
                    {profile.behaviorType ?? '🏷️'}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs">
                  <div className="font-semibold text-sm">Median: {formatHoldTime(exitedMedian)}</div>
                  <div className="text-muted-foreground text-[11px]">
                    Average: {formatHoldTime(exitedAverage)}
                  </div>
                </td>
                <td className="px-4 py-2 text-xs">
                  <div className="font-semibold text-sm">Median: {formatHoldTime(typicalHold)}</div>
                  <div className="text-muted-foreground text-[11px]">
                    Average: {formatHoldTime(profile.currentHoldAverageHours ?? typicalHold)}
                  </div>
                  <div className="text-muted-foreground text-[11px]" title="Active + exited mixes current holdings with exited positions">
                    Source: {formatHoldSource(profile.typicalHoldTimeSource)}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getQualityColor(profile.dataQualityTier)}`}>
                    {profile.dataQualityTier}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
