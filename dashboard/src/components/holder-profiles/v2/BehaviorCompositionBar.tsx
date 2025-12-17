import type { HolderProfile } from '../types';
import { getBehaviorBarColor, getBehaviorDescription, getBehaviorMeta } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  profiles: HolderProfile[];
}

export function BehaviorCompositionBar({ profiles }: Props) {
  const valid = profiles.filter((p) => p.behaviorType);
  const counts: Record<string, number> = {};
  valid.forEach((profile) => {
    const key = profile.behaviorType as string;
    counts[key] = (counts[key] || 0) + 1;
  });
  const segments = Object.entries(counts)
    .map(([type, count]) => ({
      type,
      count,
      percentage: Math.round((count / (valid.length || 1)) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  if (!segments.length) {
    return (
      <div className="rounded-lg border p-4 bg-card text-sm text-muted-foreground">No behavior classifications yet.</div>
    );
  }

  return (
    <div className="rounded-lg border p-4 bg-card space-y-3">
      <div className="w-full h-6 rounded-md overflow-hidden flex">
        {segments.map((segment) => {
          const meta = getBehaviorMeta(segment.type);
          const info = getBehaviorDescription(segment.type);
          const label = meta?.label || segment.type;
          return (
            <TooltipProvider key={segment.type} delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={`h-full cursor-help transition-opacity hover:opacity-80 ${getBehaviorBarColor(segment.type)}`}
                    style={{ width: `${segment.percentage}%` }}
                  />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  <p className="font-semibold mb-1">
                    {info?.title || label} — {segment.count} holders ({segment.percentage}%)
                  </p>
                  <p className="text-muted-foreground mb-1">{info?.description || 'Trading behavior classification based on typical hold times.'}</p>
                  <p className="text-primary font-medium">{info?.timeframe || 'Hold time varies'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
        {segments.map((segment) => {
          const meta = getBehaviorMeta(segment.type);
          const label = meta?.label || segment.type;
          return (
            <div key={segment.type} className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${getBehaviorBarColor(segment.type)}`}></span>
              <span className="text-muted-foreground">{label} — {segment.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
