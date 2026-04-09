import { Injectable } from '@nestjs/common';
import { PrismaClient, SwapAnalysisInput } from '@prisma/client';
import { prisma as defaultPrisma } from 'core/services/database-service';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('DailyAggregationService');

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Per-sell attribution record produced during the FIFO pass for one mint. */
export interface SellEvent {
  date: string;           // "YYYY-MM-DD" UTC
  realizedPnlSol: number;
  isProfitable: boolean;
}

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
  volumeUsd: number;
  hasIncompleteEnrichment: boolean;
  hasIncompleteHistory: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for testing
// ---------------------------------------------------------------------------

export function toUtcDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

// Tolerances matching fifo-lot-tracker.ts exactly — kept in sync so that
// SUM(WalletDailyPnl.realizedPnlSol) ≈ WalletPnlSummary.realizedPnl.
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
 * Runs a per-sell FIFO pass over ONE mint's full swap history and emits a
 * SellEvent for each sell transaction, attributed to the sell's UTC calendar day.
 *
 * CRITICAL: must receive the FULL chronological history for the mint —
 * never a day-scoped slice. A buy on day 1 must be visible when costing
 * a sell on day 8, otherwise FIFO produces wrong realizedPnlSol.
 *
 * The cost-basis algorithm and tolerances mirror buildFifoLotsForToken in
 * fifo-lot-tracker.ts so that SUM(WalletDailyPnl.realizedPnlSol) converges
 * to WalletPnlSummary.realizedPnl. The only intentional difference is that
 * this function emits one record per sell event rather than accumulating a
 * single total — buildFifoLotsForToken cannot provide per-sell attribution.
 *
 * USDC swaps: mirrors buildFifoLotsForToken exactly — if associatedSolValue is
 * zero but associatedUsdcValue is present, converts via associatedUsdcValue /
 * solPriceUsd (the SOL/USD price already stored on each SwapAnalysisInput row
 * from market-context enrichment). Rows lacking both values are non-economic (zero).
 */
export function attributeSellsByDay(inputs: SwapAnalysisInput[]): {
  sellEvents: SellEvent[];
  hasIncompleteHistory: boolean;
} {
  const sellEvents: SellEvent[] = [];
  let hasIncompleteHistory = false;

  // Sort: timestamp asc → signature asc → buys before sells at same timestamp
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

    // Mirror buildFifoLotsForToken exactly:
    //   1. SOL value present → use it
    //   2. USDC value present + solPriceUsd → convert USDC/solPriceUsd → SOL
    //   3. Neither → zero (non-economic transfer)
    // solPriceUsd is the SOL/USD price at trade time, already on SwapAnalysisInput
    // from market-context enrichment.
    let effectiveSolValue: number;
    if (baseSolValue > VALUE_EPSILON) {
      effectiveSolValue = baseSolValue;
    } else if (fallbackUsdcValue > VALUE_EPSILON && input.solPriceUsd) {
      effectiveSolValue = fallbackUsdcValue / input.solPriceUsd;
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

    // Sell — compute per-sell realized PnL
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
    });
  }

  return { sellEvents, hasIncompleteHistory };
}

// ---------------------------------------------------------------------------
// Minimal Prisma interface for DI + testability
// ---------------------------------------------------------------------------

type DbClient = Pick<PrismaClient, 'swapAnalysisInput' | 'analysisResult' | 'walletDailyPnl'>;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class DailyAggregationService {
  private readonly db: DbClient;

  constructor() {
    this.db = defaultPrisma;
  }

  /** For use in tests only — pass a mock DbClient directly. */
  static withDb(db: DbClient): DailyAggregationService {
    const svc = new DailyAggregationService();
    (svc as any).db = db;
    return svc;
  }

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

    // 1. Full history — no time filter
    const allSwaps = await this.db.swapAnalysisInput.findMany({
      where: { walletAddress },
      orderBy: { timestamp: 'asc' },
    });

    if (allSwaps.length === 0) {
      logger.debug(`[DailyAgg] No swaps for ${walletAddress}, skipping`);
      return;
    }

    // 2. Wallet-level incomplete-history flag from AnalysisResult
    const anyIncomplete = await this.db.analysisResult.findFirst({
      where: { walletAddress, hasIncompleteHistory: true },
      select: { id: true },
    });
    const walletHasIncompleteHistory = !!anyIncomplete;

    // 3. Build per-day aggregates
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

    // 3a. Additive fields — scan full history but only accumulate for requested dates
    const mintFirstSeenDate = new Map<string, string>(); // mint → earliest date in full history
    for (const swap of allSwaps) {
      const date = toUtcDate(swap.timestamp);
      if (!mintFirstSeenDate.has(swap.mint)) mintFirstSeenDate.set(swap.mint, date);

      if (!dateSet.has(date)) continue;

      if (!days.has(date)) days.set(date, initDay(date));
      const day = days.get(date)!;

      day.tradeCount++;
      // Mirror FIFO tracker: SOL value → direct; USDC value → convert via solPriceUsd; else 0
      const swapSolValue = Math.abs(swap.associatedSolValue);
      const swapUsdcValue = Math.abs(swap.associatedUsdcValue ?? 0);
      const swapEffectiveSol =
        swapSolValue > VALUE_EPSILON
          ? swapSolValue
          : swapUsdcValue > VALUE_EPSILON && swap.solPriceUsd
            ? swapUsdcValue / swap.solPriceUsd
            : 0;
      day.volumeSol += swapEffectiveSol;
      day.feesSol += swap.feeAmount ?? 0;
      day.uniqueMints.add(swap.mint);

      if (swap.direction === 'in') {
        day.buyCount++;
        if (mintFirstSeenDate.get(swap.mint) === date) day.newMints.add(swap.mint);
      } else {
        day.sellCount++;
      }

      if (swap.usdValue !== null && swap.usdValue !== undefined) {
        day.volumeUsd += swap.usdValue;
      } else {
        day.hasIncompleteEnrichment = true;
      }
    }

    // 3b. FIFO pass per mint — attributes realized PnL to sell date
    const mintGroups = new Map<string, SwapAnalysisInput[]>();
    for (const swap of allSwaps) {
      const arr = mintGroups.get(swap.mint) ?? [];
      arr.push(swap);
      mintGroups.set(swap.mint, arr);
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

      const payload = day
        ? {
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
            // null when any swap lacked usdValue — consumer uses hasIncompleteEnrichment flag
            volumeUsd: day.hasIncompleteEnrichment ? null : day.volumeUsd,
            realizedPnlUsd: null as null, // deferred — requires per-sell USD enrichment
            hasIncompleteEnrichment: day.hasIncompleteEnrichment,
            hasIncompleteHistory: day.hasIncompleteHistory,
            lastComputedAt: now,
          }
        : {
            // No swaps on this date — zero row, still marked fresh
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
            volumeUsd: null as null,
            realizedPnlUsd: null as null,
            hasIncompleteEnrichment: false,
            hasIncompleteHistory: walletHasIncompleteHistory,
            lastComputedAt: now,
          };

      await this.db.walletDailyPnl.upsert({
        where: { walletAddress_date: { walletAddress, date } },
        create: { walletAddress, date, ...payload },
        update: payload,
      });
    }

    logger.debug(
      `[DailyAgg] Upserted ${dates.length} day(s) for ${walletAddress}`,
    );
  }

  /**
   * Reads persisted WalletDailyPnl rows for a date range.
   * Returns rows ordered by date ascending. Missing days (no swaps, not yet computed)
   * are absent from the result — the caller fills gaps as needed.
   */
  async getDailyPnl(
    walletAddress: string,
    startDate: string,
    endDate: string,
  ) {
    const fetchRows = async () => this.db.walletDailyPnl.findMany({
      where: {
        walletAddress,
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'asc' },
    });

    let rows = await fetchRows();
    const existingDates = new Set(rows.map((row) => row.date));

    const startTs = Math.floor(new Date(`${startDate}T00:00:00.000Z`).getTime() / 1000);
    const endTs = Math.floor(new Date(`${endDate}T23:59:59.999Z`).getTime() / 1000);

    const swapsInRange = await this.db.swapAnalysisInput.findMany({
      where: {
        walletAddress,
        timestamp: { gte: startTs, lte: endTs },
      },
      select: { timestamp: true },
    });

    const activeDates = new Set(swapsInRange.map((swap) => toUtcDate(swap.timestamp)));
    const missingActiveDates = [...activeDates].filter((date) => !existingDates.has(date));

    if (missingActiveDates.length > 0) {
      logger.info(
        `[DailyAgg] Backfilling ${missingActiveDates.length} missing active day(s) for ${walletAddress} between ${startDate} and ${endDate}`,
      );
      await this.recomputeDays(walletAddress, missingActiveDates);
      rows = await fetchRows();
    }

    return rows;
  }

  /**
   * Recomputes the last N days for a wallet.
   * Used by the nightly repair cron (default: today + yesterday).
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
