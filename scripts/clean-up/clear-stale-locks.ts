import Redis from 'ioredis';

async function clearStaleLocks() {
  console.log('🔓 Starting stale lock cleanup...');
  
  // Connect to Redis
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: 3,
  });

  try {
    // Define lock patterns used by the system
    const lockPatterns = [
      'lock:similarity:*',    // Similarity analysis locks
      'lock:enrichment:*',    // Enrichment locks  
      'lock:analysis:*',      // Analysis locks
      'lock:wallet:*',        // Wallet operation locks
      'lock:pnl:*',          // PnL analysis locks
      'lock:behavior:*',     // Behavior analysis locks
    ];

    console.log('🔍 Searching for stale locks...');
    
    let totalLocksCleared = 0;
    
    for (const pattern of lockPatterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        console.log(`🗑️  Found ${keys.length} locks matching pattern: ${pattern}`);
        await redis.del(...keys);
        totalLocksCleared += keys.length;
        console.log(`✅ Cleared ${keys.length} locks for pattern: ${pattern}`);
      }
    }

    if (totalLocksCleared === 0) {
      console.log('✨ No stale locks found - system is clean!');
    } else {
      console.log(`🎉 Successfully cleared ${totalLocksCleared} stale locks!`);
    }
    
  } catch (error) {
    console.error('❌ Error clearing stale locks:', error);
    throw error;
  } finally {
    await redis.quit();
  }
}

// Run the cleanup
clearStaleLocks()
  .then(() => {
    console.log('✨ Stale lock cleanup completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Stale lock cleanup failed:', error);
    process.exit(1);
  }); 