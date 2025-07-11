import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Prisma } from '@prisma/client';
import { DexscreenerService } from '../dexscreener/dexscreener.service';
import { ITokenInfoService } from '../../types/token-info-service.interface';

@Injectable()
export class TokenInfoService implements ITokenInfoService {
  private readonly logger = new Logger(TokenInfoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly dexscreenerService: DexscreenerService
    ) {}

  async triggerTokenInfoEnrichment(
    tokenAddresses: string[],
    userId: string,
  ): Promise<void> {

    await this.db.logActivity(userId, 'trigger_token_enrichment', {
      tokenCount: tokenAddresses.length,
    });

    const existingTokens = await this.findMany(tokenAddresses);
    // Update token prices every 5 minutes for active trading
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const existingTokenMap = new Map(existingTokens.map(t => [t.tokenAddress, t]));
    
    const newTokensToFetch = tokenAddresses.filter(address => {
      const existingToken = existingTokenMap.get(address);
      // Fetch if the token doesn't exist OR if it exists but hasn't been updated in the last 5 minutes.
      return !existingToken || !existingToken.dexscreenerUpdatedAt || existingToken.dexscreenerUpdatedAt < fiveMinutesAgo;
    });


    // This is no longer fire-and-forget. We must await completion.
    await this.dexscreenerService.fetchAndSaveTokenInfo(newTokensToFetch);
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