import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BalanceCacheService } from './balance-cache.service';
import { TokenInfoModule } from '../token-info/token-info.module';

@Module({
  imports: [DatabaseModule, TokenInfoModule], // BalanceCacheService depends on DatabaseService and TokenInfoService
  providers: [BalanceCacheService],
  exports: [BalanceCacheService],
})
export class BalanceCacheModule {} 