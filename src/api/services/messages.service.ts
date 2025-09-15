import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { Prisma } from '@prisma/client';
import { parseMentions } from '../shared/mention-parser';
import { MessageGateway } from '../shared/message.gateway';

export interface CreateMessageInput {
  body: string;
  source: 'dashboard' | 'telegram' | 'bot';
  authorUserId?: string;
}

export interface ListOptions {
  cursor?: string; // ISO datetime string
  limit?: number;  // default 50, max 100
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(private readonly db: DatabaseService, private readonly messageGateway: MessageGateway) {}

  async createMessage(input: CreateMessageInput) {
    const mentions = parseMentions(input.body);
    // Resolve mentions (symbol -> address) at controller layer for now; keep service pure
    return this.db.$transaction(async (tx) => {
      const client = tx as unknown as { message: any; messageMention: any };
      const message = await client.message.create({
        data: {
          body: input.body,
          // Use string literal to avoid dependency on generated Prisma enums pre-generate
          source: input.source.toUpperCase() as unknown as string,
          authorUserId: input.authorUserId ?? null,
        },
      });

      if (mentions.length > 0) {
        await client.messageMention.createMany({
          data: mentions.map((m) => ({
            messageId: message.id,
            // Use string literal to avoid dependency on generated Prisma enums pre-generate
            kind: m.kind.toUpperCase() as unknown as string,
            refId: m.refId ?? null,
            rawValue: m.rawValue,
            metaJson: m.metaJson as unknown as Prisma.InputJsonValue,
          })),
        });
      }

      // Publish events
      try {
        await this.messageGateway.publishGlobal({ id: message.id, createdAt: message.createdAt });
        // Emit per-token events for any token mentions with refId
        for (const m of mentions) {
          if (m.kind === 'token' && m.refId) {
            await this.messageGateway.publishToken(m.refId, { id: message.id, createdAt: message.createdAt });
          }
        }
      } catch (e) {
        this.logger.warn('Failed to publish message events', e as any);
      }

      return message;
    });
  }

  async listGlobal(options: ListOptions = {}): Promise<PagedResult<any>> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const beforeDate = options.cursor ? new Date(options.cursor) : undefined;

    return this.db.$transaction(async (tx) => {
      const client = tx as any;
      const where = beforeDate ? { createdAt: { lt: beforeDate } } : undefined;
      const items = await client.message.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: { mentions: true },
      });
      const nextCursor = items.length === limit ? items[items.length - 1].createdAt.toISOString() : null;
      return { items, nextCursor };
    });
  }

  async listForToken(tokenAddress: string, options: ListOptions = {}): Promise<PagedResult<any>> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const beforeDate = options.cursor ? new Date(options.cursor) : undefined;

    return this.db.$transaction(async (tx) => {
      const client = tx as any;
      const where = {
        ...(beforeDate ? { createdAt: { lt: beforeDate } } : {}),
        mentions: { some: { kind: 'TOKEN', refId: tokenAddress } },
      };
      const items = await client.message.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: { mentions: true },
      });
      const nextCursor = items.length === limit ? items[items.length - 1].createdAt.toISOString() : null;
      return { items, nextCursor };
    });
  }

  async editMessage(messageId: string, newBody: string) {
    const newMentions = parseMentions(newBody);
    return this.db.$transaction(async (tx) => {
      const client = tx as any;
      const existing = await client.message.findUnique({
        where: { id: messageId },
        include: { mentions: true },
      });
      if (!existing) return null;

      await client.messageRevision.create({
        data: {
          messageId,
          body: existing.body,
        },
      });

      const updated = await client.message.update({
        where: { id: messageId },
        data: { body: newBody },
      });

      await client.messageMention.deleteMany({ where: { messageId } });
      if (newMentions.length > 0) {
        await client.messageMention.createMany({
          data: newMentions.map((m: any) => ({
            messageId,
            kind: (m.kind ?? 'token').toString().toUpperCase(),
            refId: m.refId ?? null,
            rawValue: m.rawValue,
            metaJson: m.metaJson as Prisma.InputJsonValue,
          })),
        });
      }
      return updated;
    });
  }

  async resolveSymbol(sym: string) {
    const symbol = sym.trim();
    if (!symbol) return [];
    return this.db.$transaction(async (tx) => {
      const client = tx as any;
      const items = await client.tokenInfo.findMany({
        where: { symbol: { equals: symbol, mode: 'insensitive' } },
        select: { tokenAddress: true, name: true, symbol: true },
        take: 20,
      });
      return items;
    });
  }
}


