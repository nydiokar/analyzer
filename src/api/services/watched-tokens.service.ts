import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { TokenInfoService } from './token-info.service';

export interface WatchedTokenRow {
  tokenAddress: string;
  name?: string | null;
  symbol?: string | null;
  imageUrl?: string | null;
  marketCapUsd?: number | null;
  liquidityUsd?: number | null;
  latestMessageAt?: string | null; // ISO
  tags: Array<{ name: string; type: string }>; // normalized lower-case names
}

@Injectable()
export class WatchedTokensService {
  constructor(private readonly db: DatabaseService, private readonly tokenInfoService: TokenInfoService) {}

  async ensureWatchedAndEnrich(tokenAddresses: string[], userId?: string) {
    if (tokenAddresses.length === 0) return;
    await this.db.$transaction(async (tx) => {
      const client = tx as any;
      for (const addr of Array.from(new Set(tokenAddresses))) {
        // Ensure TokenInfo exists FIRST to satisfy FK on WatchedToken
        const ti = await client.tokenInfo.findUnique({ where: { tokenAddress: addr } });
        if (!ti) {
          await client.tokenInfo.create({ data: { tokenAddress: addr, name: 'Unknown Token' } });
        }

        await client.watchedToken.upsert({
          where: { tokenAddress_list: { tokenAddress: addr, list: 'FAVORITES' } },
          create: { tokenAddress: addr, list: 'FAVORITES', createdBy: userId ?? null },
          update: {},
        });
      }
    });
    // Trigger enrichment async (do not await per-token; await batch)
    try {
      await this.tokenInfoService.triggerTokenInfoEnrichment(tokenAddresses, 'system-enrichment-job');
    } catch (e) {
      // swallow and log upstream
    }
  }

  async listWatched(list: 'FAVORITES' | 'GRADUATION' | 'HOLDSTRONG' = 'FAVORITES'): Promise<WatchedTokenRow[]> {
    return this.db.$transaction(async (tx) => {
      const client = tx as any;

      let watched = await client.watchedToken.findMany({
        where: { list },
        select: { tokenAddress: true, TokenInfo: { select: { name: true, symbol: true, imageUrl: true, marketCapUsd: true, liquidityUsd: true } } },
      });
      // Dedupe by tokenAddress in case of historical duplicates
      const seen = new Set<string>();
      watched = watched.filter((w: any) => (seen.has(w.tokenAddress) ? false : (seen.add(w.tokenAddress), true)));
      let addresses: string[] = watched.map((w: any) => w.tokenAddress);

      // No fallback: token repo shows only explicitly watched tokens
      if (addresses.length === 0) return [];

      // Fetch latest message timestamps per token via a single query, then reduce
      const relatedMessages = await client.message.findMany({
        where: { mentions: { some: { kind: 'TOKEN', refId: { in: addresses } } } },
        select: { id: true, createdAt: true, mentions: { select: { refId: true, kind: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });
      const latestByToken = new Map<string, string>();
      for (const msg of relatedMessages) {
        const tokenMention = (msg.mentions as Array<{ refId: string | null; kind: string }>).find((m) => m.kind === 'TOKEN' && m.refId && addresses.includes(m.refId));
        if (tokenMention && tokenMention.refId && !latestByToken.has(tokenMention.refId)) {
          latestByToken.set(tokenMention.refId, new Date(msg.createdAt).toISOString());
        }
        if (latestByToken.size === addresses.length) break;
      }

      // Fetch tags for all tokens in one query
      const tokenTags = await client.tokenTag.findMany({
        where: { tokenAddress: { in: addresses } },
        select: { tokenAddress: true, Tag: { select: { name: true, type: true } } },
      });
      const tagsByToken = new Map<string, Array<{ name: string; type: string }>>();
      for (const tt of tokenTags) {
        const arr = tagsByToken.get(tt.tokenAddress) ?? [];
        arr.push({ name: tt.Tag.name, type: tt.Tag.type });
        tagsByToken.set(tt.tokenAddress, arr);
      }

      // Assemble rows
      const rows: WatchedTokenRow[] = watched.map((w: any) => ({
        tokenAddress: w.tokenAddress,
        name: w.TokenInfo?.name ?? null,
        symbol: w.TokenInfo?.symbol ?? null,
        imageUrl: w.TokenInfo?.imageUrl ?? null,
        marketCapUsd: w.TokenInfo?.marketCapUsd ?? null,
        liquidityUsd: w.TokenInfo?.liquidityUsd ?? null,
        latestMessageAt: latestByToken.get(w.tokenAddress) ?? null,
        tags: tagsByToken.get(w.tokenAddress) ?? [],
      }));

      // Sort by latest activity desc
      rows.sort((a, b) => {
        const at = a.latestMessageAt ? new Date(a.latestMessageAt).getTime() : 0;
        const bt = b.latestMessageAt ? new Date(b.latestMessageAt).getTime() : 0;
        return bt - at;
      });

      return rows;
    });
  }
}


