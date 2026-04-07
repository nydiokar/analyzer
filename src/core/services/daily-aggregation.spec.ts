/**
 * Unit tests for DailyAggregationService — FIFO sell attribution logic.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register src/core/services/daily-aggregation.spec.ts
 *
 * No DB, no network. Tests the internal FIFO attribution in isolation by
 * exercising the logic extracted into a testable helper below.
 */

// ---------------------------------------------------------------------------
// Inline copy of attributeSellsByDay for isolated testing (no DB imports)
// ---------------------------------------------------------------------------

interface TestSwap {
  timestamp: number;
  signature: string;
  mint: string;
  direction: 'in' | 'out';
  amount: number;
  associatedSolValue: number;
  associatedUsdcValue?: number | null;
  feeAmount?: number | null;
  usdValue?: number | null;
}

interface SellEvent {
  date: string;
  realizedPnlSol: number;
  isProfitable: boolean;
}

const VALUE_EPSILON = 1e-9;
const PERCENTAGE_TOLERANCE = 0.001;
const MIN_TOLERANCE = 0.001;
const MAX_TOLERANCE = 100;
const LOT_FINDING_TOLERANCE = 0.001;

function toUtcDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function attributeSellsByDay(inputs: TestSwap[]): {
  sellEvents: SellEvent[];
  hasIncompleteHistory: boolean;
} {
  const sellEvents: SellEvent[] = [];
  let hasIncompleteHistory = false;

  const ordered = [...inputs].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if (a.signature !== b.signature) return a.signature.localeCompare(b.signature);
    if (a.direction === b.direction) return 0;
    return a.direction === 'in' ? -1 : 1;
  });

  const lots: { amountBought: number; costBasisSol: number; amountRemaining: number }[] = [];

  for (const input of ordered) {
    const normalizedAmount = Math.abs(input.amount);
    const baseSolValue = Math.abs(input.associatedSolValue);
    const effectiveSolValue = baseSolValue > VALUE_EPSILON ? baseSolValue : 0;

    if (input.direction === 'in') {
      lots.push({ amountBought: normalizedAmount, costBasisSol: effectiveSolValue, amountRemaining: normalizedAmount });
      continue;
    }

    let remainingToSell = normalizedAmount;
    const unitProceeds = normalizedAmount > 0 ? effectiveSolValue / normalizedAmount : 0;
    const completionTolerance = Math.min(Math.max(normalizedAmount * PERCENTAGE_TOLERANCE, MIN_TOLERANCE), MAX_TOLERANCE);

    let realizedCostBasis = 0;
    let proceeds = 0;

    while (remainingToSell > completionTolerance) {
      const nextLot = lots.find(lot => lot.amountRemaining > LOT_FINDING_TOLERANCE);
      if (!nextLot) { hasIncompleteHistory = true; remainingToSell = 0; break; }
      const unitCost = nextLot.amountBought > 0 ? nextLot.costBasisSol / nextLot.amountBought : 0;
      const consumed = Math.min(remainingToSell, nextLot.amountRemaining);
      proceeds += consumed * unitProceeds;
      realizedCostBasis += consumed * unitCost;
      nextLot.amountRemaining -= consumed;
      remainingToSell -= consumed;
    }

    const pnl = proceeds - realizedCostBasis;
    sellEvents.push({ date: toUtcDate(input.timestamp), realizedPnlSol: pnl, isProfitable: pnl > 0 });
  }

  return { sellEvents, hasIncompleteHistory };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function approxEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) < epsilon;
}

// Day 1 = 2026-01-01 00:00:00 UTC = 1735689600
const DAY1 = 1735689600;
const DAY8 = DAY1 + 7 * 86400;
const DAY15 = DAY1 + 14 * 86400;

// ---------------------------------------------------------------------------
// Test 1: Buy on day 1, sell on day 8 — PnL attributed to day 8
// ---------------------------------------------------------------------------
console.log('\nTest 1: Cross-day position — buy day 1, sell day 8');
{
  const swaps: TestSwap[] = [
    { timestamp: DAY1, signature: 'sig1', mint: 'MINT_A', direction: 'in',  amount: 100, associatedSolValue: 5 },
    { timestamp: DAY8, signature: 'sig2', mint: 'MINT_A', direction: 'out', amount: 100, associatedSolValue: 8 },
  ];
  const { sellEvents, hasIncompleteHistory } = attributeSellsByDay(swaps);
  assert(sellEvents.length === 1, 'one sell event emitted');
  assert(sellEvents[0].date === toUtcDate(DAY8), `sell attributed to day 8 (${sellEvents[0].date})`);
  assert(approxEqual(sellEvents[0].realizedPnlSol, 3), `realized PnL = 3 SOL (got ${sellEvents[0].realizedPnlSol})`);
  assert(sellEvents[0].isProfitable === true, 'sell is profitable');
  assert(!hasIncompleteHistory, 'no incomplete history');
}

// ---------------------------------------------------------------------------
// Test 2: Loss — sell at lower price than buy
// ---------------------------------------------------------------------------
console.log('\nTest 2: Losing trade — sell below cost');
{
  const swaps: TestSwap[] = [
    { timestamp: DAY1, signature: 'sig1', mint: 'MINT_B', direction: 'in',  amount: 100, associatedSolValue: 10 },
    { timestamp: DAY8, signature: 'sig2', mint: 'MINT_B', direction: 'out', amount: 100, associatedSolValue: 4 },
  ];
  const { sellEvents } = attributeSellsByDay(swaps);
  assert(approxEqual(sellEvents[0].realizedPnlSol, -6), `realized PnL = -6 SOL (got ${sellEvents[0].realizedPnlSol})`);
  assert(sellEvents[0].isProfitable === false, 'sell is not profitable');
}

// ---------------------------------------------------------------------------
// Test 3: Multiple sells across multiple days, same mint
// ---------------------------------------------------------------------------
console.log('\nTest 3: Two sells on different days, same mint');
{
  const swaps: TestSwap[] = [
    { timestamp: DAY1,  signature: 'sig1', mint: 'MINT_C', direction: 'in',  amount: 200, associatedSolValue: 10 },
    { timestamp: DAY8,  signature: 'sig2', mint: 'MINT_C', direction: 'out', amount: 100, associatedSolValue: 7 },
    { timestamp: DAY15, signature: 'sig3', mint: 'MINT_C', direction: 'out', amount: 100, associatedSolValue: 9 },
  ];
  const { sellEvents, hasIncompleteHistory } = attributeSellsByDay(swaps);
  assert(sellEvents.length === 2, 'two sell events');
  assert(sellEvents[0].date === toUtcDate(DAY8), 'first sell on day 8');
  assert(sellEvents[1].date === toUtcDate(DAY15), 'second sell on day 15');
  // Cost basis per token = 10/200 = 0.05 SOL/token
  // Sell 1: proceeds 7, cost 100*0.05=5 → PnL=2
  // Sell 2: proceeds 9, cost 100*0.05=5 → PnL=4
  assert(approxEqual(sellEvents[0].realizedPnlSol, 2), `day 8 PnL = 2 (got ${sellEvents[0].realizedPnlSol})`);
  assert(approxEqual(sellEvents[1].realizedPnlSol, 4), `day 15 PnL = 4 (got ${sellEvents[1].realizedPnlSol})`);
  assert(!hasIncompleteHistory, 'no incomplete history');
}

// ---------------------------------------------------------------------------
// Test 4: Sell before any buy — hasIncompleteHistory = true
// ---------------------------------------------------------------------------
console.log('\nTest 4: Sell without prior buy — incomplete history');
{
  const swaps: TestSwap[] = [
    { timestamp: DAY1, signature: 'sig1', mint: 'MINT_D', direction: 'out', amount: 50, associatedSolValue: 3 },
  ];
  const { sellEvents, hasIncompleteHistory } = attributeSellsByDay(swaps);
  assert(hasIncompleteHistory === true, 'hasIncompleteHistory is true');
  assert(sellEvents.length === 1, 'sell event still emitted');
  // No lots → FIFO sets hasIncompleteHistory and breaks immediately → PnL = 0
  // (consistent with buildFifoLotsForToken behaviour)
  assert(approxEqual(sellEvents[0].realizedPnlSol, 0), `PnL = 0 when no lots available (got ${sellEvents[0].realizedPnlSol})`);
}

// ---------------------------------------------------------------------------
// Test 5: Multiple mints on same day — attribution stays per-mint
// ---------------------------------------------------------------------------
console.log('\nTest 5: Two mints, sells on the same day');
{
  const swaps: TestSwap[] = [
    { timestamp: DAY1, signature: 's1', mint: 'MINT_E', direction: 'in',  amount: 100, associatedSolValue: 4 },
    { timestamp: DAY1, signature: 's2', mint: 'MINT_F', direction: 'in',  amount: 100, associatedSolValue: 6 },
    { timestamp: DAY8, signature: 's3', mint: 'MINT_E', direction: 'out', amount: 100, associatedSolValue: 5 },
    { timestamp: DAY8, signature: 's4', mint: 'MINT_F', direction: 'out', amount: 100, associatedSolValue: 7 },
  ];

  // Process each mint independently (as DailyAggregationService does)
  const mintE = swaps.filter(s => s.mint === 'MINT_E');
  const mintF = swaps.filter(s => s.mint === 'MINT_F');
  const eventsE = attributeSellsByDay(mintE).sellEvents;
  const eventsF = attributeSellsByDay(mintF).sellEvents;
  const allEvents = [...eventsE, ...eventsF];

  // Sum PnL for day 8
  const day8Pnl = allEvents.filter(e => e.date === toUtcDate(DAY8)).reduce((s, e) => s + e.realizedPnlSol, 0);
  assert(approxEqual(day8Pnl, 2), `day 8 combined PnL = 2 (E:+1, F:+1) (got ${day8Pnl})`);
  assert(allEvents.filter(e => e.date === toUtcDate(DAY8)).length === 2, '2 sell events on day 8');
}

// ---------------------------------------------------------------------------
// Test 6: Zero-value sell (non-economic transfer) — PnL = 0
// ---------------------------------------------------------------------------
console.log('\nTest 6: Zero-value sell treated as non-economic');
{
  const swaps: TestSwap[] = [
    { timestamp: DAY1, signature: 's1', mint: 'MINT_G', direction: 'in',  amount: 100, associatedSolValue: 5 },
    { timestamp: DAY8, signature: 's2', mint: 'MINT_G', direction: 'out', amount: 100, associatedSolValue: 0 },
  ];
  const { sellEvents } = attributeSellsByDay(swaps);
  assert(sellEvents.length === 1, 'one sell event');
  assert(approxEqual(sellEvents[0].realizedPnlSol, -5), `zero-value sell = -5 PnL (cost not recovered) (got ${sellEvents[0].realizedPnlSol})`);
  assert(sellEvents[0].isProfitable === false, 'not profitable');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
