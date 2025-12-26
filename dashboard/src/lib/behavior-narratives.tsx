/**
 * Behavior Narrative Templates
 *
 * Transforms raw wallet metrics into human-readable storytelling for the Discover page.
 * Each category includes:
 * - Category label (human-friendly name)
 * - Range bounds (so users understand the scale)
 * - Interpretation narrative (emphasizing numbers for scanning)
 */

import React from 'react';
import { SpeedCategory, FlowPattern } from '@/types/api';

// ============================================================================
// HELPER: Emphasized number component (bright/colored for scanning)
// ============================================================================

export const Num = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <span className={`font-semibold text-foreground ${className}`}>{children}</span>
);

// ============================================================================
// SPEED CATEGORY NARRATIVES
// ============================================================================

interface SpeedNarrative {
  label: string;
  range: string;
  buildStory: (data: {
    medianHoldHours?: number | null;
    avgHoldHours?: number | null;
    currentHoldHours?: number | null;
    valueHeldPct?: number | null;
    velocityScore?: number | null; // 0-100 velocity score
  }) => React.ReactNode;
}

const speedNarratives: Record<SpeedCategory, SpeedNarrative> = {
  SNIPER: {
    label: 'Sniper',
    range: '<1min',
    buildStory: ({ medianHoldHours, avgHoldHours, currentHoldHours, valueHeldPct, velocityScore }) => (
      <>
        Lightning-fast exits within seconds (median: <Num>{formatHours(medianHoldHours)}</Num>
        {avgHoldHours && avgHoldHours !== medianHoldHours && <>, avg: <Num>{formatHours(avgHoldHours)}</Num></>}).
        {velocityScore && velocityScore >= 80 ? (
          <> Extreme velocity (<Num>{Math.round(velocityScore)}</Num>) - pure bot/MEV speed.</>
        ) : (
          <> This is pure bot/MEV speed.</>
        )}
        {currentHoldHours && valueHeldPct ? (
          <> Currently holds <Num>{valueHeldPct}%</Num> of value (<Num>{formatHours(currentHoldHours)}</Num> old).</>
        ) : (
          <> Likely all positions already flipped.</>
        )}
      </>
    ),
  },
  SCALPER: {
    label: 'Scalper',
    range: '1-5min',
    buildStory: ({ medianHoldHours, avgHoldHours, currentHoldHours, valueHeldPct, velocityScore }) => (
      <>
        Ultra-fast scalping - exits within minutes (median: <Num>{formatHours(medianHoldHours)}</Num>
        {avgHoldHours && avgHoldHours !== medianHoldHours && <>, avg: <Num>{formatHours(avgHoldHours)}</Num></>}).
        {velocityScore && velocityScore >= 75 && <> High velocity (<Num>{Math.round(velocityScore)}</Num>).</>}
        {currentHoldHours && valueHeldPct ? (
          <> Currently sitting on <Num>{valueHeldPct}%</Num> of portfolio (<Num>{formatHours(currentHoldHours)}</Num> old).</>
        ) : (
          <> High turnover, minimal holding.</>
        )}
      </>
    ),
  },
  MOMENTUM: {
    label: 'Momentum',
    range: '5-30min',
    buildStory: ({ medianHoldHours, avgHoldHours, currentHoldHours, valueHeldPct, velocityScore }) => (
      <>
        Momentum trading - rides short-term moves (median: <Num>{formatHours(medianHoldHours)}</Num>
        {avgHoldHours && avgHoldHours !== medianHoldHours && <>, avg: <Num>{formatHours(avgHoldHours)}</Num></>}).
        {velocityScore && velocityScore >= 65 && <> Strong velocity (<Num>{Math.round(velocityScore)}</Num>).</>}
        {currentHoldHours && valueHeldPct ? (
          <> Currently holds <Num>{valueHeldPct}%</Num> of value (<Num>{formatHours(currentHoldHours)}</Num> old).</>
        ) : (
          <> Fast in, fast out.</>
        )}
      </>
    ),
  },
  INTRADAY: {
    label: 'Intraday',
    range: '30min-4h',
    buildStory: ({ medianHoldHours, avgHoldHours, currentHoldHours, valueHeldPct }) => (
      <>
        Holds positions for hours, not days - typical exit at <Num>{formatHours(medianHoldHours)}</Num> (median)
        {avgHoldHours && avgHoldHours !== medianHoldHours && <>, though some stretch to <Num>{formatHours(avgHoldHours)}</Num> average</>}.
        {currentHoldHours && valueHeldPct ? (
          <> Currently sitting on <Num>{valueHeldPct}%</Num> of portfolio value (<Num>{formatHours(currentHoldHours)}</Num> old).</>
        ) : null}
      </>
    ),
  },
  DAY_TRADER: {
    label: 'Day Trader',
    range: '4-24h',
    buildStory: ({ medianHoldHours, avgHoldHours, currentHoldHours, valueHeldPct }) => (
      <>
        Same-day trading - exits within <Num>24 hours</Num> (median: <Num>{formatHours(medianHoldHours)}</Num>
        {avgHoldHours && avgHoldHours !== medianHoldHours && <>, avg: <Num>{formatHours(avgHoldHours)}</Num></>}).
        {currentHoldHours && valueHeldPct ? (
          <> Current exposure: <Num>{valueHeldPct}%</Num> held for <Num>{formatHours(currentHoldHours)}</Num>.</>
        ) : null}
      </>
    ),
  },
  SWING: {
    label: 'Swing Trader',
    range: '1-7 days',
    buildStory: ({ medianHoldHours, avgHoldHours, currentHoldHours, valueHeldPct }) => (
      <>
        Patience over speed - exits typically after <Num>{formatHours(medianHoldHours)}</Num> of holding
        {avgHoldHours && avgHoldHours !== medianHoldHours && <>, with outliers averaging <Num>{formatHours(avgHoldHours)}</Num></>}.
        {currentHoldHours && valueHeldPct ? (
          <> Current portfolio: <Num>{valueHeldPct}%</Num> still in play after <Num>{formatHours(currentHoldHours)}</Num>.</>
        ) : null}
      </>
    ),
  },
  POSITION: {
    label: 'Position Trader',
    range: '7-30 days',
    buildStory: ({ medianHoldHours, avgHoldHours, currentHoldHours, valueHeldPct }) => (
      <>
        Strategic long-term positions - holds for weeks before exiting (median: <Num>{formatHours(medianHoldHours)}</Num>
        {avgHoldHours && avgHoldHours !== medianHoldHours && <>, avg: <Num>{formatHours(avgHoldHours)}</Num></>}).
        {currentHoldHours && valueHeldPct ? (
          <> Currently holding <Num>{valueHeldPct}%</Num> of value (<Num>{formatHours(currentHoldHours)}</Num> old).</>
        ) : null}
      </>
    ),
  },
  HODLER: {
    label: 'HODLER',
    range: '30+ days',
    buildStory: ({ medianHoldHours, avgHoldHours, currentHoldHours, valueHeldPct }) => (
      <>
        Long-term conviction - holds for <Num>months</Num> before considering exits (median: <Num>{formatHours(medianHoldHours)}</Num>
        {avgHoldHours && avgHoldHours !== medianHoldHours && <>, avg: <Num>{formatHours(avgHoldHours)}</Num></>}).
        {currentHoldHours && valueHeldPct ? (
          <> Currently <Num>{valueHeldPct}%</Num> in active positions (<Num>{formatHours(currentHoldHours)}</Num> old).</>
        ) : null}
      </>
    ),
  },
};

// ============================================================================
// FLOW PATTERN NARRATIVES
// ============================================================================

interface FlowNarrative {
  label: string;
  buildStory: (data: {
    totalBuys?: number | null;
    totalSells?: number | null;
    buySellRatio?: number | null;
    buySellSymmetry?: number | null;
    sequenceConsistency?: number | null;
    exitPattern?: string | null;
    unrealizedPnl?: number | null;
    uniqueTokensTraded?: number | null;
    valueHeldPct?: number | null; // NEW: % of value in current holdings
    currentHoldHours?: number | null; // NEW: Median current holding duration
    avgCurrentHoldHours?: number | null; // NEW: Average current holding duration
  }) => React.ReactNode;
}

const flowNarratives: Record<FlowPattern, FlowNarrative> = {
  BUY_ONLY: {
    label: 'Buy-Only',
    buildStory: ({ totalBuys, unrealizedPnl, uniqueTokensTraded, valueHeldPct }) => {
      // Only show % of portfolio if it's < 100% (otherwise it's obvious for buy-only)
      const showPortfolioPct = valueHeldPct && valueHeldPct < 100;

      return (
        <>
          Only buying, never selling - <Num>{totalBuys}↑</Num> entry transaction{totalBuys !== 1 ? 's' : ''} recorded.
          {showPortfolioPct && <> <Num>{valueHeldPct}%</Num> of portfolio still held (some tokens may have been transferred out).</>}
          {unrealizedPnl !== null && unrealizedPnl !== undefined ? (
            <> Currently sitting on <Num className={unrealizedPnl >= 0 ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}>
              {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(1)} SOL
            </Num> unrealized ({unrealizedPnl >= 0 ? 'profit' : 'loss'}). High conviction accumulation strategy.</>
          ) : (
            <> Pure accumulation mode - no exit strategy observed yet.</>
          )}
        </>
      );
    },
  },
  SELL_ONLY: {
    label: 'Sell-Only',
    buildStory: ({ totalSells }) => (
      <>
        Only sell transactions observed - pure distribution phase (<Num>0↑/{totalSells}↓</Num>).
        Likely exiting accumulated positions or portfolio wind-down.
      </>
    ),
  },
  ACCUMULATOR: {
    label: 'Accumulator',
    buildStory: ({ totalBuys, totalSells, buySellRatio, buySellSymmetry, sequenceConsistency, exitPattern, uniqueTokensTraded, valueHeldPct }) => {
      // Only show % of portfolio if meaningful (not 100%, or if low symmetry suggesting exits)
      const showPortfolioPct = valueHeldPct && (valueHeldPct < 95 || (buySellSymmetry !== null && buySellSymmetry !== undefined && buySellSymmetry > 0.3));

      return (
        <>
          Strong buying pressure - <Num>{buySellRatio?.toFixed(1)}×</Num> more entries than exits
          {uniqueTokensTraded ? <> across <Num>{uniqueTokensTraded}</Num> token{uniqueTokensTraded !== 1 ? 's' : ''}</> : null}.
          {showPortfolioPct && <> <Num>{valueHeldPct}%</Num> of value still in wallet.</>}
          {buySellSymmetry !== null && buySellSymmetry !== undefined ? (
            buySellSymmetry < 0.3 ? (
              <> Rarely sells (symmetry: <Num>{buySellSymmetry.toFixed(2)}</Num>) - classic accumulation behavior.</>
            ) : buySellSymmetry < 0.6 ? (
              <> Some exits observed (symmetry: <Num>{buySellSymmetry.toFixed(2)}</Num>), but net accumulation dominates.</>
            ) : (
              <> Surprisingly balanced activity (symmetry: <Num>{buySellSymmetry.toFixed(2)}</Num>) despite buy bias - strategic accumulation with selective exits.</>
            )
          ) : (
            <> Net accumulation pattern observed.</>
          )}
          {sequenceConsistency !== null && sequenceConsistency !== undefined && sequenceConsistency >= 0.9 && (
            <> Very systematic approach.</>
          )}
          {exitPattern && <> Exits are <Num>{exitPattern.toLowerCase().replace('_', ' ')}</Num>.</>}
        </>
      );
    },
  },
  DISTRIBUTOR: {
    label: 'Distributor',
    buildStory: ({ totalBuys, totalSells, buySellRatio, exitPattern, uniqueTokensTraded }) => {
      const sellRatio = buySellRatio ? (1 / buySellRatio).toFixed(1) : '—';

      return (
        <>
          Strong distribution phase - <Num>{sellRatio}×</Num> more exits than entries
          {uniqueTokensTraded ? <> across <Num>{uniqueTokensTraded}</Num> token{uniqueTokensTraded !== 1 ? 's' : ''}</> : null}.
          {exitPattern && <> Exits are <Num>{exitPattern.toLowerCase().replace('_', ' ')}</Num>.</>}
          {!exitPattern && <> Likely taking profits or unwinding accumulated positions.</>}
        </>
      );
    },
  },
  BALANCED: {
    label: 'Balanced Trader',
    buildStory: ({ totalBuys, totalSells, buySellSymmetry, sequenceConsistency, exitPattern, uniqueTokensTraded }) => {
      return (
        <>
          Equal buy/sell activity - balanced in/out flow
          {uniqueTokensTraded ? <> across <Num>{uniqueTokensTraded}</Num> token{uniqueTokensTraded !== 1 ? 's' : ''}</> : null}.
          {buySellSymmetry !== null && buySellSymmetry !== undefined && buySellSymmetry >= 0.7 ? (
            <>
              {' '}High symmetry (<Num>{buySellSymmetry.toFixed(2)}</Num>) indicates disciplined trading.
              {sequenceConsistency !== null && sequenceConsistency !== undefined && sequenceConsistency >= 0.9 && (
                <> Very systematic execution.</>
              )}
            </>
          ) : buySellSymmetry !== null && buySellSymmetry !== undefined ? (
            <> Moderate symmetry (<Num>{buySellSymmetry.toFixed(2)}</Num>) - some irregularity in trade patterns.</>
          ) : null}
          {exitPattern && (
            <> Exits are <Num>{exitPattern.toLowerCase().replace('_', ' ')}</Num>.</>
          )}
        </>
      );
    },
  },
  MIXED: {
    label: 'Mixed Activity',
    buildStory: ({ totalBuys, totalSells, buySellRatio, buySellSymmetry, sequenceConsistency, uniqueTokensTraded }) => (
      <>
        Chaotic pattern - balanced counts (<Num>{totalBuys}↑/{totalSells}↓</Num>
        {uniqueTokensTraded ? <> across <Num>{uniqueTokensTraded}</Num> token{uniqueTokensTraded !== 1 ? 's' : ''}</> : null}, ratio: <Num>{buySellRatio?.toFixed(2) || '—'}</Num>)
        {buySellSymmetry !== null && buySellSymmetry !== undefined && (
          <> but low symmetry (<Num>{buySellSymmetry.toFixed(2)}</Num>)</>
        )}.
        {sequenceConsistency !== null && sequenceConsistency !== undefined && sequenceConsistency < 0.4 ? (
          <> Erratic pattern suggests reactive, not systematic approach.</>
        ) : (
          <> Suggests reactive trading rather than systematic strategy.</>
        )}
      </>
    ),
  },
};

// ============================================================================
// SPECIAL CASE: No SpeedCategory (Pure Holders Without Exits)
// ============================================================================

export function buildNoExitsNarrative(data: {
  totalBuys?: number | null;
  totalSells?: number | null;
  unrealizedPnl?: number | null;
  reasonCode?: string;
  currentHoldHours?: number | null;
  valueHeldPct?: number | null;
  uniqueTokensTraded?: number | null;
}): { label: string; range: string; story: React.ReactNode } {
  const { totalBuys, totalSells, unrealizedPnl, reasonCode, currentHoldHours, valueHeldPct, uniqueTokensTraded } = data;

  const label = reasonCode === 'ACCUMULATOR' ? 'Accumulator' : 'No Exits';
  const range = 'N/A';

  // SPEED: Focus on TIMING of current holdings (how long held, % of value)
  const story = (
    <>
      {currentHoldHours !== null && currentHoldHours !== undefined ? (
        <>
          Holding
          {uniqueTokensTraded ? <> <Num>{uniqueTokensTraded}</Num> token{uniqueTokensTraded !== 1 ? 's' : ''}</> : <> positions</>} for <Num>{formatHours(currentHoldHours)}</Num> (median)
          {valueHeldPct ? <>, representing <Num>{valueHeldPct}%</Num> of portfolio value</> : null}.
          No exits recorded yet.
        </>
      ) : (
        <>
          {uniqueTokensTraded ? (
            <>Holding <Num>{uniqueTokensTraded}</Num> token{uniqueTokensTraded !== 1 ? 's' : ''}</>
          ) : (
            <>Holding positions</>
          )}
          {valueHeldPct ? <> representing <Num>{valueHeldPct}%</Num> of portfolio value</> : null}.
          {totalBuys ? <> <Num>{totalBuys}↑</Num> buy transaction{totalBuys !== 1 ? 's' : ''} observed</> : <> Buy activity observed</>}, no exits yet.
        </>
      )}
    </>
  );

  return { label, range, story };
}

// Helper function for formatting hours (moved from bottom of file for clarity)
function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';

  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes}m`;
  }
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }
  if (hours < 168) { // < 7 days
    const days = (hours / 24).toFixed(1);
    return `${days}d`;
  }
  if (hours < 720) { // < 30 days
    const days = Math.round(hours / 24);
    return `${days}d`;
  }
  // 30+ days
  const months = (hours / 720).toFixed(1);
  return `${months}mo`;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function buildSpeedNarrative(
  speedCategory: SpeedCategory | null | undefined,
  data: {
    medianHoldHours?: number | null;
    avgHoldHours?: number | null;
    currentHoldHours?: number | null;
    valueHeldPct?: number | null;
    totalBuys?: number | null;
    totalSells?: number | null;
    unrealizedPnl?: number | null;
    reasonCode?: string;
    uniqueTokensTraded?: number | null;
    velocityScore?: number | null; // 0-100 velocity score
  }
): { label: string; range: string; story: React.ReactNode } {
  if (!speedCategory) {
    return buildNoExitsNarrative(data);
  }

  const narrative = speedNarratives[speedCategory];
  return {
    label: narrative.label,
    range: narrative.range,
    story: narrative.buildStory(data),
  };
}

export function buildFlowNarrative(
  flowPattern: FlowPattern | null | undefined,
  data: {
    totalBuys?: number | null;
    totalSells?: number | null;
    buySellRatio?: number | null;
    buySellSymmetry?: number | null;
    sequenceConsistency?: number | null;
    exitPattern?: string | null;
    unrealizedPnl?: number | null;
    uniqueTokensTraded?: number | null;
    // NEW: Current holdings context (for accumulation/distribution patterns)
    valueHeldPct?: number | null;
    currentHoldHours?: number | null;
    avgCurrentHoldHours?: number | null;
  }
): { label: string; story: React.ReactNode } | null {
  if (!flowPattern) return null;

  const narrative = flowNarratives[flowPattern];
  return {
    label: narrative.label,
    story: narrative.buildStory(data),
  };
}

// NOTE: formatHours() moved up to be near buildNoExitsNarrative() for better organization
