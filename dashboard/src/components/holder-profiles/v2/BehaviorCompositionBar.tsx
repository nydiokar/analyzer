import type { HolderProfile } from '../types';
import { getBehaviorBarColor } from './utils/behavior';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  profiles: HolderProfile[];
}

function getBehaviorDescription(type: string): { title: string; description: string; timeframe: string } {
  const descriptions: Record<string, { title: string; description: string; timeframe: string }> = {
    SNIPER: {
      title: 'Sniper',
      description: 'Lightning-fast traders who target specific price points with precision timing. Often algorithmic or bot-driven.',
      timeframe: 'Hold time: < 1 second'
    },
    SCALPER: {
      title: 'Scalper',
      description: 'High-frequency traders capturing small price movements. Execute many trades per day for incremental gains.',
      timeframe: 'Hold time: < 1 minute'
    },
    MOMENTUM: {
      title: 'Momentum Trader',
      description: 'Traders who ride short-term price trends and momentum. Enter on strength and exit when momentum fades.',
      timeframe: 'Hold time: 5-30 minutes'
    },
    INTRADAY: {
      title: 'Intraday Trader',
      description: 'Full-session traders who analyze price action throughout the day. Hold positions for several hours but close before day end.',
      timeframe: 'Hold time: 30 minutes - 4 hours'
    },
    DAY_TRADER: {
      title: 'Day Trader',
      description: 'Traders who complete their positions within 24 hours. May hold overnight but typically close within a day.',
      timeframe: 'Hold time: 4-24 hours'
    },
    SWING: {
      title: 'Swing Trader',
      description: 'Medium-term traders who capitalize on multi-day price swings. Hold through minor fluctuations to capture larger moves.',
      timeframe: 'Hold time: 1-7 days'
    },
    POSITION: {
      title: 'Position Trader',
      description: 'Patient traders who take long-term positions based on fundamental analysis. Willing to hold through volatility.',
      timeframe: 'Hold time: 7+ days'
    },
    HOLDER: {
      title: 'Holder',
      description: 'Long-term investors with strong conviction. Hold assets for extended periods regardless of short-term price action.',
      timeframe: 'Hold time: Extended (weeks to months)'
    },
  };
  return descriptions[type] || {
    title: type,
    description: 'Trading behavior classification based on typical hold times',
    timeframe: 'Various timeframes'
  };
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
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="w-full h-8 rounded-md overflow-hidden flex cursor-help">
                {segments.map((segment) => {
                  const info = getBehaviorDescription(segment.type);
                  return (
                    <div
                      key={segment.type}
                      className={`h-full text-[10px] uppercase flex items-center justify-center text-white ${getBehaviorBarColor(segment.type)}`}
                      style={{ width: `${segment.percentage}%` }}
                      title={`${info.title}: ${segment.count} holders (${segment.percentage}%)`}
                    >
                      <span className="px-2 whitespace-nowrap">
                        {segment.type} ({segment.count})
                      </span>
                    </div>
                  );
                })}
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm text-xs">
              <p className="font-semibold mb-1">Behavior Composition</p>
              <p className="text-muted-foreground">
                This chart shows the distribution of trading behaviors among token holders.
                Each segment represents the proportion of holders classified by their typical hold times.
                Hover over individual segments below for detailed descriptions.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {segments.map((segment) => {
            const info = getBehaviorDescription(segment.type);
            return (
              <TooltipProvider key={segment.type} delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 cursor-help">
                      <span className={`h-2 w-2 rounded-full ${getBehaviorBarColor(segment.type)}`}></span>
                      <span>{segment.type} — {segment.count}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    <p className="font-semibold mb-1">{info.title}</p>
                    <p className="text-muted-foreground mb-2">{info.description}</p>
                    <p className="text-xs text-primary font-medium">{info.timeframe}</p>
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
