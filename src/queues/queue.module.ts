import { Module, OnModuleInit, OnModuleDestroy, Global, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Configuration
import { QueueNames } from './config/queue.config';
import { redisConnection } from './config/redis.config';
import { RedisModule } from './config/redis.module'; // Import RedisModule

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

// External dependencies - Import modules that provide the services we need
import { DatabaseModule } from '../api/modules/database.module';
// HeliusModule is global from AppModule, no need to import
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
import { getErrorMessage, getErrorDetails } from '../core/utils/error-utils';


@Global()
@Module({
  imports: [
    ConfigModule,
    RedisModule, // Add RedisModule here
    
    // Register BullMQ queues with NestJS
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        connection: redisConnection,
      }),
      inject: [ConfigService],
    }),

    // Register individual queues
    BullModule.registerQueue(
      { name: QueueNames.WALLET_OPERATIONS },
      { name: QueueNames.ANALYSIS_OPERATIONS },
      { name: QueueNames.SIMILARITY_OPERATIONS },
      { name: QueueNames.ENRICHMENT_OPERATIONS }
    ),

    // Import modules that provide the services we need
    DatabaseModule,    // Provides DatabaseService
    // HeliusModule is global from AppModule, no need to import
    SimilarityModule,  // Provides SimilarityApiService
    BehaviorModule,    // Provides BehaviorService
    PnlAnalysisModule, // Provides PnlAnalysisService
    TokenInfoModule,   // Provides TokenInfoService
    DexscreenerModule, // Provides DexscreenerService
    WebSocketModule,   // Provides JobProgressGateway
    BalanceCacheModule, // Provides BalanceCacheService
    HolderProfilesCacheModule, // Provides HolderProfilesCacheService
    WalletHudModule,   // Provides WalletHudService
    SigBuyersModule,   // Provides SigBuyersService for the sig-buyers-run processor
  ],
  
  providers: [
    // Core Services
    RedisLockService,
    AlertingService,
    DeadLetterQueueService,
    QueueHealthService,
    JobEventsBridgeService,
    TelegramAlertsService,
    JobPayloadCacheService, // Cache service for storing large job payloads
    SystemWalletDetectionService, // System wallet detection and filtering

    // Queue Services
    WalletOperationsQueue,
    AnalysisOperationsQueue,
    SimilarityOperationsQueue,
    EnrichmentOperationsQueue,
    MintParticipantsJobsQueue,

    // Processors (services will be injected from imported modules)
    WalletOperationsProcessor,
    AnalysisOperationsProcessor,
    SimilarityOperationsProcessor,
    EnrichmentOperationsProcessor,
    PaymentReconciliationProcessor,
    PaymentConfirmationService,
  ],
  
  exports: [
    // Export RedisModule to make REDIS_CLIENT globally available
    RedisModule,

    // Export queue services for use in other modules
    WalletOperationsQueue,
    AnalysisOperationsQueue,
    SimilarityOperationsQueue,
    EnrichmentOperationsQueue,
    MintParticipantsJobsQueue,

    // Export core services for use in other modules
    RedisLockService,
    AlertingService,
    DeadLetterQueueService,
    QueueHealthService,
    JobEventsBridgeService,
    TelegramAlertsService,
    JobPayloadCacheService, // Export for controllers/services that need to cache job payloads
    SystemWalletDetectionService, // Export for system wallet filtering

    // Export processors if needed by other modules
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
  ) {}

  async onModuleInit() {
    // 🧹 CRITICAL: Clean up orphaned locks from previous server crashes/restarts
    // This prevents jobs from being permanently stuck due to locks held by dead processes
    this.logger.log('Starting orphaned lock cleanup on startup...');
    try {
      const cleanedCount = await this.redisLockService.cleanupOrphanedLocksOnStartup();
      if (cleanedCount > 0) {
        this.logger.warn(`🧹 Cleaned up ${cleanedCount} orphaned lock(s) from previous session`);
      } else {
        this.logger.log('✅ No orphaned locks found - system is clean');
      }
    } catch (error) {
      this.logger.error('❌ Failed to clean up orphaned locks (non-critical, continuing):', error);
    }

    // Register all queues with the health service for monitoring
    this.queueHealthService.registerQueue(QueueNames.WALLET_OPERATIONS, this.walletOperationsQueue.getQueue());
    this.queueHealthService.registerQueue(QueueNames.ANALYSIS_OPERATIONS, this.analysisOperationsQueue.getQueue());
    this.queueHealthService.registerQueue(QueueNames.SIMILARITY_OPERATIONS, this.similarityOperationsQueue.getQueue());
    this.queueHealthService.registerQueue(QueueNames.ENRICHMENT_OPERATIONS, this.enrichmentOperationsQueue.getQueue());

    this.logger.log('Queue module initialized - all queues registered for health monitoring');
  }

  async onModuleDestroy() {
    this.logger.log('Initiating graceful shutdown of queue module...');

    // Graceful shutdown: Stop accepting new jobs, finish current jobs, then close
    const shutdownPromises = [
      this.walletOperationsProcessor.shutdown(),
      this.analysisOperationsProcessor.shutdown(),
      this.similarityOperationsProcessor.shutdown(),
      this.enrichmentOperationsProcessor.shutdown(),
    ];

    try {
      // Wait for all workers to finish current jobs and close (max 30 seconds)
      await Promise.race([
        Promise.all(shutdownPromises),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timeout')), 30000)
        ),
      ]);

      this.logger.log('✅ Queue module shutdown completed successfully');
    } catch (error) {
      this.logger.error('⚠️ Queue module shutdown encountered errors:', getErrorMessage(error));
      // Force close queues to prevent hanging
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