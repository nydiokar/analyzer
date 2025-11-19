import { cn } from '@/lib/utils';
import type { CognitivePrimitive } from './utils/cognitive-primitives';

interface Props {
  primitive: CognitivePrimitive;
}

export function CognitiveMetricCard({ primitive }: Props) {
  return (
    <div className="rounded-xl border p-4 bg-card">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{primitive.label}</p>
      <div className="flex items-baseline justify-between mt-2">
        <span className="text-2xl font-semibold tabular-nums">{primitive.value}</span>
        <span className={cn('text-sm font-medium', primitive.color)}>{primitive.category}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{primitive.description}</p>
    </div>
  );
}
