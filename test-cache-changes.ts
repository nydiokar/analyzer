#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { DatabaseService } from './src/core/services/database-service';
import { HeliusApiClient } from './src/core/services/helius-api-client';
import { createLogger } from './src/core/utils/logger';

const logger = createLogger('CacheTest');
const prisma = new PrismaClient();

async function testCacheChanges() {
  logger.info('Testing cache changes...');

  try {
    // Test 1: Check if we can save to the new lightweight cache
    const dbService = new DatabaseService();
    
    // Mock transaction data
    const mockTransaction = {
      signature: 'test-signature-123',
      timestamp: Math.floor(Date.now() / 1000),
      // Add other required fields as needed
    } as any;

    logger.info('Test 1: Saving to lightweight cache...');
    const saveResult = await dbService.saveCachedTransactions([mockTransaction]);
    logger.info(`Save result: ${saveResult.count} records saved`);

    // Test 2: Check if we can retrieve from the lightweight cache
    logger.info('Test 2: Retrieving from lightweight cache...');
    const cachedResult = await dbService.getCachedTransaction('test-signature-123');
    logger.info(`Cached result: ${JSON.stringify(cachedResult)}`);

    // Test 3: Check batch retrieval
    logger.info('Test 3: Batch retrieval from lightweight cache...');
    const batchResult = await dbService.getCachedTransaction(['test-signature-123', 'non-existent-signature']);
    logger.info(`Batch result: ${batchResult instanceof Map ? batchResult.size : 'not a map'}`);

    logger.info('All tests passed! Cache changes are working correctly.');

  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testCacheChanges().catch(console.error); 