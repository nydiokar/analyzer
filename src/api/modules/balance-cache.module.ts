import { Module } from '@nestjs/common';
import { DatabaseModule } from '../modules/database.module';
import { BalanceCacheService } from '../services/balance-cache.service';
import { TokenInfoModule } from '../integrations/token-info.module';

@Module({
  imports: [DatabaseModule, TokenInfoModule], // BalanceCacheService depends on DatabaseService and TokenInfoService
  providers: [BalanceCacheService],
  exports: [BalanceCacheService],
})
export class BalanceCacheModule {} 