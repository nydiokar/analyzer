import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { prisma } from '../../core/services/database-service';
import { DailyAggregationService } from '../../core/services/daily-aggregation.service';
import { getErrorMessage } from 'core/utils/error-utils';

/**
 * Nightly repair job for WalletDailyPnl rows.
 *
 * Primary trigger: async BullMQ dispatch after each analysis run (analysis-operations.processor.ts).
 * This job is the secondary safety net — it catches wallets not recently analyzed and
 * covers late-arriving enrichment on recent days.
 *
 * Queries for wallets whose lastComputedAt is more than 26 hours ago (just over one day,
 * so a missed nightly run is caught without false-positives from same-day updates).
 * Recomputes the last 3 days per wallet to cover late-arriving enrichment.
 */
@Injectable()
export class DailyAggregationJob {
  private readonly logger = new Logger(DailyAggregationJob.name);

  constructor(private readonly dailyAggregationService: DailyAggregationService) {}

  @Cron('0 0 * * *') // Midnight UTC daily
  async runNightlyRepair(): Promise<void> {
    this.logger.log('DailyAggregationJob: nightly repair started');
    const startTime = Date.now();

    try {
      // Find wallets with stale daily rows — lastComputedAt older than 26 hours.
      // Process in batches of 100 to bound memory and avoid long-running queries.
      const staleThreshold = new Date(Date.now() - 26 * 60 * 60 * 1000);

      const staleRows = await prisma.walletDailyPnl.findMany({
        where: { lastComputedAt: { lt: staleThreshold } },
        select: { walletAddress: true },
        distinct: ['walletAddress'],
        take: 500, // max wallets per nightly run
      });

      if (staleRows.length === 0) {
        this.logger.log('DailyAggregationJob: no stale wallets found, skipping');
        return;
      }

      this.logger.log(`DailyAggregationJob: recomputing ${staleRows.length} stale wallet(s)`);

      let succeeded = 0;
      let failed = 0;

      for (const { walletAddress } of staleRows) {
        try {
          await this.dailyAggregationService.recomputeRecentDays(walletAddress, 3);
          succeeded++;
        } catch (error) {
          failed++;
          this.logger.error(
            `DailyAggregationJob: failed for ${walletAddress}: ${getErrorMessage(error)}`,
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `DailyAggregationJob: nightly repair complete — ${succeeded} ok, ${failed} failed in ${duration}ms`,
      );
    } catch (error) {
      this.logger.error(`DailyAggregationJob: nightly repair job failed: ${getErrorMessage(error)}`);
    }
  }
}
