import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseService } from '../services/database.service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { HeliusSyncService } from '../../core/services/helius-sync-service';
import { SmartFetchService } from '../../core/services/smart-fetch-service';
import { WalletClassificationService } from '../../core/services/wallet-classification.service';
import { OnchainMetadataService } from '../../core/services/onchain-metadata.service';
import { DatabaseModule } from '../modules/database.module';

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
    {
      provide: OnchainMetadataService,
      useFactory: (configService: ConfigService, dbService: DatabaseService, heliusClient: HeliusApiClient) => {
        const logger = new Logger('OnchainMetadataServiceFactory');

        // Check if separate metadata API key is configured
        const metadataApiKey = configService.get<string>('HELIUS_METADATA_API_KEY');

        if (metadataApiKey) {
          logger.log('Using separate Helius API key for metadata enrichment');
          // Create dedicated client for metadata with separate rate limits
          const metadataClient = new HeliusApiClient(
            { apiKey: metadataApiKey, network: 'mainnet' },
            dbService
          );
          return new OnchainMetadataService(metadataClient);
        } else {
          logger.log('Using main Helius API key for metadata enrichment');
          // Reuse main client
          return new OnchainMetadataService(heliusClient);
        }
      },
      inject: [ConfigService, DatabaseService, HeliusApiClient],
    },
  ],
  exports: [HeliusApiClient, HeliusSyncService, SmartFetchService, WalletClassificationService, OnchainMetadataService],
})
export class HeliusModule {}
