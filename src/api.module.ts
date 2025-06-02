import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { AuthMiddleware } from './api/auth/auth.middleware';
import { DatabaseModule } from './api/database/database.module';
import { TestController } from './api/test/test.controller';
// Import the main WalletsModule which groups wallet-related features and controllers
import { WalletsModule } from './api/wallets/wallets.module'; 
import { AnalysesModule } from './api/analyses/analyses.module'; // Import AnalysesModule

@Module({
  imports: [
    DatabaseModule, // Shared database access for any direct needs in ApiModule (e.g. Auth)
    WalletsModule,  // Imports all wallet-related features and controllers
    AnalysesModule, // Imports analysis triggering endpoints
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
      // Apply middleware. If WalletsController is correctly routed via WalletsModule,
      // this might need adjustment or ensure the controller path is caught.
      // For now, assuming WalletsController paths will be matched.
      .forRoutes(TestController, 'wallets', 'analyses'); // Target controller by path prefix if controller class isn't directly in this module's scope
  }
} 