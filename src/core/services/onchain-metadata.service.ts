import { Injectable } from '@nestjs/common';
import { HeliusApiClient } from './helius-api-client';
import * as https from 'https';
import * as http from 'http';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('OnchainMetadataService');

// Security Configuration Constants
const MAX_METADATA_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_JSON_DEPTH = 20; // Maximum nesting depth
const MAX_ARRAY_LENGTH = 1000; // Maximum array size
const MAX_STRING_LENGTH = 10000; // Maximum string length
const ALLOWED_URI_SCHEMES = ['https:', 'http:'];
const TRUSTED_GATEWAYS = [
  'ipfs.io',
  'gateway.ipfs.io',
  'cloudflare-ipfs.com',
  'arweave.net',
  'gateway.arweave.net',
  'gateway.irys.xyz',
  'metadata.retlie.com',
  'moonitcdn.io',
  'actionapp.mypinata.cloud',
];

// Security error types (should not trigger retries)
class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export interface BasicTokenMetadata {
  mint: string;
  name: string | null;
  symbol: string | null;
  description: string | null;
  imageUrl: string | null;
  creator: string | null;
  metadataUri: string | null;
}

export interface SocialLinks {
  mint: string;
  twitter: string | null;
  website: string | null;
  telegram: string | null;
  discord: string | null;
  imageUrl: string | null; // Image from metadata JSON (fallback when DAS doesn't provide it)
}

/**
 * Validates URI for security risks (SSRF, malicious hosts)
 * @throws SecurityError if URI is unsafe
 */
function validateUri(uri: string): void {
  let url: URL;
  try {
    url = new URL(uri);
  } catch (e: any) {
    throw new SecurityError(`Invalid URI format: ${e.message}`);
  }

  // Check protocol
  if (!ALLOWED_URI_SCHEMES.includes(url.protocol)) {
    throw new SecurityError(`Unsupported protocol: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();

  // Reject localhost variants
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('127.') ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  ) {
    throw new SecurityError('Localhost URIs are not allowed');
  }

  // Reject private network IP addresses (SSRF protection)
  const privateIPPatterns = [
    /^192\.168\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^169\.254\./, // Link-local
    /^fc00:/i, // IPv6 ULA
    /^fe80:/i, // IPv6 link-local
  ];

  if (privateIPPatterns.some(pattern => pattern.test(hostname))) {
    throw new SecurityError('Private network addresses are not allowed');
  }

  // Reject direct IP addresses (require hostnames)
  // IPv4 pattern: 4 groups of 1-3 digits separated by dots
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6 pattern: hex groups separated by colons
  const ipv6Pattern = /^[0-9a-f:]+$/i;

  if (ipv4Pattern.test(hostname) || ipv6Pattern.test(hostname)) {
    // Allow only if it's a trusted gateway (though unlikely)
    if (!TRUSTED_GATEWAYS.includes(hostname)) {
      throw new SecurityError('Direct IP addresses are not allowed');
    }
  }

  // Log warning for HTTP (non-encrypted)
  if (url.protocol === 'http:') {
    logger.warn(`Insecure HTTP URI detected: ${sanitizeUriForLogging(uri)}`);
  }

  // Log warning for non-trusted gateways
  if (!TRUSTED_GATEWAYS.some(gateway => hostname.includes(gateway))) {
    logger.warn(`Non-trusted gateway: ${sanitizeUriForLogging(uri)}`);
  }
}

/**
 * Sanitizes URI for safe logging (removes sensitive query params)
 */
function sanitizeUriForLogging(uri: string): string {
  try {
    const url = new URL(uri);
    // Truncate long URIs and remove query params
    const base = `${url.protocol}//${url.hostname}${url.pathname}`;
    return base.length > 100 ? base.substring(0, 100) + '...' : base;
  } catch {
    // If parsing fails, just truncate
    return uri.length > 100 ? uri.substring(0, 100) + '...' : uri;
  }
}

/**
 * Sanitizes parsed metadata to remove prototype pollution vectors
 */
function sanitizeMetadata(obj: any, depth = 0): any {
  // Depth limit protection
  if (depth > MAX_JSON_DEPTH) {
    throw new SecurityError(`JSON nesting exceeds maximum depth of ${MAX_JSON_DEPTH}`);
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle primitives
  if (typeof obj !== 'object') {
    // String length limit
    if (typeof obj === 'string' && obj.length > MAX_STRING_LENGTH) {
      logger.warn(`String truncated from ${obj.length} to ${MAX_STRING_LENGTH} chars`);
      return obj.substring(0, MAX_STRING_LENGTH);
    }
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    if (obj.length > MAX_ARRAY_LENGTH) {
      logger.warn(`Array truncated from ${obj.length} to ${MAX_ARRAY_LENGTH} elements`);
      obj = obj.slice(0, MAX_ARRAY_LENGTH);
    }
    return obj.map(item => sanitizeMetadata(item, depth + 1));
  }

  // Handle objects - use Object.create(null) for safety
  const sanitized: any = Object.create(null);

  for (const key of Object.keys(obj)) {
    // Strip prototype pollution keys
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      logger.warn(`Stripped dangerous key: ${key}`);
      continue;
    }

    sanitized[key] = sanitizeMetadata(obj[key], depth + 1);
  }

  return sanitized;
}

@Injectable()
export class OnchainMetadataService {
  // HTTP connection pooling for faster requests
  private httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000,
  });

  constructor(private heliusClient: HeliusApiClient) {}

  /**
   * STAGE 1: Fetch basic metadata from Helius DAS API (fast)
   * Uses getAssetBatch - supports up to 1000 tokens per call
   */
  async fetchBasicMetadataBatch(mints: string[]): Promise<BasicTokenMetadata[]> {
    if (!mints || mints.length === 0) return [];

    logger.info(`Fetching basic metadata for ${mints.length} tokens via DAS API`);

    try {
      // Call Helius DAS API
      const assets = await this.heliusClient.getAssetBatch(mints);

      const results = assets.map(asset => ({
        mint: asset.id,
        name: asset.content?.metadata?.name || null,
        symbol: asset.content?.metadata?.symbol || null,
        description: asset.content?.metadata?.description || null,
        // Prefer CDN for speed (100-300ms vs 2-10s for IPFS), fallback to raw URI
        // CDN URLs are served by Helius edge servers, much faster than decentralized gateways
        imageUrl: asset.content?.files?.[0]?.cdn_uri || asset.content?.files?.[0]?.uri || null,
        creator: asset.creators?.[0]?.address || null,
        metadataUri: asset.content?.json_uri || null,
      }));

      logger.info(`Successfully fetched basic metadata for ${results.length}/${mints.length} tokens`);
      return results;
    } catch (error) {
      logger.error('Failed to fetch basic metadata from DAS:', error);
      return [];
    }
  }

  /**
   * STAGE 3: Fetch social links from metadata URIs (slow, background)
   * Only fetches for tokens that need it
   */
  async fetchSocialLinksBatch(
    tokens: Array<{ mint: string; uri: string }>
  ): Promise<SocialLinks[]> {
    if (!tokens || tokens.length === 0) return [];

    const results: SocialLinks[] = [];

    // Process in smaller batches to avoid overwhelming gateways
    const batchSize = 10;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);

      const promises = batch.map(async ({ mint, uri }) => {
        try {
          const metadata = await this.fetchMetadataFromUriWithRetry(uri);
          return {
            mint,
            twitter: metadata?.twitter || null,
            website: metadata?.website || null,
            telegram: metadata?.telegram || null,
            discord: metadata?.discord || null,
            imageUrl: metadata?.image || null, // Capture image from metadata JSON
          };
        } catch (error: any) {
          // Log security violations more prominently than network errors
          if (error.name === 'SecurityError') {
            logger.warn(`Security violation for ${mint}: ${error.message}`);
          } else {
            logger.debug(`Failed to fetch metadata for ${mint}: ${error.message}`);
          }
          return {
            mint,
            twitter: null,
            website: null,
            telegram: null,
            discord: null,
            imageUrl: null,
          };
        }
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      // Small delay between batches
      if (i + batchSize < tokens.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return results;
  }

  /**
   * Fetch metadata from URI with retry logic
   * Retries up to 2 times with exponential backoff on network errors
   * Does NOT retry on security violations
   */
  private async fetchMetadataFromUriWithRetry(uri: string, maxAttempts = 2): Promise<any> {
    // Validate URI before attempting fetch (fail fast on security issues)
    try {
      validateUri(uri);
    } catch (error: any) {
      if (error instanceof SecurityError) {
        logger.warn(`Security validation failed for URI: ${error.message}`);
        throw error; // Don't retry security errors
      }
      throw error;
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.fetchMetadataFromUri(uri);
      } catch (error: any) {
        lastError = error;

        // NEVER retry security errors
        if (error instanceof SecurityError) {
          throw error;
        }

        // Don't retry on client errors (4xx) - only retry on network issues
        if (error.message.includes('HTTP 4')) {
          throw error;
        }

        // Only retry on network errors and timeouts
        const shouldRetry =
          error.message.includes('Network error') ||
          error.message.includes('Timeout') ||
          error.message.includes('ECONNRESET') ||
          error.message.includes('ETIMEDOUT');

        if (!shouldRetry || attempt === maxAttempts) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        logger.debug(`Retry ${attempt}/${maxAttempts} for ${sanitizeUriForLogging(uri)} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * Fetch and parse JSON from IPFS/Arweave URI
   * Handles both IPFS and Arweave gateways with appropriate timeouts
   * Includes security protections: size limits, Content-Type checks, sanitization
   */
  private async fetchMetadataFromUri(uri: string): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(uri);

        // FAST timeout - fail quickly on broken URIs
        const timeout = 3000; // 3 seconds max per URI

        // Select protocol module based on URL scheme
        const protocolModule = url.protocol === 'https:' ? https : http;

        const options: https.RequestOptions = {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          timeout,
          agent: url.protocol === 'https:' ? this.httpsAgent : undefined, // Reuse connections for HTTPS
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TokenAnalyzer/1.0)',
            'Accept': 'application/json',
          },
        };

        const req = protocolModule.request(options, (res) => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }

          // Content-Type verification (warning only, not blocking)
          const contentType = res.headers['content-type'] || '';
          if (!contentType.includes('application/json') && !contentType.includes('text/plain')) {
            logger.warn(
              `Unexpected Content-Type "${contentType}" from ${sanitizeUriForLogging(uri)}`
            );
          }

          let data = '';
          let totalSize = 0;

          res.on('data', (chunk) => {
            totalSize += chunk.length;

            // Size limit check - destroy connection if exceeded
            if (totalSize > MAX_METADATA_SIZE) {
              res.destroy();
              return reject(
                new SecurityError(
                  `Response size exceeds maximum of ${MAX_METADATA_SIZE / 1024 / 1024}MB`
                )
              );
            }

            data += chunk;
          });

          res.on('end', () => {
            try {
              // Parse JSON
              const parsed = JSON.parse(data);

              // Sanitize to prevent prototype pollution and enforce limits
              const sanitized = sanitizeMetadata(parsed);

              resolve(sanitized);
            } catch (e: any) {
              if (e instanceof SecurityError) {
                reject(e);
              } else {
                reject(new Error(`Invalid JSON from ${sanitizeUriForLogging(uri)}: ${e.message}`));
              }
            }
          });
        });

        req.on('error', (e) => {
          reject(new Error(`Network error: ${e.message}`));
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error(`Timeout after ${timeout}ms`));
        });

        req.end();
      } catch (e: any) {
        reject(new Error(`Invalid URI: ${e.message}`));
      }
    });
  }
}
