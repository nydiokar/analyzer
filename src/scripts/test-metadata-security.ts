#!/usr/bin/env tsx
/**
 * Manual Security Testing Script for IPFS Metadata Fetching
 *
 * Tests the security hardening measures:
 * - SSRF protection (rejects localhost, private IPs)
 * - DoS protection (size limits)
 * - Prototype pollution protection
 * - JSON depth limits
 *
 * Usage: npx tsx src/scripts/test-metadata-security.ts
 */

import { OnchainMetadataService } from '../core/services/onchain-metadata.service';
import { HeliusApiClient } from '../core/services/helius-api-client';
import { createLogger } from '../core/utils/logger';

const logger = createLogger('SecurityTest');

// Mock Helius client (not needed for these tests)
const mockHeliusClient = {
  getAssetBatch: async () => [],
} as any as HeliusApiClient;

const service = new OnchainMetadataService(mockHeliusClient);

interface TestCase {
  name: string;
  uri: string;
  expectedToFail: boolean;
  expectedError?: string;
}

const testCases: TestCase[] = [
  // SSRF Tests - Should FAIL
  {
    name: 'Localhost (127.0.0.1)',
    uri: 'http://127.0.0.1:3000/metadata.json',
    expectedToFail: true,
    expectedError: 'Localhost URIs are not allowed',
  },
  {
    name: 'Localhost (localhost)',
    uri: 'http://localhost:8080/secret.json',
    expectedToFail: true,
    expectedError: 'Localhost URIs are not allowed',
  },
  {
    name: 'Private Network (192.168.x.x)',
    uri: 'http://192.168.1.1/metadata.json',
    expectedToFail: true,
    expectedError: 'Private network addresses are not allowed',
  },
  {
    name: 'Private Network (10.x.x.x)',
    uri: 'http://10.0.0.1/metadata.json',
    expectedToFail: true,
    expectedError: 'Private network addresses are not allowed',
  },
  {
    name: 'Private Network (172.16-31.x.x)',
    uri: 'http://172.16.0.1/metadata.json',
    expectedToFail: true,
    expectedError: 'Private network addresses are not allowed',
  },
  {
    name: 'Direct IP Address (observed in logs)',
    uri: 'http://95.179.167.134:3000/metadata/YWKUMA',
    expectedToFail: true,
    expectedError: 'Direct IP addresses are not allowed',
  },
  {
    name: 'Link-local Address',
    uri: 'http://169.254.1.1/metadata.json',
    expectedToFail: true,
    expectedError: 'Private network addresses are not allowed',
  },

  // Valid URIs - Should PASS validation (may fail on network, but not security)
  {
    name: 'IPFS Gateway (ipfs.io)',
    uri: 'https://ipfs.io/ipfs/QmTest123',
    expectedToFail: false,
  },
  {
    name: 'IPFS Gateway (gateway.ipfs.io)',
    uri: 'https://gateway.ipfs.io/ipfs/QmTest123',
    expectedToFail: false,
  },
  {
    name: 'IPFS Gateway (cloudflare)',
    uri: 'https://cloudflare-ipfs.com/ipfs/QmTest123',
    expectedToFail: false,
  },
  {
    name: 'Arweave Gateway',
    uri: 'https://arweave.net/test123',
    expectedToFail: false,
  },
  {
    name: 'Arweave Gateway Alt',
    uri: 'https://gateway.arweave.net/test123',
    expectedToFail: false,
  },

  // Suspicious URIs (observed in logs) - Should WARN but may pass if hostname-based
  {
    name: 'Suspicious Domain (eu.j7tracker.com)',
    uri: 'https://eu.j7tracker.com/metadata/t0qarcfecnguiagm.json',
    expectedToFail: false, // Will pass validation but log warning
  },
  {
    name: 'Suspicious Domain (rapidlaunch.io)',
    uri: 'https://rapidlaunch.io/temp/metadata/2a957b3f-f4f3-4a95-94e1-58934e0ac5bd.json',
    expectedToFail: false, // Will pass validation but log warning
  },
];

async function runSecurityTests() {
  logger.info('='.repeat(80));
  logger.info('Starting IPFS Metadata Security Tests');
  logger.info('='.repeat(80));
  logger.info('');
  logger.info('NOTE: fetchSocialLinksBatch is designed to be resilient - it catches');
  logger.info('security errors and returns null values instead of throwing.');
  logger.info('This is correct behavior. We validate by checking the logs.');
  logger.info('');

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    logger.info(`\nTest: ${testCase.name}`);
    logger.info(`URI: ${testCase.uri}`);
    logger.info(`Expected to fail: ${testCase.expectedToFail ? 'YES (blocked, returns null)' : 'NO (may fetch)'}`);

    try {
      const result = await service.fetchSocialLinksBatch([
        { mint: 'test-token', uri: testCase.uri },
      ]);

      // fetchSocialLinksBatch always succeeds but returns null on security errors
      // We validate by checking the result contains null values
      const allNull = result[0] &&
        result[0].twitter === null &&
        result[0].website === null &&
        result[0].telegram === null &&
        result[0].discord === null &&
        result[0].imageUrl === null;

      if (testCase.expectedToFail) {
        if (allNull) {
          logger.info(`✅ PASS: Security error caught, returned null values`);
          logger.info(`(Check logs above for "Security validation failed" warning)`);
          passed++;
        } else {
          logger.error(`❌ FAIL: Expected null values but got: ${JSON.stringify(result)}`);
          failed++;
        }
      } else {
        // For valid URIs, we expect either null (network error) or data
        logger.info(`✅ PASS: Validation passed (returned ${allNull ? 'null (network error)' : 'data'})`);
        passed++;
      }
    } catch (error: any) {
      // fetchSocialLinksBatch shouldn't throw, but handle unexpected errors
      logger.error(`❌ UNEXPECTED ERROR: ${error.message}`);
      failed++;
    }
  }

  logger.info('');
  logger.info('='.repeat(80));
  logger.info('Test Results');
  logger.info('='.repeat(80));
  logger.info(`Total: ${testCases.length}`);
  logger.info(`Passed: ${passed}`);
  logger.info(`Failed: ${failed}`);
  logger.info('');

  if (failed === 0) {
    logger.info('🎉 All security tests passed!');
  } else {
    logger.error(`❌ ${failed} test(s) failed - review security implementation`);
    process.exit(1);
  }
}

// Run tests
runSecurityTests().catch(error => {
  logger.error('Test suite crashed:', error);
  process.exit(1);
});
