import { Controller, Get, Query, Post, Body, Param, ValidationPipe, Req } from '@nestjs/common';
import { User } from '@prisma/client';
import { WatchedTokensService } from '../services/watched-tokens.service';
import { IsAnalyst } from '../shared/decorators/analyst.decorator';
import { MessageGateway } from '../shared/message.gateway';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@Controller('watched-tokens')
@IsAnalyst()
export class WatchedTokensController {
  constructor(
    private readonly svc: WatchedTokensService,
    private readonly messageGateway: MessageGateway,
  ) {}

  @Get()
  async list(@Query('list') list?: 'FAVORITES' | 'GRADUATION' | 'HOLDSTRONG') {
    return this.svc.listWatched(list ?? 'FAVORITES');
  }

  @Post(':tokenAddress/tags')
  async addTags(
    @Param('tokenAddress') tokenAddress: string,
    @Body(new ValidationPipe()) body: { items: Array<{ type: string; name: string }> },
    @Req() req: AuthenticatedRequest,
  ) {
    const items = Array.isArray(body?.items) ? body.items : [];
    return this.svc.addTags(tokenAddress, items, req.user?.id);
  }

  @Post(':tokenAddress/watch')
  async setWatch(
    @Param('tokenAddress') tokenAddress: string,
    @Body('on') on: boolean,
    @Req() req: AuthenticatedRequest,
  ) {
    const isOn = on === undefined ? true : !!on;
    const result = await this.svc.setWatched(tokenAddress, isOn, req.user?.id);
    if (isOn && result.isNew) {
      try {
        await this.messageGateway.publishTokenAdded({ tokenAddress, addedBy: req.user?.id ?? null, addedAt: new Date().toISOString() });
      } catch {
        // non-critical, swallow
      }
    }
    return result;
  }
}


