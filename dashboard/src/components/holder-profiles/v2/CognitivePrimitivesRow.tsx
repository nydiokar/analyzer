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
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {primitives.map((primitive) => (
        <CognitiveMetricCard key={primitive.id} primitive={primitive} />
      ))}
    </div>
  );
}
