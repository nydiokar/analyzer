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
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CompositeAuthGuard } from './api/shared/guards/composite-auth.guard';
import { AdminGuard } from './api/shared/guards/admin.guard';
import { CreditGuard } from './api/shared/guards/credit.guard';
import { CreditInterceptor } from './api/shared/interceptors/credit.interceptor';
import { SentryModule } from '@sentry/nestjs/setup';
import { MetricsModule } from './api/modules/metrics.module';
import { CreditsModule } from './api/modules/credits.module';

@Module({
  imports: [
    SentryModule.forRoot(), // Add Sentry monitoring
    MetricsModule, // Add Prometheus metrics
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{
      ttl: 60000, // 1 minute in milliseconds
      limit: 200, // 500 requests per minute (increased for concurrent job testing)
    }]),
    ConfigModule.forRoot({ // Initialize ConfigModule to load .env variables
      isGlobal: true, // Make ConfigModule global
    }),
    DatabaseModule, // Import DatabaseModule (it's @Global, so its providers are available everywhere)
    HeliusModule, // Import HeliusModule (it's @Global, so its providers are available everywhere)
    AuthModule, // Import AuthModule for JWT and composite authentication
    QueueModule, // Add queue module for BullMQ integration
    CreditsModule, // Credit ledger — global, provides CreditsService everywhere
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
    {
      provide: APP_GUARD,
      useClass: AdminGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CreditGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CreditInterceptor,
    },
  ],
})
export class AppModule {} 