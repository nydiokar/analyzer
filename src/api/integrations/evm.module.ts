import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from 'api/modules/database.module';
import { DatabaseService } from 'api/services/database.service';
import { PnlAnalysisModule } from 'api/modules/pnl-analysis.module';
import { PnlAnalysisService } from 'api/services/pnl-analysis.service';
import { BehaviorModule } from 'api/modules/behavior.module';
import { BehaviorService } from 'api/services/behavior.service';
import { WalletHudModule } from 'api/modules/wallet-hud.module';
import { WalletHudService } from 'api/services/wallet-hud.service';
import { EvmApiClient } from 'core/services/evm-api-client';
import { EvmSyncService } from 'core/services/evm-sync-service';

@Module({
  imports: [ConfigModule, DatabaseModule, PnlAnalysisModule, BehaviorModule, WalletHudModule],
  providers: [
    {
      provide: EvmApiClient,
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('EvmApiClientFactory');
        const alchemyApiKey = configService.get<string>('ALCHEMY_API_KEY');

        if (!alchemyApiKey) {
          logger.warn('ALCHEMY_API_KEY not configured — EVM API calls will be unauthenticated and rate-limited.');
        }

        return new EvmApiClient({ alchemyApiKey });
      },
      inject: [ConfigService],
    },
    {
      provide: EvmSyncService,
      useFactory: (
        evmApiClient: EvmApiClient,
        databaseService: DatabaseService,
        pnlAnalysisService: PnlAnalysisService,
        behaviorService: BehaviorService,
        walletHudService: WalletHudService,
      ) => {
        return new EvmSyncService(evmApiClient, databaseService, pnlAnalysisService, behaviorService, walletHudService);
      },
      inject: [EvmApiClient, DatabaseService, PnlAnalysisService, BehaviorService, WalletHudService],
    },
  ],
  exports: [EvmApiClient, EvmSyncService],
})
export class EvmModule {}
