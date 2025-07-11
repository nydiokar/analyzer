import { NestFactory } from '@nestjs/core';
import { Job } from 'bullmq';
import { AppModule } from '../../app.module';
import { SimilarityOperationsProcessor } from '../processors/similarity-operations.processor';
import { ComprehensiveSimilarityFlowData, SimilarityFlowResult } from '../jobs/types';

// This is the sandboxed process entry point
async function run(job: Job<ComprehensiveSimilarityFlowData>): Promise<SimilarityFlowResult> {
  // Bootstrap a standalone NestJS application context
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });

  // Get the processor instance from the app context
  const processor = app.get(SimilarityOperationsProcessor);
  
  // Call the actual processing logic
  // We are re-using the method on the processor, but it's now running in a separate process
  const result = await processor.processSimilarityFlow(job);

  await app.close();
  return result;
}

// BullMQ expects a default export from the worker file
export default run; 