import { Body, Controller, Get, Param, Patch, Post, Query, ValidationPipe } from '@nestjs/common';
import { MessagesService } from '../services/messages.service';

class PostMessageDto {
  body!: string;
  source!: 'dashboard' | 'telegram' | 'bot';
}

@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  async postMessage(@Body(new ValidationPipe()) dto: PostMessageDto) {
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


