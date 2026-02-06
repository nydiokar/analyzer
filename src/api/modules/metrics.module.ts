import { Module, Global } from '@nestjs/common';
import { MetricsService } from '../services/metrics.service';
import { MetricsController } from '../controllers/metrics.controller';
import { BullMQMetricsCollectorService } from '../services/bullmq-metrics-collector.service';

@Global() // Make MetricsService available everywhere
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    BullMQMetricsCollectorService, // Automatically starts polling on app init
  ],
  exports: [MetricsService], // Export so other modules can record metrics
})
export class MetricsModule {}
