import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BalanceCacheService } from './balance-cache.service';

@Module({
  imports: [DatabaseModule], // BalanceCacheService depends on DatabaseService
  providers: [BalanceCacheService],
  exports: [BalanceCacheService],
})
export class BalanceCacheModule {} 