import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Configuration
import { QueueNames } from './config/queue.config';
import { redisConnection } from './config/redis.config';

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

// External dependencies - Import modules that provide the services we need
import { DatabaseModule } from '../api/database/database.module';
import { HeliusModule } from '../api/helius/helius.module';
import { SimilarityModule } from '../api/analyses/similarity/similarity.module';
import { BehaviorModule } from '../api/wallets/behavior/behavior.module';
import { PnlAnalysisModule } from '../api/pnl_analysis/pnl-analysis.module';
import { TokenInfoModule } from '../api/token-info/token-info.module';
import { DexscreenerModule } from '../api/dexscreener/dexscreener.module';

@Module({
  imports: [
    ConfigModule,
    
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
  ],
  
  providers: [
    // Redis Lock Service
    RedisLockService,
    
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
    
    // Export Redis lock service for use in other processors
    RedisLockService,
    
    // Export processors if needed by other modules
    WalletOperationsProcessor,
    AnalysisOperationsProcessor, 
    SimilarityOperationsProcessor,
    EnrichmentOperationsProcessor,
  ],
})
export class QueueModule {} 