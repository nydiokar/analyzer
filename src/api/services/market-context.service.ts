import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from './database.service';
import { TokenInfoService } from './token-info.service';
import { prisma } from '../../core/services/database-service';
import {
  classifyMcap,
  timestampToDateKey,
  buildSolPriceMap,
  backfillSolPrices,
} from '../../core/services/market-context-standalone';

@Injectable()
export class MarketContextService {
  private readonly logger = new Logger(MarketContextService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tokenInfoService: TokenInfoService,
  ) {}

  // ---------------------------------------------------------------------------
  // SOL price cache
  // ---------------------------------------------------------------------------

  /**
   * Write (or refresh) today's SOL price in SolDailyPrice.
   * Always upserts — called both on startup and by the scheduled cron so the
   * stored value stays fresh throughout the day.
   * Primary: CoinGecko via TokenInfoService (same source as live prices).
   * Fallback: DeFiLlama backfill for today + recent gap sweep.
   */
  async appendTodaySolPrice(): Promise<void> {
    const dateKey = timestampToDateKey(Math.floor(Date.now() / 1000));

    let price: number | null = null;
    try {
      price = await this.tokenInfoService.getSolPrice();
    } catch (err) {
      this.logger.warn(`[SOL Daily] CoinGecko fetch failed, will try DeFiLlama backfill: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (price !== null && price > 0) {
      await prisma.solDailyPrice.upsert({
        where: { date: dateKey },
        update: { priceUsd: price },
        create: { date: dateKey, priceUsd: price },
      });
      this.logger.log(`[SOL Daily] Refreshed price for ${dateKey}: $${price.toFixed(2)}`);
    } else {
      // CoinGecko failed — fall back to DeFiLlama for today + recent gap sweep
      this.logger.warn('[SOL Daily] CoinGecko unavailable, falling back to DeFiLlama backfill');
      await backfillSolPrices(prisma, 7);
    }
  }

  /**
   * Cron: refresh today's SOL price and patch any gaps in the last 30 days.
   * Runs every 3 hours (8× per day) so intraday price stays reasonably current
   * and any missed days are caught quickly before enrichment queues them as deferred.
   */
  @Cron('0 0 */3 * * *')
  async scheduledSolPriceRefresh(): Promise<void> {
    this.logger.log('[SOL Cron] Refreshing SOL price');
    try {
      await this.appendTodaySolPrice();
      // Scan last 30 days for gaps and fill them — this is what catches the DeFiLlama outage scenario
      const filled = await backfillSolPrices(prisma, 30);
      if (filled > 0) {
        this.logger.warn(`[SOL Cron] Backfilled ${filled} missing day(s) in last 30 days`);
      }
    } catch (err) {
      this.logger.error(`[SOL Cron] Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
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
      const CONCURRENCY = 10;
      for (let i = 0; i < missing.length; i += CONCURRENCY) {
        const chunk = missing.slice(i, i + CONCURRENCY);
        await Promise.all(
          chunk.map(async (mint) => {
            const supply = await this.tokenInfoService.getTokenSupply(mint);
            if (supply !== undefined) result.set(mint, supply);
          }),
        );
        if (i + CONCURRENCY < missing.length) {
          await new Promise(r => setTimeout(r, 100));
        }
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
    const SKIP_MINTS = [
      'So11111111111111111111111111111111111111112', // native SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
    ];
    const walletFilter = walletAddress ? { walletAddress } : {};

    const LP_INTERACTION_TYPES = ['ADD_LIQUIDITY', 'REMOVE_LIQUIDITY'];

    // Stamp SOL/stable-mint rows and LP position rows complete — no meaningful mcap derivable
    await prisma.swapAnalysisInput.updateMany({
      where: { enrichedAt: null, mint: { in: SKIP_MINTS }, ...walletFilter },
      data: { enrichedAt: new Date() },
    });
    await prisma.swapAnalysisInput.updateMany({
      where: { enrichedAt: null, interactionType: { in: LP_INTERACTION_TYPES }, ...walletFilter },
      data: { enrichedAt: new Date() },
    });

    const rows = await prisma.swapAnalysisInput.findMany({
      where: {
        enrichedAt: null,
        NOT: [
          { mint: { in: SKIP_MINTS } },
          { interactionType: { in: LP_INTERACTION_TYPES } },
        ],
        ...walletFilter,
      },
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

    const now = new Date();
    type UpdatePayload = { solPriceUsd: number | null; usdValue: number; tokenPriceUsd: number; marketCapUsd: number | null; mcapBucket: string | null };
    const enrichUpdates = new Map<number, UpdatePayload>();
    const skipIds: number[] = [];

    for (const row of rows) {
      const dateKey = timestampToDateKey(row.timestamp);
      const solPriceUsd = solPriceMap.get(dateKey) ?? null;

      if (row.amount <= 0) {
        skipIds.push(row.id);
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
        skipIds.push(row.id);
        skipped++;
        continue;
      }

      const tokenPriceUsd = usdValue / row.amount;
      const totalSupply = supplyMap.get(row.mint) ?? null;
      const marketCapUsd = totalSupply !== null ? tokenPriceUsd * totalSupply : null;
      const mcapBucket = marketCapUsd !== null ? classifyMcap(marketCapUsd) : null;
      enrichUpdates.set(row.id, { solPriceUsd, usdValue, tokenPriceUsd, marketCapUsd, mcapBucket });
      enriched++;
    }

    if (skipIds.length > 0) {
      await prisma.swapAnalysisInput.updateMany({
        where: { id: { in: skipIds } },
        data: { enrichedAt: now },
      });
    }

    if (enrichUpdates.size > 0) {
      const CHUNK = 50;
      const entries = [...enrichUpdates.entries()];
      let staleUpdateCount = 0;
      for (let i = 0; i < entries.length; i += CHUNK) {
        const updateResults = await Promise.all(
          entries.slice(i, i + CHUNK).map(([id, data]) =>
            prisma.swapAnalysisInput.updateMany({ where: { id }, data: { ...data, enrichedAt: now } }),
          ),
        );
        staleUpdateCount += updateResults.filter((result) => result.count === 0).length;
      }
      if (staleUpdateCount > 0) {
        enriched -= staleUpdateCount;
        this.logger.debug(
          `Skipped ${staleUpdateCount} stale market-context update(s); rows were likely replaced by a concurrent sync.`,
        );
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
