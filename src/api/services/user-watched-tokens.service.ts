import { BadRequestException, Injectable } from '@nestjs/common';
import { prisma } from '../../core/services/database-service';
import { WatchedTokensService, type WatchedTokenRow } from './watched-tokens.service';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';

function normalizeUserTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) continue;
    if (!/^[a-z0-9_-]+$/.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= 10) break;
  }
  return out;
}

@Injectable()
export class UserWatchedTokensService {
  constructor(private readonly watchedTokensService: WatchedTokensService) {}

  async listForUser(userId: string): Promise<WatchedTokenRow[]> {
    const rows = await prisma.userWatchedToken.findMany({
      where: { userId },
      select: { tokenAddress: true, tags: true },
      orderBy: { createdAt: 'desc' },
    });
    const baseRows = await this.watchedTokensService.buildRowsForAddresses(rows.map((row) => row.tokenAddress));
    const tagsByAddress = new Map(rows.map((row) => [row.tokenAddress, row.tags ?? []]));
    return baseRows.map((row) => ({
      ...row,
      userTags: tagsByAddress.get(row.tokenAddress) ?? [],
    }));
  }

  async setWatched(userId: string, tokenAddress: string, on: boolean, tags?: string[]) {
    if (!isValidSolanaAddress(tokenAddress)) {
      throw new BadRequestException('Invalid Solana token address');
    }

    const normalizedTags = normalizeUserTags(tags);

    if (on) {
      await this.watchedTokensService.ensureTokenInfoRecords([tokenAddress]);
      await prisma.userWatchedToken.upsert({
        where: { userId_tokenAddress: { userId, tokenAddress } },
        update: normalizedTags.length > 0 ? { tags: normalizedTags } : {},
        create: { userId, tokenAddress, tags: normalizedTags },
      });
      await this.watchedTokensService.triggerTokenEnrichment([tokenAddress]);
      return { ok: true, watched: true };
    }

    await prisma.userWatchedToken.deleteMany({
      where: { userId, tokenAddress },
    });
    return { ok: true, watched: false };
  }

  async updateTags(userId: string, tokenAddress: string, tags: string[]) {
    if (!isValidSolanaAddress(tokenAddress)) {
      throw new BadRequestException('Invalid Solana token address');
    }

    const normalizedTags = normalizeUserTags(tags);
    const existing = await prisma.userWatchedToken.findUnique({
      where: { userId_tokenAddress: { userId, tokenAddress } },
      select: { userId: true, tokenAddress: true },
    });
    if (!existing) {
      throw new BadRequestException('Token is not in your watchlist');
    }

    await prisma.userWatchedToken.update({
      where: { userId_tokenAddress: { userId, tokenAddress } },
      data: { tags: normalizedTags },
    });

    return { ok: true, tags: normalizedTags };
  }
}
