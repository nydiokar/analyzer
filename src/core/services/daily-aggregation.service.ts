import { Injectable, Logger } from '@nestjs/common';
import { prisma } from './database-service';
import { SwapAnalysisInput } from '@prisma/client';

// Per-sell attribution record produced during the FIFO pass
interface SellEvent {
  date: string;            // "YYYY-MM-DD" UTC
  realizedPnlSol: number;
  isProfitable: boolean;
  volumeSol: number;       // SOL value of this sell
}

// Per-day aggregated result before upserting
interface DayAggregate {
  date: string;
  tradeCount: number;
  buyCount: number;
  sellCount: number;
  volumeSol: number;
  feesSol: number;
  realizedPnlSol: number;
  profitableSellsCount: number;
  totalSellsCount: number;
  uniqueMints: Set<string>;
  newMints: Set<string>;
  volumeUsd: number | null;
  hasIncompleteEnrichment: boolean;
  hasIncompleteHistory: boolean;
}

function toUtcDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// FIFO tolerances — must match fifo-lot-tracker.ts exactly
const VALUE_EPSILON = 1e-9;
const PERCENTAGE_TOLERANCE = 0.001;
const MIN_TOLERANCE = 0.001;
const MAX_TOLERANCE = 100;
const LOT_FINDING_TOLERANCE = 0.001;

interface FifoLot {
  amountBought: number;
  costBasisSol: number;
  amountRemaining: number;
}

/**
 * Runs a FIFO pass over one mint's full swap history and emits a SellEvent
 * for each sell, attributed to the sell's calendar day.
 *
 * Uses the same algorithm and tolerances as buildFifoLotsForToken so that
 * SUM(WalletDailyPnl.realizedPnlSol) ≈ WalletPnlSummary.realizedPnl.
 */
function attributeSellsByDay(inputs: SwapAnalysisInput[]): {
  sellEvents: SellEvent[];
  hasIncompleteHistory: boolean;
} {
  const sellEvents: SellEvent[] = [];
  let hasIncompleteHistory = false;

  // Sort ascending: timestamp → signature → buys before sells at same ts
  const ordered = [...inputs].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if (a.signature !== b.signature) return a.signature.localeCompare(b.signature);
    if (a.direction === b.direction) return 0;
    return a.direction === 'in' ? -1 : 1;
  });

  const lots: FifoLot[] = [];

  for (const input of ordered) {
    const normalizedAmount = Math.abs(input.amount);
    const baseSolValue = Math.abs(input.associatedSolValue);
    const fallbackUsdcValue = Math.abs(input.associatedUsdcValue ?? 0);

    // Use the same SOL/USDC resolution as the original FIFO tracker
    let effectiveSolValue: number;
    if (baseSolValue > VALUE_EPSILON) {
      effectiveSolValue = baseSolValue;
    } else if (fallbackUsdcValue > VALUE_EPSILON) {
      // No solPriceUsd available here — treat USDC-only rows as zero SOL value
      // This matches the behaviour when solPriceUsd is undefined in buildFifoLotsForToken
      effectiveSolValue = 0;
    } else {
      effectiveSolValue = 0;
    }

    if (input.direction === 'in') {
      lots.push({
        amountBought: normalizedAmount,
        costBasisSol: effectiveSolValue,
        amountRemaining: normalizedAmount,
      });
      continue;
    }

    // direction === 'out' — sell event
    let remainingToSell = normalizedAmount;
    const unitProceeds = normalizedAmount > 0 ? effectiveSolValue / normalizedAmount : 0;
    const completionTolerance = Math.min(
      Math.max(normalizedAmount * PERCENTAGE_TOLERANCE, MIN_TOLERANCE),
      MAX_TOLERANCE,
    );

    let realizedCostBasis = 0;
    let proceeds = 0;

    while (remainingToSell > completionTolerance) {
      const nextLot = lots.find(lot => lot.amountRemaining > LOT_FINDING_TOLERANCE);
      if (!nextLot) {
        hasIncompleteHistory = true;
        remainingToSell = 0;
        break;
      }
      const unitCost = nextLot.amountBought > 0 ? nextLot.costBasisSol / nextLot.amountBought : 0;
      const consumed = Math.min(remainingToSell, nextLot.amountRemaining);
      proceeds += consumed * unitProceeds;
      realizedCostBasis += consumed * unitCost;
      nextLot.amountRemaining -= consumed;
      remainingToSell -= consumed;
    }

    const pnl = proceeds - realizedCostBasis;
    sellEvents.push({
      date: toUtcDate(input.timestamp),
      realizedPnlSol: pnl,
      isProfitable: pnl > 0,
      volumeSol: effectiveSolValue,
    });
  }

  return { sellEvents, hasIncompleteHistory };
}

@Injectable()
export class DailyAggregationService {
  private readonly logger = new Logger(DailyAggregationService.name);

  /**
   * Recomputes WalletDailyPnl rows for the given dates for one wallet.
   *
   * Always fetches the FULL swap history (no time filter) so FIFO lot matching
   * is correct for sells that close positions opened on earlier days.
   * Only the resulting per-day rows for `dates` are upserted.
   */
  async recomputeDays(walletAddress: string, dates: string[]): Promise<void> {
    if (dates.length === 0) return;

    const dateSet = new Set(dates);

    // 1. Fetch full swap history — no time filter
    const allSwaps = await prisma.swapAnalysisInput.findMany({
      where: { walletAddress },
      orderBy: { timestamp: 'asc' },
    });

    if (allSwaps.length === 0) {
      this.logger.debug(`[DailyAgg] No swaps for ${walletAddress}, skipping`);
      return;
    }

    // 2. Check wallet-level incomplete history flag
    const anyIncompleteHistory = await prisma.analysisResult.findFirst({
      where: { walletAddress, hasIncompleteHistory: true },
      select: { id: true },
    });
    const walletHasIncompleteHistory = !!anyIncompleteHistory;

    // 3. Build day aggregates map — initialise entries only for requested dates
    const days = new Map<string, DayAggregate>();
    const initDay = (date: string): DayAggregate => ({
      date,
      tradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      volumeSol: 0,
      feesSol: 0,
      realizedPnlSol: 0,
      profitableSellsCount: 0,
      totalSellsCount: 0,
      uniqueMints: new Set(),
      newMints: new Set(),
      volumeUsd: 0,
      hasIncompleteEnrichment: false,
      hasIncompleteHistory: walletHasIncompleteHistory,
    });

    // 3a. Additive fields from raw swaps — only for requested dates
    // Track which mints we've seen before each requested date (for newMints)
    const mintFirstSeenDate = new Map<string, string>();
    for (const swap of allSwaps) {
      const date = toUtcDate(swap.timestamp);

      // Track first-seen date for every mint across full history
      if (!mintFirstSeenDate.has(swap.mint)) {
        mintFirstSeenDate.set(swap.mint, date);
      }

      if (!dateSet.has(date)) continue;

      if (!days.has(date)) days.set(date, initDay(date));
      const day = days.get(date)!;

      day.tradeCount++;
      day.volumeSol += Math.abs(swap.associatedSolValue);
      day.feesSol += swap.feeAmount ?? 0;
      day.uniqueMints.add(swap.mint);

      if (swap.direction === 'in') {
        day.buyCount++;
        // newMint: first-ever buy of this mint for this wallet
        if (mintFirstSeenDate.get(swap.mint) === date) {
          day.newMints.add(swap.mint);
        }
      } else {
        day.sellCount++;
      }

      // USD volume
      if (swap.usdValue !== null && swap.usdValue !== undefined) {
        day.volumeUsd = (day.volumeUsd ?? 0) + swap.usdValue;
      } else {
        day.hasIncompleteEnrichment = true;
      }
    }

    // 3b. FIFO pass per mint — attributes realized PnL to sell date
    const mintGroups = new Map<string, SwapAnalysisInput[]>();
    for (const swap of allSwaps) {
      const group = mintGroups.get(swap.mint) ?? [];
      group.push(swap);
      mintGroups.set(swap.mint, group);
    }

    for (const [, mintSwaps] of mintGroups) {
      const { sellEvents, hasIncompleteHistory } = attributeSellsByDay(mintSwaps);

      for (const event of sellEvents) {
        if (!dateSet.has(event.date)) continue;
        if (!days.has(event.date)) days.set(event.date, initDay(event.date));
        const day = days.get(event.date)!;

        day.realizedPnlSol += event.realizedPnlSol;
        day.totalSellsCount++;
        if (event.isProfitable) day.profitableSellsCount++;
        if (hasIncompleteHistory) day.hasIncompleteHistory = true;
      }
    }

    // 4. Upsert each requested date
    const now = new Date();
    for (const date of dates) {
      const day = days.get(date);

      if (!day) {
        // No swaps on this date — upsert a zero row so it exists and is marked fresh
        await prisma.walletDailyPnl.upsert({
          where: { walletAddress_date: { walletAddress, date } },
          create: {
            walletAddress,
            date,
            tradeCount: 0,
            buyCount: 0,
            sellCount: 0,
            volumeSol: 0,
            feesSol: 0,
            realizedPnlSol: 0,
            profitableSellsCount: 0,
            totalSellsCount: 0,
            uniqueMintsTradedCount: 0,
            newMintsEnteredCount: 0,
            volumeUsd: null,
            realizedPnlUsd: null,
            hasIncompleteEnrichment: false,
            hasIncompleteHistory: walletHasIncompleteHistory,
            lastComputedAt: now,
          },
          update: {
            tradeCount: 0,
            buyCount: 0,
            sellCount: 0,
            volumeSol: 0,
            feesSol: 0,
            realizedPnlSol: 0,
            profitableSellsCount: 0,
            totalSellsCount: 0,
            uniqueMintsTradedCount: 0,
            newMintsEnteredCount: 0,
            volumeUsd: null,
            realizedPnlUsd: null,
            hasIncompleteEnrichment: false,
            hasIncompleteHistory: walletHasIncompleteHistory,
            lastComputedAt: now,
          },
        });
        continue;
      }

      const volumeUsd = day.volumeUsd !== null && day.volumeUsd > 0 ? day.volumeUsd : null;

      await prisma.walletDailyPnl.upsert({
        where: { walletAddress_date: { walletAddress, date } },
        create: {
          walletAddress,
          date,
          tradeCount: day.tradeCount,
          buyCount: day.buyCount,
          sellCount: day.sellCount,
          volumeSol: day.volumeSol,
          feesSol: day.feesSol,
          realizedPnlSol: day.realizedPnlSol,
          profitableSellsCount: day.profitableSellsCount,
          totalSellsCount: day.totalSellsCount,
          uniqueMintsTradedCount: day.uniqueMints.size,
          newMintsEnteredCount: day.newMints.size,
          volumeUsd,
          realizedPnlUsd: null, // USD PnL requires per-sell enriched data — deferred
          hasIncompleteEnrichment: day.hasIncompleteEnrichment,
          hasIncompleteHistory: day.hasIncompleteHistory,
          lastComputedAt: now,
        },
        update: {
          tradeCount: day.tradeCount,
          buyCount: day.buyCount,
          sellCount: day.sellCount,
          volumeSol: day.volumeSol,
          feesSol: day.feesSol,
          realizedPnlSol: day.realizedPnlSol,
          profitableSellsCount: day.profitableSellsCount,
          totalSellsCount: day.totalSellsCount,
          uniqueMintsTradedCount: day.uniqueMints.size,
          newMintsEnteredCount: day.newMints.size,
          volumeUsd,
          realizedPnlUsd: null,
          hasIncompleteEnrichment: day.hasIncompleteEnrichment,
          hasIncompleteHistory: day.hasIncompleteHistory,
          lastComputedAt: now,
        },
      });
    }

    this.logger.debug(
      `[DailyAgg] Upserted ${days.size} day(s) for ${walletAddress} (requested: ${dates.join(', ')})`,
    );
  }

  /**
   * Recomputes the last N days for a wallet (default: today + yesterday).
   * Used by the nightly repair cron.
   */
  async recomputeRecentDays(walletAddress: string, nDays = 2): Promise<void> {
    const dates: string[] = [];
    const now = Date.now();
    for (let i = 0; i < nDays; i++) {
      dates.push(new Date(now - i * 86400_000).toISOString().slice(0, 10));
    }
    await this.recomputeDays(walletAddress, dates);
  }
}
