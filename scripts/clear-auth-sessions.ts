import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, { maxRetriesPerRequest: 3 });

type PatternResult = { pattern: string; deleted: number };

async function deleteByPattern(pattern: string): Promise<PatternResult> {
  let cursor = '0';
  let deleted = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = nextCursor;

    if (keys.length > 0) {
      const res = await redis.del(...keys);
      deleted += res;
    }
  } while (cursor !== '0');

  return { pattern, deleted };
}

async function run() {
  const patterns = [
    'refresh_token:*', // legacy plaintext mappings
    'refresh_token_hash:*', // new hashed mappings
    'refresh_session:*',
    'user_sessions:*',
  ];

  console.log(`Cleaning auth session keys in Redis at ${redisUrl} ...`);
  const results: PatternResult[] = [];

  for (const pattern of patterns) {
    const result = await deleteByPattern(pattern);
    results.push(result);
    console.log(`  ${pattern}: deleted ${result.deleted}`);
  }

  console.log('Done.');
  return results;
}

run()
  .catch((err) => {
    console.error('Failed to clean auth session keys:', err);
    process.exitCode = 1;
  })
  .finally(() => redis.disconnect());
