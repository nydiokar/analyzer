import { Queue } from 'bullmq';
import { redisConfig } from '../../src/queues/config/redis.config';

async function clearAllQueues() {
  console.log('🧹 Starting queue cleanup...');
  
  const queueNames = [
    'wallet-operations',
    'analysis-operations', 
    'similarity-operations',
    'enrichment-operations'  // Added this one!
  ];

  for (const queueName of queueNames) {
    try {
      console.log(`\n📋 Clearing queue: ${queueName}`);
      
      const queue = new Queue(queueName, { connection: redisConfig });
      
      // Get stats before clearing
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();
      
      console.log(`   📊 Before: ${waiting.length} waiting, ${active.length} active, ${completed.length} completed, ${failed.length} failed`);
      
      // Clear all job states
      await queue.obliterate({ force: true });
      
      console.log(`   ✅ Queue ${queueName} cleared completely`);
      
      await queue.close();
    } catch (error) {
      console.error(`   ❌ Error clearing queue ${queueName}:`, error);
    }
  }
  
  console.log('\n🎉 All queues cleared!');
  console.log('💡 You can now start fresh similarity analyses without old enrichment jobs interfering.');
}

clearAllQueues().catch(console.error); 