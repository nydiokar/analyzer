import { NestFactory } from '@nestjs/core';
import { Job } from 'bullmq';
import { AppModule } from '../../app.module';
import { SimilarityOperationsProcessor } from '../processors/similarity-operations.processor';
import { ComprehensiveSimilarityFlowData, SimilarityFlowResult } from '../jobs/types';

// This is the sandboxed process entry point
async function run(job: Job<ComprehensiveSimilarityFlowData>): Promise<SimilarityFlowResult> {
  let app: any;
  try {
    // Bootstrap a standalone NestJS application context
    // Use abortOnError: false to prevent worker crashes from affecting main app
    app = await NestFactory.createApplicationContext(AppModule, { 
      logger: ['error', 'warn', 'log'],
      abortOnError: false 
    });

    // Get the processor instance from the app context
    const processor = app.get(SimilarityOperationsProcessor);
    
    // Call the actual processing logic
    // We are re-using the method on the processor, but it's now running in a separate process
    const result = await processor.processSimilarityFlow(job);

    return result;
  } catch (error) {
    // Log the error for debugging but don't let it crash the process
    console.error('Similarity worker error:', error);
    
    // Give time for failure events to be published before shutting down
    await new Promise(resolve => setTimeout(resolve, 100));
    
    throw error;
  } finally {
    // Always clean up the NestJS app context to prevent memory leaks
    if (app) {
      try {
        await app.close();
      } catch (closeError) {
        console.error('Error closing NestJS app context:', closeError);
      }
    }
  }
}

// BullMQ expects a default export from the worker file
export default run; 