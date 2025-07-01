import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SimilarityOperationsQueue } from './queues/similarity-operations.queue';
import { generateJobId } from './utils/job-id-generator';

/**
 * Backend Integration Test
 * Tests: Full queue system integration with NestJS backend and real services
 * Prerequisites: Redis running + backend services available
 */
async function testBackendIntegration() {
  console.log('🧪 Testing BullMQ Backend Integration...');
  console.log('🔌 Ensure Redis is running: docker run -d -p 6379:6379 redis:latest');
  
  // Initialize the full NestJS application
  console.log('🏗️ Initializing NestJS application...');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'] // Reduce noise, but keep important logs
  });
  
  try {
    await app.init();
    console.log('✅ NestJS application initialized');
    
    // Get the queue service from the app context
    const similarityQueue = app.get(SimilarityOperationsQueue);
    console.log('✅ SimilarityOperationsQueue service retrieved');
    
    // Create a test job with real data
    const testWallets = [
      'Dj8MAV63ZoYGmgj5t3BQuBDK2pkJmgshmY2pPrfBHuHS',
      '2Dr7TyDcwRBo6JvWMUXPn6Sb9R2JN3Z2tvbXT311wDHE' 
    ];

    const jobData = {
      walletAddresses: testWallets,
      requestId: 'backend-integration-test',
      failureThreshold: 0.8,
      timeoutMinutes: 5, // Shorter timeout for testing
      similarityConfig: {
        vectorType: 'capital' as const,
        excludeMints: [],
        timeRange: {
          from: undefined,
          to: undefined
        }
      }
    };

    console.log('📤 Creating similarity analysis job...');
    const job = await similarityQueue.addSimilarityAnalysisFlow(jobData);
    console.log(`✅ Job created with ID: ${job.id}`);
    
    // Monitor job progress
    console.log('👀 Monitoring job progress...');
    let attempts = 0;
    const maxAttempts = 30; // 5 minutes with 10-second intervals
    
    while (attempts < maxAttempts) {
      const state = await job.getState();
      const progress = job.progress;
      
      console.log(`📊 Job status: ${state}, Progress: ${progress}%`);
      
      if (state === 'completed') {
        console.log('✅ Job completed successfully!');
        const result = job.returnvalue;
        console.log('📋 Result summary:');
        console.log(`   - Success: ${result?.success}`);
        console.log(`   - Processed wallets: ${result?.metadata?.processedWallets}`);
        console.log(`   - Processing time: ${result?.metadata?.processingTimeMs}ms`);
        break;
      } else if (state === 'failed') {
        console.log('❌ Job failed!');
        console.log('Error:', job.failedReason);
        throw new Error(`Job failed: ${job.failedReason}`);
      } else if (state === 'active') {
        console.log('⚡ Job is actively processing...');
      } else {
        console.log(`⏳ Job waiting in state: ${state}`);
      }
      
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
    }
    
    if (attempts >= maxAttempts) {
      throw new Error('Job did not complete within expected time');
    }
    
    // Clean up test data
    console.log('🧹 Cleaning up test data...');
    await similarityQueue.getQueue().obliterate({ force: true });
    
    console.log('✅ Backend integration test completed successfully!');
    console.log('🎉 Ready to proceed with B tasks (WalletOperationsProcessor, etc.)');
    
  } catch (error) {
    console.error('❌ Backend integration test failed:', error);
    throw error;
  } finally {
    // Always close the application
    await app.close();
    console.log('🔒 NestJS application closed');
  }
}

// Error handling wrapper
async function runTest() {
  try {
    await testBackendIntegration();
  } catch (error) {
    console.error('❌ Integration test failed:', error);
    process.exit(1);
  }
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  runTest();
}

export { testBackendIntegration }; 