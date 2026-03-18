import { Controller, Get, Query, Post, Body, Param, ValidationPipe } from '@nestjs/common';
import { WatchedTokensService } from '../services/watched-tokens.service';

@Controller('watched-tokens')
export class WatchedTokensController {
  constructor(private readonly svc: WatchedTokensService) {}

  @Get()
  async list(@Query('list') list?: 'FAVORITES' | 'GRADUATION' | 'HOLDSTRONG') {
    return this.svc.listWatched(list ?? 'FAVORITES');
  }

  @Post(':tokenAddress/tags')
  async addTags(
    @Param('tokenAddress') tokenAddress: string,
    @Body(new ValidationPipe()) body: { items: Array<{ type: string; name: string }> }
  ) {
    const items = Array.isArray(body?.items) ? body.items : [];
    return this.svc.addTags(tokenAddress, items);
  }

  @Post(':tokenAddress/watch')
  async setWatch(
    @Param('tokenAddress') tokenAddress: string,
    @Body('on') on: boolean,
  ) {
    return this.svc.setWatched(tokenAddress, on === undefined ? true : !!on);
  }
}


