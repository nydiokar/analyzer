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
  // SOL price cache - delegates to standalone shared functions
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
  // Token supply - one bulk DB read, then targeted RPC only for misses
  // ---------------------------------------------------------------------------

  private async buildSupplyMap(mints: string[]): Promise<Map<string, number>> {
    if (mints.length === 0) return new Map();

    const uniqueMints = [...new Set(mints)];
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

    const seen = new Set(rows.map(r => r.tokenAddress));
    for (const mint of uniqueMints) {
      if (!seen.has(mint)) missing.push(mint);
    }

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
   * Rows with structurally invalid inputs are stamped as complete so they are
   * not retried forever. Rows missing prerequisite cache data stay pending.
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
    let deferred = 0;

    for (const row of rows) {
      try {
        const dateKey = timestampToDateKey(row.timestamp);
        const solPriceUsd = solPriceMap.get(dateKey) ?? null;

        if (row.amount <= 0) {
          await prisma.swapAnalysisInput.update({
            where: { id: row.id },
            data: { enrichedAt: new Date() },
          });
          skipped++;
          continue;
        }

        let usdValue: number | null = null;
        if (row.associatedSolValue > 0 && solPriceUsd) {
          usdValue = row.associatedSolValue * solPriceUsd;
        } else if (row.associatedUsdcValue && row.associatedUsdcValue > 0) {
          usdValue = row.associatedUsdcValue;
        }

        if (usdValue === null) {
          if (row.associatedSolValue > 0 && solPriceUsd === null) {
            deferred++;
            continue;
          }

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

    const errors = rows.length - enriched - skipped - deferred;
    this.logger.log(
      `Enriched: ${enriched} | Skipped (permanent): ${skipped} | Deferred (retry later): ${deferred} | Transient errors: ${errors}`,
    );
    return enriched + skipped;
  }

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

  async enrichWallet(walletAddress: string, batchSize = 500): Promise<number> {
    let totalProcessed = 0;
    let batchResult: number;

    do {
      batchResult = await this.enrichSwapBatch(batchSize, walletAddress);
      totalProcessed += batchResult;
      if (batchResult > 0) await new Promise(r => setTimeout(r, 100));
    } while (batchResult > 0);

    this.logger.log(`Wallet ${walletAddress} market context processed ${totalProcessed} swap records.`);
    return totalProcessed;
  }
}
