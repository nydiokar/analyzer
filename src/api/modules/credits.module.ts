import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CreditsService } from '../services/credits.service';
import { CreditGuard } from '../shared/guards/credit.guard';
import { CreditInterceptor } from '../shared/interceptors/credit.interceptor';

/**
 * CreditsModule — global so any module can inject CreditsService without
 * importing this module explicitly.
 *
 * Provides:
 * - CreditsService (balance queries, atomic topUp/deduct, signup bonus)
 * - CreditGuard (pre-request balance check)
 * - CreditInterceptor (post-success credit deduction)
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [CreditsService, CreditGuard, CreditInterceptor],
  exports: [CreditsService, CreditGuard, CreditInterceptor],
})
export class CreditsModule {}
