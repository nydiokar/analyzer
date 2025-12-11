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
  badge?: string;
}

function getOutcomeTooltip(verdict: string): string {
  const tooltips: Record<string, string> = {
    'High churn, likely short-lived': 'Holders exit within minutes. High risk of volatility.',
    'Mixed behavior, unstable': 'Mix of bot and human activity. Expect volatility.',
    'Still breathing': 'Some conviction remains but momentum is fading.',
    'Relatively stable': 'Holders show patience with longer hold times and low daily flip rates.',
  };
  return tooltips[verdict] || 'Assessment based on holder exit speeds, conviction, and behavior patterns.';
}

export function OutcomeStrip({ verdict, description, color, badge }: OutcomeStripProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-5 bg-gradient-to-br flex flex-col gap-1',
        COLOR_MAP[color]
      )}
    >
      <div className="flex items-center gap-1.5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Outcome</div>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <InfoIcon className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>{getOutcomeTooltip(verdict)}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="text-xl font-semibold">{verdict}</div>
      <p className="text-sm text-muted-foreground">{description}</p>
      {badge && <div className="text-xs font-mono text-muted-foreground">{badge}</div>}
    </div>
  );
}
