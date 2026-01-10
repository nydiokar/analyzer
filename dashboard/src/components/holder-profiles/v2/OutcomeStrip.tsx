import { cn } from '@/lib/utils';
import type { OutcomeVerdict } from '../v2/utils/outcome-logic';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { InfoIcon } from 'lucide-react';

const COLOR_MAP: Record<OutcomeVerdict['color'], string> = {
  red: 'from-red-500/15 to-red-500/5 text-red-500 border-red-500/20',
  yellow: 'from-amber-500/15 to-amber-500/5 text-amber-600 border-amber-500/20',
  green: 'from-emerald-500/15 to-emerald-500/5 text-emerald-500 border-emerald-500/20',
  blue: 'from-blue-500/15 to-blue-500/5 text-blue-500 border-blue-500/20',
};

interface OutcomeStripProps extends OutcomeVerdict {
  holdersCount?: number;
  compact?: boolean;
}

function getOutcomeTooltip(verdict: string): string {
  const tooltips: Record<string, string> = {
    'High churn, likely short-lived': 'Holders exit very quickly, typically within minutes. High risk of rapid price volatility.',
    'Mixed behavior, unstable': 'Holders show varying exit patterns - some quick, some patient. Unpredictable price action expected.',
    'Still breathing': 'Some holders maintain positions for days, but overall conviction appears moderate. Watch for momentum shifts.',
    'Relatively stable': 'Holders tend to maintain positions for extended periods with low turnover, suggesting conviction and patience.',
  };
  return tooltips[verdict] || 'Assessment based on holder exit speeds and conviction patterns.';
}

export function OutcomeStrip({ verdict, description, color, holdersCount, compact = false }: OutcomeStripProps) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-gradient-to-br flex flex-col gap-2 h-full',
        compact ? 'p-3' : 'p-4',
        COLOR_MAP[color]
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Outcome</div>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-md text-xs">
                <p className="font-semibold mb-1">How is this determined?</p>
                <p className="text-muted-foreground">{getOutcomeTooltip(verdict)}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {holdersCount !== undefined && (
          <div className="text-xs font-medium text-muted-foreground">
            {holdersCount} holder{holdersCount !== 1 ? 's' : ''}
          </div>
        )}
      </div>
      <div className={cn('font-semibold leading-tight', compact ? 'text-base' : 'text-lg')}>{verdict}</div>
      {!compact && (
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      )}
    </div>
  );
}
