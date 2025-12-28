import { Module, Global } from '@nestjs/common';
import { MetricsService } from '../services/metrics.service';
import { MetricsController } from '../controllers/metrics.controller';

@Global() // Make MetricsService available everywhere
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService], // Export so other modules can record metrics
})
export class MetricsModule {}
