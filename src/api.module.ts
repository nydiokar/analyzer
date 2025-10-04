import { Module } from '@nestjs/common';
import { DatabaseModule } from './api/modules/database.module';
import { TestController } from './api/controllers/test.controller';
// Import the main WalletsModule which groups wallet-related features and controllers
import { WalletsModule } from './api/modules/wallets.module'; 
import { AnalysesModule } from './api/modules/analyses.module'; // Import AnalysesModule
import { UsersModule } from './api/modules/users.module'; // Import the new UsersModule
import { DexscreenerModule } from './api/integrations/dexscreener.module';
import { TokenInfoModule } from './api/integrations/token-info.module';
import { HealthModule } from './api/modules/health.module';
import { JobsModule } from './api/modules/jobs.module'; // Import JobsModule for job status API
import { WebSocketModule } from './api/modules/websocket.module'; // Import WebSocketModule for real-time updates
import { HeliusWebhookModule } from './api/integrations/helius-webhook.module';
import { MessagesModule } from './api/modules/messages.module';
import { TokenValidationController } from './api/controllers/token-validation.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    HttpModule, // For token validation
    DatabaseModule, // Shared database access for any direct needs in ApiModule (e.g. Auth)
    WalletsModule,  // Imports all wallet-related features and controllers
    AnalysesModule, // Imports analysis triggering endpoints
    UsersModule,    // Add UsersModule here
    DexscreenerModule,
    TokenInfoModule,
    HealthModule,
    JobsModule,     // Imports job status API endpoints
    WebSocketModule, // Imports WebSocket gateway for real-time job progress
    HeliusWebhookModule, // Helius webhook integration
    MessagesModule, // Messages (chat + threads)
    // QueueModule, HeliusModule, DatabaseModule are already global from AppModule
    // BehaviorModule is now imported by WalletsModule, so remove from here if not directly used by ApiModule itself
  ],
  controllers: [
    TestController,
    TokenValidationController, // Token address validation endpoint
     // WalletsController is now part of WalletsModule, so remove from here
     // HeliusWebhookController is now part of HeliusWebhookModule
  ],
  providers: [
    // API specific services that are not part of a feature module
  ],
})
export class ApiModule {
  // Removed middleware configuration - using global ApiKeyAuthGuard instead
  // The global guard handles all authentication including:
  // - API key validation with caching
  // - Demo user permissions  
  // - @Public decorator support for health endpoint
} 