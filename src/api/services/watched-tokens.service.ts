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
  priceUsd?: string | null;
  volume24h?: number | null;
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

  async listWatchedAddresses(list: 'FAVORITES' | 'GRADUATION' | 'HOLDSTRONG' = 'FAVORITES'): Promise<string[]> {
    return this.db.$transaction(async (tx) => {
      const client = tx as any;
      const watched = await client.watchedToken.findMany({
        where: { list },
        select: { tokenAddress: true },
      });
      // Dedupe just in case
      const seen = new Set<string>();
      const out: string[] = [];
      for (const w of watched) {
        if (!seen.has(w.tokenAddress)) { seen.add(w.tokenAddress); out.push(w.tokenAddress); }
      }
      return out;
    });
  }

  async listWatched(list: 'FAVORITES' | 'GRADUATION' | 'HOLDSTRONG' = 'FAVORITES'): Promise<WatchedTokenRow[]> {
    return this.db.$transaction(async (tx) => {
      const client = tx as any;

      let watched = await client.watchedToken.findMany({
        where: { list },
        select: { tokenAddress: true, TokenInfo: { select: { name: true, symbol: true, imageUrl: true, marketCapUsd: true, liquidityUsd: true, priceUsd: true, volume24h: true } } },
      });
      // Dedupe by tokenAddress in case of historical duplicates
      const seen = new Set<string>();
      watched = watched.filter((w: any) => (seen.has(w.tokenAddress) ? false : (seen.add(w.tokenAddress), true)));
      let addresses: string[] = watched.map((w: any) => w.tokenAddress);

      // No fallback: token repo shows only explicitly watched tokens
      if (addresses.length === 0) return [];

      // Fetch latest message timestamps per token using optimized subquery approach
      // Instead of scanning 1000 messages, fetch top 1 per token directly
      const latestByToken = new Map<string, string>();

      // Use raw query for better performance with DISTINCT ON (Postgres) or equivalent
      // Fallback: batch small queries per token (better than 1000-row scan)
      const latestPromises = addresses.map(async (addr) => {
        const latest = await client.message.findFirst({
          where: { mentions: { some: { kind: 'TOKEN', refId: addr } } },
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
        });
        if (latest) {
          latestByToken.set(addr, new Date(latest.createdAt).toISOString());
        }
      });

      // Execute in batches of 20 to avoid overwhelming DB
      for (let i = 0; i < latestPromises.length; i += 20) {
        await Promise.all(latestPromises.slice(i, i + 20));
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
        priceUsd: w.TokenInfo?.priceUsd ?? null,
        volume24h: w.TokenInfo?.volume24h ?? null,
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

  async addTags(tokenAddress: string, items: Array<{ type: string; name: string }>, userId?: string) {
    const normalized = Array.from(new Set(items
      .map((i) => ({ type: (i.type || 'meta').toUpperCase(), name: (i.name || '').toLowerCase().trim() }))
      .filter((i) => i.name.length > 0)
    ));
    if (normalized.length === 0) return { added: 0 };
    if (normalized.length > 10) {
      // rudimentary rate/size limit: cap per request
      normalized.length = 10;
    }
    return this.db.$transaction(async (tx) => {
      const client = tx as any;
      let added = 0;
      for (const it of normalized) {
        const tag = await client.tag.upsert({
          where: { name: it.name },
          update: { type: it.type },
          create: { name: it.name, type: it.type },
        });
        const existed = await client.tokenTag.findUnique({ where: { tokenAddress_tagId: { tokenAddress, tagId: tag.id } } });
        if (!existed) {
          await client.tokenTag.create({ data: { tokenAddress, tagId: tag.id, source: 'user-note', confidence: 1 } });
          added++;
        }
      }
      // ensure token is watched so UI reflects tags
      await client.watchedToken.upsert({
        where: { tokenAddress_list: { tokenAddress, list: 'FAVORITES' } },
        update: {},
        create: { tokenAddress, list: 'FAVORITES', createdBy: userId ?? null },
      });
      return { added };
    });
  }

  async setWatched(tokenAddress: string, on: boolean, userId?: string) {
    return this.db.$transaction(async (tx) => {
      const client = tx as any;
      if (on) {
        // Ensure TokenInfo exists to satisfy FK
        const ti = await client.tokenInfo.findUnique({ where: { tokenAddress } });
        if (!ti) {
          await client.tokenInfo.create({ data: { tokenAddress, name: 'Unknown Token' } });
        }
        await client.watchedToken.upsert({
          where: { tokenAddress_list: { tokenAddress, list: 'FAVORITES' } },
          update: {},
          create: { tokenAddress, list: 'FAVORITES', createdBy: userId ?? null },
        });
        return { ok: true, watched: true };
      } else {
        const existed = await client.watchedToken.findUnique({ where: { tokenAddress_list: { tokenAddress, list: 'FAVORITES' } } });
        if (existed) {
          await client.watchedToken.delete({ where: { tokenAddress_list: { tokenAddress, list: 'FAVORITES' } } });
        }
        return { ok: true, watched: false };
      }
    });
  }
}


