import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
});

async function clearWalletCache(address: string) {
  console.log(`\n🧹 Clearing cache for wallet: ${address}\n`);

  // Clear Redis cache (the detection service uses this key pattern)
  const cacheKey = `system-wallet:${address}`;

  try {
    const deleted = await redis.del(cacheKey);
    if (deleted > 0) {
      console.log(`✅ Cleared Redis cache key: ${cacheKey}`);
    } else {
      console.log(`ℹ️  No Redis cache found for: ${cacheKey}`);
    }
  } catch (error) {
    console.error(`❌ Failed to clear Redis cache:`, error);
  }

  console.log(`\n✅ Cache cleared! The next analysis will fetch fresh data from DB.`);
  console.log(`\nNOTE: Memory cache in the backend process will be cleared on next restart.\n`);

  await redis.quit();
}

const address = process.argv[2];
if (!address) {
  console.error('Usage: npx ts-node scripts/clear-wallet-cache.ts <address>');
  process.exit(1);
}

clearWalletCache(address).catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
