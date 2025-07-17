#!/usr/bin/env ts-node
/**
 * Redis Lock Cleanup Script - Removes stuck locks from interrupted processes
 */

import Redis from 'ioredis';

class RedisLockCleaner {
  private redis: Redis;

  constructor() {
    // Create Redis connection with minimal valid config
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      maxRetriesPerRequest: null, // Required for BullMQ compatibility
      lazyConnect: true,
    });
  }

  async cleanAllLocks(): Promise<void> {
    console.log('🧹 Cleaning all Redis locks...');
    
    try {
      const patterns = [
        'lock:wallet:sync:*',
        'lock:wallet:pnl:*', 
        'lock:wallet:behavior:*',
        'lock:similarity:*'
      ];

      let totalCleaned = 0;
      
      for (const pattern of patterns) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          console.log(`Found ${keys.length} locks matching ${pattern}`);
          await this.redis.del(...keys);
          totalCleaned += keys.length;
        }
      }

      console.log(`✅ Cleaned ${totalCleaned} locks total`);
      
    } catch (error) {
      console.error('❌ Error cleaning locks:', error);
    } finally {
      await this.redis.disconnect();
    }
  }

  async listLocks(): Promise<void> {
    console.log('🔍 Current Redis locks:');
    
    try {
      const keys = await this.redis.keys('lock:*');
      
      if (keys.length === 0) {
        console.log('✅ No locks found');
        return;
      }

      for (const key of keys) {
        const value = await this.redis.get(key);
        const ttl = await this.redis.ttl(key);
        console.log(`${key} = ${value} (TTL: ${ttl}s)`);
      }
      
    } catch (error) {
      console.error('❌ Error listing locks:', error);
    } finally {
      await this.redis.disconnect();
    }
  }
}

async function main() {
  const cleaner = new RedisLockCleaner();
  const command = process.argv[2];
  
  if (command === 'list') {
    await cleaner.listLocks();
  } else {
    await cleaner.cleanAllLocks();
  }
}

if (require.main === module) {
  main();
} 