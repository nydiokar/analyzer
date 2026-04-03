import { Module } from '@nestjs/common';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import { AnalysisOperationsQueue } from '../../queues/queues/analysis-operations.queue';
import { SimilarityOperationsQueue } from '../../queues/queues/similarity-operations.queue';
import { RedisLockService } from '../../queues/services/redis-lock.service';
import { JobEventsBridgeService } from '../../queues/services/job-events-bridge.service';
import { IntelController } from '../controllers/intel.controller';
import { WalletHudService } from '../services/wallet-hud.service';
import { DatabaseService } from '../services/database.service';
import { BehaviorService } from '../services/behavior.service';
import { PnlOverviewService } from '../services/pnl-overview.service';
import { TokenPerformanceService } from '../services/token-performance.service';

const OPENAPI_STUB = {};

@Module({
  controllers: [IntelController],
  providers: [
    { provide: WalletHudService, useValue: OPENAPI_STUB },
    { provide: DatabaseService, useValue: OPENAPI_STUB },
    { provide: BehaviorService, useValue: OPENAPI_STUB },
    { provide: PnlOverviewService, useValue: OPENAPI_STUB },
    { provide: TokenPerformanceService, useValue: OPENAPI_STUB },
    { provide: AnalysisOperationsQueue, useValue: OPENAPI_STUB },
    { provide: SimilarityOperationsQueue, useValue: OPENAPI_STUB },
    { provide: RedisLockService, useValue: OPENAPI_STUB },
    { provide: JobEventsBridgeService, useValue: OPENAPI_STUB },
    { provide: REDIS_CLIENT, useValue: OPENAPI_STUB },
  ],
})
export class IntelOpenApiModule {}
