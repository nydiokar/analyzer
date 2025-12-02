import type { HolderProfile } from '../types';
import { getBehaviorBarColor } from './utils/behavior';

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
          {segments.map((segment) => (
            <div
              key={segment.type}
              className={`h-full text-[10px] uppercase flex items-center justify-center text-white ${getBehaviorBarColor(segment.type)}`}
              style={{ width: `${segment.percentage}%` }}
            >
              <span className="px-2 whitespace-nowrap">
                {segment.type} ({segment.count})
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {segments.map((segment) => (
            <div key={segment.type} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${getBehaviorBarColor(segment.type)}`}></span>
              {segment.type} — {segment.count}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
