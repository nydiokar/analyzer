import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from 'api/modules/database.module';
import { DatabaseService } from 'api/services/database.service';
import { EvmApiClient } from 'core/services/evm-api-client';
import { EvmSyncService } from 'core/services/evm-sync-service';

@Module({
  imports: [ConfigModule, DatabaseModule],
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
      useFactory: (evmApiClient: EvmApiClient, databaseService: DatabaseService) => {
        return new EvmSyncService(evmApiClient, databaseService);
      },
      inject: [EvmApiClient, DatabaseService],
    },
  ],
  exports: [EvmApiClient, EvmSyncService],
})
export class EvmModule {}
