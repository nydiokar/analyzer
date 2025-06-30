import * as crypto from 'crypto';

// Deterministic job ID generation prevents duplicate processing
export interface JobIdGenerator {
  syncWallet: (walletAddress: string, requestId?: string) => string;
  analyzePnl: (walletAddress: string, dependsOnSync?: string) => string;
  analyzeBehavior: (walletAddress: string, dependsOnSync?: string) => string;
  calculateSimilarity: (walletAddresses: string[], requestId: string) => string;
  enrichMetadata: (tokenAddress: string, requestId?: string) => string;
  fetchDexScreener: (tokenAddress: string, requestId?: string) => string;
}

export const generateJobId: JobIdGenerator = {
  syncWallet: (walletAddress: string, requestId = 'default') => {
    const hashInput = `sync-${walletAddress}-${requestId}`;
    return `sync-${crypto.createHash('md5').update(hashInput).digest('hex').slice(0, 8)}`;
  },
  
  analyzePnl: (walletAddress: string, dependsOnSync?: string) => {
    const dependency = dependsOnSync || 'standalone';
    const hashInput = `pnl-${walletAddress}-${dependency}`;
    return `pnl-${crypto.createHash('md5').update(hashInput).digest('hex').slice(0, 8)}`;
  },
  
  analyzeBehavior: (walletAddress: string, dependsOnSync?: string) => {
    const dependency = dependsOnSync || 'standalone';
    const hashInput = `behavior-${walletAddress}-${dependency}`;
    return `behavior-${crypto.createHash('md5').update(hashInput).digest('hex').slice(0, 8)}`;
  },
  
  calculateSimilarity: (walletAddresses: string[], requestId: string) => {
    // Sort addresses for consistent hashing regardless of input order
    const sortedAddresses = walletAddresses.sort().join('-');
    const hashInput = `similarity-${sortedAddresses}-${requestId}`;
    return `similarity-${crypto.createHash('md5').update(hashInput).digest('hex').slice(0, 12)}`;
  },
  
  enrichMetadata: (tokenAddress: string, requestId = 'default') => {
    const hashInput = `enrich-${tokenAddress}-${requestId}`;
    return `enrich-${crypto.createHash('md5').update(hashInput).digest('hex').slice(0, 8)}`;
  },
  
  fetchDexScreener: (tokenAddress: string, requestId = 'default') => {
    const hashInput = `dex-${tokenAddress}-${requestId}`;
    return `dex-${crypto.createHash('md5').update(hashInput).digest('hex').slice(0, 8)}`;
  }
};

// Utility function to validate job ID format
export function validateJobId(jobId: string, expectedType: string): boolean {
  const pattern = new RegExp(`^${expectedType}-[a-f0-9]{8,12}$`);
  return pattern.test(jobId);
}

// Extract job type from job ID
export function extractJobType(jobId: string): string | null {
  const match = jobId.match(/^([a-z]+)-[a-f0-9]{8,12}$/);
  return match ? match[1] : null;
} 