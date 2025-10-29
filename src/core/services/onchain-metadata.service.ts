import { Injectable } from '@nestjs/common';
import { HeliusApiClient } from './helius-api-client';
import * as https from 'https';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('OnchainMetadataService');

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
        // Prefer CDN URL for faster loading
        imageUrl: asset.content?.files?.[0]?.cdn_uri ||
                  asset.content?.files?.[0]?.uri || null,
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

    logger.info(`Fetching social links from ${tokens.length} URIs`);
    const results: SocialLinks[] = [];

    // Process in smaller batches to avoid overwhelming gateways
    const batchSize = 10;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);

      const promises = batch.map(async ({ mint, uri }) => {
        try {
          const metadata = await this.fetchMetadataFromUri(uri);
          return {
            mint,
            twitter: metadata?.twitter || null,
            website: metadata?.website || null,
            telegram: metadata?.telegram || null,
            discord: metadata?.discord || null,
          };
        } catch (error: any) {
          logger.debug(`Failed to fetch metadata for ${mint}: ${error.message}`);
          return {
            mint,
            twitter: null,
            website: null,
            telegram: null,
            discord: null,
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

    logger.info(`Successfully fetched social links for ${results.filter(r => r.twitter || r.website).length}/${tokens.length} tokens`);
    return results;
  }

  /**
   * Fetch and parse JSON from IPFS/Arweave URI
   * Handles both IPFS and Arweave gateways with appropriate timeouts
   */
  private async fetchMetadataFromUri(uri: string): Promise<any> {
    return new Promise((resolve, reject) => {
      try {
        const url = new URL(uri);

        // Determine timeout based on gateway type
        // Arweave gateways are slower than IPFS
        const isArweave = uri.includes('irys.xyz') || uri.includes('arweave');
        const timeout = isArweave ? 20000 : 10000; // 20s for Arweave, 10s for IPFS

        const options: https.RequestOptions = {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          timeout,
          agent: this.httpsAgent, // Reuse connections
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TokenAnalyzer/1.0)',
          },
        };

        const req = https.request(options, (res) => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }

          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (e) {
              reject(new Error(`Invalid JSON from ${uri}`));
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
