import { Module, OnModuleInit, OnModuleDestroy, Global, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Configuration
import { QueueNames } from './config/queue.config';
import { redisConnection } from './config/redis.config';
import { RedisModule } from './config/redis.module';

// Queues
import { WalletOperationsQueue } from './queues/wallet-operations.queue';
import { AnalysisOperationsQueue } from './queues/analysis-operations.queue';
import { SimilarityOperationsQueue } from './queues/similarity-operations.queue';
import { EnrichmentOperationsQueue } from './queues/enrichment-operations.queue';

// Processors
import { WalletOperationsProcessor } from './processors/wallet-operations.processor';
import { AnalysisOperationsProcessor } from './processors/analysis-operations.processor';
import { SimilarityOperationsProcessor } from './processors/similarity-operations.processor';
import { EnrichmentOperationsProcessor } from './processors/enrichment-operations.processor';
import { PaymentReconciliationProcessor } from './processors/payment-reconciliation.processor';

// Services
import { RedisLockService } from './services/redis-lock.service';
import { AlertingService } from './services/alerting.service';
import { DeadLetterQueueService } from './services/dead-letter-queue.service';
import { QueueHealthService } from './services/queue-health.service';
import { JobEventsBridgeService } from './services/job-events-bridge.service';
import { JobPayloadCacheService } from '../api/services/job-payload-cache.service';
import { SystemWalletDetectionService } from '../api/services/system-wallet-detection.service';

// External dependencies
import { DatabaseModule } from '../api/modules/database.module';
import { SimilarityModule } from '../api/modules/similarity.module';
import { BehaviorModule } from '../api/modules/behavior.module';
import { PnlAnalysisModule } from '../api/modules/pnl-analysis.module';
import { TokenInfoModule } from '../api/integrations/token-info.module';
import { DexscreenerModule } from '../api/integrations/dexscreener.module';
import { WebSocketModule } from '../api/modules/websocket.module';
import { BalanceCacheModule } from '../api/modules/balance-cache.module';
import { HolderProfilesCacheModule } from '../api/modules/holder-profiles-cache.module';
import { WalletHudModule } from '../api/modules/wallet-hud.module';
import { MintParticipantsJobsQueue } from './queues/mint-participants.queue';
import { TelegramAlertsService } from '../api/services/telegram-alerts.service';
import { SigBuyersModule } from '../api/modules/sig-buyers.module';
import { PaymentConfirmationService } from '../api/services/payment-confirmation.service';
import { getErrorMessage } from '../core/utils/error-utils';
import { MarketContextModule } from '../api/modules/market-context.module';
import { MarketContextService } from '../api/services/market-context.service';
import { DailyAggregationService } from '../core/services/daily-aggregation.service';
import { DailyAggregationJob } from './jobs/daily-aggregation.job';

@Global()
@Module({
  imports: [
    ConfigModule,
    RedisModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (_configService: ConfigService) => ({
        connection: redisConnection,
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: QueueNames.WALLET_OPERATIONS },
      { name: QueueNames.ANALYSIS_OPERATIONS },
      { name: QueueNames.SIMILARITY_OPERATIONS },
      { name: QueueNames.ENRICHMENT_OPERATIONS },
    ),
    DatabaseModule,
    SimilarityModule,
    BehaviorModule,
    PnlAnalysisModule,
    TokenInfoModule,
    DexscreenerModule,
    WebSocketModule,
    BalanceCacheModule,
    HolderProfilesCacheModule,
    WalletHudModule,
    SigBuyersModule,
    MarketContextModule,
  ],
  providers: [
    RedisLockService,
    AlertingService,
    DeadLetterQueueService,
    QueueHealthService,
    JobEventsBridgeService,
    TelegramAlertsService,
    JobPayloadCacheService,
    SystemWalletDetectionService,
    WalletOperationsQueue,
    AnalysisOperationsQueue,
    SimilarityOperationsQueue,
    EnrichmentOperationsQueue,
    MintParticipantsJobsQueue,
    WalletOperationsProcessor,
    AnalysisOperationsProcessor,
    SimilarityOperationsProcessor,
    EnrichmentOperationsProcessor,
    PaymentReconciliationProcessor,
    PaymentConfirmationService,
    DailyAggregationService,
    DailyAggregationJob,
  ],
  exports: [
    RedisModule,
    WalletOperationsQueue,
    AnalysisOperationsQueue,
    SimilarityOperationsQueue,
    EnrichmentOperationsQueue,
    MintParticipantsJobsQueue,
    RedisLockService,
    AlertingService,
    DeadLetterQueueService,
    QueueHealthService,
    JobEventsBridgeService,
    TelegramAlertsService,
    JobPayloadCacheService,
    SystemWalletDetectionService,
    WalletOperationsProcessor,
    AnalysisOperationsProcessor,
    SimilarityOperationsProcessor,
    EnrichmentOperationsProcessor,
    PaymentReconciliationProcessor,
    PaymentConfirmationService,
  ],
})
export class QueueModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueModule.name);

  constructor(
    private readonly queueHealthService: QueueHealthService,
    private readonly redisLockService: RedisLockService,
    private readonly walletOperationsQueue: WalletOperationsQueue,
    private readonly analysisOperationsQueue: AnalysisOperationsQueue,
    private readonly similarityOperationsQueue: SimilarityOperationsQueue,
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
    private readonly walletOperationsProcessor: WalletOperationsProcessor,
    private readonly analysisOperationsProcessor: AnalysisOperationsProcessor,
    private readonly similarityOperationsProcessor: SimilarityOperationsProcessor,
    private readonly enrichmentOperationsProcessor: EnrichmentOperationsProcessor,
    private readonly marketContextService: MarketContextService,
  ) {}

  async onModuleInit() {
    this.logger.log('Starting orphaned lock cleanup on startup...');
    try {
      const cleanedCount = await this.redisLockService.cleanupOrphanedLocksOnStartup();
      if (cleanedCount > 0) {
        this.logger.warn(`Cleaned up ${cleanedCount} orphaned lock(s) from previous session`);
      } else {
        this.logger.log('No orphaned locks found - system is clean');
      }
    } catch (error) {
      this.logger.error('Failed to clean up orphaned locks (non-critical, continuing):', error);
    }

    this.queueHealthService.registerQueue(QueueNames.WALLET_OPERATIONS, this.walletOperationsQueue.getQueue());
    this.queueHealthService.registerQueue(QueueNames.ANALYSIS_OPERATIONS, this.analysisOperationsQueue.getQueue());
    this.queueHealthService.registerQueue(QueueNames.SIMILARITY_OPERATIONS, this.similarityOperationsQueue.getQueue());
    this.queueHealthService.registerQueue(QueueNames.ENRICHMENT_OPERATIONS, this.enrichmentOperationsQueue.getQueue());

    this.logger.log('Queue module initialized - all queues registered for health monitoring');

    this.initSolPriceCache().catch((err) => {
      this.logger.warn(`SOL price cache init failed (non-critical): ${getErrorMessage(err)}`);
    });
  }

  private async initSolPriceCache(): Promise<void> {
    await this.marketContextService.appendTodaySolPrice();
  }

  async onModuleDestroy() {
    this.logger.log('Initiating graceful shutdown of queue module...');

    const shutdownPromises = [
      this.walletOperationsProcessor.shutdown(),
      this.analysisOperationsProcessor.shutdown(),
      this.similarityOperationsProcessor.shutdown(),
      this.enrichmentOperationsProcessor.shutdown(),
    ];

    try {
      await Promise.race([
        Promise.all(shutdownPromises),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timeout')), 30000),
        ),
      ]);

      this.logger.log('Queue module shutdown completed successfully');
    } catch (error) {
      this.logger.error('Queue module shutdown encountered errors:', getErrorMessage(error));
      await Promise.allSettled([
        this.walletOperationsQueue.getQueue().close(),
        this.analysisOperationsQueue.getQueue().close(),
        this.similarityOperationsQueue.getQueue().close(),
        this.enrichmentOperationsQueue.getQueue().close(),
      ]);
      this.logger.warn('Force closed all queues after shutdown timeout');
    }
  }
}
