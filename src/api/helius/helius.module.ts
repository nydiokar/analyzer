import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { HeliusSyncService } from '../../core/services/helius-sync-service';
import { SmartFetchService } from '../../core/services/smart-fetch-service';
import { WalletClassificationService } from '../../core/services/wallet-classification.service';
import { DatabaseModule } from '../database/database.module';

@Global()
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
  ],
  providers: [
    {
      provide: HeliusApiClient,
      useFactory: (configService: ConfigService, dbService: DatabaseService) => {
        const logger = new Logger('HeliusApiClientFactory');
        const apiKey = configService.get<string>('HELIUS_API_KEY');

        if (!apiKey) {
          logger.error('HELIUS_API_KEY is not configured.');
          throw new Error('HELIUS_API_KEY is not configured.');
        }
        return new HeliusApiClient({ apiKey, network: 'mainnet' }, dbService);
      },
      inject: [ConfigService, DatabaseService],
    },
    WalletClassificationService,
    {
      provide: SmartFetchService,
      useFactory: (classificationService: WalletClassificationService) => {
        return new SmartFetchService(classificationService);
      },
      inject: [WalletClassificationService],
    },
    {
      provide: HeliusSyncService,
      useFactory: (dbService: DatabaseService, heliusClient: HeliusApiClient, smartFetchService: SmartFetchService) => {
        return new HeliusSyncService(dbService, heliusClient, smartFetchService);
      },
      inject: [DatabaseService, HeliusApiClient, SmartFetchService],
    },
  ],
  exports: [HeliusApiClient, HeliusSyncService, SmartFetchService, WalletClassificationService],
})
export class HeliusModule {}
