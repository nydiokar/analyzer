import { Module, OnModuleInit } from '@nestjs/common';
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

// Services
import { RedisLockService } from './services/redis-lock.service';
import { AlertingService } from './services/alerting.service';
import { DeadLetterQueueService } from './services/dead-letter-queue.service';
import { QueueHealthService } from './services/queue-health.service';
import { JobEventsBridgeService } from './services/job-events-bridge.service';

// External dependencies - Import modules that provide the services we need
import { DatabaseModule } from '../api/modules/database.module';
import { HeliusModule } from '../api/integrations/helius.module';
import { SimilarityModule } from '../api/modules/similarity.module';
import { BehaviorModule } from '../api/modules/behavior.module';
import { PnlAnalysisModule } from '../api/modules/pnl-analysis.module';
import { TokenInfoModule } from '../api/integrations/token-info.module';
import { DexscreenerModule } from '../api/integrations/dexscreener.module';
import { WebSocketModule } from '../api/modules/websocket.module';
import { BalanceCacheModule } from '../api/modules/balance-cache.module';

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
    HeliusModule,      // Provides HeliusApiClient, HeliusSyncService (Global module)
    SimilarityModule,  // Provides SimilarityApiService
    BehaviorModule,    // Provides BehaviorService
    PnlAnalysisModule, // Provides PnlAnalysisService
    TokenInfoModule,   // Provides TokenInfoService
    DexscreenerModule, // Provides DexscreenerService
    WebSocketModule,   // Provides JobProgressGateway
    BalanceCacheModule, // Provides BalanceCacheService
  ],
  
  providers: [
    // Core Services
    RedisLockService,
    AlertingService,
    DeadLetterQueueService,
    QueueHealthService,
    JobEventsBridgeService,
    
    // Queue Services
    WalletOperationsQueue,
    AnalysisOperationsQueue,
    SimilarityOperationsQueue,
    EnrichmentOperationsQueue,

    // Processors (services will be injected from imported modules)
    WalletOperationsProcessor,
    AnalysisOperationsProcessor,
    SimilarityOperationsProcessor,
    EnrichmentOperationsProcessor,
  ],
  
  exports: [
    // Export queue services for use in other modules
    WalletOperationsQueue,
    AnalysisOperationsQueue,
    SimilarityOperationsQueue,
    EnrichmentOperationsQueue,
    
    // Export core services for use in other modules
    RedisLockService,
    AlertingService,
    DeadLetterQueueService,
    QueueHealthService,
    JobEventsBridgeService,
    
    // Export processors if needed by other modules
    WalletOperationsProcessor,
    AnalysisOperationsProcessor, 
    SimilarityOperationsProcessor,
    EnrichmentOperationsProcessor,
  ],
})
export class QueueModule implements OnModuleInit {
  constructor(
    private readonly queueHealthService: QueueHealthService,
    private readonly walletOperationsQueue: WalletOperationsQueue,
    private readonly analysisOperationsQueue: AnalysisOperationsQueue,
    private readonly similarityOperationsQueue: SimilarityOperationsQueue,
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
  ) {}

  async onModuleInit() {
    // Register all queues with the health service for monitoring
    this.queueHealthService.registerQueue(QueueNames.WALLET_OPERATIONS, this.walletOperationsQueue.getQueue());
    this.queueHealthService.registerQueue(QueueNames.ANALYSIS_OPERATIONS, this.analysisOperationsQueue.getQueue());
    this.queueHealthService.registerQueue(QueueNames.SIMILARITY_OPERATIONS, this.similarityOperationsQueue.getQueue());
    this.queueHealthService.registerQueue(QueueNames.ENRICHMENT_OPERATIONS, this.enrichmentOperationsQueue.getQueue());
  }
} 