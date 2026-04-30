export interface FifoLot {
  amountBought: number;
  costBasisSol: number;
  amountRemaining: number;
  purchaseTimestamp: number;
  sourceSignature?: string;
}

export interface FifoPnlResult {
  realizedPnlSol: number | null;
  remainingCostBasisSol: number | null;
  hasIncompleteHistory: boolean;
  lots: FifoLot[];
}

export interface FifoSwapInput {
  timestamp: number;
  signature: string;
  direction: 'in' | 'out';
  amount: number;
  associatedSolValue: number;
  // Stable USD value (USDC/USDT/USD1) if SOL value is missing.
  associatedUsdcValue?: number | null;
  interactionType?: string;
}

export function isEconomicTradeInput(input: Pick<FifoSwapInput, 'interactionType'>): boolean {
  const interactionType = input.interactionType?.toUpperCase() ?? '';
  return interactionType !== 'TRANSFER' &&
    interactionType !== 'CREATE_ORDER' &&
    interactionType !== 'CANCEL_ORDER';
}

function sortSwapInputs(inputs: FifoSwapInput[]): FifoSwapInput[] {
  return [...inputs].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if (a.signature !== b.signature) return a.signature.localeCompare(b.signature);
    if (a.direction === b.direction) return 0;
    return a.direction === 'in' ? -1 : 1;
  });
}

export function buildFifoLotsForToken(
  inputs: FifoSwapInput[],
  solPriceUsd?: number,
): FifoPnlResult {
  const lots: FifoLot[] = [];
  let realizedCostBasisSol = 0;
  let totalProceedsSol = 0;
  let hasIncompleteHistory = false;

  const ordered = sortSwapInputs(inputs);

  const VALUE_EPSILON = 1e-9;

  // Tolerance configuration for FIFO completion detection
  // Uses percentage-based tolerance with floor/ceiling bounds to handle all token scales
  const PERCENTAGE_TOLERANCE = 0.001; // 0.1% of the amount being sold
  const MIN_TOLERANCE = 0.001; // Floor: prevent floating point precision issues
  const MAX_TOLERANCE = 100; // Ceiling: prevent being too loose on massive sales
  const LOT_FINDING_TOLERANCE = 0.001; // For finding lots with real tokens (not dust)

  for (const input of ordered) {
    const normalizedAmount = Math.abs(input.amount);
    const baseSolValue = Math.abs(input.associatedSolValue);
    const fallbackUsdcValue = Math.abs(input.associatedUsdcValue ?? 0);

    // Convert USDC to SOL - each record has EITHER SOL or USDC, not both
    let effectiveSolValue: number;
    if (baseSolValue > 0) {
      // Use SOL value
      effectiveSolValue = baseSolValue;
    } else if (fallbackUsdcValue > 0 && solPriceUsd) {
      // Convert USDC to SOL
      effectiveSolValue = fallbackUsdcValue / solPriceUsd;
    } else {
      effectiveSolValue = 0;
    }
    if (input.direction === 'in') {
      lots.push({
        amountBought: normalizedAmount,
        costBasisSol: effectiveSolValue,
        amountRemaining: normalizedAmount,
        purchaseTimestamp: input.timestamp,
        sourceSignature: input.signature,
      });
      continue;
    }

    if (!isEconomicTradeInput(input) || effectiveSolValue <= VALUE_EPSILON) {
      continue;
    }

    let remainingToSell = normalizedAmount;
    const unitProceeds = normalizedAmount > 0 ? effectiveSolValue / normalizedAmount : 0;

    // Calculate tolerance for this specific sale amount
    // Scales with token amount but bounded by floor/ceiling
    const completionTolerance = Math.min(
      Math.max(
        normalizedAmount * PERCENTAGE_TOLERANCE,
        MIN_TOLERANCE
      ),
      MAX_TOLERANCE
    );

    while (remainingToSell > completionTolerance) {
      const nextLot = lots.find(lot => lot.amountRemaining > LOT_FINDING_TOLERANCE);
      if (!nextLot) {
        hasIncompleteHistory = true;
        remainingToSell = 0;
        break;
      }

      const unitCost =
        nextLot.amountBought > 0 ? nextLot.costBasisSol / nextLot.amountBought : 0;
      const consumed = Math.min(remainingToSell, nextLot.amountRemaining);
      totalProceedsSol += consumed * unitProceeds;
      realizedCostBasisSol += consumed * unitCost;
      nextLot.amountRemaining -= consumed;
      remainingToSell -= consumed;
    }

  }

  const remainingCostBasisSol = lots.reduce((sum, lot) => {
    if (lot.amountRemaining <= 0 || lot.amountBought <= 0) return sum;
    const unitCost = lot.costBasisSol / lot.amountBought;
    return sum + lot.amountRemaining * unitCost;
  }, 0);

  return {
    realizedPnlSol: totalProceedsSol - realizedCostBasisSol,
    remainingCostBasisSol,
    hasIncompleteHistory: hasIncompleteHistory,
    lots,
  };
}
