import { Module, OnModuleInit, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { TokenInfoService } from '../services/token-info.service';
import { WatchedTokensService } from '../services/watched-tokens.service';
import { TokenInfoModule } from '../integrations/token-info.module';
import { DatabaseModule } from './database.module';

@Injectable()
class SparklineScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SparklineScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tokenInfoService: TokenInfoService,
    private readonly watchedTokensService: WatchedTokensService,
  ) {}

  async onModuleInit() {
    const periodMs = 180_000; // fixed 3 minutes
    const tick = async () => {
      try {
        const addresses = await this.watchedTokensService.listWatchedAddresses('FAVORITES');
        if (addresses.length === 0) return;
        // Cap cohort size per tick to 150
        const cap = 150;
        const nowIdx = Math.floor(Date.now() / periodMs) % Math.max(1, Math.ceil(addresses.length / cap));
        const start = nowIdx * cap;
        const slice = addresses.slice(start, start + cap);
        if (slice.length > 0) {
          await this.tokenInfoService.triggerTokenInfoEnrichment(slice, 'system-sparkline-scheduler');
        }
      } catch (e) {
        this.logger.debug(`scheduler tick failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    // First delayed kick, then repeat
    this.timer = setInterval(tick, periodMs);
    // Run once shortly after start
    setTimeout(tick, Math.floor(periodMs / 3));
  }

  async onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

@Module({
  imports: [DatabaseModule, TokenInfoModule],
  providers: [SparklineScheduler, WatchedTokensService],
})
export class SchedulerModule {}


