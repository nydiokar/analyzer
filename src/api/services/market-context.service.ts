import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { TokenInfoService } from './token-info.service';
import { prisma } from '../../core/services/database-service';
import {
  classifyMcap,
  timestampToDateKey,
  buildSolPriceMap,
  backfillSolPrices,
  appendTodaySolPrice,
} from '../../core/services/market-context-standalone';

@Injectable()
export class MarketContextService {
  private readonly logger = new Logger(MarketContextService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tokenInfoService: TokenInfoService,
  ) {}

  // ---------------------------------------------------------------------------
  // SOL price cache — delegates to standalone pure functions
  // ---------------------------------------------------------------------------

  async appendTodaySolPrice(): Promise<void> {
    await appendTodaySolPrice(prisma);
  }

  async backfillSolPrices(lookbackDays = 90): Promise<number> {
    return backfillSolPrices(prisma, lookbackDays);
  }

  async getSolPriceDayCount(): Promise<number> {
    return prisma.solDailyPrice.count();
  }

  // ---------------------------------------------------------------------------
  // Token supply — one bulk DB read, then targeted RPC only for misses
  // ---------------------------------------------------------------------------

  /**
   * Builds a Map<mint, totalSupply> for a set of mints.
   *
   * Strategy:
   *   1. Single SELECT on TokenInfo for all mints — free, fast.
   *   2. For any mint missing totalSupply, call TokenInfoService.getTokenSupply()
   *      which goes Redis → DB → Helius RPC and writes back to both layers.
   *   In steady state (post-backfill) step 2 fires for zero mints.
   */
  private async buildSupplyMap(mints: string[]): Promise<Map<string, number>> {
    if (mints.length === 0) return new Map();

    const uniqueMints = [...new Set(mints)];

    // Bulk read — one query for all mints
    const rows = await this.db.findManyTokenInfo(uniqueMints);
    const result = new Map<string, number>();
    const missing: string[] = [];

    for (const row of rows) {
      if (row.totalSupply != null) {
        result.set(row.tokenAddress, row.totalSupply);
      } else {
        missing.push(row.tokenAddress);
      }
    }

    // Mints with no TokenInfo row at all
    const seen = new Set(rows.map(r => r.tokenAddress));
    for (const mint of uniqueMints) {
      if (!seen.has(mint)) missing.push(mint);
    }

    // For cache misses: TokenInfoService handles Redis → DB → Helius → write-back
    // These are genuinely unseen mints — call one at a time (RPC has no batch for getTokenSupply)
    if (missing.length > 0) {
      this.logger.log(`[Supply] Fetching ${missing.length} mints from RPC (not yet cached)`);
      for (const mint of missing) {
        const supply = await this.tokenInfoService.getTokenSupply(mint);
        if (supply !== undefined) result.set(mint, supply);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Enrichment engine
  // ---------------------------------------------------------------------------

  /**
   * Enrich a batch of SwapAnalysisInput rows with SOL price + token market cap.
   *
   * Flow per batch:
   *   1. Fetch up to batchSize un-enriched rows (scoped to wallet if provided).
   *   2. Build SOL price map — one DB query covering all timestamps.
   *   3. Build supply map — one bulk TokenInfo read; RPC only for true misses.
   *   4. Compute and write enriched fields row by row.
   *
   * Rows with no derivable value (zero amounts, missing SOL price) are stamped
   * with enrichedAt so they are never retried.
   *
   * @returns Total rows processed (enriched + permanently skipped).
   */
  async enrichSwapBatch(batchSize = 500, walletAddress?: string): Promise<number> {
    const rows = await prisma.swapAnalysisInput.findMany({
      where: { enrichedAt: null, ...(walletAddress ? { walletAddress } : {}) },
      orderBy: { timestamp: 'desc' },
      take: batchSize,
    });

    if (rows.length === 0) {
      this.logger.log('No un-enriched swaps found.');
      return 0;
    }

    this.logger.log(`Enriching ${rows.length} swap records...`);

    const uniqueMints = [...new Set(rows.map(r => r.mint))];

    const [solPriceMap, supplyMap] = await Promise.all([
      buildSolPriceMap(prisma, rows.map(r => r.timestamp)),
      this.buildSupplyMap(uniqueMints),
    ]);

    let enriched = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const dateKey = timestampToDateKey(row.timestamp);
        const solPriceUsd = solPriceMap.get(dateKey) ?? null;

        let usdValue: number | null = null;
        if (row.associatedSolValue > 0 && solPriceUsd) {
          usdValue = row.associatedSolValue * solPriceUsd;
        } else if (row.associatedUsdcValue && row.associatedUsdcValue > 0) {
          usdValue = row.associatedUsdcValue;
        }

        if (usdValue === null || row.amount <= 0) {
          // Permanently un-enrichable — stamp so it's never retried
          await prisma.swapAnalysisInput.update({
            where: { id: row.id },
            data: { enrichedAt: new Date() },
          });
          skipped++;
          continue;
        }

        const tokenPriceUsd = usdValue / row.amount;
        const totalSupply = supplyMap.get(row.mint) ?? null;
        const marketCapUsd = totalSupply !== null ? tokenPriceUsd * totalSupply : null;
        const mcapBucket = marketCapUsd !== null ? classifyMcap(marketCapUsd) : null;

        await prisma.swapAnalysisInput.update({
          where: { id: row.id },
          data: { solPriceUsd, usdValue, tokenPriceUsd, marketCapUsd, mcapBucket, enrichedAt: new Date() },
        });

        enriched++;
      } catch (err: any) {
        this.logger.warn(`Error enriching row ${row.id}: ${err.message}`);
      }
    }

    const errors = rows.length - enriched - skipped;
    this.logger.log(`Enriched: ${enriched} | Skipped (no data): ${skipped} | Transient errors: ${errors}`);
    return enriched + skipped;
  }

  /**
   * Run enrichment until all un-enriched rows are processed.
   * Used by the backfill script via NestJS app bootstrap.
   */
  async enrichAll(batchSize = 500): Promise<number> {
    let totalProcessed = 0;
    let batchResult: number;
    do {
      batchResult = await this.enrichSwapBatch(batchSize);
      totalProcessed += batchResult;
      if (batchResult > 0) await new Promise(r => setTimeout(r, 100));
    } while (batchResult > 0);

    this.logger.log(`Total processed: ${totalProcessed} swap records.`);
    return totalProcessed;
  }
}
