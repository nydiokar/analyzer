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
    const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

    const existingTokenMap = new Map(existingTokens.map(t => [t.tokenAddress, t]));
    
    const newTokensToFetch = tokenAddresses.filter(address => {
      const existingToken = existingTokenMap.get(address);
      // Fetch if the token doesn't exist OR if it exists but hasn't been updated in the last 15 days.
      return !existingToken || existingToken.updatedAt < fifteenDaysAgo;
    });


    // This is a fire-and-forget call. We don't await it.
    this.dexscreenerService.fetchAndSaveTokenInfo(newTokensToFetch);
  }

  async findMany(tokenAddresses: string[]) {
    return this.db.findManyTokenInfo(tokenAddresses);
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