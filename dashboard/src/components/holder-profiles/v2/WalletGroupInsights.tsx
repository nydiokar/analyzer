import type { HolderProfile } from '../types';
import { buildWalletGroupInsights } from './utils/group-insights';

interface Props {
  profiles: HolderProfile[];
}

export function WalletGroupInsights({ profiles }: Props) {
  const insights = buildWalletGroupInsights(profiles);
  if (!insights.length) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {insights.map((insight) => (
        <div key={insight.label} className="rounded-lg border bg-card/80 px-3 py-2 flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{insight.label}</span>
            <span className={`h-1.5 w-1.5 rounded-full ${insight.accentClass ?? 'bg-muted-foreground/40'}`} />
          </div>
          <p className={`text-base font-semibold ${insight.textClass ?? 'text-foreground'}`}>
            {insight.value}
          </p>
          <p className="text-[11px] text-muted-foreground">{insight.description}</p>
        </div>
      ))}
    </div>
  );
}
