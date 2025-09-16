import { Controller, Get, Query } from '@nestjs/common';
import { WatchedTokensService } from '../services/watched-tokens.service';

@Controller('watched-tokens')
export class WatchedTokensController {
  constructor(private readonly svc: WatchedTokensService) {}

  @Get()
  async list(@Query('list') list?: 'FAVORITES' | 'GRADUATION' | 'HOLDSTRONG') {
    return this.svc.listWatched(list ?? 'FAVORITES');
  }
}


