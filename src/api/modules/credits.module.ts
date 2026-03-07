import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CreditsService } from '../services/credits.service';
import { X402VerificationService } from '../services/x402-verification.service';
import { RedisModule } from '../../queues/config/redis.module';

/**
 * CreditsModule — global, provides services to the entire app.
 *
 * Guards and interceptors (CreditGuard, CreditInterceptor) are registered
 * as APP_GUARD / APP_INTERCEPTOR in AppModule — not here.
 */
@Global()
@Module({
  imports: [ConfigModule, RedisModule],
  providers: [CreditsService, X402VerificationService],
  exports: [CreditsService, X402VerificationService],
})
export class CreditsModule {}
