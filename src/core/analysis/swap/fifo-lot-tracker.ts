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
  associatedUsdcValue?: number | null;
  interactionType?: string;
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

  // SwapAnalyzer passes ALL transfers including non-economic ones (BURN, UNKNOWN tiny)
  // We identify and assign ZERO cost to non-economic transfers while tracking token movement
  const UNKNOWN_TRANSFER_THRESHOLD_SOL = 0.01;

  // Tolerance configuration for FIFO completion detection
  // Uses percentage-based tolerance with floor/ceiling bounds to handle all token scales
  const PERCENTAGE_TOLERANCE = 0.001; // 0.1% of the amount being sold
  const MIN_TOLERANCE = 0.001; // Floor: prevent floating point precision issues
  const MAX_TOLERANCE = 100; // Ceiling: prevent being too loose on massive sales
  const LOT_FINDING_TOLERANCE = 0.001; // For finding lots with real tokens (not dust)

  for (const input of ordered) {
    const normalizedAmount = Math.abs(input.amount);
    const interactionType = input.interactionType?.toUpperCase() ?? '';

    // Non-economic transfers: BURN and UNKNOWN with negligible SOL value
    // These track token movement but have zero cost basis (DCA deposits, program escrow, etc.)
    const baseSolValue = Math.abs(input.associatedSolValue);
    const fallbackUsdcValue = Math.abs(input.associatedUsdcValue ?? 0);
    const isNonEconomicTransfer = interactionType === 'BURN' ||
      (interactionType === 'UNKNOWN' &&
       baseSolValue < UNKNOWN_TRANSFER_THRESHOLD_SOL &&
       fallbackUsdcValue < UNKNOWN_TRANSFER_THRESHOLD_SOL);

    // Convert USDC to SOL - each record has EITHER SOL or USDC, not both
    let effectiveSolValue: number;
    if (isNonEconomicTransfer) {
      effectiveSolValue = 0;
    } else if (baseSolValue > 0) {
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

    totalProceedsSol += effectiveSolValue;
    let remainingToSell = normalizedAmount;

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
        break;
      }

      const unitCost =
        nextLot.amountBought > 0 ? nextLot.costBasisSol / nextLot.amountBought : 0;
      const consumed = Math.min(remainingToSell, nextLot.amountRemaining);
      realizedCostBasisSol += consumed * unitCost;
      nextLot.amountRemaining -= consumed;
      remainingToSell -= consumed;
    }

    if (hasIncompleteHistory) {
      break;
    }
  }

  if (hasIncompleteHistory) {
    return {
      realizedPnlSol: null,
      remainingCostBasisSol: null,
      hasIncompleteHistory: true,
      lots,
    };
  }

  const remainingCostBasisSol = lots.reduce((sum, lot) => {
    if (lot.amountRemaining <= 0 || lot.amountBought <= 0) return sum;
    const unitCost = lot.costBasisSol / lot.amountBought;
    return sum + lot.amountRemaining * unitCost;
  }, 0);

  return {
    realizedPnlSol: totalProceedsSol - realizedCostBasisSol,
    remainingCostBasisSol,
    hasIncompleteHistory: false,
    lots,
  };
}
