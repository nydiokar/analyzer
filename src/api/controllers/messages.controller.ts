import { Body, Controller, Get, Param, Patch, Post, Query, ValidationPipe, ConflictException } from '@nestjs/common';
import { MessagesService } from '../services/messages.service';
import { parseMentions } from '../shared/mention-parser';

class PostMessageDto {
  body!: string;
  source!: 'dashboard' | 'telegram' | 'bot';
}

@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
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
      return this.messages.createMessage({ body: rewritten, source: dto.source });
    }
    return this.messages.createMessage({ body: dto.body, source: dto.source });
  }

  @Get()
  async listGlobal(
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '50',
  ) {
    const take = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    return this.messages.listGlobal({ cursor: cursor ?? undefined, limit: take });
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
}


