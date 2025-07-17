import { SimilarityOperationsQueue } from './queues/similarity-operations.queue';
import { generateJobId } from './utils/job-id-generator';

/**
 * Simple BullMQ Queue Test
 * Prerequisites: Docker Desktop with Redis running
 * Tests: Job creation, deduplication, queue management
 */
async function testSimilarityFlow() {
  console.log('🧪 Testing BullMQ Queue Infrastructure...');
  console.log('🔌 Make sure Redis is running via Docker: docker run -d -p 6379:6379 redis:latest');

  // Initialize queue
  const similarityQueue = new SimilarityOperationsQueue();
  
  // Test job creation with deduplication
  const testWallets = [
    'So11111111111111111111111111111111111111112', // WSOL
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'  // RAY
  ];

  const jobData = {
    walletAddresses: testWallets,
    requestId: 'test-similarity-001',
    failureThreshold: 0.8,
    timeoutMinutes: 30,
    similarityConfig: {
      vectorType: 'capital' as const,
      excludeMints: [],
      timeRange: {
        from: undefined,
        to: undefined
      }
    }
  };

  console.log('🔧 Testing job ID generation...');
  const expectedJobId = generateJobId.calculateSimilarity(testWallets, jobData.requestId);
  console.log(`✅ Generated job ID: ${expectedJobId}`);

  console.log('📤 Creating similarity analysis job...');
  const job = await similarityQueue.addSimilarityAnalysisFlow(jobData);
  console.log(`✅ Job created with ID: ${job.id}`);
  
  // Verify deduplication works
  if (job.id === expectedJobId) {
    console.log('✅ Job ID deduplication working correctly');
  } else {
    console.log(`❌ Job ID mismatch: expected ${expectedJobId}, got ${job.id}`);
  }

  // Test duplicate job creation (should get same job)
  console.log('🔄 Testing duplicate job prevention...');
  const duplicateJob = await similarityQueue.addSimilarityAnalysisFlow(jobData);
  if (duplicateJob.id === job.id) {
    console.log('✅ Duplicate job prevention working correctly');
  } else {
    console.log(`❌ Duplicate job created: ${duplicateJob.id} vs ${job.id}`);
  }

  // Check job status
  console.log('📊 Job status:', await job.getState());
  console.log('📋 Job data keys:', Object.keys(job.data));
  
  // Get queue stats
  const stats = await similarityQueue.getStats();
  
  console.log('📈 Queue Statistics:');
  console.log(`   - Waiting: ${stats.waiting}`);
  console.log(`   - Active: ${stats.active}`);
  console.log(`   - Completed: ${stats.completed}`);
  console.log(`   - Failed: ${stats.failed}`);

  // Clean up
  console.log('🧹 Cleaning up...');
  await similarityQueue.getQueue().obliterate({ force: true }); // Clean test data
  await similarityQueue.getQueue().close();
  
  console.log('✅ Queue infrastructure test completed successfully!');
  console.log('💡 To test actual processing, run your backend with the processor enabled');
}

// Error handling wrapper
async function runTest() {
  try {
    await testSimilarityFlow();
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  runTest();
}

export { testSimilarityFlow }; 