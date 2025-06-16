import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SimilarityApiService } from './similarity.service';

@Module({
  imports: [DatabaseModule],
  providers: [SimilarityApiService],
  exports: [SimilarityApiService],
})
export class SimilarityModule {} 