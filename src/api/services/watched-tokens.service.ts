import { Injectable } from '@nestjs/common';
import { prisma } from '../../core/services/database-service';
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
  userTags?: string[];
}

@Injectable()
export class WatchedTokensService {
  constructor(private readonly tokenInfoService: TokenInfoService) {}

  async ensureTokenInfoRecords(tokenAddresses: string[]) {
    const uniqueAddresses = Array.from(new Set(tokenAddresses.filter(Boolean)));
    if (uniqueAddresses.length === 0) return;
    await prisma.$transaction(async (tx) => {
      const client = tx as any;
      for (const addr of uniqueAddresses) {
        const ti = await client.tokenInfo.findUnique({ where: { tokenAddress: addr } });
        if (!ti) {
          await client.tokenInfo.create({ data: { tokenAddress: addr, name: 'Unknown Token' } });
        }
      }
    });
  }

  async triggerTokenEnrichment(tokenAddresses: string[]) {
    const uniqueAddresses = Array.from(new Set(tokenAddresses.filter(Boolean)));
    if (uniqueAddresses.length === 0) return;
    try {
      await this.tokenInfoService.triggerTokenInfoEnrichment(uniqueAddresses, 'system-enrichment-job');
    } catch (e) {
      // swallow and log upstream
    }
  }

  async ensureWatchedAndEnrich(tokenAddresses: string[], userId?: string) {
    const uniqueAddresses = Array.from(new Set(tokenAddresses.filter(Boolean)));
    if (uniqueAddresses.length === 0) return;
    await this.ensureTokenInfoRecords(uniqueAddresses);
    await prisma.$transaction(async (tx) => {
      const client = tx as any;
      for (const addr of uniqueAddresses) {
        await client.watchedToken.upsert({
          where: { tokenAddress_list: { tokenAddress: addr, list: 'FAVORITES' } },
          create: { tokenAddress: addr, list: 'FAVORITES', createdBy: userId ?? null },
          update: {},
        });
      }
    });
    await this.triggerTokenEnrichment(uniqueAddresses);
  }

  async listWatchedAddresses(list: 'FAVORITES' | 'GRADUATION' | 'HOLDSTRONG' = 'FAVORITES'): Promise<string[]> {
    return prisma.$transaction(async (tx) => {
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

  async buildRowsForAddresses(addresses: string[]): Promise<WatchedTokenRow[]> {
    const uniqueAddresses = Array.from(new Set(addresses.filter(Boolean)));
    if (uniqueAddresses.length === 0) return [];
    return prisma.$transaction(async (tx) => {
      const client = tx as any;
      const tokenInfos = await client.tokenInfo.findMany({
        where: { tokenAddress: { in: uniqueAddresses } },
        select: {
          tokenAddress: true,
          name: true,
          symbol: true,
          imageUrl: true,
          marketCapUsd: true,
          liquidityUsd: true,
          priceUsd: true,
          volume24h: true,
        },
      });
      const infoByAddress = new Map<string, any>(tokenInfos.map((row: any) => [row.tokenAddress, row]));

      // Fetch latest message timestamps per token using optimized subquery approach
      const latestByToken = new Map<string, string>();
      const latestPromises = uniqueAddresses.map(async (addr) => {
        const latest = await client.message.findFirst({
          where: { mentions: { some: { kind: 'TOKEN', refId: addr } } },
          select: { createdAt: true },
          orderBy: { createdAt: 'desc' },
        });
        if (latest) {
          latestByToken.set(addr, new Date(latest.createdAt).toISOString());
        }
      });

      for (let i = 0; i < latestPromises.length; i += 20) {
        await Promise.all(latestPromises.slice(i, i + 20));
      }

      const tokenTags = await client.tokenTag.findMany({
        where: { tokenAddress: { in: uniqueAddresses } },
        select: { tokenAddress: true, Tag: { select: { name: true, type: true } } },
      });
      const tagsByToken = new Map<string, Array<{ name: string; type: string }>>();
      for (const tt of tokenTags) {
        const arr = tagsByToken.get(tt.tokenAddress) ?? [];
        arr.push({ name: tt.Tag.name, type: tt.Tag.type });
        tagsByToken.set(tt.tokenAddress, arr);
      }

      const rows: WatchedTokenRow[] = uniqueAddresses.map((tokenAddress) => {
        const info = infoByAddress.get(tokenAddress);
        return {
          tokenAddress,
          name: info?.name ?? null,
          symbol: info?.symbol ?? null,
          imageUrl: info?.imageUrl ?? null,
          marketCapUsd: info?.marketCapUsd ?? null,
          liquidityUsd: info?.liquidityUsd ?? null,
          priceUsd: info?.priceUsd ?? null,
          volume24h: info?.volume24h ?? null,
          latestMessageAt: latestByToken.get(tokenAddress) ?? null,
          tags: tagsByToken.get(tokenAddress) ?? [],
        };
      });

      rows.sort((a, b) => {
        const at = a.latestMessageAt ? new Date(a.latestMessageAt).getTime() : 0;
        const bt = b.latestMessageAt ? new Date(b.latestMessageAt).getTime() : 0;
        return bt - at;
      });

      return rows;
    });
  }

  async listWatched(list: 'FAVORITES' | 'GRADUATION' | 'HOLDSTRONG' = 'FAVORITES'): Promise<WatchedTokenRow[]> {
    const addresses = await this.listWatchedAddresses(list);
    return this.buildRowsForAddresses(addresses);
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
    return prisma.$transaction(async (tx) => {
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
    if (on) {
      await this.ensureTokenInfoRecords([tokenAddress]);
      await this.triggerTokenEnrichment([tokenAddress]);
    }
    return prisma.$transaction(async (tx) => {
      const client = tx as any;
      if (on) {
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


