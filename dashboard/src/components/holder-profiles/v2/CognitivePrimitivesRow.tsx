import type { HolderProfile } from '../../holder-profiles/types';
import { CognitiveMetricCard } from './CognitiveMetricCard';
import { getCognitivePrimitives } from './utils/cognitive-primitives';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  profiles: HolderProfile[];
  showHeader?: boolean;
}

export function CognitivePrimitivesRow({ profiles, showHeader = false }: Props) {
  const primitives = getCognitivePrimitives(profiles);
  return (
    <div className="space-y-3">
      {showHeader && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="text-sm font-medium cursor-help w-fit">Cognitive Primitives</p>
            </TooltipTrigger>
            <TooltipContent className="max-w-md text-xs">
              <p className="font-semibold mb-1">Cognitive Primitives</p>
              <p className="text-muted-foreground mb-2">
                Three core behavioral metrics that characterize holder trading patterns:
              </p>
              <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                <li><strong>Speed:</strong> How quickly holders typically exit positions</li>
                <li><strong>Conviction:</strong> How often holders flip tokens within a day</li>
                <li><strong>Consistency:</strong> Quality and reliability of the data</li>
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {primitives.map((primitive) => (
          <CognitiveMetricCard key={primitive.id} primitive={primitive} />
        ))}
      </div>
    </div>
  );
}
