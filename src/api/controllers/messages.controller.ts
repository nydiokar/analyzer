import { Body, Controller, Get, Param, Patch, Post, Query, ValidationPipe, ConflictException, Delete, Req, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MessagesService } from '../services/messages.service';
import { parseMentions } from '../shared/mention-parser';
import { WatchedTokensService } from '../services/watched-tokens.service';
import { Request } from 'express';
import { IsISO8601, IsNotEmpty, IsString } from 'class-validator';

class PostMessageDto {
  body!: string;
  source!: 'dashboard' | 'telegram' | 'bot';
  parentId?: string | null;
}

class UpdateReadStateDto {
  @IsString()
  @IsNotEmpty()
  scope!: string;

  @IsISO8601()
  lastReadAt!: string;
}

@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService, private readonly watchedTokens: WatchedTokensService) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 messages per minute (0.5/sec avg, allows bursts)
  async postMessage(@Body(new ValidationPipe()) dto: PostMessageDto) {
    // Server-side enforcement per plan: reject unresolved @sym: with 409; rewrite to @ca: when unambiguous
    const mentions = parseMentions(dto.body ?? '');
    const symbolMentions = mentions.filter((m: any) => m.kind === 'token' && m.metaJson && (m.metaJson as any).symbol);
    if (symbolMentions.length > 0) {
      const uniqueSymbols = Array.from(new Set(symbolMentions.map((m: any) => String((m.metaJson as any).symbol))));
      const candidatesBySymbol: Record<string, any[]> = {};
      for (const sym of uniqueSymbols) {
        const candidates = await this.messages.resolveSymbol(sym);
        candidatesBySymbol[sym] = candidates;
      }
      const ambiguousOrUnresolved = uniqueSymbols.filter((s) => (candidatesBySymbol[s]?.length ?? 0) !== 1);
      if (ambiguousOrUnresolved.length > 0) {
        throw new ConflictException({ reason: 'SYMBOL_AMBIGUITY', candidatesBySymbol });
      }
      let rewritten = dto.body;
      for (const sym of uniqueSymbols) {
        const address = candidatesBySymbol[sym][0]?.tokenAddress as string;
        const re = new RegExp(`@sym:${sym}\\b`, 'gi');
        rewritten = rewritten.replace(re, `@ca:${address}`);
      }
      // Ensure WatchedToken upsert happens BEFORE message event publish to avoid race
      const tokenMentions = parseMentions(rewritten).filter((m: any) => m.kind === 'token' && m.refId).map((m: any) => m.refId as string);
      if (tokenMentions.length) {
        await this.watchedTokens.ensureWatchedAndEnrich(tokenMentions, 'system');
      }
      const created = await this.messages.createMessage({ body: rewritten, source: dto.source, parentId: dto.parentId ?? null });
      return created;
    }
    const tokenMentions = parseMentions(dto.body).filter((m: any) => m.kind === 'token' && m.refId).map((m: any) => m.refId as string);
    if (tokenMentions.length) {
      await this.watchedTokens.ensureWatchedAndEnrich(tokenMentions, 'system');
    }
    const created = await this.messages.createMessage({ body: dto.body, source: dto.source, parentId: dto.parentId ?? null });
    return created;
  }

  @Get()
  async listGlobal(
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '50',
  ) {
    const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    return this.messages.listGlobal({ cursor: cursor ?? undefined, limit: take });
  }

  @Get('read-state')
  async getReadState(@Req() req: Request & { user?: any }, @Query('scope') scope?: string) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('User context missing');
    const rows = await this.messages.getReadStatesForUser(userId, scope ?? undefined);
    if (scope) {
      const row = rows[0];
      return {
        scope,
        lastReadAt: row?.lastReadAt ? row.lastReadAt.toISOString() : null,
      };
    }
    return rows.map((row) => ({ scope: row.scope, lastReadAt: row.lastReadAt ? row.lastReadAt.toISOString() : null }));
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.messages.getById(id);
  }

  @Get('resolve/symbol')
  async resolveSymbol(@Query('sym') sym: string) {
    return this.messages.resolveSymbol(sym);
  }

  @Get('/tokens/:tokenAddress/messages')
  async listForToken(
    @Param('tokenAddress') tokenAddress: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '50',
  ) {
    const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    return this.messages.listForToken(tokenAddress, { cursor: cursor ?? undefined, limit: take });
  }

  @Patch(':id')
  async editMessage(@Param('id') id: string, @Body('body') body: string) {
    return this.messages.editMessage(id, body);
  }

  @Delete(':id')
  async deleteMessage(@Param('id') id: string) {
    return this.messages.deleteMessage(id);
  }

  @Post('read-state')
  async setReadState(
    @Req() req: Request & { user?: any },
    @Body(new ValidationPipe({ transform: true })) dto: UpdateReadStateDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('User context missing');
    const scope = dto.scope.trim();
    if (!scope) throw new BadRequestException('Scope must be provided');
    const lastReadAt = new Date(dto.lastReadAt);
    if (Number.isNaN(lastReadAt.getTime())) {
      throw new BadRequestException('Invalid lastReadAt timestamp');
    }

    const updated = await this.messages.updateReadState(userId, scope, lastReadAt);
    return { scope: updated.scope, lastReadAt: updated.lastReadAt.toISOString() };
  }

  @Post(':id/pin')
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 pins per minute (power users organizing threads)
  async setPinned(@Param('id') id: string, @Body('isPinned') isPinned: boolean) {
    await this.messages.setPinned(id, !!isPinned);
    return { ok: true };
  }

  @Post(':id/react')
  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 reactions per minute (scanning feed, rapid reactions)
  async react(@Param('id') id: string, @Body('type') type: string, @Body('on') on: boolean) {
    await this.messages.setReaction(id, String(type || '').toLowerCase(), !!on);
    return { ok: true };
  }
}


