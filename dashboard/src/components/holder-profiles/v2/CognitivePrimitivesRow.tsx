import type { HolderProfile } from '../types';
import { CognitiveMetricCard } from './CognitiveMetricCard';
import { getCognitivePrimitives } from './utils/cognitive-primitives';

interface Props {
  profiles: HolderProfile[];
}

export function CognitivePrimitivesRow({ profiles }: Props) {
  const primitives = getCognitivePrimitives(profiles);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {primitives.map((primitive) => (
        <CognitiveMetricCard key={primitive.id} primitive={primitive} />
      ))}
    </div>
  );
}
