import { Module } from '@nestjs/common';
import { TokenPerformanceService } from './token-performance.service';
import { DatabaseModule } from '../../database/database.module'; // Adjusted path

@Module({
  imports: [DatabaseModule],
  providers: [TokenPerformanceService],
  exports: [TokenPerformanceService],
})
export class TokenPerformanceModule {} 