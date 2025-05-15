import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { AuthMiddleware } from './auth/auth.middleware';
import { DatabaseModule } from '../database/database.module'; // Import DatabaseModule
import { BehaviorModule } from '../behavior/behavior.module'; // <--- ADD THIS LINE
import { TestController } from './test/test.controller';
import { WalletsController } from './wallets/wallets.controller'; // <--- ADD THIS LINE
// Import controllers and providers that will belong to this module later
// import { WalletsController } from './wallets/wallets.controller';
// import { BehaviorService } from '../wallet_analysis/services/behavior-service'; // Example if used directly

@Module({
  imports: [
    DatabaseModule, // Make DatabaseService available for injection in this module
    BehaviorModule, // <--- ADD THIS LINE
  ],
  controllers: [
    TestController,
    WalletsController, // <--- ADD THIS LINE
    // WalletsController, // Add controllers here as they are created
  ],
  providers: [
    // Add API specific services here if any
    // BehaviorService, // Example: If BehaviorService needs to be injectable and is not in its own module
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      // Apply middleware to all routes within the specified controllers
      .forRoutes(TestController, WalletsController);
  }
} 