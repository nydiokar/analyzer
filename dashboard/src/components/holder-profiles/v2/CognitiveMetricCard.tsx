import { cn } from '@/lib/utils';
import type { CognitivePrimitive } from './utils/cognitive-primitives';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { InfoIcon } from 'lucide-react';

interface Props {
  primitive: CognitivePrimitive;
}

function getTooltip(primitiveId: string): string {
  const tooltips: Record<string, string> = {
    speed: "Median of holders' realized exits.",
    conviction: 'Conviction = 100% - daily flip rate.',
    consistency: 'Share of holders with 30+ exits used in classification.',
    quality: 'Holders with 10+ exited tokens / total.',
    similarity: '% of classified holders sharing the dominant behavior type. High = a meaningful cluster exists worth investigating.',
    fresh: 'Token supply % held by wallets with no exit history yet.',
  };
  return tooltips[primitiveId] || 'Behavioral metric';
}

function getCategoryTooltip(primitiveId: string, category: string): string {
  if (primitiveId === 'speed') {
    const speedTooltips: Record<string, string> = {
      'Instant': 'Exits <1s.',
      'Ultra-fast': 'Exits <1 min.',
      'Fast': 'Exits 1-5 min.',
      'Intraday': 'Holds 30 min-6 h.',
      'Multi-day': 'Holds 1-7 d.',
      'Long-term': 'Holds >=7 d.',
    };
    return speedTooltips[category] || 'Hold time classification';
  }
  if (primitiveId === 'conviction') {
    const convictionTooltips: Record<string, string> = {
      'High': 'Conviction >=60%.',
      'Moderate': 'Conviction 30-60%.',
      'Low': 'Conviction <30%.',
    };
    return convictionTooltips[category] || 'Conviction level';
  }
  if (primitiveId === 'consistency') {
    const qualityTooltips: Record<string, string> = {
      'Consistent': 'Quality data >=70%.',
      'Moderate': 'Quality data 40-70%.',
      'Chaotic': 'Quality data <40%.',
    };
    return qualityTooltips[category] || 'Data quality classification';
  }
  if (primitiveId === 'quality') {
    return 'Usually low trust in the data.';
  }
  if (primitiveId === 'similarity') {
    return 'Dispersed <15%, Weak cluster 15-34%, Notable cluster 35-59%, Strong cluster >=60%.';
  }
  return category;
}

function getMetricLabel(primitiveId: string): string {
  // Only show metric label for Speed
  return primitiveId === 'speed' ? 'Median exit' : '';
}

export function CognitiveMetricCard({ primitive }: Props) {
  const metricLabel = getMetricLabel(primitive.id);

  return (
    <div className="rounded-lg border p-3 bg-card flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{primitive.label}</p>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <InfoIcon className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-sm text-xs">
              <p>{getTooltip(primitive.id)}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-xl font-semibold tabular-nums leading-none">{primitive.value}</span>
        {metricLabel && (
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{metricLabel}</span>
        )}
      </div>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn('text-xs font-medium mt-0.5 cursor-help w-fit', primitive.color)}>
              {primitive.category}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">
            <p>{getCategoryTooltip(primitive.id, primitive.category)}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
