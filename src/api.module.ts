import { Module } from '@nestjs/common';
import { DatabaseModule } from './api/modules/database.module';
import { TestController } from './api/controllers/test.controller';
// Import the main WalletsModule which groups wallet-related features and controllers
import { WalletsModule } from './api/modules/wallets.module';
import { AnalysesModule } from './api/modules/analyses.module'; // Import AnalysesModule
import { UsersModule } from './api/modules/users.module'; // Import the new UsersModule
import { AdminModule } from './api/modules/admin.module'; // Import AdminModule for admin panel
import { AuthModule } from './api/modules/auth.module'; // Import AuthModule for authentication services
import { DexscreenerModule } from './api/integrations/dexscreener.module';
import { TokenInfoModule } from './api/integrations/token-info.module';
import { HealthModule } from './api/modules/health.module';
import { JobsModule } from './api/modules/jobs.module'; // Import JobsModule for job status API
import { WebSocketModule } from './api/modules/websocket.module'; // Import WebSocketModule for real-time updates
import { HeliusWebhookModule } from './api/integrations/helius-webhook.module';
import { DiscoverModule } from './api/modules/discover.module';
import { WalletHudModule } from './api/modules/wallet-hud.module';
import { WalletRepresentationModule } from './api/modules/wallet-representation.module';
import { WalletHuntModule } from './api/modules/wallet-hunt.module';
import { PaymentModule } from './api/modules/payment.module';
import { IntelModule } from './api/modules/intel.module';
import { RadarModule } from './api/modules/radar.module';
import { SigBuyersModule } from './api/modules/sig-buyers.module';
import { MessagesModule } from './api/modules/messages.module';
import { ShareModule } from './api/modules/share.module';
import { TokenValidationController } from './api/controllers/token-validation.controller';
import { HttpModule } from '@nestjs/axios';


@Module({
  imports: [
    DatabaseModule, // Shared database access for any direct needs in ApiModule (e.g. Auth)
    // AuthModule is @Global and imported in AppModule - no need to import here
    WalletsModule,  // Imports all wallet-related features and controllers
    AnalysesModule, // Imports analysis triggering endpoints
    UsersModule,    // Add UsersModule here
    AdminModule,    // Admin panel for API key management
    DexscreenerModule,
    TokenInfoModule,
    HealthModule,
    JobsModule,     // Imports job status API endpoints
    WebSocketModule, // Imports WebSocket gateway for real-time job progress
    HeliusWebhookModule, // Helius webhook integration
    DiscoverModule,
    WalletHudModule, // Wallet HUD (Heads-Up Display) for high-signal metrics
    WalletRepresentationModule, // SPEC-001/002 representation signals for the dashboard (SURFACE-1)
    WalletHuntModule, // Wallet Hunt for detecting person wallets via token intersection
    PaymentModule,    // Solana Pay credit pack checkout
    IntelModule,      // External product API for devs and agents
    RadarModule,      // Holdings Radar — analyst-gated wallet monitoring
    SigBuyersModule,  // Significant Buyers — find wallets that bought a token in a time window
    MessagesModule,   // Chat, token threads, watched tokens, alerts
    ShareModule,      // Shareable holder-profiles snapshot links
    HttpModule,       // For token validation controller
    // QueueModule, HeliusModule, DatabaseModule are already global from AppModule
    // BehaviorModule is now imported by WalletsModule, so remove from here if not directly used by ApiModule itself
  ],
  controllers: [
    TestController,
    TokenValidationController,
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
