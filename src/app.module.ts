import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiModule } from './api.module';
import { ConfigModule } from '@nestjs/config'; // For .env variable support
import { HeliusModule } from './api/integrations/helius.module'; // Import the global HeliusModule
import { DatabaseModule } from './api/modules/database.module'; // Import the global DatabaseModule
import { UsersModule } from './api/modules/users.module';
import { AuthModule } from './api/modules/auth.module'; // Import the new AuthModule
import { QueueModule } from './queues/queue.module'; // Add BullMQ queue integration
import { APP_GUARD } from '@nestjs/core';
import { CompositeAuthGuard } from './api/shared/guards/composite-auth.guard';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{
      ttl: 60000, // 1 minute in milliseconds
      limit: 100, // 100 requests per minute
    }]),
    ConfigModule.forRoot({ // Initialize ConfigModule to load .env variables
      isGlobal: true, // Make ConfigModule global
    }),
    DatabaseModule, // Import DatabaseModule (it's @Global, so its providers are available everywhere)
    HeliusModule, // Import HeliusModule (it's @Global, so its providers are available everywhere)
    AuthModule, // Import AuthModule for JWT and composite authentication
    QueueModule, // Add queue module for BullMQ integration
    ApiModule,
    UsersModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CompositeAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {} 