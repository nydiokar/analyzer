import { Body, Controller, Get, Post, Query, ValidationPipe } from '@nestjs/common';
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
    // Minimal placeholder to keep controller compile-ready; service method later
    return { items: [], nextCursor: null, take, cursor: cursor ?? null };
  }
}


