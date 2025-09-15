import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { Prisma } from '@prisma/client';
import { parseMentions } from '../shared/mention-parser';

export interface CreateMessageInput {
  body: string;
  source: 'dashboard' | 'telegram' | 'bot';
  authorUserId?: string;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(private readonly db: DatabaseService) {}

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

      return message;
    });
  }
}


