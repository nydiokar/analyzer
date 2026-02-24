import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CreditsService } from '../services/credits.service';

/**
 * CreditsModule — global so any module can inject CreditsService without
 * importing this module explicitly.
 *
 * Provides: CreditsService (balance queries, atomic topUp/deduct, signup bonus)
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
