import { cn } from '@/lib/utils';
import type { CognitivePrimitive } from './utils/cognitive-primitives';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { InfoIcon } from 'lucide-react';

interface Props {
  primitive: CognitivePrimitive;
}

function getTooltip(primitiveId: string): string {
  const tooltips: Record<string, string> = {
    speed: 'Median hold time across all holders. Shows how long holders typically keep positions before exiting. Faster exits indicate scalping/day trading; longer holds suggest patience and conviction.',
    conviction: 'Conviction score (100% - daily flip rate). Higher % means holders rarely flip tokens within 24 hours, indicating strong conviction. Low scores suggest frequent trading and weak hands.',
    consistency: 'Data quality reliability. Shows the proportion of holders with sufficient exit history (GOLD tier) to make accurate behavioral classifications. "Chaotic" means limited data; "Reliable" means confident analysis.',
  };
  return tooltips[primitiveId] || 'Behavioral metric';
}

function getCategoryTooltip(primitiveId: string, category: string): string {
  if (primitiveId === 'speed') {
    const speedTooltips: Record<string, string> = {
      'Instant': 'Sub-second exits - algorithmic bots',
      'Ultra-fast': 'Sub-minute exits - high-frequency scalpers',
      'Fast': '1-5 min exits - momentum scalpers',
      'Intraday': '30min-6h holds - day traders',
      'Multi-day': '1-7 day holds - swing traders',
      'Long-term': '7+ day holds - patient investors',
    };
    return speedTooltips[category] || 'Hold time classification';
  }
  if (primitiveId === 'conviction') {
    const convictionTooltips: Record<string, string> = {
      'High': '60%+ conviction - holders rarely flip within 24h',
      'Moderate': '30-60% conviction - some same-day flips',
      'Low': '<30% conviction - frequent day trading',
    };
    return convictionTooltips[category] || 'Conviction level';
  }
  if (primitiveId === 'consistency') {
    const qualityTooltips: Record<string, string> = {
      'Reliable': '70%+ have strong exit history - analysis is confident',
      'Moderate': '40-70% have exit data - reasonably reliable',
      'Chaotic': '<40% have clean exits - take with grain of salt',
    };
    return qualityTooltips[category] || 'Data quality classification';
  }
  return category;
}

function getMetricLabel(primitiveId: string): string {
  // Only show metric label for Speed
  return primitiveId === 'speed' ? 'Median hold' : '';
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
