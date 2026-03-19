import { BadRequestException, Injectable } from '@nestjs/common';
import { prisma } from '../../core/services/database-service';
import { WatchedTokensService, type WatchedTokenRow } from './watched-tokens.service';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';

@Injectable()
export class UserWatchedTokensService {
  constructor(private readonly watchedTokensService: WatchedTokensService) {}

  async listForUser(userId: string): Promise<WatchedTokenRow[]> {
    const rows = await prisma.userWatchedToken.findMany({
      where: { userId },
      select: { tokenAddress: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.watchedTokensService.buildRowsForAddresses(rows.map((row) => row.tokenAddress));
  }

  async setWatched(userId: string, tokenAddress: string, on: boolean) {
    if (!isValidSolanaAddress(tokenAddress)) {
      throw new BadRequestException('Invalid Solana token address');
    }

    if (on) {
      await this.watchedTokensService.ensureTokenInfoRecords([tokenAddress]);
      await prisma.userWatchedToken.upsert({
        where: { userId_tokenAddress: { userId, tokenAddress } },
        update: {},
        create: { userId, tokenAddress },
      });
      await this.watchedTokensService.triggerTokenEnrichment([tokenAddress]);
      return { ok: true, watched: true };
    }

    await prisma.userWatchedToken.deleteMany({
      where: { userId, tokenAddress },
    });
    return { ok: true, watched: false };
  }
}
