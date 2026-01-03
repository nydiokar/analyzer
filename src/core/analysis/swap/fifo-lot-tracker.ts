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
): FifoPnlResult {
  const lots: FifoLot[] = [];
  let realizedCostBasisSol = 0;
  let totalProceedsSol = 0;
  let hasIncompleteHistory = false;

  const ordered = sortSwapInputs(inputs);

  for (const input of ordered) {
    const normalizedAmount = Math.abs(input.amount);
    const interactionType = input.interactionType?.toUpperCase() ?? '';
    const isNonEconomicTransfer = interactionType === 'TRANSFER' || interactionType === 'BURN';
    const fallbackUsdcValue = input.associatedUsdcValue ?? 0;
    const baseSolValue = Math.abs(input.associatedSolValue);
    const effectiveSolValue = isNonEconomicTransfer ? 0 : (baseSolValue > 0 ? baseSolValue : Math.abs(fallbackUsdcValue));

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

    while (remainingToSell > 0) {
      const nextLot = lots.find(lot => lot.amountRemaining > 0);
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
