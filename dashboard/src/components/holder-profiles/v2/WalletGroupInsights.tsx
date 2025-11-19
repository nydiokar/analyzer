import type { HolderProfile } from '../types';
import { buildWalletGroupInsights } from './utils/group-insights';

interface Props {
  profiles: HolderProfile[];
}

export function WalletGroupInsights({ profiles }: Props) {
  const insights = buildWalletGroupInsights(profiles);
  if (!insights.length) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {insights.map((insight) => (
        <div key={insight.label} className={`rounded-xl border p-3 ${insight.color}`}>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{insight.label}</p>
          <p className="text-lg font-semibold">{insight.value}</p>
          <p className="text-xs text-muted-foreground">{insight.description}</p>
        </div>
      ))}
    </div>
  );
}
