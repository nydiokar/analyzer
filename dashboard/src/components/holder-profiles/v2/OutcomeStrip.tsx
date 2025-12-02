import { cn } from '@/lib/utils';
import type { OutcomeVerdict } from '../v2/utils/outcome-logic';

const COLOR_MAP: Record<OutcomeVerdict['color'], string> = {
  red: 'from-red-500/15 to-red-500/5 text-red-500 border-red-500/20',
  yellow: 'from-amber-500/15 to-amber-500/5 text-amber-600 border-amber-500/20',
  green: 'from-emerald-500/15 to-emerald-500/5 text-emerald-500 border-emerald-500/20',
  blue: 'from-blue-500/15 to-blue-500/5 text-blue-500 border-blue-500/20',
};

interface OutcomeStripProps extends OutcomeVerdict {
  badge?: string;
}

export function OutcomeStrip({ verdict, description, color, badge }: OutcomeStripProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-5 bg-gradient-to-br flex flex-col gap-1',
        COLOR_MAP[color]
      )}
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Outcome</div>
      <div className="text-xl font-semibold">{verdict}</div>
      <p className="text-sm text-muted-foreground">{description}</p>
      {badge && <div className="text-xs font-mono text-muted-foreground">{badge}</div>}
    </div>
  );
}
