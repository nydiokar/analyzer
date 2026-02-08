/**
 * Clear HUD cache for a specific wallet or all wallets
 */

import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
});

async function main() {
  const walletAddress = process.argv[2];

  if (walletAddress && walletAddress !== 'all') {
    // Clear specific wallet
    const key = `wallet-hud:${walletAddress}`;
    const result = await redis.del(key);
    console.log(`✅ Cleared HUD cache for ${walletAddress} (${result} key deleted)`);
  } else {
    // Clear all HUD caches
    const pattern = 'wallet-hud:*';
    let cursor = '0';
    let totalDeleted = 0;

    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        const deleted = await redis.del(...keys);
        totalDeleted += deleted;
        console.log(`Deleted ${deleted} keys...`);
      }
    } while (cursor !== '0');

    console.log(`✅ Cleared ALL HUD caches (${totalDeleted} keys deleted)`);
  }

  await redis.quit();
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
});
