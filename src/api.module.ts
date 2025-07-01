import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { AuthMiddleware } from './api/auth/auth.middleware';
import { DatabaseModule } from './api/database/database.module';
import { TestController } from './api/test/test.controller';
// Import the main WalletsModule which groups wallet-related features and controllers
import { WalletsModule } from './api/wallets/wallets.module'; 
import { AnalysesModule } from './api/analyses/analyses.module'; // Import AnalysesModule
import { UsersModule } from './api/users/users.module'; // Import the new UsersModule
import { DexscreenerModule } from './api/dexscreener/dexscreener.module';
import { TokenInfoModule } from './api/token-info/token-info.module';
import { HealthModule } from './api/health/health.module';
import { JobsModule } from './api/jobs/jobs.module'; // Import JobsModule for job status API
import { WebSocketModule } from './api/websocket/websocket.module'; // Import WebSocketModule for real-time updates

@Module({
  imports: [
    DatabaseModule, // Shared database access for any direct needs in ApiModule (e.g. Auth)
    WalletsModule,  // Imports all wallet-related features and controllers
    AnalysesModule, // Imports analysis triggering endpoints
    UsersModule,    // Add UsersModule here
    DexscreenerModule,
    TokenInfoModule,
    HealthModule,
    JobsModule,     // Imports job status API endpoints
    WebSocketModule, // Imports WebSocket gateway for real-time job progress
    // BehaviorModule is now imported by WalletsModule, so remove from here if not directly used by ApiModule itself
  ],
  controllers: [
    TestController,
    // WalletsController is now part of WalletsModule, so remove from here
  ],
  providers: [
    // API specific services that are not part of a feature module
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.GET },
      )
      .forRoutes('*');
  }
} 