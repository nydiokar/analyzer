import { cn } from '@/lib/utils';
import type { CognitivePrimitive } from './utils/cognitive-primitives';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { InfoIcon } from 'lucide-react';

interface Props {
  primitive: CognitivePrimitive;
}

function getTooltip(primitiveId: string): string {
  const tooltips: Record<string, string> = {
    speed: 'Median hold time across all holders',
    conviction: 'Daily flip ratio - lower % means stronger conviction',
    consistency: 'Percentage of holders with high-quality data (GOLD tier)',
  };
  return tooltips[primitiveId] || 'Behavioral metric';
}

export function CognitiveMetricCard({ primitive }: Props) {
  return (
    <div className="rounded-xl border p-4 bg-card">
      <div className="flex items-center gap-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{primitive.label}</p>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <InfoIcon className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>{getTooltip(primitive.id)}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex items-baseline justify-between mt-2">
        <span className="text-2xl font-semibold tabular-nums">{primitive.value}</span>
        <span className={cn('text-sm font-medium', primitive.color)}>{primitive.category}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{primitive.description}</p>
    </div>
  );
}
