import type { HolderProfile } from '../types';
import { buildWalletGroupInsights } from './utils/group-insights';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  profiles: HolderProfile[];
}

export function WalletGroupInsights({ profiles }: Props) {
  const insights = buildWalletGroupInsights(profiles);
  if (!insights.length) return null;
  const tooltipCopy: Record<string, string> = {
    'Dominant behavior': 'Most common behavior type among analysed wallets.',
    'Fastest exit': 'Wallet with the shortest active + exited median hold.',
    'Highest conviction': 'Wallet with the lowest flip ratio across completed trades.',
    'Data warning': 'Wallet with the weakest data quality tier in this cohort.',
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {insights.map((insight) => (
        <TooltipProvider key={insight.label} delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="rounded-lg border bg-card/80 px-3 py-2 flex flex-col gap-1 cursor-help">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span>{insight.label}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${insight.accentClass ?? 'bg-muted-foreground/40'}`} />
                </div>
                <p className={`text-base font-semibold ${insight.textClass ?? 'text-foreground'}`}>
                  {insight.value}
                </p>
                <p className="text-[11px] text-muted-foreground">{insight.description}</p>
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              {tooltipCopy[insight.label] ?? 'Snapshot summary for analysed wallets.'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}
