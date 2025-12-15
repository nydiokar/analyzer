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
      <div className="rounded-xl border p-4 text-sm text-muted-foreground">No behavior classifications yet.</div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border p-4">
        <div className="w-full h-8 rounded-md overflow-hidden flex">
          {segments.map((segment) => {
            const meta = getBehaviorMeta(segment.type);
            const info = getBehaviorDescription(segment.type);
            const label = meta?.label || segment.type;
            return (
              <TooltipProvider key={segment.type} delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`h-full text-[10px] uppercase flex items-center justify-center text-white ${getBehaviorBarColor(segment.type)}`}
                      style={{ width: `${segment.percentage}%` }}
                    >
                      <span className="px-2 whitespace-nowrap">
                        {label} ({segment.count})
                      </span>
                    </div>
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
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {segments.map((segment) => {
            const meta = getBehaviorMeta(segment.type);
            const info = getBehaviorDescription(segment.type);
            const label = meta?.label || segment.type;
            return (
              <TooltipProvider key={segment.type} delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 cursor-help">
                      <span className={`h-2 w-2 rounded-full ${getBehaviorBarColor(segment.type)}`}></span>
                      <span>{label} — {segment.count}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    <p className="font-semibold mb-1">{info?.title || label}</p>
                    <p className="text-muted-foreground mb-2">{info?.description || 'Trading behavior classification based on typical hold times.'}</p>
                    <p className="text-xs text-primary font-medium">{info?.timeframe || 'Hold time varies'}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>
      </div>
    </div>
  );
}
