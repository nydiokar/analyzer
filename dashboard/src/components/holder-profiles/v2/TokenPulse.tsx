import type { HolderProfilesResult } from '../types';
import { OutcomeStrip } from './OutcomeStrip';
import { CognitivePrimitivesRow } from './CognitivePrimitivesRow';
import { BehaviorCompositionBar } from './BehaviorCompositionBar';
import { MinimalHoldersTable } from './MinimalHoldersTable';
import { getTokenOutcome } from './utils/outcome-logic';
import { formatAddress } from './utils/formatters';

interface Props {
  result: HolderProfilesResult;
}

export function TokenPulse({ result }: Props) {
  const outcome = getTokenOutcome(result.profiles);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Token Pulse</p>
        <div className="text-sm text-muted-foreground">Token {formatAddress(result.tokenMint)}</div>
      </div>

      <OutcomeStrip {...outcome} badge={`${result.metadata.totalHoldersAnalyzed} holders analyzed`} />

      <CognitivePrimitivesRow profiles={result.profiles} />

      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium mb-2">Behavior composition</p>
          <BehaviorCompositionBar profiles={result.profiles} />
        </div>
        <div>
          <p className="text-sm font-medium mb-2">Supporting evidence</p>
          <MinimalHoldersTable profiles={result.profiles} mode="token" />
        </div>
      </div>
    </section>
  );
}
