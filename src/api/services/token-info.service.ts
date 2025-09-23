import { Injectable, Logger } from '@nestjs/common';
import { SparklineService } from './sparkline.service';
import { DatabaseService } from '../services/database.service';
import { Prisma } from '@prisma/client';
import { DexscreenerService } from '../services/dexscreener.service';
import { ITokenInfoService } from '../../types/token-info-service.interface';

@Injectable()
export class TokenInfoService implements ITokenInfoService {
  private readonly logger = new Logger(TokenInfoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly dexscreenerService: DexscreenerService,
    private readonly sparklineService: SparklineService,
    ) {}

  async triggerTokenInfoEnrichment(
    tokenAddresses: string[],
    userId: string,
  ): Promise<void> {
    const startTime = Date.now();

    await this.db.logActivity(userId, 'trigger_token_enrichment', {
      tokenCount: tokenAddresses.length,
    });

    const existingTokens = await this.findMany(tokenAddresses);
    // Reasonable cache expiry: 1 hour for metadata, configurable minutes for prices
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const priceTtlMinutes = Number(process.env.DEXSCREENER_PRICE_TTL_MINUTES ?? '1');
    const priceTtlMs = Math.max(1, priceTtlMinutes) * 60 * 1000;
    const priceCutoff = new Date(Date.now() - priceTtlMs);

    const existingTokenMap = new Map(existingTokens.map(t => [t.tokenAddress, t]));
    
    const newTokensToFetch = tokenAddresses.filter(address => {
      const existingToken = existingTokenMap.get(address);
      
      // Skip tokens that are clearly placeholders (Unknown Token with no real data)
      if (existingToken?.name === 'Unknown Token' && !existingToken.priceUsd && !existingToken.marketCapUsd) {
        // Only refresh placeholders if they're older than 1 hour
        return !existingToken.dexscreenerUpdatedAt || existingToken.dexscreenerUpdatedAt < oneHourAgo;
      }
      
      // For tokens with real data, check if metadata is stale (1 hour) or price is stale (configurable)
      if (existingToken) {
        const metadataStale = !existingToken.dexscreenerUpdatedAt || existingToken.dexscreenerUpdatedAt < oneHourAgo;
        const priceStale = !existingToken.priceUsd || !existingToken.dexscreenerUpdatedAt || existingToken.dexscreenerUpdatedAt < priceCutoff;
        
        // Only fetch if metadata is stale OR if we have price data but it's stale
        return metadataStale || (existingToken.priceUsd && priceStale);
      }
      
      // New token - always fetch
      return true;
    });

    // This is no longer fire-and-forget. We must await completion.
    await this.dexscreenerService.fetchAndSaveTokenInfo(newTokensToFetch);

    // Append sparkline snapshots for tokens we just refreshed (Phase 3)
    try {
      const refreshed = await this.findMany(newTokensToFetch);
      await this.sparklineService.appendMany(
        refreshed.map((r) => {
          const priceStr = (r as any).priceUsd as string | null;
          const price = priceStr ? Number(priceStr) : NaN;
          return { addr: r.tokenAddress, price };
        })
      );
    } catch (e) {
      this.logger.debug(`sparkline snapshot append failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    // Log success status
    const durationMs = Date.now() - startTime;
    await this.db.logActivity(userId, 'trigger_token_enrichment', {
      tokenCount: tokenAddresses.length,
      newTokensFetched: newTokensToFetch.length,
    }, 'SUCCESS', durationMs);
  }

  async findMany(tokenAddresses: string[]) {
    return this.db.findManyTokenInfo(tokenAddresses);
  }

  /**
   * Finds multiple TokenInfo records but only returns a partial set of fields.
   * This is optimized for the similarity lab's "skeleton" load and does not
   * affect the ITokenInfoService interface.
   */
  async findManyPartial(tokenAddresses: string[]) {
    // This method is not part of the ITokenInfoService interface
    return this.db.findManyTokenInfoPartial(tokenAddresses);
  }

  async upsertMany(data: Prisma.TokenInfoCreateInput[]) {
    if (data.length === 0) {
      return;
    }

    this.logger.log(`Upserting ${data.length} token info records.`);

    try {
      await this.db.upsertManyTokenInfo(data);
      this.logger.log(`Successfully upserted ${data.length} token info records.`);
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error('Error during bulk upsert of token info:', error.message, error.stack);
      } else {
        this.logger.error('An unknown error occurred during bulk upsert of token info:', error);
      }
    }
  }
} 