import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseService as CoreDatabaseService } from '../../core/services/database-service';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { HeliusSyncService } from '../../core/services/helius-sync-service';

@Global() // Make its providers globally available
@Module({
  imports: [
    ConfigModule, // Relies on ConfigModule being globally available (from AppModule)
  ],
  providers: [
    CoreDatabaseService, // Provide the core DatabaseService
    {
      provide: HeliusApiClient,
      useFactory: (configService: ConfigService, coreDbService: CoreDatabaseService) => {
        const logger = new Logger('HeliusApiClientFactory');
        logger.log('--- HeliusApiClientFactory EXECUTING ---'); // Crucial log
        const apiKey = configService.get<string>('HELIUS_API_KEY');
        
        // --- DEBUGGING LINE ---
        logger.log(`[DEBUG] Attempting to read HELIUS_API_KEY. Value: ${apiKey ? '********' + apiKey.slice(-4) : '<<<< UNDEFINED >>>>'}`);
        // --- END DEBUGGING ---

        if (!apiKey) {
          logger.error('HELIUS_API_KEY is not configured.');
          throw new Error('HELIUS_API_KEY is not configured.');
        }
        // Ensure HeliusApiConfig matches the constructor of HeliusApiClient
        return new HeliusApiClient({ apiKey, network: 'mainnet' }, coreDbService);
      },
      inject: [ConfigService, CoreDatabaseService], // Inject dependencies for the factory
    },
    HeliusSyncService, // HeliusSyncService itself will get CoreDatabaseService and HeliusApiClient injected
  ],
  exports: [CoreDatabaseService, HeliusApiClient, HeliusSyncService], // Export them for other modules if HeliusModule wasn't global
})
export class HeliusModule {}
