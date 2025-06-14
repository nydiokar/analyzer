import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from 'nestjs-throttler';
import { ApiModule } from './api.module';
import { ConfigModule } from '@nestjs/config'; // For .env variable support
import { HeliusModule } from './api/helius/helius.module'; // Import the global HeliusModule
import { DatabaseModule } from './api/database/database.module'; // Import the global DatabaseModule
import { UsersModule } from './api/users/users.module';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyAuthGuard } from './api/auth/api-key-auth.guard';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60000, // 1 minute
      limit: 100, // 100 requests per minute
    }),
    ConfigModule.forRoot({ // Initialize ConfigModule to load .env variables
      isGlobal: true, // Make ConfigModule global
    }),
    DatabaseModule, // Import DatabaseModule (it's @Global, so its providers are available everywhere)
    HeliusModule, // Import HeliusModule (it's @Global, so its providers are available everywhere)
    ApiModule,
    UsersModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiKeyAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {} 